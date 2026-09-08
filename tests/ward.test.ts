import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARENA_RADIUS, RADIUS, addPlayer, createGame, move, parseInput, startRound, tick, type Game } from '../shared/game.ts';

test('input validation, normalized speed and both semicircle boundaries', () => {
  assert.equal(parseInput({ x: NaN, z: 0, yaw: 0, fire: false }), null);
  assert.equal(parseInput({ x: 0, z: 0, yaw: Infinity, fire: false }), null);
  assert.equal(parseInput({ x: '1', z: 0, yaw: 0, fire: false }), null);
  const input = parseInput({ x: 20, z: 20, yaw: 100, fire: true })!;
  assert.ok(Math.abs(Math.hypot(input.x, input.z) - 1) < 1e-8);
  for (const team of [0, 1]) {
    const side = team === 0 ? -1 : 1, player = { x: side * 5, z: 0 };
    move(player, -side, 0, 10, team, 'ward');
    assert.equal(player.x, side * RADIUS);
    for (let i = 0; i < 720; i++) {
      move(player, Math.cos(i / 30), Math.sin(i / 30), .3, team, 'ward');
      assert.ok(player.x * side >= RADIUS - 1e-10);
      assert.ok(Math.hypot(player.x, player.z) <= ARENA_RADIUS - RADIUS + 1e-10);
    }
  }
});

function duel(mode: Game['mode'] = 'duel') {
  const game = createGame('ABCDEF', mode);
  const a = addPlayer(game, 'a', '첫째'), b = addPlayer(game, 'b', '둘째');
  a.ready = b.ready = true;
  assert.equal(startRound(game), true);
  tick(game, 3.1);
  a.x = -3; a.z = 0; b.x = 3; b.z = 0;
  a.input = { x: 0, z: 0, yaw: Math.PI / 2, fire: true };
  return { game, a, b };
}

test('cleavers cross the ward line, four hits end the duel and rematch resets both halves', () => {
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
  assert.equal(a.x, -5); assert.equal(b.x, 5);
  assert.equal(a.z, b.z); assert.equal(a.input.fire, false);
  assert.equal(game.round, 2);
});

test('duel capacity is two; team spawns stay balanced after seats become vacant', () => {
  const single = duel();
  assert.throws(() => addPlayer(single.game, 'extra', '넘침'));
  const game = createGame('ABCDEF', 'teams');
  for (let i = 0; i < 6; i++) addPlayer(game, String(i), '플레이어').ready = true;
  assert.throws(() => addPlayer(game, 'extra', '넘침'));
  game.players[0].connected = false;
  assert.equal(startRound(game), false);
  game.players.splice(0, 1);
  assert.equal(startRound(game), false);
  game.players.splice(2, 1);
  assert.equal(startRound(game), true);
  assert.equal(game.players.filter(p => p.team === 0).length, 2);
  for (const p of game.players) assert.equal(Math.sign(p.x), p.team === 0 ? -1 : 1);
  assert.equal(new Set(game.players.map(p => `${p.x},${p.z}`)).size, 4);
});

test('projectiles preserve friendly fire protection after their owner leaves', () => {
  const { game, a, b } = duel('teams');
  const ally = addPlayer(game, 'ally', '아군');
  ally.x = -1; ally.z = 0;
  tick(game, 1 / 30);
  assert.equal(game.shots.length, 1);
  game.players = game.players.filter(p => p.id !== a.id);
  for (let i = 0; i < 15; i++) tick(game, 1 / 30);
  assert.equal(ally.hp, 100); assert.equal(b.hp, 75);
});

test('projectiles pass disconnected opponents and bots aim only at connected opponents', () => {
  const { game, b } = duel('teams');
  const offline = addPlayer(game, 'offline', '접속 종료');
  offline.team = 1; offline.x = 1; offline.z = 0; offline.connected = false;
  for (let i = 0; i < 16; i++) tick(game, 1 / 30);
  assert.equal(offline.hp, 100); assert.equal(b.hp, 75);
  const botGame = createGame('BOT', 'teams');
  const bot = addPlayer(botGame, 'bot', '로봇', true);
  const absent = addPlayer(botGame, 'absent', '접속 종료');
  const opponent = addPlayer(botGame, 'enemy', '상대');
  bot.x = -3; bot.z = 0;
  absent.x = 1; absent.z = 8; absent.connected = false;
  opponent.team = 1; opponent.x = 3; opponent.z = 0;
  botGame.phase = 'playing'; tick(botGame, 1 / 30);
  assert.ok(botGame.shots[0].vx > 14);
});

test('shots hit the first opponent before later players and the circular boundary', () => {
  const game = createGame('ABCDEF', 'teams');
  const shooter = addPlayer(game, 'a', '발사자');
  const far = addPlayer(game, 'far', '뒤 상대'), near = addPlayer(game, 'near', '앞 상대');
  game.phase = 'playing';
  shooter.x = -1.6; shooter.z = 0;
  far.team = near.team = 1;
  far.x = 1.3; far.z = .5; near.x = 1; near.z = -.5;
  shooter.input = { x: 0, z: 0, yaw: Math.PI / 2, fire: true };
  for (let i = 0; i < 5; i++) tick(game, 1 / 30);
  assert.equal(near.hp, 75); assert.equal(far.hp, 100);
  const edge = duel();
  edge.a.x = -.5; edge.b.x = ARENA_RADIUS - RADIUS;
  tick(edge.game, 1);
  assert.equal(edge.b.hp, 75); assert.equal(edge.game.shots.length, 0);
  edge.a.input.yaw = -Math.PI / 2; edge.a.cooldown = 0;
  tick(edge.game, 1);
  assert.equal(edge.game.shots.length, 0);
});

test('disconnect victory and timeout draw end play and clear shots', () => {
  const { game, b } = duel();
  b.connected = false; tick(game, 1 / 30);
  assert.equal(game.phase, 'finished'); assert.equal(game.winner, '첫째 승리');
  const timeout = duel(); timeout.game.time = .01; tick(timeout.game, 1 / 30);
  assert.equal(timeout.game.phase, 'finished'); assert.equal(timeout.game.winner, '무승부');
  assert.equal(timeout.game.shots.length, 0);
});
