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
  move(player, 1, 0, 1, 0, 'arena');
  assert.equal(player.x, 11.5);
  const stuck = { x: 4.5, z: 2.8 };
  move(stuck, 0, 0, 0, 0, 'arena');
  assert.ok(Math.abs(stuck.x - 4.5) >= 1.5);
});

function duel(mode: Game['mode'] = 'ffa') {
  const game = createGame('ABCDEF', mode, 'arena');
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
  assert.deepEqual(game.hits, [{ owner: a.id, target: b.id, x: b.x, z: b.z, damage: 25 }]);
  for (let i = 0; i < 100; i++) tick(game, 1 / 30);
  assert.equal(b.hp, 0);
  assert.equal(game.phase, 'finished');
  assert.equal(game.winner, '첫째 승리');
  assert.equal(game.hits.length, 4);
  assert.ok(game.hits.every(hit => hit.owner === a.id && hit.target === b.id && hit.damage === 25));
  assert.equal(startRound(game), false);
  a.ready = b.ready = true;
  assert.equal(startRound(game), true);
  assert.equal(a.hp, 100); assert.equal(b.hp, 100);
  assert.equal(a.input.fire, false);
  assert.equal(game.round, 2);
  assert.deepEqual(game.hits, []);
});

test('obstacles block projectiles and teammates do not take damage', () => {
  const { game, a, b } = duel();
  a.x = -8; a.z = 2.8; b.x = -1; b.z = 2.8;
  for (let i = 0; i < 90; i++) tick(game, 1 / 30);
  assert.equal(b.hp, 100);
  assert.deepEqual(game.hits, []);
  const team = duel('teams');
  addPlayer(team.game, 'c', '셋째').team = 1;
  team.a.team = team.b.team = 0;
  for (let i = 0; i < 60; i++) tick(team.game, 1 / 30);
  assert.equal(team.b.hp, 100);
  assert.ok(team.game.hits.every(hit => hit.target !== team.b.id));
});

test('cleavers catch the enlarged body edge but miss outside it in every map and view', () => {
  for (const map of ['arena', 'ward', 'baron'] as const) for (const view of ['top', 'fps'] as const) {
    for (const [offset, expectedHp] of [[.8, 75], [1.1, 75], [1.3, 100], [-1.1, 75], [-1.3, 100]]) {
      const game = createGame('EDGE', 'duel', map, view);
      const shooter = addPlayer(game, 'a', '발사자'), target = addPlayer(game, 'b', '상대');
      game.phase = 'playing';
      shooter.x = -3; shooter.z = offset; target.x = 3; target.z = 0;
      shooter.input = { x: 0, z: 0, yaw: Math.PI / 2, fire: true };
      tick(game, 1 / 30); shooter.input.fire = false;
      for (let frame = 0; frame < 20; frame++) tick(game, 1 / 30);
      assert.equal(target.hp, expectedHp, `${map}/${view} offset ${offset}`);
      assert.equal(game.hits.length, expectedHp === 75 ? 1 : 0);
    }
  }
});

test('projectiles pass through disconnected players and hit connected opponents', () => {
  const { game, b } = duel();
  const disconnected = addPlayer(game, 'offline', '접속 종료');
  disconnected.x = 0; disconnected.z = 0; disconnected.connected = false;
  for (let i = 0; i < 16; i++) tick(game, 1 / 30);
  assert.equal(disconnected.hp, 100);
  assert.equal(b.hp, 75);
  assert.equal(game.hits.length, 1);
  assert.equal(game.hits[0].target, b.id);
});

test('bots aim at connected opponents instead of disconnected players', () => {
  const game = createGame('ABCDEF', 'ffa', 'arena');
  const bot = addPlayer(game, 'bot', '로봇', true);
  const offline = addPlayer(game, 'offline', '접속 종료');
  const opponent = addPlayer(game, 'opponent', '상대');
  bot.x = bot.z = 0;
  offline.x = 0; offline.z = 3; offline.connected = false;
  opponent.x = 0; opponent.z = -3;
  game.phase = 'playing';
  tick(game, 1 / 30);
  assert.ok(game.shots[0].vz < 0);
});

test('projectiles preserve friendly fire protection after their owner leaves', () => {
  const { game, a, b } = duel('teams');
  const ally = addPlayer(game, 'ally', '아군');
  ally.team = a.team; ally.x = ally.z = 0;
  tick(game, 1 / 30);
  assert.equal(game.shots.length, 1);
  game.players = game.players.filter(p => p.id !== a.id);
  for (let i = 0; i < 15; i++) tick(game, 1 / 30);
  assert.equal(ally.hp, 100);
  assert.equal(b.hp, 75);
});

test('six seats, balanced team start, readiness and disconnect victory', () => {
  const game = createGame('ABCDEF', 'teams', 'arena');
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

test('shots hit the first player along their path, before later players, obstacles or the arena edge', () => {
  const order = createGame('ABCDEF', 'ffa', 'arena');
  const shooter = addPlayer(order, 'a', '발사자');
  const far = addPlayer(order, 'far', '뒤 상대'), near = addPlayer(order, 'near', '앞 상대');
  order.phase = 'playing';
  shooter.x = -1.6; shooter.z = 0;
  far.x = .3; far.z = .5; near.x = 0; near.z = -.5;
  shooter.input = { x: 0, z: 0, yaw: Math.PI / 2, fire: true };
  tick(order, 1 / 30); tick(order, 1 / 30);
  assert.equal(near.hp, 75); assert.equal(far.hp, 100);

  for (const [x, z, targetX, targetZ, yaw] of [
    [5.6, 4.5, 6, 2.8, Math.PI],
    [10.92, -1.24, 11.5, 0, Math.atan2(.8, .6)],
  ]) {
    const { game, a, b } = duel();
    a.x = x; a.z = z; b.x = targetX; b.z = targetZ; a.input.yaw = yaw;
    tick(game, 1 / 30); tick(game, 1 / 30);
    assert.equal(b.hp, 75);
    assert.equal(game.shots.length, 0);
  }
});

test('a press and release received before the same simulation tick fire exactly once', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const { port } = arena.server.address() as { port: number };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const message = () => new Promise<{ type: string; code: string; id: string }>(done => ws.once('message', raw => done(JSON.parse(raw.toString()))));
  try {
    await new Promise<void>(done => ws.once('open', done));
    const joined = message();
    ws.send(JSON.stringify({ type: 'create', name: '발사 검증', practice: true }));
    const { code, id } = await joined;
    const game = arena.rooms.get(code)!.game, player = game.players.find(p => p.id === id)!;
    game.phase = 'playing';
    game.players.find(p => p.bot)!.cooldown = 10;
    const input = { x: 0, z: 0, yaw: Math.PI / 2, fire: true };
    const pong = message();
    ws.send(JSON.stringify({ type: 'input', input }));
    ws.send(JSON.stringify({ type: 'input', input: { ...input, fire: false } }));
    ws.send(JSON.stringify({ type: 'ping', time: 1 }));
    assert.equal((await pong).type, 'pong');
    assert.equal(player.input.fire, false);
    context.mock.timers.tick(34);
    assert.equal(game.shots.filter(shot => shot.owner === id).length, 1);
    assert.equal(player.input.fire, false);
    for (let i = 0; i < 30; i++) context.mock.timers.tick(34);
    assert.equal(game.nextShot, 1);
  } finally { ws.terminate(); await arena.close(); }
});

test('real WebSockets join, start, synchronize, isolate rooms, validate, reconnect and cancel countdown on leave', async () => {
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
    const moved = await b.wait(m => m.type === 'state' && m.game.players.some(p => p.id === joinedA.id && p.x > -4.9));
    assert.ok(moved.game.players.find(p => p.id === joinedA.id)!.x < -3);
    const other = await c.wait(m => m.type === 'state');
    assert.equal(other.game.players.length, 1);
    const busy = await client();
    const busyClosed = new Promise<number>(done => busy.ws.once('close', done));
    busy.send({ type: 'resume', code: joinedA.code, token: joinedB.token });
    assert.equal((await busy.wait(m => m.type === 'error' || m.type === 'expired')).type, 'error');
    assert.equal(await busyClosed, 1013);
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

    for (const [map, mode] of [['ward', 'duel'], ['ward', 'teams'], ['arena', 'ffa'], ['arena', 'teams']] as const) {
      const host = await client();
      host.send({ type: 'create', name: '방장', mode, map });
      const room = await host.wait(m => m.type === 'joined');
      const guests = [];
      for (let i = 0; i < (mode === 'teams' ? 3 : 1); i++) {
        const guest = await client();
        guest.send({ type: 'join', name: '친구', code: room.code, map: map === 'arena' ? 'ward' : 'arena' });
        await guest.wait(m => m.type === 'joined');
        guests.push(guest);
      }
      host.send({ type: 'ready' }); guests.forEach(guest => guest.send({ type: 'ready' }));
      const started = await host.wait(m => m.type === 'state' && m.game.phase === 'countdown');
      assert.equal(started.game.map, map); assert.equal(started.game.mode, mode);
      guests.pop()!.send({ type: 'leave' });
      const remaining = await host.wait(m => m.type === 'state' && m.game.round === 1 && m.game.players.length === guests.length + 1);
      assert.equal(remaining.game.phase, 'lobby');
      assert.ok(remaining.game.players.every(p => !p.ready));
      const replacement = await client();
      replacement.send({ type: 'join', name: '새 친구', code: room.code });
      await replacement.wait(m => m.type === 'joined');
      host.send({ type: 'ready' });
      [...guests, replacement].forEach(guest => guest.send({ type: 'ready' }));
      const rematch = await host.wait(m => m.type === 'state' && m.game.phase === 'countdown' && m.game.round === 2);
      assert.equal(rematch.game.map, map);
    }
  } finally {
    sockets.forEach(ws => ws.terminate());
    await arena.close();
  }
});
