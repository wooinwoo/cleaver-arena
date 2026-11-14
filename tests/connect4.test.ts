import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actConnectFour, createConnectFour, INFO, type ConnectFourState } from '../shared/connect4.ts';
import { connectFourBot } from '../shared/connect4-bot.ts';
import { finished } from '../shared/tabletop-types.ts';

const at = (r: number, c: number) => r * 7 + c;

function play(state: ConnectFourState, columns: number[]) {
  for (const c of columns) assert.equal(actConnectFour(state, state.turn, { type: 'drop', c }), null);
  return state;
}

function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
}

test('connect4 info and starting state', () => {
  assert.equal(INFO.title, '사목');
  assert.deepEqual([INFO.min, INFO.max], [2, 2]);
  const state = createConnectFour();
  assert.equal(state.board.length, 42);
  assert.equal(state.turn, 0);
  assert.ok(state.board.every(cell => cell === null));
});

test('discs fall to the lowest empty cell and turns alternate', () => {
  const state = play(createConnectFour(), [3, 3, 3]);
  assert.equal(state.board[at(5, 3)], 0);
  assert.equal(state.board[at(4, 3)], 1);
  assert.equal(state.board[at(3, 3)], 0);
  assert.equal(state.last, at(3, 3));
  assert.equal(state.turn, 1);
  assert.equal(state.count, 3);
});

test('a full column is rejected without changes', () => {
  const state = play(createConnectFour(), [0, 0, 0, 0, 0, 0]);
  const before = structuredClone(state);
  assert.equal(typeof actConnectFour(state, 0, { type: 'drop', c: 0 }), 'string');
  assert.deepEqual(state, before);
});

test('invalid seats, turns and inputs do not mutate', () => {
  const state = play(createConnectFour(), [3]);
  const before = structuredClone(state);
  for (const [seat, action] of [
    [0, { type: 'drop', c: 1 }],
    [2, { type: 'drop', c: 1 }],
    [NaN, { type: 'drop', c: 1 }],
    [1, { type: 'drop', c: -1 }],
    [1, { type: 'drop', c: 7 }],
    [1, { type: 'drop', c: 1.5 }],
    [1, { type: 'drop', c: '1' }],
    [1, { type: 'drop', c: NaN }],
    [1, { type: 'drop', c: Infinity }],
    [1, { type: 'drop' }],
    [1, { type: 'place', c: 1 }],
  ] as const) {
    assert.equal(typeof actConnectFour(state, seat, action), 'string');
    assert.deepEqual(state, before);
  }
});

test('wins in all four directions record the line and stop play', () => {
  const cases: [number[], number[]][] = [
    // horizontal: red 0..3 on the bottom row
    [[0, 0, 1, 1, 2, 2, 3], [at(5, 0), at(5, 1), at(5, 2), at(5, 3)]],
    // vertical: red stacks column 0
    [[0, 1, 0, 1, 0, 1, 0], [at(2, 0), at(3, 0), at(4, 0), at(5, 0)]],
    // diagonal rising to the right
    [[0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3], [at(2, 3), at(3, 2), at(4, 1), at(5, 0)]],
    // diagonal rising to the left
    [[6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3], [at(2, 3), at(3, 4), at(4, 5), at(5, 6)]],
  ];
  for (const [moves, line] of cases) {
    const state = play(createConnectFour(), moves);
    assert.equal(state.winner, 0, JSON.stringify(moves));
    assert.deepEqual(state.line, line);
    const before = structuredClone(state);
    assert.equal(typeof actConnectFour(state, 1, { type: 'drop', c: 6 }), 'string');
    assert.deepEqual(state, before);
  }
  const yellow = play(createConnectFour(), [0, 1, 0, 1, 0, 1, 2, 1]);
  assert.equal(yellow.winner, 1);
});

test('a full board without four is a draw', () => {
  const state = createConnectFour();
  // Rows alternate colours; columns 0-2, 3-5 and 6 flip, so no line ever reaches four.
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) state.board[at(r, c)] = (r + Math.floor(c / 3)) % 2;
  // leave the top-right cell empty and fill it as the final move
  const last = at(0, 6);
  const seat = state.board[last]!;
  state.board[last] = null;
  state.count = 41;
  state.turn = seat;
  assert.equal(actConnectFour(state, seat, { type: 'drop', c: 6 }), null);
  assert.equal(state.winner, null);
  assert.ok(state.draw);
  assert.ok(finished(state));
});

test('bot takes an immediate win', () => {
  const state = play(createConnectFour(), [0, 6, 1, 6, 2, 5]);
  assert.deepEqual(connectFourBot(state, 0, () => 0), { type: 'drop', c: 3 });
  const vertical = play(createConnectFour(), [3, 0, 3, 0, 3, 6]);
  assert.deepEqual(connectFourBot(vertical, 0, () => 0.9), { type: 'drop', c: 3 });
});

test('bot blocks an immediate threat', () => {
  const state = play(createConnectFour(), [0, 6, 1, 6, 2]);
  assert.deepEqual(connectFourBot(state, 1, () => 0), { type: 'drop', c: 3 });
});

test('bot self-play finishes legal games quickly over many seeds', () => {
  let slowest = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const random = seeded(seed);
    const state = createConnectFour();
    for (let i = 0; i < 42 && !finished(state); i++) {
      const start = performance.now();
      const move = connectFourBot(state, state.turn, random);
      slowest = Math.max(slowest, performance.now() - start);
      assert.equal(actConnectFour(state, state.turn, move), null);
    }
    assert.ok(finished(state));
  }
  assert.ok(slowest < 120, `slowest move ${slowest}ms`);
});
