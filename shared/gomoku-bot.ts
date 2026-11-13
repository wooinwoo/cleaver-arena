import type { Action } from './tabletop-types.ts';
import type { GomokuState } from './gomoku.ts';

const SIZE = 15;
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]] as const;

/** Value of the line a stone at (r, c) would make for `seat`, by length and open ends. */
function lineValue(board: GomokuState['board'], r: number, c: number, seat: number) {
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let length = 1, open = 0;
    for (const sign of [-1, 1]) {
      let row = r + dr * sign, col = c + dc * sign;
      while (row >= 0 && row < SIZE && col >= 0 && col < SIZE && board[row * SIZE + col] === seat) {
        length++; row += dr * sign; col += dc * sign;
      }
      if (row >= 0 && row < SIZE && col >= 0 && col < SIZE && board[row * SIZE + col] === null) open++;
    }
    if (length >= 5) total += 1_000_000;
    else if (open === 0) continue;
    else if (length === 4) total += open === 2 ? 100_000 : 10_000;
    else if (length === 3) total += open === 2 ? 5_000 : 400;
    else if (length === 2) total += open === 2 ? 200 : 40;
    else total += open * 5;
  }
  return total;
}

/**
 * Picks a move by scoring every empty point near existing stones: finishing or blocking five first,
 * then fours, open threes and so on. Attack weighs slightly more than defence so the bot wins when it can.
 * ponytail: one-ply heuristic, no lookahead. Add a shallow search if players find it too easy.
 */
export function gomokuBot(state: GomokuState, seat: number, random = Math.random): Action {
  const { board } = state;
  if (state.count === 0) return { type: 'place', r: 7, c: 7 };
  let best = -1, choice = 0;
  for (let index = 0; index < board.length; index++) {
    if (board[index] !== null) continue;
    const r = Math.floor(index / SIZE), c = index % SIZE;
    let near = false;
    for (let dr = -2; dr <= 2 && !near; dr++) for (let dc = -2; dc <= 2 && !near; dc++) {
      const row = r + dr, col = c + dc;
      near = row >= 0 && row < SIZE && col >= 0 && col < SIZE && board[row * SIZE + col] !== null;
    }
    if (!near) continue;
    const score = lineValue(board, r, c, seat) * 1.1 + lineValue(board, r, c, 1 - seat) + random();
    if (score > best) { best = score; choice = index; }
  }
  return { type: 'place', r: Math.floor(choice / SIZE), c: choice % SIZE };
}
