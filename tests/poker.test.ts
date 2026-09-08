import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoker, actPoker, pokerView } from '../shared/poker.ts';

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
