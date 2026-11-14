import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actMancala, createMancala, type MancalaState } from '../shared/mancala.ts';
import { mancalaBot } from '../shared/mancala-bot.ts';
import { finished } from '../shared/tabletop-types.ts';

const total = (state: MancalaState) => state.pits.reduce((a, b) => a + b, 0);
function board(pits: number[], turn = 0): MancalaState {
  const state = createMancala();
  state.pits = pits;
  state.turn = turn;
  return state;
}

test('mancala starts with 4 seeds in 12 pits and empty stores', () => {
  const state = createMancala();
  assert.deepEqual(state.pits, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(state.turn, 0);
});

test('mancala sows counter-clockwise, wraps and skips the opponent store', () => {
  // seat 0 pit 5 with 10 seeds: 6..12 (7), skip 13, 0,1,2 (3)
  const state = board([1, 1, 1, 1, 1, 10, 0, 1, 1, 1, 1, 1, 1, 0]);
  assert.equal(actMancala(state, 0, { type: 'sow', pit: 5 }), null);
  assert.deepEqual(state.lastSow, [6, 7, 8, 9, 10, 11, 12, 0, 1, 2]);
  assert.equal(state.pits[13], 0);
  assert.equal(state.pits[6], 1);
  assert.equal(state.turn, 1);
  assert.equal(total(state), 21);

  // seat 1 skips seat 0's store
  const other = board([1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 9, 0], 1);
  assert.equal(actMancala(other, 1, { type: 'sow', pit: 5 }), null);
  assert.deepEqual(other.lastSow, [13, 0, 1, 2, 3, 4, 5, 7, 8]);
  assert.equal(other.pits[6], 0);
  assert.equal(other.pits[13], 1);
});

test('mancala gives an extra turn when the last seed lands in the own store', () => {
  const state = createMancala();
  assert.equal(actMancala(state, 0, { type: 'sow', pit: 2 }), null);
  assert.equal(state.extraTurn, true);
  assert.equal(state.turn, 0);
  assert.equal(state.pits[6], 1);
  assert.equal(actMancala(state, 0, { type: 'sow', pit: 0 }), null);
  assert.equal(state.extraTurn, false);
  assert.equal(state.turn, 1);
});

test('mancala captures the opposite pit when the last seed lands in an own empty pit', () => {
  // seat 0 pit 1 (1 seed) -> pit 2 empty; opposite of index 2 is 10 with 5 seeds
  const state = board([0, 1, 0, 3, 0, 0, 0, 2, 2, 2, 5, 2, 2, 0]);
  assert.equal(actMancala(state, 0, { type: 'sow', pit: 1 }), null);
  assert.equal(state.captured, 6);
  assert.equal(state.pits[6], 6);
  assert.equal(state.pits[2], 0);
  assert.equal(state.pits[10], 0);
  assert.equal(state.turn, 1);
  assert.equal(total(state), 19);

  // seat 1 capture: pit 0 (index 7) -> index 8 empty, opposite 4
  const other = board([1, 1, 1, 1, 4, 1, 0, 1, 0, 1, 1, 1, 1, 0], 1);
  assert.equal(actMancala(other, 1, { type: 'sow', pit: 0 }), null);
  assert.equal(other.captured, 5);
  assert.equal(other.pits[13], 5);
  assert.equal(other.pits[4], 0);
});

test('mancala does not capture when the opposite pit is empty', () => {
  const state = board([0, 1, 0, 3, 0, 0, 0, 2, 2, 2, 0, 2, 2, 0]);
  assert.equal(actMancala(state, 0, { type: 'sow', pit: 1 }), null);
  assert.equal(state.captured, 0);
  assert.equal(state.pits[2], 1);
  assert.equal(state.pits[6], 0);
});

test('mancala does not capture on a seed landing in an opponent empty pit', () => {
  const state = board([1, 0, 0, 0, 0, 3, 0, 1, 0, 1, 1, 1, 1, 0]);
  assert.equal(actMancala(state, 0, { type: 'sow', pit: 5 }), null);
  assert.equal(state.captured, 0);
  assert.equal(state.pits[8], 1);
});

test('mancala ends when a side is empty and sweeps the rest to its owner', () => {
  // seat 0 plays its last seed into the store: own side empty -> end, no extra turn
  const state = board([0, 0, 0, 0, 0, 1, 20, 1, 2, 0, 0, 0, 3, 10]);
  assert.equal(actMancala(state, 0, { type: 'sow', pit: 5 }), null);
  assert.equal(state.pits[6], 21);
  assert.equal(state.pits[13], 16);
  assert.ok(state.pits.slice(0, 6).every(n => n === 0));
  assert.ok(state.pits.slice(7, 13).every(n => n === 0));
  assert.equal(state.winner, 0);
  assert.equal(state.extraTurn, false);
  const before = structuredClone(state);
  assert.equal(typeof actMancala(state, 0, { type: 'sow', pit: 0 }), 'string');
  assert.deepEqual(state, before);

  // the opponent's side empties after seat 1 moves: seat 0's seeds go to seat 0
  const other = board([2, 0, 0, 0, 0, 3, 10, 0, 0, 0, 0, 0, 1, 15], 1);
  assert.equal(actMancala(other, 1, { type: 'sow', pit: 5 }), null);
  assert.equal(other.pits[13], 16);
  assert.equal(other.pits[6], 15);
  assert.equal(other.winner, 1);
});

test('mancala equal stores end in a draw', () => {
  const state = board([0, 0, 0, 0, 0, 1, 23, 0, 0, 0, 0, 0, 1, 23]);
  assert.equal(actMancala(state, 0, { type: 'sow', pit: 5 }), null);
  assert.equal(state.pits[6], 24);
  assert.equal(state.pits[13], 24);
  assert.equal(state.draw, true);
  assert.equal(state.winner, null);
});

test('mancala rejects invalid input without mutation', () => {
  const state = board([0, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  const before = structuredClone(state);
  for (const [seat, action] of [
    [1, { type: 'sow', pit: 1 }],
    [2, { type: 'sow', pit: 1 }],
    [NaN, { type: 'sow', pit: 1 }],
    [0, { type: 'sow', pit: 0 }],
    [0, { type: 'sow', pit: -1 }],
    [0, { type: 'sow', pit: 6 }],
    [0, { type: 'sow', pit: 1.5 }],
    [0, { type: 'sow', pit: '1' }],
    [0, { type: 'sow', pit: Infinity }],
    [0, { type: 'sow' }],
    [0, { type: 'place', pit: 1 }],
  ] as const) {
    assert.equal(typeof actMancala(state, seat, action), 'string');
    assert.deepEqual(state, before);
  }
});

test('mancala bot returns a legal move and takes an obvious capture', () => {
  const state = board([0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0], 1);
  for (let i = 0; i < 5; i++) {
    const move = mancalaBot(state, 1);
    assert.equal(actMancala(structuredClone(state), 1, move), null);
  }
  // seat 0: pit 1 -> empty pit 2 captures 9 opposite
  const capture = board([0, 1, 0, 1, 0, 0, 0, 1, 1, 1, 9, 1, 1, 0]);
  assert.deepEqual(mancalaBot(capture, 0, () => 0), { type: 'sow', pit: 1 });
});

test('two mancala bots play legal games to completion and keep all 48 seeds', () => {
  for (let game = 0; game < 3; game++) {
    const state = createMancala();
    for (let i = 0; i < 300 && !finished(state); i++) {
      assert.equal(actMancala(state, state.turn, mancalaBot(state, state.turn)), null);
      assert.equal(total(state), 48);
    }
    assert.ok(finished(state));
    assert.equal(state.pits[6] + state.pits[13], 48);
  }
});
