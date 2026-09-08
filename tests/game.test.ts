import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { connect as connectTcp } from 'node:net';
import { addPlayer, createGame, move, parseInput, startRound, tick, type Game } from '../shared/game.ts';
import { createArenaServer } from '../server/index.ts';

test('input validation, speed limit, arena bounds and obstacle collision', () => {
  assert.equal(parseInput({ x: NaN, z: 0, yaw: 0, fire: false }), null);
  assert.equal(parseInput({ x: 0, z: 0, yaw: Infinity, fire: false }), null);
  assert.equal(parseInput({ x: '1', z: 0, yaw: 0, fire: false }), null);
  const input = parseInput({ x: 20, z: 20, yaw: 100, fire: true })!;
  assert.ok(Math.abs(Math.hypot(input.x, input.z) - 1) < 1e-8);
  const player = { x: 11.4, z: 0 };
  move(player, 1, 0, 1);
  assert.equal(player.x, 11.5);
  const stuck = { x: 4.5, z: 2.8 };
  move(stuck, 0, 0, 0);
  assert.ok(Math.abs(stuck.x - 4.5) >= 1.5);
});

function duel(mode: Game['mode'] = 'ffa') {
  const game = createGame('ABCDEF', mode);
  const a = addPlayer(game, 'a', '첫째'), b = addPlayer(game, 'b', '둘째');
  a.ready = b.ready = true;
  assert.equal(startRound(game), true);
  tick(game, 3.1);
  a.x = -3; a.z = 0; b.x = 3; b.z = 0;
  a.input = { x: 0, z: 0, yaw: Math.PI / 2, fire: true };
  return { game, a, b };
}

test('authoritative shots, cooldown, four-hit elimination and rematch reset', () => {
  const { game, a, b } = duel();
  for (let i = 0; i < 18; i++) tick(game, 1 / 30);
  assert.equal(b.hp, 75);
  assert.equal(game.nextShot, 1);
  for (let i = 0; i < 100; i++) tick(game, 1 / 30);
  assert.equal(b.hp, 0);
  assert.equal(game.phase, 'finished');
  assert.equal(game.winner, '첫째 승리');
  assert.equal(startRound(game), false);
  a.ready = b.ready = true;
  assert.equal(startRound(game), true);
  assert.equal(a.hp, 100); assert.equal(b.hp, 100);
  assert.equal(a.input.fire, false);
  assert.equal(game.round, 2);
});

test('obstacles block projectiles and teammates do not take damage', () => {
  const { game, a, b } = duel();
  a.x = -8; a.z = 2.8; b.x = -1; b.z = 2.8;
  for (let i = 0; i < 90; i++) tick(game, 1 / 30);
  assert.equal(b.hp, 100);
  const team = duel('teams');
  addPlayer(team.game, 'c', '셋째').team = 1;
  team.a.team = team.b.team = 0;
  for (let i = 0; i < 60; i++) tick(team.game, 1 / 30);
  assert.equal(team.b.hp, 100);
});

test('six seats, balanced team start, readiness and disconnect victory', () => {
  const game = createGame('ABCDEF', 'teams');
  for (let i = 0; i < 6; i++) addPlayer(game, String(i), '플레이어').ready = true;
  assert.throws(() => addPlayer(game, 'extra', '넘침'));
  game.players[0].connected = false;
  assert.equal(startRound(game), false);
  game.players.splice(0, 2);
  game.players.forEach(p => { p.team = 0; });
  assert.equal(startRound(game), true);
  assert.equal(game.players.filter(p => p.team === 0).length, 2);
  const { game: match, b } = duel();
  b.connected = false;
  tick(match, 1 / 30);
  assert.equal(match.phase, 'finished');
  assert.equal(match.winner, '첫째 승리');
});

test('two real WebSockets join, start, synchronize, isolate rooms, validate and reconnect', async () => {
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const address = arena.server.address() as { port: number };
  const url = `ws://127.0.0.1:${address.port}/ws`;
  type Message = { type: string; id: string; code: string; token: string; game: Game; message: string };
  const sockets: WebSocket[] = [];
  async function client() {
    const ws = new WebSocket(url); sockets.push(ws);
    const messages: Message[] = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>(done => ws.once('open', done));
    return {
      ws, send: (data: unknown) => ws.send(JSON.stringify(data)),
      async wait(predicate: (m: Message) => boolean, timeout = 15000) {
        const start = performance.now();
        while (performance.now() - start < timeout) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise(done => setTimeout(done, 20));
        }
        throw new Error('Timed out waiting for server message');
      },
    };
  }
  try {
    const a = await client(), b = await client(), c = await client();
    a.send({ type: 'create', name: '첫째' });
    const joinedA = await a.wait(m => m.type === 'joined');
    b.send({ type: 'join', name: '둘째', code: joinedA.code });
    const joinedB = await b.wait(m => m.type === 'joined');
    c.send({ type: 'create', name: '다른 방' });
    const joinedC = await c.wait(m => m.type === 'joined');
    assert.notEqual(joinedA.code, joinedC.code);
    a.send({ type: 'ready' }); b.send({ type: 'ready' });
    await a.wait(m => m.type === 'state' && m.game.phase === 'playing');
    await b.wait(m => m.type === 'state' && m.game.phase === 'playing');
    a.send({ type: 'input', input: { x: 100, z: 0, yaw: 0, fire: false } });
    const moved = await b.wait(m => m.type === 'state' && m.game.players.some(p => p.id === joinedA.id && p.x > 8.1));
    assert.ok(moved.game.players.find(p => p.id === joinedA.id)!.x < 10);
    const other = await c.wait(m => m.type === 'state');
    assert.equal(other.game.players.length, 1);
    b.ws.close();
    await new Promise<void>(done => b.ws.once('close', () => done()));
    const resumed = await client();
    resumed.send({ type: 'resume', code: joinedA.code, token: joinedB.token });
    assert.equal((await resumed.wait(m => m.type === 'joined')).id, joinedB.id);
    const bad = await client();
    bad.send({ type: 'resume', code: joinedA.code, token: 'wrong' });
    assert.equal((await bad.wait(m => m.type === 'expired')).type, 'expired');
    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.deepEqual(await health.json(), { ok: true });
    const secret = await fetch(`http://127.0.0.1:${address.port}/%2e%2e/package.json`);
    assert.equal(secret.status, 404);
    const malformed = await new Promise<string>((done, reject) => {
      let response = '';
      const tcp = connectTcp(address.port, '127.0.0.1', () => tcp.write('GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
      tcp.on('data', chunk => { response += chunk; });
      tcp.on('end', () => done(response));
      tcp.on('error', reject);
    });
    assert.match(malformed, /^HTTP\/1.1 400/);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`)).status, 200);
  } finally {
    sockets.forEach(ws => ws.terminate());
    await arena.close();
  }
});
