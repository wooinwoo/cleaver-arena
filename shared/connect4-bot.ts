import type { Action } from './tabletop-types.ts';
import { COLS, ROWS, landingRow, winningLine, type ConnectFourState } from './connect4.ts';

const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1_000_000;
const MAX_DEPTH = 6;
const TIME_LIMIT = 50;

/** Every run of four cells on the board (69 in total). */
const WINDOWS: number[][] = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const endR = r + dr * 3, endC = c + dc * 3;
    if (endR < 0 || endR >= ROWS || endC < 0 || endC >= COLS) continue;
    WINDOWS.push([0, 1, 2, 3].map(k => (r + dr * k) * COLS + c + dc * k));
  }
}

/** Static score from `seat`'s point of view: open windows of 2 and 3 plus centre column control. */
function evaluate(board: (number | null)[], seat: number) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    const v = board[r * COLS + 3];
    if (v === seat) score += 3; else if (v !== null) score -= 3;
  }
  for (const window of WINDOWS) {
    let mine = 0, theirs = 0;
    for (const index of window) {
      const v = board[index];
      if (v === seat) mine++; else if (v !== null) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 5; else if (mine === 2) score += 2;
    else if (theirs === 3) score -= 5; else if (theirs === 2) score -= 2;
  }
  return score;
}

class Timeout extends Error {}

/**
 * Picks a column with an iterative-deepening negamax (alpha-beta, centre-first ordering) up to depth 6.
 * Immediate wins are taken and immediate threats blocked before searching. Always returns a legal drop.
 */
export function connectFourBot(state: ConnectFourState, seat: number, random = Math.random): Action {
  const board = state.board.slice();
  const legal = ORDER.filter(c => landingRow(board, c) >= 0);
  if (legal.length === 0) return { type: 'drop', c: 3 };
  if (legal.length === 1) return { type: 'drop', c: legal[0] };
  const opponent = 1 - seat;
  const wins = (c: number, who: number) => {
    const r = landingRow(board, c);
    board[r * COLS + c] = who;
    const won = winningLine(board, r, c, who) !== null;
    board[r * COLS + c] = null;
    return won;
  };
  for (const c of legal) if (wins(c, seat)) return { type: 'drop', c };
  const threats = legal.filter(c => wins(c, opponent));
  if (threats.length) return { type: 'drop', c: threats[0] };

  const deadline = Date.now() + TIME_LIMIT;
  let nodes = 0;
  let filled = state.board.filter(v => v !== null).length;

  function negamax(depth: number, alpha: number, beta: number, who: number): number {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
    if (filled === COLS * ROWS) return 0;
    if (depth === 0) return evaluate(board, who);
    let best = -Infinity;
    for (const c of ORDER) {
      const r = landingRow(board, c);
      if (r < 0) continue;
      const index = r * COLS + c;
      board[index] = who; filled++;
      const score = winningLine(board, r, c, who) ? WIN + depth : -negamax(depth - 1, -beta, -alpha, 1 - who);
      board[index] = null; filled--;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Skip moves that hand the opponent a win on the cell directly above.
  const safe = legal.filter(c => {
    const r = landingRow(board, c);
    if (r === 0) return true;
    board[r * COLS + c] = seat;
    const gives = wins(c, opponent);
    board[r * COLS + c] = null;
    return !gives;
  });
  const candidates = safe.length ? safe : legal;
  let choice = candidates[0];
  try {
    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      let bestScore = -Infinity, best: number[] = [];
      for (const c of candidates) {
        const r = landingRow(board, c);
        board[r * COLS + c] = seat; filled++;
        let score: number;
        try { score = -negamax(depth - 1, -Infinity, -(bestScore - 1), opponent); }
        finally { board[r * COLS + c] = null; filled--; }
        if (score > bestScore) { bestScore = score; best = [c]; }
        else if (score === bestScore) best.push(c);
      }
      choice = best[Math.floor(random() * best.length) % best.length];
      if (bestScore >= WIN) break;
    }
  } catch (error) {
    if (!(error instanceof Timeout)) throw error;
  }
  return { type: 'drop', c: choice };
}
