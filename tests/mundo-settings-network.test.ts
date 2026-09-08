import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { WebSocket } from 'ws';
import { createArenaServer } from '../server/index.ts';
import type { Game } from '../shared/game.ts';

test('host settings, fixed room view and authoritative spells survive reconnect, rematch and host transfer', async () => {
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const port = (arena.server.address() as { port: number }).port;
  const sockets: WebSocket[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  type Message = { type: string; id: string; code: string; token: string; message: string; game: Game };
  async function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    const messages: Message[] = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>(done => ws.once('open', done));
    return { ws, messages, send: (data: unknown) => ws.send(JSON.stringify(data)),
      async wait(predicate: (message: Message) => boolean) {
        const deadline = Date.now() + 12_000;
        while (Date.now() < deadline) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise(done => setTimeout(done, 10));
        }
        throw new Error('Mundo settings response timeout');
      } };
  }
  try {
    const legacy = await client();
    legacy.send({ type: 'create', name: '기존방' });
    await legacy.wait(message => message.type === 'joined');
    const defaults = (await legacy.wait(message => message.type === 'state')).game;
    assert.equal(defaults.map, 'ward'); assert.equal(defaults.view, 'top');
    assert.deepEqual(defaults.spellCooldowns, { flash: 20, ghost: 30 });

    const a = await client();
    let b = await client();
    a.send({ type: 'create', name: '방장', map: 'baron', view: 'top' });
    const host = await a.wait(message => message.type === 'joined');
    b.send({ type: 'join', name: '친구', code: host.code, map: 'arena', view: 'fps', flashCooldown: 1, ghostCooldown: 6 });
    const guest = await b.wait(message => message.type === 'joined');
    const joined = (await b.wait(message => message.type === 'state')).game;
    assert.equal(joined.map, 'baron'); assert.equal(joined.view, 'top');
    assert.deepEqual(joined.spellCooldowns, defaults.spellCooldowns);
    const live = () => arena.rooms.get(host.code)!.game;
    const settings = { type: 'settings', view: 'fps', flashCooldown: 3, ghostCooldown: 6 };
    a.send({ type: 'ready' });
    await a.wait(message => message.game?.players.find(player => player.id === host.id)?.ready === true);
    const before = structuredClone(live());
    for (const change of [
      { view: ['fps'] }, { view: 'invalid' }, { flashCooldown: 0 }, { flashCooldown: 301 },
      { flashCooldown: 1.5 }, { flashCooldown: '3' }, { ghostCooldown: 5 }, { ghostCooldown: 301 }, { ghostCooldown: null },
    ]) {
      a.send({ ...settings, ...change });
      assert.match((await a.wait(message => message.type === 'error')).message, /정수|설정/);
      assert.deepEqual(live(), before, 'Invalid settings must not partially update view, cooldowns or readiness.');
    }
    b.send(settings);
    assert.match((await b.wait(message => message.type === 'error')).message, /방장/);
    assert.deepEqual(live(), before);
    a.send(settings);
    for (const peer of [a, b]) {
      const state = (await peer.wait(message => message.game?.view === 'fps')).game;
      assert.deepEqual(state.spellCooldowns, { flash: 3, ghost: 6 });
      assert.ok(state.players.every(player => !player.ready));
    }

    b.ws.close();
    await new Promise<void>(done => b.ws.once('close', () => done()));
    await a.wait(message => message.game?.players.some(player => !player.connected));
    b = await client();
    b.send({ type: 'resume', code: host.code, token: guest.token, view: 'top', flashCooldown: 300, ghostCooldown: 300 });
    assert.equal((await b.wait(message => message.type === 'joined')).id, guest.id);
    const resumed = (await b.wait(message => message.type === 'state')).game;
    assert.equal(resumed.view, 'fps'); assert.deepEqual(resumed.spellCooldowns, { flash: 3, ghost: 6 });
    a.send({ type: 'ready' }); b.send({ type: 'ready' });
    await a.wait(message => message.game?.phase === 'countdown');
    a.send({ ...settings, view: 'top' });
    assert.match((await a.wait(message => message.type === 'error')).message, /시작 전/);
    await a.wait(message => message.game?.phase === 'playing');
    a.send({ ...settings, view: 'top' });
    assert.match((await a.wait(message => message.type === 'error')).message, /시작 전/);
    assert.equal(live().view, 'fps');
    a.send({ type: 'spell', spell: 'flash', yaw: null });
    assert.match((await a.wait(message => message.type === 'error')).message, /방향/);
    a.send({ type: 'spell', spell: 'flash', yaw: Math.PI / 2 });
    for (const peer of [a, b]) {
      const state = (await peer.wait(message => message.game?.players.find(player => player.id === host.id)?.flashes === 1)).game;
      const player = state.players.find(player => player.id === host.id)!;
      assert.equal(player.x, -1); assert.ok(Math.abs(player.z) < 1e-10);
      assert.ok(player.flashCooldown > 2.5 && player.flashCooldown <= 3);
    }
    a.send({ type: 'spell', spell: 'flash', yaw: -Math.PI / 2 });
    assert.match((await a.wait(message => message.type === 'error')).message, /재사용/);
    assert.equal(live().players[0].x, -1); assert.equal(live().players[0].flashes, 1);
    a.send({ type: 'spell', spell: 'ghost', yaw: Math.PI / 2 });
    const boosted = (await a.wait(message => message.game?.players[0].ghostTime > 0)).game.players[0];
    assert.ok(boosted.ghostTime > 5.5 && boosted.ghostTime <= 6);
    assert.ok(boosted.ghostCooldown <= 6);
    const move = () => [a, b].forEach(peer => peer.send({ type: 'input', input: { x: 0, z: 1, yaw: Math.PI / 2, fire: false } }));
    move();
    const movement = setInterval(move, 50); timers.push(movement);
    const moving = (await a.wait(message => message.game?.players[0].z > 1.5)).game;
    clearInterval(movement);
    for (const peer of [a, b]) peer.send({ type: 'input', input: { x: 0, z: 0, yaw: Math.PI / 2, fire: false } });
    const ratio = moving.players[0].z / moving.players[1].z;
    assert.ok(ratio > 1.2 && ratio < 1.6, `Ghost must move about 40% faster: ${ratio}`);
    a.messages.length = 0;
    await a.wait(message => message.game?.players[0].ghostTime === 0);
    assert.equal(live().players[0].ghostCooldown, 0);
    a.send({ type: 'spell', spell: 'flash', yaw: Math.PI / 2 });
    const boundary = (await b.wait(message => message.game?.players[0].flashes === 2)).game.players[0];
    assert.equal(boundary.x, -.5); assert.ok(Math.hypot(boundary.x, boundary.z) <= 9.5);

    const fire = () => {
      const [shooter, opponent] = live().players;
      a.send({ type: 'input', input: { x: 0, z: 0, yaw: Math.atan2(opponent.x - shooter.x, opponent.z - shooter.z), fire: true } });
    };
    fire(); const shooting = setInterval(fire, 50); timers.push(shooting);
    const finished = (await a.wait(message => message.game?.phase === 'finished')).game;
    clearInterval(shooting);
    assert.equal(finished.players[1].hp, 0); assert.equal(finished.winner, '방장 승리');
    a.send({ type: 'ready' }); b.send({ type: 'ready' });
    const rematch = (await a.wait(message => message.game?.round === 2)).game;
    assert.equal(rematch.view, 'fps'); assert.deepEqual(rematch.spellCooldowns, { flash: 3, ghost: 6 });
    assert.ok(rematch.players.every(player => player.hp === 100 && player.flashCooldown === 0 && player.ghostTime === 0));

    // Queue attempts behind leave while withholding the close acknowledgement.
    const transport = (a.ws as WebSocket & { _socket: Socket })._socket;
    a.ws.pause(); transport.cork();
    a.send({ type: 'leave' });
    a.send({ ...settings, view: 'top', flashCooldown: 299 });
    a.send({ type: 'spell', spell: 'flash', yaw: 0 });
    transport.uncork();
    const transferred = (await b.wait(message => message.game?.players.length === 1)).game;
    assert.equal(transferred.players[0].id, guest.id); assert.equal(transferred.view, 'fps');
    assert.deepEqual(transferred.spellCooldowns, { flash: 3, ghost: 6 });
    b.send({ type: 'settings', view: 'top', flashCooldown: 4, ghostCooldown: 8 });
    const changed = (await b.wait(message => message.game?.view === 'top')).game;
    assert.deepEqual(changed.spellCooldowns, { flash: 4, ghost: 8 });
    const stale = await client();
    stale.send({ type: 'resume', code: host.code, token: host.token });
    await stale.wait(message => message.type === 'expired');
    a.ws.resume();
  } finally {
    timers.forEach(clearInterval); sockets.forEach(ws => ws.terminate()); await arena.close();
  }
});
