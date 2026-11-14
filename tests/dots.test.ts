import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actDots, createDots, lineIndex, openLines, sides, INFO, LINES, SIZE, type DotsState } from '../shared/dots.ts';
import { dotsBot } from '../shared/dots-bot.ts';
import { finished } from '../shared/tabletop-types.ts';

const line = (dir: 'h' | 'v', r: number, c: number) => ({ type: 'line', dir, r, c });
const set = (state: DotsState, dir: 'h' | 'v', r: number, c: number, owner = 0) => {
  (dir === 'h' ? state.h : state.v)[lineIndex(dir, r, c)] = owner;
  state.count++;
};
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Fills every line and box except the listed open lines, leaving the given boxes unowned. */
function nearlyFull(seats: number, openList: [('h' | 'v'), number, number][], freeBoxes: number[]) {
  const state = createDots(seats);
  state.h.fill(0); state.v.fill(0);
  for (const [dir, r, c] of openList) (dir === 'h' ? state.h : state.v)[lineIndex(dir, r, c)] = null;
  state.count = LINES - openList.length;
  state.boxes.fill(0);
  for (const box of freeBoxes) state.boxes[box] = null;
  return state;
}

test('dots info and initial state', () => {
  assert.equal(INFO.title, '점과 상자');
  assert.equal(INFO.min, 2);
  assert.equal(INFO.max, 4);
  const state = createDots(3);
  assert.equal(state.h.length, 30);
  assert.equal(state.v.length, 30);
  assert.equal(state.boxes.length, 25);
  assert.deepEqual(state.scores, [0, 0, 0]);
  assert.equal(state.turn, 0);
  assert.equal(openLines(state).length, LINES);
});

test('dots rejects invalid inputs without mutation', () => {
  const state = createDots(2);
  assert.equal(actDots(state, 0, line('h', 0, 0)), null);
  assert.equal(state.turn, 1);
  const before = structuredClone(state);
  for (const [seat, action] of [
    [0, line('h', 1, 1)],
    [2, line('h', 1, 1)],
    [NaN, line('h', 1, 1)],
    [1, line('h', 0, 0)],
    [1, line('h', 6, 0)],
    [1, line('h', 0, 5)],
    [1, line('v', 5, 0)],
    [1, line('v', 0, 6)],
    [1, line('h', -1, 0)],
    [1, line('h', 0.5, 0)],
    [1, { type: 'line', dir: 'h', r: '1', c: 0 }],
    [1, { type: 'line', dir: 'd', r: 1, c: 0 }],
    [1, { type: 'line', r: 1, c: 0 }],
    [1, { type: 'line', dir: 'v', r: NaN, c: 0 }],
    [1, { type: 'place', dir: 'h', r: 1, c: 0 }],
  ] as const) {
    assert.equal(typeof actDots(state, seat, action), 'string');
    assert.deepEqual(state, before);
  }
  // Outer edges are valid lines.
  assert.equal(actDots(state, 1, line('h', 5, 4)), null);
  assert.equal(actDots(state, 0, line('v', 4, 5)), null);
});

test('dots completing one box scores and grants another turn', () => {
  const state = createDots(2);
  assert.equal(actDots(state, 0, line('h', 0, 0)), null);
  assert.equal(actDots(state, 1, line('h', 1, 0)), null);
  assert.equal(actDots(state, 0, line('v', 0, 0)), null);
  assert.equal(state.turn, 1);
  assert.equal(actDots(state, 1, line('v', 0, 1)), null);
  assert.equal(state.boxes[0], 1);
  assert.deepEqual(state.scores, [0, 1]);
  assert.deepEqual(state.claimed, [0]);
  assert.deepEqual(state.last, { dir: 'v', r: 0, c: 1 });
  assert.equal(state.turn, 1);
  assert.equal(actDots(state, 1, line('h', 3, 3)), null);
  assert.deepEqual(state.claimed, []);
  assert.equal(state.turn, 0);
});

test('dots one line can complete two boxes', () => {
  const state = createDots(2);
  for (const [dir, r, c] of [['h', 0, 0], ['h', 1, 0], ['v', 0, 0], ['h', 0, 1], ['h', 1, 1], ['v', 0, 2]] as const) set(state, dir, r, c);
  assert.equal(actDots(state, 0, line('v', 0, 1)), null);
  assert.deepEqual(state.claimed.sort(), [0, 1]);
  assert.equal(state.boxes[0], 0);
  assert.equal(state.boxes[1], 0);
  assert.deepEqual(state.scores, [2, 0]);
  assert.equal(state.turn, 0);
  assert.equal(state.v[lineIndex('v', 0, 1)], 0);
});

test('dots turn order cycles through 3 and 4 seats', () => {
  for (const seats of [3, 4]) {
    const state = createDots(seats);
    for (let move = 0; move < seats * 2; move++) {
      assert.equal(state.turn, move % seats);
      assert.equal(typeof actDots(state, (move + 1) % seats, line('h', 0, 0)), 'string');
      // Top edge then bottom edge lines never close a box this early.
      const r = move < 5 ? 0 : 5;
      assert.equal(actDots(state, move % seats, line('h', r, move % 5)), null);
    }
    assert.equal(state.turn, 0);
  }
});

test('dots last line decides the winner by most boxes', () => {
  const state = nearlyFull(2, [['v', 0, 0]], [0]);
  state.scores = [12, 12];
  assert.equal(actDots(state, 0, line('v', 0, 0)), null);
  assert.deepEqual(state.scores, [13, 12]);
  assert.equal(state.winner, 0);
  assert.equal(state.draw, false);
  assert.ok(finished(state));
  const before = structuredClone(state);
  assert.equal(typeof actDots(state, 0, line('v', 0, 0)), 'string');
  assert.deepEqual(state, before);
});

test('dots tie for most boxes is a draw', () => {
  const state = nearlyFull(3, [['v', 0, 0]], [0]);
  state.scores = [11, 12, 1];
  assert.equal(actDots(state, 0, line('v', 0, 0)), null);
  assert.deepEqual(state.scores, [12, 12, 1]);
  assert.equal(state.winner, null);
  assert.equal(state.draw, true);
});

test('dots finishing without a claim still ends the game', () => {
  // Last line is an edge of an already owned box (unusual but possible through setup).
  const state = nearlyFull(2, [['h', 0, 0]], []);
  state.scores = [20, 5];
  state.turn = 1;
  assert.equal(actDots(state, 1, line('h', 0, 0)), null);
  assert.equal(state.winner, 0);
});

test('dots bot takes an available box', () => {
  const state = createDots(2);
  for (const [dir, r, c] of [['h', 2, 2], ['h', 3, 2], ['v', 2, 2]] as const) set(state, dir, r, c);
  for (let seed = 1; seed <= 10; seed++) {
    assert.deepEqual(dotsBot(state, 0, seeded(seed)), line('v', 2, 3));
  }
});

test('dots bot avoids drawing a third side when it can', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const random = seeded(seed);
    const state = createDots(2);
    for (let move = 0; move < 20 && !finished(state); move++) {
      const safeExists = openLines(state).some(l => {
        const copy = structuredClone(state);
        (l.dir === 'h' ? copy.h : copy.v)[lineIndex(l.dir, l.r, l.c)] = 0;
        return copy.boxes.every((_, i) => sides(copy, Math.floor(i / SIZE), i % SIZE) !== 3);
      });
      const threeBefore = state.boxes.some((_, i) => sides(state, Math.floor(i / SIZE), i % SIZE) === 3);
      assert.equal(actDots(state, state.turn, dotsBot(state, state.turn, random)), null);
      if (safeExists && !threeBefore) {
        assert.ok(state.boxes.every((_, i) => sides(state, Math.floor(i / SIZE), i % SIZE) !== 3), `seed ${seed} move ${move}`);
      }
    }
  }
});

test('dots bot gives away the shortest chain when forced', () => {
  // Open: single box (4,4) with two outer sides missing, and a 3-box chain (0,0)-(0,2) along the top edge.
  const state = nearlyFull(2, [['h', 5, 4], ['v', 4, 5], ['v', 0, 0], ['v', 0, 1], ['v', 0, 2], ['h', 0, 2]], [24, 0, 1, 2]);
  assert.ok([0, 1, 2, 24].every(i => sides(state, Math.floor(i / SIZE), i % SIZE) === 2));
  for (let seed = 1; seed <= 10; seed++) {
    const action = dotsBot(state, 0, seeded(seed));
    assert.ok(
      (action.dir === 'h' && action.r === 5 && action.c === 4) || (action.dir === 'v' && action.r === 4 && action.c === 5),
      JSON.stringify(action),
    );
  }
});

test('dots bot self-play finishes legally for 2 and 4 seats', () => {
  for (const seats of [2, 4]) {
    for (let seed = 1; seed <= 15; seed++) {
      const random = seeded(seed * 31 + seats);
      const state = createDots(seats);
      let moves = 0;
      while (!finished(state)) {
        assert.equal(actDots(state, state.turn, dotsBot(state, state.turn, random)), null);
        assert.ok(++moves <= LINES);
      }
      assert.equal(moves, LINES);
      assert.equal(state.scores.reduce((a, b) => a + b, 0), 25);
      assert.ok(state.boxes.every(owner => owner !== null));
      assert.ok(state.h.every(owner => owner !== null) && state.v.every(owner => owner !== null));
      const best = Math.max(...state.scores);
      assert.equal(state.draw, state.scores.filter(s => s === best).length > 1);
      if (!state.draw) assert.equal(state.scores[state.winner!], best);
    }
  }
});
