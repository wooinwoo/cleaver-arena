import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ARENA_RADIUS, RADIUS, HALF_X, HALF_Z, SPEED, OBSTACLES,
  FLASH_COOLDOWN, GHOST_COOLDOWN, FLASH_DISTANCE, GHOST_DURATION, GHOST_MULTIPLIER,
  addPlayer, castSpell, createGame, move, parseInput, startRound, tick, type ArenaMap, type Game,
} from '../shared/game.ts';

function match(map: ArenaMap = 'ward', view: Game['view'] = 'top') {
  const game = createGame('SPELLS', 'duel', map, view);
  const a = addPlayer(game, 'a', '첫째'), b = addPlayer(game, 'b', '둘째');
  a.ready = b.ready = true;
  assert.equal(startRound(game), true);
  tick(game, 3);
  return { game, a, b };
}
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} must equal ${expected}`);
}
function reject(game: Game, id: string, spell: unknown, yaw: unknown) {
  const before = structuredClone(game);
  assert.notEqual(castSpell(game, id, spell, yaw), null);
  assert.deepEqual(game, before, 'A rejected spell must not mutate any match or player state.');
}

test('spells validate type, finite yaw, match phase, identity, connection and survival without mutation', () => {
  const { game, a } = match();
  for (const spell of ['blink', '', 0, null, undefined, {}, []]) reject(game, a.id, spell, 0);
  for (const spell of ['flash', 'ghost']) {
    for (const yaw of [NaN, Infinity, -Infinity, '0', null, undefined, {}, true]) reject(game, a.id, spell, yaw);
    reject(game, 'absent', spell, 0);
    for (const phase of ['lobby', 'countdown', 'finished'] as const) {
      game.phase = phase;
      reject(game, a.id, spell, 0);
    }
    game.phase = 'playing';
    a.connected = false;
    reject(game, a.id, spell, 0);
    a.connected = true;
    a.hp = 0;
    reject(game, a.id, spell, 0);
    a.hp = 100;
  }
});

test('flash travels four units independently of ghost and consumes only its own configured cooldown', () => {
  const { game, a } = match('arena');
  a.x = 0; a.z = 0;
  assert.equal(castSpell(game, a.id, 'ghost', 0), null);
  assert.equal(castSpell(game, a.id, 'flash', Math.PI / 2), null);
  near(a.x, FLASH_DISTANCE); near(a.z, 0);
  assert.equal(a.flashes, 1);
  assert.equal(a.flashCooldown, FLASH_COOLDOWN);
  assert.equal(a.ghostCooldown, GHOST_COOLDOWN);
  assert.equal(a.ghostTime, GHOST_DURATION);
  reject(game, a.id, 'flash', 0);
  reject(game, a.id, 'ghost', 0);
  tick(game, FLASH_COOLDOWN);
  assert.equal(a.flashCooldown, 0);
  assert.equal(a.ghostTime, 0);
  assert.equal(castSpell(game, a.id, 'flash', Math.PI), null);
  assert.equal(a.flashes, 2);
  reject(game, a.id, 'ghost', 0);
  tick(game, GHOST_COOLDOWN - FLASH_COOLDOWN);
  assert.equal(a.ghostCooldown, 0);
  assert.equal(castSpell(game, a.id, 'ghost', 0), null);
});

test('flash never crosses either circular half, the central ward or the circular outer wall', () => {
  const limit = ARENA_RADIUS - RADIUS;
  for (const map of ['ward', 'baron'] as const) for (const team of [0, 1]) {
    const { game } = match(map);
    const player = game.players[team], side = team === 0 ? -1 : 1;
    const starts = [[side * 5, 0], [side * 1.5, 0], [side * 9.4, 0], [side * RADIUS, Math.sqrt(limit ** 2 - RADIUS ** 2) - .01]];
    for (const [x, z] of starts) for (let direction = 0; direction < 64; direction++) {
      player.x = x; player.z = z; player.flashCooldown = 0;
      assert.equal(castSpell(game, player.id, 'flash', direction * Math.PI / 32), null);
      assert.ok(player.x * side >= RADIUS - 1e-9);
      assert.ok(Math.hypot(player.x, player.z) <= limit + 1e-9);
      assert.ok(Math.hypot(player.x - x, player.z - z) <= FLASH_DISTANCE + 1e-9);
    }
    player.x = side * 1.5; player.z = 0; player.flashCooldown = 0;
    assert.equal(castSpell(game, player.id, 'flash', -side * Math.PI / 2), null);
    near(player.x, side * RADIUS);
  }
});

test('arena flash respects all four rectangular walls, jumps over obstacles and cannot land inside them', () => {
  const { game, a } = match('arena');
  for (const [x, z, yaw, endX, endZ] of [
    [11, 0, Math.PI / 2, HALF_X - RADIUS, 0], [-11, 0, -Math.PI / 2, -HALF_X + RADIUS, 0],
    [0, 8, 0, 0, HALF_Z - RADIUS], [0, -8, Math.PI, 0, -HALF_Z + RADIUS],
  ]) {
    a.x = x; a.z = z; a.flashCooldown = 0;
    assert.equal(castSpell(game, a.id, 'flash', yaw), null);
    near(a.x, endX); near(a.z, endZ);
  }
  for (const obstacle of OBSTACLES) {
    a.x = obstacle.x - 2; a.z = obstacle.z; a.flashCooldown = 0;
    assert.equal(castSpell(game, a.id, 'flash', Math.PI / 2), null);
    near(a.x, obstacle.x + 2); near(a.z, obstacle.z);
    a.x = obstacle.x - FLASH_DISTANCE; a.z = obstacle.z; a.flashCooldown = 0;
    const startX = a.x;
    assert.equal(castSpell(game, a.id, 'flash', Math.PI / 2), null);
    near(a.x, obstacle.x - obstacle.radius - RADIUS);
    assert.ok(a.x - startX <= FLASH_DISTANCE);
    for (const other of OBSTACLES) assert.ok(Math.hypot(a.x - other.x, a.z - other.z) >= other.radius + RADIUS - 1e-9);
  }
});

test('ghost multiplies normalized movement by 1.4 and preserves the six-argument move API', () => {
  const { game, a } = match();
  a.x = -5; a.z = -3;
  a.input = parseInput({ x: 20, z: 20, yaw: 0, fire: false })!;
  const initial = { x: a.x, z: a.z };
  assert.equal(castSpell(game, a.id, 'ghost', 0), null);
  tick(game, .25);
  near(Math.hypot(a.x - initial.x, a.z - initial.z), SPEED * .25 * GHOST_MULTIPLIER);
  near(a.ghostTime, GHOST_DURATION - .25);
  const regular = { ...initial }, boosted = { ...initial };
  move(regular, a.input.x, a.input.z, .25, a.team, game.map);
  move(boosted, a.input.x, a.input.z, .25, a.team, game.map, GHOST_MULTIPLIER);
  near(Math.hypot(regular.x - initial.x, regular.z - initial.z), SPEED * .25);
  near(boosted.x, a.x); near(boosted.z, a.z);
});

test('a frame spanning ghost expiration moves only its remaining boosted fraction at increased speed', () => {
  const { game, a } = match();
  assert.equal(castSpell(game, a.id, 'ghost', 0), null);
  tick(game, GHOST_DURATION - .25);
  a.x = -5; a.z = 0;
  a.input = { x: 0, z: 1, yaw: 0, fire: false };
  tick(game, .5);
  near(a.z, SPEED * (.25 * GHOST_MULTIPLIER + .25));
  assert.equal(a.ghostTime, 0);
  near(a.ghostCooldown, GHOST_COOLDOWN - GHOST_DURATION - .25);
  tick(game, .25);
  near(a.z, SPEED * (.25 * GHOST_MULTIPLIER + .5));
});

test('configured spell cooldowns are consumed and expire while rematches retain room settings and reset player spells', () => {
  const { game, a, b } = match('baron', 'fps');
  game.spellCooldowns = { flash: 3, ghost: 9 };
  assert.equal(castSpell(game, a.id, 'flash', 0), null);
  assert.equal(castSpell(game, a.id, 'ghost', 0), null);
  assert.equal(a.flashCooldown, 3);
  assert.equal(a.ghostCooldown, 9);
  tick(game, 2.5);
  reject(game, a.id, 'flash', 0);
  tick(game, .5);
  assert.equal(castSpell(game, a.id, 'flash', 0), null);
  tick(game, 6);
  assert.equal(castSpell(game, a.id, 'ghost', 0), null);
  game.phase = 'finished';
  a.ready = b.ready = true;
  assert.equal(startRound(game), true);
  assert.equal(game.view, 'fps');
  assert.equal(game.map, 'baron');
  assert.deepEqual(game.spellCooldowns, { flash: 3, ghost: 9 });
  assert.equal(game.round, 2);
  for (const player of game.players) {
    assert.equal(player.flashCooldown, 0); assert.equal(player.ghostCooldown, 0);
    assert.equal(player.ghostTime, 0); assert.equal(player.flashes, 0);
  }
  assert.equal(createGame('DEFAULT').view, 'top');
  assert.deepEqual(createGame('DEFAULT').spellCooldowns, { flash: FLASH_COOLDOWN, ghost: GHOST_COOLDOWN });
});

test('baron and ward use identical movement, spells, projectile bounds and half-court game modes', () => {
  assert.equal(createGame('BARON', 'ffa', 'baron').mode, 'duel');
  assert.equal(createGame('ARENA', 'ffa', 'arena').mode, 'ffa');
  const ward = match('ward'), baron = match('baron');
  for (const instance of [ward, baron]) {
    assert.equal(castSpell(instance.game, instance.a.id, 'ghost', 0), null);
    assert.equal(castSpell(instance.game, instance.a.id, 'flash', Math.PI / 2), null);
    instance.a.input = parseInput({ x: 1, z: 1, yaw: Math.PI / 2, fire: false })!;
    tick(instance.game, .25);
    instance.a.x = -.5; instance.a.z = 0;
    instance.b.x = ARENA_RADIUS - RADIUS; instance.b.z = 0;
    instance.a.input = { x: 0, z: 0, yaw: Math.PI / 2, fire: true };
    tick(instance.game, 1);
    assert.equal(instance.b.hp, 75);
    assert.equal(instance.game.shots.length, 0);
    instance.a.input.fire = false;
    instance.game.shots.push({ id: 99, owner: instance.a.id, team: 0, x: 9, z: 8, vx: -15, vz: 0 });
    tick(instance.game, .1);
    assert.equal(instance.game.shots.length, 0);
  }
  assert.deepEqual({ ...baron.game, map: 'ward' }, ward.game);
});

test('bots never cast spells automatically', () => {
  const { game, a } = match();
  a.bot = true;
  tick(game, .5);
  assert.equal(a.flashCooldown, 0); assert.equal(a.ghostCooldown, 0);
  assert.equal(a.ghostTime, 0); assert.equal(a.flashes, 0);
});
