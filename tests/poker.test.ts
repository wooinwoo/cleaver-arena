import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoker, actPoker, pokerView, type PokerState } from '../shared/poker.ts';
import type { Action } from '../shared/tabletop-types.ts';

test('poker hides only own card until result; unique deals and no view mutation', () => {
  const state = createPoker(6);
  assert.equal(new Set(state.cards).size, 6);
  for (let seat = 0; seat < 6; seat++) {
    const view = pokerView(state, seat);
    assert.equal(view.cards[seat], null);
    assert.equal(view.cards.filter(card => card === null).length, 1);
  }
  assert.equal(state.cards.filter(card => card === null).length, 0);
  assert.equal(actPoker(state, 1, { type: 'call' }), '내 차례가 아니에요.');
  for (let seat = 0; seat < 6; seat++) assert.equal(actPoker(state, seat, { type: 'call' }), null);
  assert.equal(state.winner, state.cards.indexOf(Math.max(...state.cards)));
  assert.equal(state.chips.reduce((a, b) => a + b), 120);
  assert.deepEqual(pokerView(state, 0).cards, state.cards);
});
test('raise reopens action, folds settle, and affordable cap preserves chips', () => {
  const state = createPoker(3);
  actPoker(state, 0, { type: 'call' });
  actPoker(state, 1, { type: 'raise' });
  actPoker(state, 2, { type: 'call' });
  assert.equal(state.winner, null);
  assert.equal(state.turn, 0);
  actPoker(state, 0, { type: 'fold' });
  assert.notEqual(state.winner, null);
  assert.equal(state.chips.reduce((a, b) => a + b), 60);
  const two = createPoker(2);
  actPoker(two, 0, { type: 'fold' });
  assert.equal(two.winner, 1);
  assert.equal(two.chips[1], 21);
  const cap = createPoker(2);
  for (let i = 0; i < 19; i++) assert.equal(actPoker(cap, cap.turn, { type: 'raise' }), null);
  const prior = JSON.stringify(cap);
  assert.notEqual(actPoker(cap, cap.turn, { type: 'raise' }), null);
  assert.equal(JSON.stringify(cap), prior);
  assert.equal(actPoker(cap, cap.turn, { type: 'call' }), null);
  assert.equal(cap.chips.reduce((a, b) => a + b), 40);
});

function accept(state: PokerState, seat: number, action: Action) {
  assert.equal(actPoker(state, seat, action), null);
  assert.equal(state.chips.reduce((sum, chips) => sum + chips, state.pot), 40, 'Every duel action conserves all 40 chips.');
  assert.ok(state.chips.every(chips => Number.isInteger(chips) && chips >= 0));
}
function reject(state: PokerState, seat: number, action: Action) {
  const before = structuredClone(state);
  assert.notEqual(actPoker(state, seat, action), null);
  assert.deepEqual(state, before, 'Rejected actions must not change cards, chips, readiness or the log.');
}
function checkBoth(state: PokerState) {
  accept(state, state.turn, { type: 'call' });
  assert.equal(state.stage, 'betting', 'One initial check must not reveal either card.');
  accept(state, state.turn, { type: 'call' });
  assert.equal(state.stage, 'reveal');
}
function advance(state: PokerState) {
  accept(state, 0, { type: 'next' });
  accept(state, 1, { type: 'next' });
}

test('party remains the default and accepts only its fixed one-chip raise', () => {
  const state = createPoker(2);
  assert.equal(state.variant, 'party');
  assert.equal(state.hand, 1);
  assert.deepEqual(state.remaining, []);
  assert.equal(actPoker(state, 0, { type: 'raise', amount: 8 }), null);
  assert.equal(state.bet, 2);
  assert.equal(state.pot, 3);
  assert.deepEqual(state.chips, [18, 19]);
  assert.equal(actPoker(state, 1, { type: 'call' }), null);
  assert.equal(state.stage, 'reveal');
  assert.equal(state.handWinner, state.winner);
  assert.equal(state.pot, 4, 'Party keeps the settled pot visible.');
  reject(state, 0, { type: 'next' });
});

test('duel deals independent personal 1–10 decks, exhausts all ten cards and reshuffles each deck', () => {
  assert.throws(() => createPoker(3, 'duel'));
  assert.throws(() => createPoker(1, 'duel'));
  const state = createPoker(2, 'duel');
  assert.notEqual(state.decks[0], state.decks[1]);
  assert.deepEqual(state.remaining, [9, 9]);
  const seen: number[][] = [[], []];
  for (let hand = 1; hand <= 10; hand++) {
    assert.equal(state.hand, hand);
    assert.equal(state.turn, (hand - 1) % 2);
    for (const seat of [0, 1]) {
      seen[seat].push(state.cards[seat]);
      assert.equal(state.remaining[seat], 10 - hand);
      const view = pokerView(state, seat);
      assert.equal(Object.hasOwn(view, 'decks'), false);
      assert.equal(JSON.stringify(view).includes('"decks"'), false);
      assert.equal(view.cards[seat], null);
      assert.equal(view.cards[1 - seat], state.cards[1 - seat]);
    }
    checkBoth(state);
    assert.equal(state.winner, null, 'Ten one-chip hands cannot exhaust the starting 20 chips.');
    for (const seat of [0, 1]) assert.deepEqual(pokerView(state, seat).cards, state.cards);
    if (hand < 10) advance(state);
  }
  const fullDeck = Array.from({ length: 10 }, (_, i) => i + 1);
  for (const cards of seen) assert.deepEqual(cards.sort((a, b) => a - b), fullDeck);
  assert.deepEqual(state.decks, [[], []]);
  advance(state);
  assert.equal(state.hand, 11);
  assert.deepEqual(state.remaining, [9, 9]);
  for (const seat of [0, 1]) {
    assert.deepEqual([state.cards[seat], ...state.decks[seat]].sort((a, b) => a - b), fullDeck);
    assert.equal(Object.hasOwn(pokerView(state, seat), 'decks'), false);
  }
});

test('equal personal cards reveal without ending the match and carry the pot into the next hand', () => {
  const state = createPoker(2, 'duel');
  state.cards = [6, 6];
  checkBoth(state);
  assert.equal(state.handWinner, null);
  assert.equal(state.winner, null);
  assert.equal(state.draw, false);
  assert.equal(state.pot, 2);
  assert.deepEqual(state.chips, [19, 19]);
  assert.deepEqual(pokerView(state, 0).cards, [6, 6]);
  advance(state);
  assert.equal(state.hand, 2);
  assert.equal(state.turn, 1);
  assert.equal(state.pot, 4);
  assert.deepEqual(state.chips, [18, 18]);
  assert.deepEqual(state.bets, [1, 1]);
  assert.equal(pokerView(state, 0).cards[0], null);
});

test('duel raises specify additional integer chips and a responding call immediately reveals', () => {
  const state = createPoker(2, 'duel');
  state.cards = [8, 3];
  accept(state, 0, { type: 'raise', amount: 4 });
  assert.equal(state.bet, 5);
  assert.equal(state.pot, 6);
  assert.deepEqual(state.bets, [5, 1]);
  accept(state, 1, { type: 'raise', amount: 2 });
  assert.equal(state.bet, 7);
  assert.equal(state.pot, 12);
  assert.deepEqual(state.bets, [5, 7]);
  accept(state, 0, { type: 'call' });
  assert.equal(state.stage, 'reveal');
  assert.equal(state.handWinner, 0);
  assert.equal(state.winner, null);
  assert.equal(state.pot, 0);
  assert.deepEqual(state.chips, [27, 13]);
});

test('folding a 10 transfers the pot plus ten chips; other folded cards transfer only the pot', () => {
  for (const card of [10, 9]) {
    const state = createPoker(2, 'duel');
    state.cards = [card, 7];
    accept(state, 0, { type: 'fold' });
    assert.equal(state.stage, 'reveal');
    assert.equal(state.handWinner, 1);
    assert.equal(state.winner, null);
    assert.equal(state.pot, 0);
    assert.deepEqual(state.chips, card === 10 ? [9, 31] : [19, 21]);
    assert.deepEqual(pokerView(state, 0).cards, state.cards);
  }
});

test('a 10-fold penalty is capped by remaining wealth and bankruptcy ends the match', () => {
  const state = createPoker(2, 'duel');
  state.cards = [10, 4];
  state.chips = [6, 32];
  accept(state, 0, { type: 'fold' });
  assert.deepEqual(state.chips, [0, 40]);
  assert.equal(state.pot, 0);
  assert.equal(state.handWinner, 1);
  assert.equal(state.winner, 1);
  for (const seat of [0, 1]) for (const type of ['next', 'call', 'raise', 'fold']) reject(state, seat, { type });
});

test('all-in ties carry every chip forward and allow zero-ante checks without creating chips or deadlocking', () => {
  for (const chips of [[19, 19], [4, 34]]) {
    const state = createPoker(2, 'duel');
    state.cards = [7, 7];
    state.chips = [...chips];
    accept(state, 0, { type: 'raise', amount: chips[0] });
    accept(state, 1, { type: 'call' });
    const carried = state.pot;
    assert.equal(state.chips[0], 0);
    assert.equal(state.stage, 'reveal');
    assert.equal(state.winner, null);
    assert.equal(state.draw, false);
    advance(state);
    assert.equal(state.pot, carried);
    assert.equal(state.bet, 0);
    assert.deepEqual(state.bets, [0, 0]);
    reject(state, state.turn, { type: 'raise' });
    state.cards = [9, 2];
    checkBoth(state);
    assert.equal(state.pot, 0);
    assert.equal(state.handWinner, 0);
    assert.deepEqual(state.chips, chips[0] === 19 ? [40, 0] : [10, 30]);
    assert.equal(state.winner, chips[0] === 19 ? 0 : null);
  }
});

test('next-hand readiness accepts each player once, rejects invalid phases or seats, and resets privacy', () => {
  const state = createPoker(2, 'duel');
  reject(state, 0, { type: 'next' });
  state.cards = [3, 8];
  checkBoth(state);
  for (const seat of [-1, 2, NaN, .5]) reject(state, seat, { type: 'next' });
  reject(state, state.turn, { type: 'call' });
  accept(state, 0, { type: 'next' });
  assert.deepEqual(state.nextReady, [true, false]);
  assert.equal(state.hand, 1);
  assert.equal(state.stage, 'reveal');
  assert.deepEqual(pokerView(state, 0).cards, [3, 8]);
  reject(state, 0, { type: 'next' });
  accept(state, 1, { type: 'next' });
  assert.equal(state.hand, 2);
  assert.equal(state.stage, 'betting');
  assert.equal(state.handWinner, null);
  assert.deepEqual(state.nextReady, [false, false]);
  assert.deepEqual(state.acted, [false, false]);
  assert.deepEqual(state.folded, [false, false]);
  assert.deepEqual(state.chips, [18, 20]);
  assert.equal(state.turn, 1);
  assert.equal(pokerView(state, 0).cards[0], null);
  assert.equal(pokerView(state, 1).cards[1], null);
  reject(state, 1, { type: 'next' });
});

test('malformed, fractional, negative and unaffordable raise amounts are rejected without mutation', () => {
  const state = createPoker(2, 'duel');
  for (const amount of [NaN, Infinity, -Infinity, '2', null, true, {}, [], -1, 0, .5, 20, Number.MAX_SAFE_INTEGER]) {
    reject(state, 0, { type: 'raise', amount });
  }
  for (const seat of [-1, 2, .5, NaN]) reject(state, seat, { type: 'raise', amount: 1 });
  reject(state, 1, { type: 'raise', amount: 1 });
  reject(state, 0, { type: 'unrecognized' });
  accept(state, 0, { type: 'raise' });
  assert.equal(state.bet, 2);
  assert.equal(state.pot, 3);
});

test('an unequal all-in showdown awards exactly forty chips and rejects every later action', () => {
  const state = createPoker(2, 'duel');
  state.cards = [2, 9];
  accept(state, 0, { type: 'raise', amount: 19 });
  reject(state, 1, { type: 'raise', amount: 1 });
  accept(state, 1, { type: 'call' });
  assert.equal(state.winner, 1);
  assert.equal(state.stage, 'reveal');
  assert.deepEqual(state.chips, [0, 40]);
  for (const type of ['next', 'call', 'raise', 'fold']) reject(state, 1, { type });
});
