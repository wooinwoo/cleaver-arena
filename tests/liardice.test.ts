import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiarDice, actLiarDice, liarDiceView, countFace, INFO, type LiarDiceState } from '../shared/liardice.ts';
import { liarDiceBot } from '../shared/liardice-bot.ts';

function seeded(seed: number) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13; value >>>= 0;
    value ^= value >>> 17;
    value ^= value << 5; value >>>= 0;
    return value / 2 ** 32;
  };
}

function fixed(dice: number[][]): LiarDiceState {
  const state = createLiarDice(dice.length);
  state.dice = dice.map(hand => [...hand]);
  return state;
}

test('liardice info and creation', () => {
  assert.equal(INFO.title, '거짓말 주사위');
  assert.equal(INFO.min, 2);
  assert.equal(INFO.max, 6);
  const state = createLiarDice(4, seeded(3));
  assert.equal(state.dice.length, 4);
  for (const hand of state.dice) {
    assert.equal(hand.length, 5);
    for (const value of hand) assert.ok(value >= 1 && value <= 6);
  }
  assert.equal(state.turn, 0);
  assert.equal(state.stage, 'bid');
  assert.equal(state.bid, null);
});

test('liardice bid ordering', () => {
  const state = fixed([[2, 2, 3, 4, 5], [6, 6, 6, 5, 4], [3, 3, 3, 3, 3]]);
  assert.equal(actLiarDice(state, 0, { type: 'bid', count: 3, face: 4 }), null);
  assert.equal(state.turn, 1);
  assert.ok(actLiarDice(state, 1, { type: 'bid', count: 3, face: 4 }));
  assert.ok(actLiarDice(state, 1, { type: 'bid', count: 3, face: 3 }));
  assert.ok(actLiarDice(state, 1, { type: 'bid', count: 2, face: 6 }));
  assert.equal(actLiarDice(state, 1, { type: 'bid', count: 3, face: 5 }), null);
  assert.equal(state.turn, 2);
  assert.equal(actLiarDice(state, 2, { type: 'bid', count: 4, face: 2 }), null);
  assert.equal(state.turn, 0);
  assert.deepEqual(state.bid, { count: 4, face: 2, seat: 2 });
});

test('liardice counts wild 1s', () => {
  assert.equal(countFace([[1, 1, 3], [3, 4, 1]], 3), 5);
  assert.equal(countFace([[1, 1, 3], [3, 4, 1]], 4), 4);
  assert.equal(countFace([[2, 2], [5, 6]], 3), 0);
});

test('liardice call: bid holds, caller loses a die', () => {
  const state = fixed([[1, 3, 3, 2, 2], [3, 4, 5, 6, 6]]);
  assert.equal(actLiarDice(state, 0, { type: 'bid', count: 4, face: 3 }), null);
  assert.equal(actLiarDice(state, 1, { type: 'call' }), null);
  assert.equal(state.stage, 'reveal');
  assert.equal(state.lastResult!.actual, 4);
  assert.equal(state.lastResult!.loser, 1);
  assert.equal(state.lastResult!.caller, 1);
  assert.equal(state.dice[1].length, 4);
  assert.equal(state.lastResult!.dice[1].length, 5);
  assert.equal(state.turn, 1);
});

test('liardice call: bid fails, bidder loses a die', () => {
  const state = fixed([[1, 3, 3, 2, 2], [3, 4, 5, 6, 6]]);
  assert.equal(actLiarDice(state, 0, { type: 'bid', count: 5, face: 3 }), null);
  assert.equal(actLiarDice(state, 1, { type: 'call' }), null);
  assert.equal(state.lastResult!.actual, 4);
  assert.equal(state.lastResult!.loser, 0);
  assert.equal(state.dice[0].length, 4);
  assert.equal(state.turn, 0);
});

test('liardice reveal then next round rerolls and resets', () => {
  const state = fixed([[2, 2, 2, 2, 2], [2, 2, 2, 2, 2]]);
  actLiarDice(state, 0, { type: 'bid', count: 9, face: 2 });
  actLiarDice(state, 1, { type: 'call' });
  assert.equal(state.turn, 1);
  assert.ok(actLiarDice(state, 0, { type: 'next' }), 'only the starter starts the round');
  assert.ok(actLiarDice(state, 1, { type: 'bid', count: 1, face: 2 }), 'no bids during reveal');
  assert.equal(actLiarDice(state, 1, { type: 'next' }, () => 0.99), null);
  assert.equal(state.stage, 'bid');
  assert.equal(state.bid, null);
  assert.equal(state.lastResult, null);
  assert.equal(state.round, 2);
  assert.deepEqual(state.dice, [[6, 6, 6, 6, 6], [6, 6, 6, 6]]);
  assert.equal(state.turn, 1);
});

test('liardice elimination, skipping eliminated players and the win', () => {
  const state = fixed([[2, 2], [3], [4, 4]]);
  actLiarDice(state, 0, { type: 'bid', count: 1, face: 5 });
  assert.equal(actLiarDice(state, 1, { type: 'bid', count: 2, face: 5 }), null);
  assert.equal(actLiarDice(state, 2, { type: 'call' }), null);
  assert.equal(state.lastResult!.loser, 1);
  assert.equal(state.lastResult!.eliminated, true);
  assert.equal(state.dice[1].length, 0);
  assert.equal(state.turn, 2, 'next alive after the eliminated loser starts');
  assert.equal(state.winner, null);
  assert.equal(actLiarDice(state, 2, { type: 'next' }, () => 0.5), null);
  assert.equal(actLiarDice(state, 2, { type: 'bid', count: 1, face: 4 }), null);
  assert.equal(state.turn, 0, 'seat 1 is skipped');
  assert.ok(actLiarDice(state, 1, { type: 'call' }));
  assert.equal(actLiarDice(state, 0, { type: 'bid', count: 2, face: 4 }), null);
  assert.equal(state.turn, 2);
  // all dice show 4, so a bid on 6s fails and the bidder loses.
  assert.equal(actLiarDice(state, 2, { type: 'bid', count: 4, face: 6 }), null);
  assert.ok(actLiarDice(state, 0, { type: 'bid', count: 5, face: 6 }), 'count cannot exceed dice in play');
  assert.equal(actLiarDice(state, 0, { type: 'call' }), null);
  assert.equal(state.lastResult!.actual, 0);
  assert.equal(state.lastResult!.loser, 2);
  state.dice = [[4, 4], [], [4]];
  state.stage = 'bid'; state.bid = null; state.lastResult = null; state.turn = 2;
  actLiarDice(state, 2, { type: 'bid', count: 2, face: 3 });
  actLiarDice(state, 0, { type: 'call' });
  assert.equal(state.dice[2].length, 0);
  assert.equal(state.winner, 0);
  assert.ok(actLiarDice(state, 0, { type: 'next' }));
});

test('liardice view hides other dice outside the reveal', () => {
  const state = fixed([[1, 2, 3, 4, 5], [6, 6, 6, 6, 6]]);
  const view = liarDiceView(state, 0);
  assert.deepEqual(view.dice[0], [1, 2, 3, 4, 5]);
  assert.deepEqual(view.dice[1], [null, null, null, null, null]);
  assert.deepEqual(view.counts, [5, 5]);
  assert.equal(view.totalDice, 10);
  assert.equal(view.revealed, false);
  assert.ok(!JSON.stringify(view).includes('6,6'));
  actLiarDice(state, 0, { type: 'bid', count: 1, face: 2 });
  actLiarDice(state, 1, { type: 'call' });
  const open = liarDiceView(state, 0);
  assert.equal(open.revealed, true);
  assert.deepEqual(open.lastResult!.dice[1], [6, 6, 6, 6, 6]);
  assert.deepEqual(open.dice[1], [6, 6, 6, 6]);
});

test('liardice invalid inputs do not mutate', () => {
  const state = fixed([[1, 2, 3, 4, 5], [6, 6, 6, 6, 6]]);
  const before = structuredClone(state);
  for (const [seat, action] of [
    [1, { type: 'bid', count: 1, face: 2 }],
    [0, { type: 'call' }],
    [0, { type: 'next' }],
    [0, { type: 'bid', count: 1, face: 1 }],
    [0, { type: 'bid', count: 1, face: 7 }],
    [0, { type: 'bid', count: 0, face: 3 }],
    [0, { type: 'bid', count: 11, face: 3 }],
    [0, { type: 'bid', count: 1.5, face: 3 }],
    [0, { type: 'bid', count: '2', face: 3 }],
    [0, { type: 'dance' }],
    [5, { type: 'call' }],
    [-1, { type: 'call' }],
  ] as const) {
    const error = actLiarDice(state, seat, action as never);
    assert.equal(typeof error, 'string');
    assert.deepEqual(state, before);
  }
});

for (const seats of [2, 5]) {
  test(`liardice bot self-play finishes with ${seats} seats`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = seeded(seed * 7919 + seats);
      const state = createLiarDice(seats, random);
      let steps = 0;
      while (state.winner === null) {
        assert.ok(steps++ < 5000, 'game should end');
        const seat = state.turn;
        const action = liarDiceBot(state, seat, random);
        assert.equal(actLiarDice(state, seat, action, random), null, `${JSON.stringify(action)} seed ${seed}`);
      }
      assert.equal(state.dice.filter(hand => hand.length).length, 1);
      assert.ok(state.dice[state.winner].length > 0);
    }
  });
}
