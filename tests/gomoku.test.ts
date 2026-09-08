import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actGomoku, createGomoku } from '../shared/gomoku.ts';

test('gomoku validates turns, bounds, integers, actions and occupied positions without mutations', () => {
  const state = createGomoku();
  assert.equal(state.board.length, 225);
  assert.ok(state.board.every(cell => cell === null));
  assert.equal(actGomoku(state, 0, { type: 'place', r: 7, c: 7 }), null);
  assert.equal(state.last, 112);
  assert.equal(state.count, 1);
  assert.equal(state.turn, 1);
  const before = structuredClone(state);
  for (const [seat, action] of [
    [0, { type: 'place', r: 1, c: 1 }],
    [2, { type: 'place', r: 1, c: 1 }],
    [NaN, { type: 'place', r: 1, c: 1 }],
    [1, { type: 'place', r: 7, c: 7 }],
    [1, { type: 'place', r: -1, c: 0 }],
    [1, { type: 'place', r: 15, c: 0 }],
    [1, { type: 'place', r: 0, c: -1 }],
    [1, { type: 'place', r: 0, c: 15 }],
    [1, { type: 'place', r: 0.5, c: 1 }],
    [1, { type: 'place', r: 1, c: '2' }],
    [1, { type: 'place', r: NaN, c: 1 }],
    [1, { type: 'place', r: 1, c: Infinity }],
    [1, { type: 'place' }],
    [1, { type: 'move', r: 1, c: 1 }],
  ] as const) {
    assert.equal(typeof actGomoku(state, seat, action), 'string');
    assert.deepEqual(state, before);
  }
});

test('gomoku detects all four lines for either color and blocks moves after victory', () => {
  for (const seat of [0, 1]) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const state = createGomoku();
      state.turn = seat;
      for (const offset of [-2, -1, 1, 2]) state.board[(7 + dr * offset) * 15 + 7 + dc * offset] = seat;
      state.count = 4;
      assert.equal(actGomoku(state, seat, { type: 'place', r: 7, c: 7 }), null);
      assert.equal(state.winner, seat);
      assert.equal(state.draw, false);
      const before = structuredClone(state);
      assert.equal(typeof actGomoku(state, seat, { type: 'place', r: 0, c: 0 }), 'string');
      assert.deepEqual(state, before);
    }
  }
});

test('gomoku freestyle accepts overlines and keeps separate board rows apart', () => {
  const overline = createGomoku();
  for (const col of [0, 1, 2, 4, 5]) overline.board[col] = 0;
  overline.count = 5;
  assert.equal(actGomoku(overline, 0, { type: 'place', r: 0, c: 3 }), null);
  assert.equal(overline.winner, 0);

  const wrapped = createGomoku();
  for (const index of [12, 13, 14, 15]) wrapped.board[index] = 0;
  wrapped.count = 4;
  assert.equal(actGomoku(wrapped, 0, { type: 'place', r: 1, c: 1 }), null);
  assert.equal(wrapped.winner, null);
});

test('gomoku plays a complete legal draw and rejects subsequent moves', () => {
  const state = createGomoku();
  const positions: number[][] = [[], []];
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) positions[(r + 2 * c) % 4 < 2 ? 0 : 1].push(r * 15 + c);
  }
  for (let move = 0; move < 225; move++) {
    const seat = move % 2;
    const index = positions[seat].shift()!;
    assert.equal(actGomoku(state, seat, { type: 'place', r: Math.floor(index / 15), c: index % 15 }), null);
    assert.equal(state.winner, null);
    assert.equal(state.draw, move === 224);
  }
  assert.equal(state.count, 225);
  assert.ok(state.board.every(cell => cell !== null));
  const before = structuredClone(state);
  assert.equal(typeof actGomoku(state, state.turn, { type: 'place', r: 0, c: 0 }), 'string');
  assert.deepEqual(state, before);
});
