import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, castSpell, createGame, parseInput, tick, type Input } from '../shared/game.ts';

function duel() {
  const game = createGame('MOUSE', 'duel', 'ward');
  const player = addPlayer(game, 'a', 'A'); addPlayer(game, 'b', 'B');
  game.phase = 'playing';
  return { game, player };
}

test('mouse destination arrives without overshoot, including ghost expiry', () => {
  for (const ghostTime of [0, .05, 6]) {
    const { game, player } = duel();
    player.ghostTime = ghostTime;
    player.input = { ...player.input, target: { x: -3.1, z: 1.7 } } as Input;
    for (let i = 0; i < 100; i++) tick(game, 1 / 30);
    assert.ok(Math.abs(player.x + 3.1) < .001);
    assert.ok(Math.abs(player.z - 1.7) < .001);
    const position = [player.x, player.z];
    tick(game, .1);
    assert.deepEqual([player.x, player.z], position);
  }
});

test('mouse destination respects the central boundary and stops when input is cleared', () => {
  const { game, player } = duel();
  player.input = { ...player.input, target: { x: 5, z: 0 } } as Input;
  for (let i = 0; i < 60; i++) tick(game, 1 / 30);
  assert.equal(player.x, -.5);
  player.input = { x: 0, z: 0, yaw: 0, fire: false };
  tick(game, .2);
  assert.equal(player.x, -.5);
});

test('target validation rejects malformed and unbounded coordinates', () => {
  const base = { x: 0, z: 0, yaw: 0, fire: false };
  for (const target of [null, {}, [], { x: NaN, z: 0 }, { x: 0, z: Infinity }, { x: '2', z: 0 }, { x: 1e10, z: 0 }]) {
    assert.equal(parseInput({ ...base, target }), null);
  }
  assert.deepEqual(parseInput({ ...base, target: { x: -3, z: 2 } }), { ...base, target: { x: -3, z: 2 } });
  assert.deepEqual(parseInput(base), base);
});

test('flash follows the supplied cursor direction and cancels the old destination', () => {
  const { game, player } = duel();
  player.input = { ...player.input, target: { x: -3, z: 0 } } as Input;
  assert.equal(castSpell(game, player.id, 'flash', 0), null);
  assert.equal(player.x, -5); assert.equal(player.z, 4);
  tick(game, .1);
  assert.equal(player.x, -5); assert.equal(player.z, 4);
});
