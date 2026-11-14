import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createArenaServer } from '../server/index.ts';
import {
  ARENA_START, CAR_RADIUS, DASH_COOLDOWN, DASH_SPEED, MAX_SPEED, ROUND_SECONDS, TARGET_WINS,
  addBumperPlayer, bumperBot, bumperView, createBumper, parseBumperInput, startBumper, tickBumper, type BumperGame,
} from '../shared/bumper.ts';

const DT = 1 / 30;
function seeded(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
function match(humans = 2, bots = 0): BumperGame {
  const game = createBumper('TEST01');
  for (let i = 0; i < humans; i++) addBumperPlayer(game, `h${i}`, `사람${i}`).ready = true;
  for (let i = 0; i < bots; i++) addBumperPlayer(game, `b${i}`, `봇 ${i + 1}`, true);
  assert.equal(startBumper(game), true);
  while (game.phase === 'countdown') tickBumper(game, DT);
  return game;
}

test('bumper needs two cars and every human ready before it starts', () => {
  const game = createBumper('A');
  const solo = addBumperPlayer(game, 'a', '혼자');
  solo.ready = true;
  assert.equal(startBumper(game), false, 'one car cannot start');
  const friend = addBumperPlayer(game, 'b', '친구');
  assert.equal(startBumper(game), false, 'friend is not ready');
  friend.ready = true;
  assert.equal(startBumper(game), true);
  assert.equal(game.phase, 'countdown');
  assert.equal(game.round, 1);
  assert.ok(game.players.every(p => Math.hypot(p.x, p.z) < ARENA_START - 2), 'cars start well inside the arena');
});

test('bumper input is clamped and rejects junk', () => {
  assert.deepEqual(parseBumperInput({ x: 5, z: -9, dash: 1 }), { x: 1, z: -1, dash: false });
  assert.deepEqual(parseBumperInput({ x: .5, z: 0, dash: true }), { x: .5, z: 0, dash: true });
  for (const junk of [null, 3, 'x', {}, { x: NaN, z: 0 }, { x: Infinity, z: 0 }, { x: '1', z: 0 }]) assert.equal(parseBumperInput(junk), null);
});

test('driving tops out at max speed and a dash is faster, then cools down', () => {
  const game = match();
  const car = game.players[0];
  car.x = 0; car.z = 0; game.players[1].x = 8; game.players[1].z = 8;
  car.input = { x: 1, z: 0, dash: false };
  for (let i = 0; i < 40; i++) { tickBumper(game, DT); car.x = 0; car.z = 0; }
  assert.ok(Math.hypot(car.vx, car.vz) <= MAX_SPEED + .01 && Math.hypot(car.vx, car.vz) > MAX_SPEED * .8);
  car.input = { x: 1, z: 0, dash: true };
  tickBumper(game, DT);
  assert.ok(Math.hypot(car.vx, car.vz) > MAX_SPEED * 1.4 && Math.hypot(car.vx, car.vz) <= DASH_SPEED + .01);
  assert.ok(car.dashCooldown > DASH_COOLDOWN - .1);
  const speedAfterDash = Math.hypot(car.vx, car.vz);
  tickBumper(game, DT);
  assert.ok(Math.hypot(car.vx, car.vz) <= speedAfterDash, 'holding dash during cooldown does not dash again');
});

test('a charging car knocks a resting car away and a dash hits harder', () => {
  const run = (dash: boolean) => {
    const game = match();
    const [a, b] = game.players;
    a.x = -3; a.z = 0; b.x = 0; b.z = 0; a.vx = 0; a.vz = 0;
    a.input = { x: 1, z: 0, dash };
    let peak = 0;
    for (let i = 0; i < 30; i++) { tickBumper(game, DT); a.input = { x: 1, z: 0, dash: false }; peak = Math.max(peak, b.vx); }
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= CAR_RADIUS * 2 - .01, 'cars never overlap');
    assert.equal(b.lastHitBy, a.id);
    return peak;
  };
  const push = run(false), dashPush = run(true);
  assert.ok(push > 2, `normal push ${push}`);
  assert.ok(dashPush > push * 1.3, `dash push ${dashPush} vs ${push}`);
});

test('leaving the floor eliminates a car, credits the hitter and ends the round', () => {
  const game = match();
  const [a, b] = game.players;
  a.x = game.radius - 3.2; a.z = 0; b.x = game.radius - 1.2; b.z = 0;
  a.input = { x: 1, z: 0, dash: true };
  for (let i = 0; i < 60 && game.phase === 'playing'; i++) { tickBumper(game, DT); a.input = { x: -1, z: 0, dash: false }; }
  assert.equal(b.alive, false);
  assert.equal(a.alive, true);
  assert.equal(a.kos, 1);
  assert.equal(game.phase, 'roundEnd');
  assert.equal(game.roundWinner, a.id);
  assert.equal(a.score, 1);
  assert.ok(game.events.some(event => event.type === 'fall' && event.b === b.slot));
  while (game.phase === 'roundEnd') tickBumper(game, DT);
  assert.equal(game.phase, 'countdown');
  assert.equal(game.round, 2);
  assert.ok(game.players.every(p => p.alive), 'everyone is back for the next round');
});

test('the arena shrinks, and sudden death always ends an idle round', () => {
  const game = match();
  for (let i = 0; i < 20 * 30; i++) tickBumper(game, DT);
  assert.ok(game.radius < ARENA_START && game.radius > 5, `radius ${game.radius}`);
  let ticks = 0;
  while (game.phase === 'playing' && ticks++ < (ROUND_SECONDS + 20) * 30) tickBumper(game, DT);
  assert.notEqual(game.phase, 'playing', 'an idle round still ends');
});

test('bots finish whole matches without leaving the simulation in a bad state', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const random = seeded(seed);
    const game = createBumper('BOTS');
    addBumperPlayer(game, 'h', '사람').ready = true;
    for (let n = 0; n < 1 + seed % 4; n++) addBumperPlayer(game, `b${n}`, `봇 ${n + 1}`, true);
    assert.equal(startBumper(game), true);
    let ticks = 0;
    while (game.phase !== 'finished' && ticks++ < 30 * 60 * 12) {
      tickBumper(game, DT, random);
      for (const p of game.players) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.vx), 'finite state');
    }
    assert.equal(game.phase, 'finished', `seed ${seed} finished`);
    assert.equal(Math.max(...game.players.map(p => p.score)), TARGET_WINS);
    assert.match(game.winner, /우승$/);
    assert.ok(game.players.every(p => p.ready === p.bot), 'humans must ready up again');
  }
});

test('a bot near the rim steers back to the centre', () => {
  const game = match(1, 1);
  const bot = game.players[1];
  bot.x = game.radius - .8; bot.z = 0; bot.vx = 3; bot.vz = 0;
  const input = bumperBot(game, bot, () => .5);
  assert.ok(input.x < -.9, JSON.stringify(input));
});

test('snapshots carry no steering input and round coordinates', () => {
  const view = bumperView(match());
  assert.ok(!('input' in view.players[0]));
  assert.equal(view.players[0].x, Math.round(view.players[0].x * 100) / 100);
});

test('bumper rooms create, join, start and stream state over the socket', async () => {
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const port = (arena.server.address() as { port: number }).port;
  async function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bumper-ws`);
    const messages: Record<string, any>[] = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return { ws, send: (data: unknown) => ws.send(JSON.stringify(data)),
      async wait(predicate: (data: Record<string, any>) => boolean) {
        const deadline = performance.now() + 8000;
        while (performance.now() < deadline) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return messages.splice(0, index + 1).at(-1)!;
          await new Promise(done => setTimeout(done, 10));
        }
        throw new Error('bumper server response timeout');
      } };
  }
  try {
    const a = await client(), b = await client();
    a.send({ type: 'create', name: '방장' });
    const joined = await a.wait(data => data.type === 'joined');
    b.send({ type: 'join', name: '손님', code: joined.code });
    await b.wait(data => data.type === 'joined');
    b.send({ type: 'bot', add: true });
    assert.match((await b.wait(data => data.type === 'error')).message, /방장/);
    a.send({ type: 'bot', add: true });
    const lobby = await a.wait(data => data.type === 'state' && data.game.players.length === 3);
    assert.equal(lobby.game.phase, 'lobby');
    assert.ok(lobby.game.players.every((p: Record<string, unknown>) => !('input' in p) && !('token' in p)));
    a.send({ type: 'ready' }); b.send({ type: 'ready' });
    await a.wait(data => data.type === 'state' && data.game.phase === 'countdown');
    const playing = await a.wait(data => data.type === 'state' && data.game.phase === 'playing');
    const me = playing.game.players.find((p: Record<string, any>) => p.id === joined.id);
    a.send({ type: 'input', input: { x: 1, z: 0, dash: false } });
    const moved = await a.wait(data => data.type === 'state' && Math.abs(data.game.players.find((p: Record<string, any>) => p.id === joined.id).x - me.x) > .5);
    assert.equal(moved.game.phase, 'playing');
    const late = await client();
    late.send({ type: 'join', name: '늦음', code: joined.code });
    assert.match((await late.wait(data => data.type === 'error')).message, /경기 중/);
  } finally { await arena.close(); }
});
