import type { Action } from './tabletop-types.ts';
import type { ReversiState } from './reversi.ts';

const SIZE = 8;
const DIRS = [-9, -8, -7, -1, 1, 7, 8, 9];
/** Column step per direction, used to stop lines wrapping across rows. */
const DCOL = [-1, 0, 1, -1, 1, -1, 0, 1];
const EMPTY = -1;

/** Classic positional table: corners high, X squares (diagonal to corners) and C squares (beside corners) negative. */
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];
/** Each corner followed by its three neighbours. */
const CORNERS = [[0, 1, 8, 9], [7, 6, 15, 14], [56, 57, 48, 49], [63, 62, 55, 54]];
/** For the three squares around a corner, that corner's index; -1 everywhere else. Keeps the evaluation free of allocations. */
const CORNER_OF = new Int8Array(64).fill(-1);
for (const [corner, ...near] of CORNERS) for (const index of near) CORNER_OF[index] = corner;
/** Positions with this many empties or fewer are searched to the end of the game. */
const SOLVE_EMPTIES = 8;
/** Number of discs placed after the starting four during which the bot varies its choice. */
const OPENING_DISCS = 10;
/** How far below the best search score an opening move may fall and still be picked. */
const OPENING_MARGIN = 8;
/** Search order: good squares first for better pruning. */
const ORDER = Array.from({ length: 64 }, (_, i) => i).sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);

type Board = Int8Array;

function flipsAt(board: Board, index: number, seat: number, out: number[] | null): number {
  if (board[index] !== EMPTY) return 0;
  const other = 1 - seat;
  let total = 0;
  const col0 = index % SIZE;
  for (let d = 0; d < 8; d++) {
    let pos = index + DIRS[d], col = col0 + DCOL[d], run = 0;
    while (pos >= 0 && pos < 64 && col >= 0 && col < SIZE && board[pos] === other) {
      pos += DIRS[d]; col += DCOL[d]; run++;
    }
    if (run && pos >= 0 && pos < 64 && col >= 0 && col < SIZE && board[pos] === seat) {
      total += run;
      if (out) for (let k = 1, p = index + DIRS[d]; k <= run; k++, p += DIRS[d]) out.push(p);
    }
  }
  return total;
}

function moves(board: Board, seat: number): number[] {
  const list: number[] = [];
  for (const index of ORDER) if (flipsAt(board, index, seat, null)) list.push(index);
  return list;
}

function play(board: Board, index: number, seat: number): Board {
  const next = board.slice();
  const flips: number[] = [];
  flipsAt(board, index, seat, flips);
  next[index] = seat;
  for (const f of flips) next[f] = seat;
  return next;
}

function discDiff(board: Board, seat: number) {
  let diff = 0;
  for (let i = 0; i < 64; i++) if (board[i] === seat) diff++; else if (board[i] === 1 - seat) diff--;
  return diff;
}

function evaluate(board: Board, seat: number, myMoves: number, theirMoves: number): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const cell = board[i];
    if (cell === EMPTY) continue;
    // Once a corner is taken its neighbours stop being dangerous.
    const corner = CORNER_OF[i];
    const weight = corner >= 0 && board[corner] !== EMPTY ? 8 : WEIGHTS[i];
    score += cell === seat ? weight : -weight;
  }
  if (myMoves + theirMoves) score += 60 * (myMoves - theirMoves) / (myMoves + theirMoves + 2);
  return score;
}

/** Negamax with alpha-beta from `seat`'s point of view. Terminal positions are scored by disc difference. */
function search(board: Board, seat: number, depth: number, alpha: number, beta: number, passed: boolean): number {
  const mine = moves(board, seat);
  if (!mine.length) {
    if (passed) return 10_000 * Math.sign(discDiff(board, seat)) + discDiff(board, seat);
    return -search(board, 1 - seat, depth, -beta, -alpha, true);
  }
  if (depth === 0) return evaluate(board, seat, mine.length, moves(board, 1 - seat).length);
  let best = -Infinity;
  for (const index of mine) {
    const value = -search(play(board, index, seat), 1 - seat, depth - 1, -beta, -alpha, false);
    if (value > best) best = value;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return best;
}

/** How many corners `seat` could take on this board. */
function cornersOpen(board: Board, seat: number): number {
  let count = 0;
  for (const [corner] of CORNERS) if (flipsAt(board, corner, seat, null)) count++;
  return count;
}

/**
 * The moves that are sound with respect to corners: a corner whenever one can be taken, and among those
 * (or among all moves when no corner is on offer) the ones that leave the opponent the fewest corners to take in reply.
 */
function cornerSafe(board: Board, list: number[], seat: number): number[] {
  const corners = list.filter(index => CORNERS.some(([corner]) => corner === index));
  const pool = corners.length ? corners : list;
  const handed = pool.map(index => cornersOpen(play(board, index, seat), 1 - seat));
  const fewest = Math.min(...handed);
  return pool.filter((_, i) => handed[i] === fewest);
}

/**
 * Alpha-beta search (4 ply, exact in the last 8 empties) over positional weights and mobility.
 *
 * While the first `OPENING_DISCS` discs are going down, `random` picks among the moves that score within
 * `OPENING_MARGIN` of the best, so games do not repeat. After that the best move is played and `random`
 * only breaks exact ties.
 *
 * Corners come first (see `cornerSafe`): the bot never passes up a corner and never opens one for the opponent
 * when another move would not. The one exception is the solved endgame, where the exact final score decides
 * and the corner rule only chooses between moves that end equally well.
 */
export function reversiBot(state: ReversiState, seat: number, random = Math.random): Action {
  const board: Board = Int8Array.from(state.board, cell => (cell === null ? EMPTY : cell));
  const legal = moves(board, seat);
  if (!legal.length) return { type: 'place', r: 0, c: 0 };
  let empties = 0;
  for (let i = 0; i < 64; i++) if (board[i] === EMPTY) empties++;
  const solved = empties <= SOLVE_EMPTIES;
  const depth = solved ? empties : 4;
  const sound = cornerSafe(board, legal, seat);
  const list = solved ? legal : sound;
  const margin = 60 - empties < OPENING_DISCS ? OPENING_MARGIN : 0;

  // Scores are exact for every move within `margin` of the best; anything further behind is only cut off.
  const scored: { index: number; value: number }[] = [];
  let best = -Infinity;
  for (const index of list) {
    const value = -search(play(board, index, seat), 1 - seat, depth - 1, -Infinity, margin + 1 - best, false);
    scored.push({ index, value });
    if (value > best) best = value;
  }
  const close = scored.filter(move => move.value >= best - margin);
  // Only matters in the solved endgame, where `list` was not narrowed: prefer a corner-safe move among equals.
  const careful = close.filter(move => sound.includes(move.index));
  // Best first, so a `random` that always returns 0 plays the top move.
  const pool = (careful.length ? careful : close).sort((a, b) => b.value - a.value);
  const { index } = pool[Math.floor(random() * pool.length)] ?? pool[0];
  return { type: 'place', r: Math.floor(index / SIZE), c: index % SIZE };
}
