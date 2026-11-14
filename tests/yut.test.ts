import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actYut, createYut, yutDestination, yutRoll, yutTargets, YUT_DONE, YUT_HOME, YUT_POINTS, type YutState } from '../shared/yut.ts';
import { yutBot } from '../shared/yut-bot.ts';

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Random source that makes the next throws come out as the given results. */
function sticks(...results: number[]) {
  const draws: number[] = [];
  const flat = 0.1, round = 0.9;
  for (const value of results) {
    if (value === -1) draws.push(flat, round, round, round);
    else if (value === 1) draws.push(round, flat, round, round);
    else if (value === 5) draws.push(round, round, round, round);
    else draws.push(...[0, 1, 2, 3].map(i => i < value ? flat : round));
  }
  return () => { const next = draws.shift(); if (next === undefined) throw new Error('no draws left'); return next; };
}
function moveState(seat: number, pending: number[], seats = 2): YutState {
  const state = createYut(seats);
  state.turn = seat; state.stage = 'move'; state.pending = pending;
  return state;
}

test('throw distribution matches four fair sticks', () => {
  const random = seeded(7), counts = new Map<number, number>(), total = 160_000;
  for (let i = 0; i < total; i++) { const value = yutRoll(random); counts.set(value, (counts.get(value) ?? 0) + 1); }
  const expected: Record<number, number> = { [-1]: 1, 1: 3, 2: 6, 3: 4, 4: 1, 5: 1 };
  for (const [value, sixteenths] of Object.entries(expected)) {
    const share = (counts.get(Number(value)) ?? 0) / total;
    assert.ok(Math.abs(share - sixteenths / 16) < 0.006, `${value}: ${share}`);
  }
  assert.equal(YUT_POINTS.length, 29);
});

test('윷 and 모 grant another throw and results queue up', () => {
  const state = createYut(2);
  assert.equal(actYut(state, 0, { type: 'throw' }, sticks(4)), null);
  assert.equal(state.stage, 'throw');
  assert.match(state.log, /윷! 한 번 더/);
  assert.equal(actYut(state, 0, { type: 'throw' }, sticks(5)), null);
  assert.equal(state.stage, 'throw');
  assert.equal(actYut(state, 0, { type: 'throw' }, sticks(2)), null);
  assert.equal(state.stage, 'move');
  assert.deepEqual(state.pending, [4, 5, 2]);
  assert.equal(state.lastThrow?.value, 2);
  // Any order: use 개 first.
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 2 }), null);
  assert.deepEqual(state.pending, [4, 5]);
  assert.equal(state.pieces[0][0], 2);
  assert.equal(actYut(state, 0, { type: 'move', piece: 1, result: 1 }), null);
  assert.equal(state.pieces[0][1], 5);
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(state.pieces[0][0], 6);
  assert.equal(state.turn, 1);
  assert.equal(state.stage, 'throw');
  assert.deepEqual(state.pending, []);
});

test('outer path, both corner shortcuts and the centre route', () => {
  assert.equal(yutDestination(YUT_HOME, 3), 3);
  assert.equal(yutDestination(3, 4), 7); // passing 모 without stopping stays outside
  assert.equal(yutDestination(12, 5), 17);
  assert.equal(yutDestination(19, 1), 0);
  assert.equal(yutDestination(19, 2), YUT_DONE);
  assert.equal(yutDestination(0, 1), YUT_DONE);
  // Stopped on 모 (5): diagonal through the centre to 찌 (15).
  assert.equal(yutDestination(5, 1), 20);
  assert.equal(yutDestination(5, 3), 22);
  assert.equal(yutDestination(5, 5), 24);
  assert.equal(yutDestination(20, 4), 24);
  assert.equal(yutDestination(21, 3), 24); // passes the centre without stopping
  assert.equal(yutDestination(24, 2), 16);
  // Stopped on 뒷모 (10): diagonal to 참먹이.
  assert.equal(yutDestination(10, 2), 26);
  assert.equal(yutDestination(10, 4), 27);
  assert.equal(yutDestination(10, 5), 28);
  assert.equal(yutDestination(26, 4), 0);
  assert.equal(yutDestination(26, 5), YUT_DONE);
  // Stopped on 방 (22): short way home.
  assert.equal(yutDestination(22, 1), 27);
  assert.equal(yutDestination(22, 3), 0);
  assert.equal(yutDestination(22, 4), YUT_DONE);

  const state = moveState(0, [5, 3, 2]);
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(state.pieces[0][0], 5);
  assert.equal(yutTargets(state, 0, 0, 0), 22);
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(state.pieces[0][0], 22);
  assert.equal(yutTargets(state, 0, 0, 0), 28);
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(state.pieces[0][0], 28);
});

test('업기 stacks pieces that then move together', () => {
  const state = moveState(0, [2, 2, 3]);
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(actYut(state, 0, { type: 'move', piece: 1, result: 0 }), null);
  assert.match(state.log, /업었습니다/);
  assert.deepEqual(state.pieces[0], [2, 2, YUT_HOME, YUT_HOME]);
  assert.equal(actYut(state, 0, { type: 'move', piece: 1, result: 0 }), null);
  assert.deepEqual(state.pieces[0], [5, 5, YUT_HOME, YUT_HOME]);
});

test('capture sends every opponent piece on the point home and grants another throw', () => {
  const state = moveState(0, [3, 1], 3);
  state.pieces[1] = [3, 3, 7, YUT_HOME];
  state.pieces[2] = [3, YUT_HOME, YUT_HOME, YUT_HOME];
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.deepEqual(state.pieces[1], [YUT_HOME, YUT_HOME, 7, YUT_HOME]);
  assert.deepEqual(state.pieces[2], [YUT_HOME, YUT_HOME, YUT_HOME, YUT_HOME]);
  assert.equal(state.lastMove?.captured, 3);
  assert.equal(state.turn, 0);
  assert.equal(state.stage, 'throw');
  assert.deepEqual(state.pending, [1]);
  assert.equal(actYut(state, 0, { type: 'throw' }, sticks(3)), null);
  assert.equal(state.stage, 'move');
  assert.deepEqual(state.pending, [1, 3]);
});

test('빽도 edge cases', () => {
  // No piece on the board: skipped automatically.
  let state = createYut(2);
  assert.equal(actYut(state, 0, { type: 'throw' }, sticks(-1)), null);
  assert.equal(state.turn, 1);
  assert.deepEqual(state.pending, []);
  assert.match(state.log, /빽도/);
  // Usable after another result brings a piece onto the board.
  state = createYut(2);
  assert.equal(actYut(state, 0, { type: 'throw' }, sticks(4)), null);
  assert.equal(actYut(state, 0, { type: 'throw' }, sticks(-1)), null);
  assert.deepEqual(state.pending, [4, -1]);
  const before = structuredClone(state);
  assert.equal(typeof actYut(state, 0, { type: 'move', piece: 0, result: 1 }), 'string');
  assert.deepEqual(state, before);
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(state.pieces[0][0], 3);
  // From the first point to 참먹이 without finishing, then any forward move finishes.
  state = moveState(0, [-1, 1]);
  state.pieces[0][0] = 1;
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(state.pieces[0][0], 0);
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(state.pieces[0][0], YUT_DONE);
  // A leftover 빽도 is dropped when the last board piece finishes.
  state = moveState(0, [2, -1]);
  state.pieces[0][0] = 19;
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(state.turn, 1);
  // 빽도 at the centre goes back the way the piece came.
  assert.equal(yutDestination(22, -1, 26), 26);
  assert.equal(yutDestination(22, -1, 21), 21);
  assert.equal(yutDestination(20, -1), 5);
  state = moveState(0, [3, -1]);
  state.pieces[0][0] = 10;
  assert.equal(actYut(state, 0, { type: 'move', piece: 0, result: 0 }), null);
  assert.equal(yutTargets(state, 0, 0, 0), 26);
  // 빽도 onto a corner: the next move takes the diagonal.
  assert.equal(yutDestination(6, -1), 5);
});

test('finishing all four pieces wins and blocks further actions', () => {
  const state = moveState(1, [3, 2]);
  state.pieces[1] = [YUT_DONE, YUT_DONE, 27, 27];
  assert.equal(actYut(state, 1, { type: 'move', piece: 2, result: 1 }), null);
  assert.equal(state.pieces[1][2], 0);
  assert.equal(state.pieces[1][3], 0);
  assert.equal(state.winner, null);
  assert.equal(actYut(state, 1, { type: 'move', piece: 3, result: 0 }), null);
  assert.equal(state.winner, 1);
  const before = structuredClone(state);
  assert.equal(typeof actYut(state, 1, { type: 'throw' }), 'string');
  assert.deepEqual(state, before);
});

test('invalid inputs leave the state unchanged', () => {
  const state = moveState(0, [2]);
  state.pieces[0][3] = YUT_DONE;
  const before = structuredClone(state);
  for (const [seat, action] of [
    [1, { type: 'move', piece: 0, result: 0 }],
    [5, { type: 'throw' }],
    [NaN, { type: 'throw' }],
    [0, { type: 'throw' }],
    [0, { type: 'move', piece: 4, result: 0 }],
    [0, { type: 'move', piece: -1, result: 0 }],
    [0, { type: 'move', piece: 0.5, result: 0 }],
    [0, { type: 'move', piece: '0', result: 0 }],
    [0, { type: 'move', piece: 0, result: 1 }],
    [0, { type: 'move', piece: 0, result: NaN }],
    [0, { type: 'move', piece: 3, result: 0 }],
    [0, { type: 'move' }],
    [0, { type: 'jump' }],
  ] as const) {
    assert.equal(typeof actYut(state, seat, action), 'string');
    assert.deepEqual(state, before);
  }
  const fresh = createYut(2);
  const clean = structuredClone(fresh);
  assert.equal(typeof actYut(fresh, 0, { type: 'move', piece: 0, result: 0 }), 'string');
  assert.deepEqual(fresh, clean);
  assert.throws(() => createYut(1));
  assert.throws(() => createYut(5));
});

test('bots finish games for 2 and 4 seats', () => {
  for (const seats of [2, 4]) for (let seed = 1; seed <= 25; seed++) {
    const random = seeded(seed * 31 + seats);
    const state = createYut(seats);
    let steps = 0;
    while (state.winner === null) {
      const action = yutBot(state, state.turn, random);
      assert.equal(actYut(state, state.turn, action, random), null, JSON.stringify(action));
      assert.ok(++steps < 5000, 'game should end');
      JSON.stringify(state);
    }
    assert.ok(state.pieces[state.winner].every(p => p === YUT_DONE));
  }
});
