import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actReversi, createReversi, reversiFlips, reversiMoves, type ReversiState } from '../shared/reversi.ts';
import { reversiBot } from '../shared/reversi-bot.ts';
import { finished } from '../shared/tabletop-types.ts';

const at = (r: number, c: number) => r * 8 + c;

function custom(cells: [r: number, c: number, seat: number][], turn = 0): ReversiState {
  const state = createReversi();
  state.board.fill(null);
  for (const [r, c, seat] of cells) state.board[at(r, c)] = seat;
  state.counts = [0, 1].map(seat => state.board.filter(cell => cell === seat).length) as [number, number];
  state.turn = turn;
  return state;
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

const CORNER_CELLS = [at(0, 0), at(0, 7), at(7, 0), at(7, 7)];

/** Board from eight rows of `X` (black), `O` (white) and `.` (empty). */
function layout(rows: string[], turn: number): ReversiState {
  const cells: [number, number, number][] = [];
  rows.forEach((row, r) => [...row].forEach((cell, c) => { if (cell !== '.') cells.push([r, c, cell === 'X' ? 0 : 1]); }));
  return custom(cells, turn);
}

/** How many corners the opponent could take right after `seat` plays `index`. */
function cornersHanded(state: ReversiState, seat: number, index: number) {
  const board = state.board.slice();
  for (const flip of reversiFlips(board, index, seat)) board[flip] = seat;
  board[index] = seat;
  return CORNER_CELLS.filter(corner => reversiFlips(board, corner, 1 - seat).length).length;
}

/** The first `plies` moves of a bot-vs-bot game. Without `random` the bot is called the way the server calls it. */
function opening(plies: number, random?: () => number) {
  const state = createReversi();
  const line: number[] = [];
  while (line.length < plies && !finished(state)) {
    assert.equal(actReversi(state, state.turn, reversiBot(state, state.turn, random)), null);
    line.push(state.last as number);
  }
  return line;
}

/** The four board symmetries that keep the starting position: identity, half turn and the two diagonal mirrors. */
const SYMMETRIES = [
  (index: number) => index,
  (index: number) => 63 - index,
  (index: number) => (index % 8) * 8 + Math.floor(index / 8),
  (index: number) => 63 - ((index % 8) * 8 + Math.floor(index / 8)),
];
/** One spelling for a line and its mirror images, so the same game turned around is not counted as a different one. */
const canonical = (line: number[]) => SYMMETRIES.map(map => line.map(map).join(' ')).sort()[0];

/**
 * One bot move and how long it took. A slow sample is timed again and the fastest run counts,
 * so a GC pause or a busy machine is not mistaken for a slow search.
 */
function timedMove(state: ReversiState, seat: number, random: () => number) {
  let started = performance.now();
  const move = reversiBot(state, seat, random);
  let elapsed = performance.now() - started;
  for (let retry = 1; elapsed >= 50 && retry <= 3; retry++) {
    started = performance.now();
    reversiBot(state, seat, seeded(retry));
    elapsed = Math.min(elapsed, performance.now() - started);
  }
  return { move, elapsed };
}

test('reversi opening has the four centre discs and four legal black moves', () => {
  const state = createReversi();
  assert.equal(state.board.length, 64);
  assert.equal(state.board[at(3, 3)], 1);
  assert.equal(state.board[at(3, 4)], 0);
  assert.equal(state.board[at(4, 3)], 0);
  assert.equal(state.board[at(4, 4)], 1);
  assert.deepEqual(state.counts, [2, 2]);
  assert.equal(state.turn, 0);
  assert.deepEqual(reversiMoves(state, 0), [at(2, 3), at(3, 2), at(4, 5), at(5, 4)]);
  assert.deepEqual(reversiMoves(state, 1), [at(2, 4), at(3, 5), at(4, 2), at(5, 3)]);

  assert.equal(actReversi(state, 0, { type: 'place', r: 2, c: 3 }), null);
  assert.equal(state.board[at(3, 3)], 0);
  assert.deepEqual(state.flipped, [at(3, 3)]);
  assert.equal(state.last, at(2, 3));
  assert.deepEqual(state.counts, [4, 1]);
  assert.equal(state.turn, 1);
});

test('reversi flips in all eight directions at once and stops at gaps and edges', () => {
  // White ring around (3,3) with black discs one step further out in every direction.
  const cells: [number, number, number][] = [];
  for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
    cells.push([3 + dr, 3 + dc, 1], [3 + dr * 2, 3 + dc * 2, 0]);
  }
  const state = custom(cells);
  assert.equal(actReversi(state, 0, { type: 'place', r: 3, c: 3 }), null);
  assert.equal(state.flipped.length, 8);
  assert.ok(state.board.every(cell => cell !== 1));
  assert.deepEqual(state.counts, [17, 0]);
  assert.equal(state.winner, 0);

  // A white line not closed by black, and a line that would wrap across rows, flip nothing.
  const open = custom([[0, 6, 1], [0, 7, 1], [1, 0, 0], [5, 5, 0], [5, 6, 1]]);
  assert.equal(typeof actReversi(open, 0, { type: 'place', r: 0, c: 5 }), 'string');
  assert.ok(!reversiMoves(open, 0).includes(at(0, 5)));
  assert.deepEqual(reversiMoves(open, 0), [at(5, 7)]);
});

test('reversi rejects invalid input without mutating state', () => {
  const state = createReversi();
  assert.equal(actReversi(state, 0, { type: 'place', r: 2, c: 3 }), null);
  const before = structuredClone(state);
  for (const [seat, action] of [
    [0, { type: 'place', r: 2, c: 2 }],
    [2, { type: 'place', r: 2, c: 2 }],
    [-1, { type: 'place', r: 2, c: 2 }],
    [NaN, { type: 'place', r: 2, c: 2 }],
    [1, { type: 'place', r: 3, c: 3 }],
    [1, { type: 'place', r: 0, c: 0 }],
    [1, { type: 'place', r: -1, c: 0 }],
    [1, { type: 'place', r: 8, c: 0 }],
    [1, { type: 'place', r: 0, c: 8 }],
    [1, { type: 'place', r: 2.5, c: 2 }],
    [1, { type: 'place', r: '2', c: 2 }],
    [1, { type: 'place', r: Infinity, c: 2 }],
    [1, { type: 'place' }],
    [1, { type: 'move', r: 2, c: 2 }],
    [1, null],
  ] as const) {
    assert.equal(typeof actReversi(state, seat as number, action as never), 'string');
    assert.deepEqual(state, before);
  }
});

test('reversi passes automatically when the opponent has no legal move', () => {
  const state = custom([[0, 1, 1], [0, 2, 0], [4, 4, 0], [4, 5, 1]]);
  assert.deepEqual(reversiMoves(state, 0), [at(0, 0), at(4, 6)]);
  assert.equal(actReversi(state, 0, { type: 'place', r: 0, c: 0 }), null);
  // White can still play (4,3), so no pass yet.
  assert.equal(state.turn, 1);

  // After black takes (0,0), white's only disc (7,5) faces black discs that run into the edge: white must pass.
  const skip = custom([[0, 1, 1], [0, 2, 0], [7, 5, 1], [7, 6, 0], [7, 7, 0]]);
  assert.equal(actReversi(skip, 0, { type: 'place', r: 0, c: 0 }), null);
  assert.deepEqual(reversiMoves(skip, 1), []);
  assert.deepEqual(reversiMoves(skip, 0), [at(7, 4)]);
  assert.equal(skip.turn, 0);
  assert.equal(skip.passed, 1);
  assert.match(skip.log, /백은 둘 곳이 없어 차례를 넘깁니다/);
  assert.equal(finished(skip), false);
  assert.equal(typeof actReversi(skip, 1, { type: 'place', r: 7, c: 4 }), 'string');
  assert.equal(actReversi(skip, 0, { type: 'place', r: 7, c: 4 }), null);
  assert.equal(skip.winner, 0);
});

test('reversi ends when neither side can move and scores wins and draws', () => {
  const win = custom([[0, 1, 1], [0, 2, 0]]);
  assert.equal(actReversi(win, 0, { type: 'place', r: 0, c: 0 }), null);
  assert.equal(win.winner, 0);
  assert.equal(win.draw, false);
  assert.deepEqual(win.counts, [3, 0]);
  const before = structuredClone(win);
  assert.equal(typeof actReversi(win, win.turn, { type: 'place', r: 5, c: 5 }), 'string');
  assert.deepEqual(win, before);

  // White wins with more discs even though black moved last.
  const white = custom([[0, 1, 1], [0, 2, 0], [7, 0, 1], [7, 1, 1], [7, 2, 1], [6, 0, 1]]);
  assert.equal(actReversi(white, 0, { type: 'place', r: 0, c: 0 }), null);
  assert.deepEqual(white.counts, [3, 4]);
  assert.equal(white.winner, 1);

  const draw = custom([[0, 1, 1], [0, 2, 0], [7, 0, 1], [7, 1, 1], [7, 2, 1]]);
  assert.equal(actReversi(draw, 0, { type: 'place', r: 0, c: 0 }), null);
  assert.deepEqual(draw.counts, [3, 3]);
  assert.equal(draw.draw, true);
  assert.equal(draw.winner, null);
});

test('reversi bot always returns a legal move and self-play finishes without errors', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const state = createReversi();
    const random = seeded(seed);
    let plies = 0, slowest = 0;
    while (!finished(state)) {
      const seat = state.turn;
      const legal = reversiMoves(state, seat);
      assert.ok(legal.length > 0, 'turn must always have a legal move');
      const { move, elapsed } = timedMove(state, seat, random);
      slowest = Math.max(slowest, elapsed);
      assert.ok(legal.includes((move.r as number) * 8 + (move.c as number)), JSON.stringify(move));
      assert.equal(actReversi(state, seat, move), null);
      assert.equal(state.counts[0] + state.counts[1], state.board.filter(cell => cell !== null).length);
      assert.ok(++plies <= 60);
    }
    assert.ok(state.winner !== null || state.draw);
    assert.ok(slowest < 250, `slowest move ${slowest.toFixed(1)}ms`);
  }
});

test('reversi bot takes an available corner', () => {
  const state = custom([[0, 1, 1], [0, 2, 0], [3, 3, 1], [3, 4, 0], [4, 3, 0], [4, 4, 1]]);
  assert.deepEqual(reversiBot(state, 0, () => 0), { type: 'place', r: 0, c: 0 });
});

test('reversi bot takes an available corner for every random source', () => {
  // One corner on offer while the bot still varies its opening, and one in a midgame where the search alone prefers (4,1).
  const early = custom([[0, 1, 1], [0, 2, 0], [3, 3, 1], [3, 4, 0], [4, 3, 0], [4, 4, 1]]);
  const midgame = layout(['..XXXX..', '..XOX...', '..XOOXX.', 'OOXOOXX.', '..XXXOO.', '.XXXOXXX', '...XXXX.', '..OOOO..'], 1);
  assert.ok(reversiMoves(early, 0).length > 1 && reversiMoves(midgame, 1).length > 1);
  for (let seed = 1; seed <= 20; seed++) {
    assert.deepEqual(reversiBot(early, 0, seeded(seed)), { type: 'place', r: 0, c: 0 });
    assert.deepEqual(reversiBot(midgame, 1, seeded(seed)), { type: 'place', r: 7, c: 7 });
  }
});

test('reversi bot does not open a corner for the opponent when another move keeps it shut', () => {
  // Black has two moves. (7,6) is what the search alone prefers, but it lets white take (7,7) at once.
  const state = layout(['..XXXX..', '..XOX...', '..XOOXX.', '.XXOOXX.', '...OOOO.', '.XXXOOXX', '...XOO..', '..OOOO..'], 0);
  const legal = reversiMoves(state, 0);
  assert.equal(legal.length, 2);
  assert.equal(cornersHanded(state, 0, at(7, 6)), 1);
  const [safe] = legal.filter(index => cornersHanded(state, 0, index) === 0);
  assert.notEqual(safe, undefined);
  for (let seed = 1; seed <= 20; seed++) {
    assert.deepEqual(reversiBot(state, 0, seeded(seed)), { type: 'place', r: Math.floor(safe / 8), c: safe % 8 });
  }
});

test('reversi bot plays the solved endgame for the final score and lets the corner rule break ties', () => {
  /** White's final lead when white plays (r, c) and the bot then finishes the game for both sides. */
  const lead = (from: ReversiState, r: number, c: number) => {
    const state = structuredClone(from);
    assert.equal(actReversi(state, 1, { type: 'place', r, c }), null);
    while (!finished(state)) assert.equal(actReversi(state, state.turn, reversiBot(state, state.turn, () => 0)), null);
    return state.counts[1] - state.counts[0];
  };
  // White to move, 4 empties: the corner (7,0) and (4,0) end equally well, so the corner is taken.
  const tied = layout(['OOOOOOOO', 'OOOOOOOO', 'OXOOOOOO', 'XOOOOOOO', '.XOXOOOO', '.XXOOOOO', '.XOOOOOO', '.OOOOOOO'], 1);
  assert.equal(lead(tied, 7, 0), lead(tied, 4, 0));
  // White to move, 7 empties: the corner (7,0) only draws while (1,6) wins, so the corner is left alone.
  const costly = layout(['XXXXXXX.', '..OOOX..', 'XXOOXXXO', 'XOOOOOOO', 'XOXXXOOO', 'XXXXOOXX', 'XXXOXOXX', '..OOOOXO'], 1);
  assert.ok(lead(costly, 1, 6) > 0);
  assert.equal(lead(costly, 7, 0), 0);
  for (let seed = 1; seed <= 20; seed++) {
    assert.deepEqual(reversiBot(tied, 1, seeded(seed)), { type: 'place', r: 7, c: 0 });
    assert.deepEqual(reversiBot(costly, 1, seeded(seed)), { type: 'place', r: 1, c: 6 });
  }
});

test('reversi bot opens differently from game to game', () => {
  const lines = Array.from({ length: 12 }, (_, i) => opening(10, seeded(i + 1)));
  for (const line of lines) assert.equal(line.length, 10);
  const distinct = new Set(lines.map(canonical));
  assert.ok(distinct.size >= 6, `only ${distinct.size} distinct openings in 12 games`);
  // Variety has to come from the bot's own replies too, not just from the first disc.
  const replies = new Set(lines.map(line => canonical(line.slice(0, 2))));
  assert.ok(replies.size >= 2, 'the reply to the first move never changes');
});

test('reversi bot called without a random source varies through Math.random', () => {
  const original = Math.random;
  const lines: number[][] = [];
  try {
    for (const seed of [2, 5, 9]) {
      Math.random = seeded(seed);
      lines.push(opening(10));
      assert.deepEqual(lines.at(-1), opening(10, seeded(seed)));
    }
  } finally {
    Math.random = original;
  }
  assert.equal(new Set(lines.map(canonical)).size, 3);
});

test('reversi bot self-play is balanced, fast and careful with corners', () => {
  const wins = [0, 0];
  let slowest = 0, cornerChoices = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const state = createReversi();
    const random = seeded(seed);
    let plies = 0;
    while (!finished(state)) {
      const seat = state.turn;
      const legal = reversiMoves(state, seat);
      const { move, elapsed } = timedMove(state, seat, random);
      slowest = Math.max(slowest, elapsed);
      const index = (move.r as number) * 8 + (move.c as number);
      assert.ok(legal.includes(index), JSON.stringify(move));

      // The last 8 empties are solved exactly; there the final score decides and the corner rule only breaks ties.
      if (state.board.filter(cell => cell === null).length > 8) {
        const corners = legal.filter(cell => CORNER_CELLS.includes(cell));
        if (corners.length) assert.ok(corners.includes(index), `seed ${seed} ply ${plies}: passed up a corner`);
        const pool = corners.length ? corners : legal;
        const handed = pool.map(cell => cornersHanded(state, seat, cell));
        const fewest = Math.min(...handed);
        if (corners.length || handed.some(count => count > fewest)) cornerChoices++;
        assert.equal(cornersHanded(state, seat, index), fewest, `seed ${seed} ply ${plies}: handed over a corner it could deny`);
      }

      assert.equal(actReversi(state, seat, move), null);
      assert.ok(++plies <= 60);
    }
    assert.ok(state.winner !== null || state.draw);
    if (state.winner !== null) wins[state.winner]++;
  }
  assert.ok(wins[0] >= 3 && wins[1] >= 3, `black won ${wins[0]} and white ${wins[1]} of 20`);
  assert.ok(slowest < 50, `slowest move ${slowest.toFixed(1)}ms`);
  // The corner checks above must have had real decisions to judge.
  assert.ok(cornerChoices >= 100, `only ${cornerChoices} corner decisions`);
});
