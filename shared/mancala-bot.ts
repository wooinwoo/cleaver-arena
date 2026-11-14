import type { Action } from './tabletop-types.ts';
import { type MancalaState, PITS, STORE, pitIndex, sow } from './mancala.ts';

const DEPTH = 7;
const WIN = 1000;

/** Store difference from `me`'s side; finished positions are scored decisively. */
function evaluate(pits: number[], me: number, ended: boolean) {
  const diff = pits[STORE[me]] - pits[STORE[1 - me]];
  return ended ? (diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0) : diff;
}

/** Alpha-beta from `me`'s point of view. An extra turn keeps the same mover and costs one ply. */
function search(pits: number[], mover: number, me: number, depth: number, alpha: number, beta: number): number {
  if (depth === 0) return evaluate(pits, me, false);
  const maximizing = mover === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const pit of order(pits, mover)) {
    const next = pits.slice();
    const result = sow(next, mover, pit, false);
    const score = result.ended
      ? evaluate(next, me, true)
      : search(next, result.extraTurn ? mover : 1 - mover, me, depth - 1, alpha, beta);
    if (maximizing) { if (score > best) best = score; if (best > alpha) alpha = best; }
    else { if (score < best) best = score; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

/** Legal pits, extra-turn moves first (better pruning). */
function order(pits: number[], seat: number) {
  const moves: number[] = [];
  const rest: number[] = [];
  for (let pit = PITS - 1; pit >= 0; pit--) {
    const seeds = pits[pitIndex(seat, pit)];
    if (!seeds) continue;
    (seeds === PITS - pit ? moves : rest).push(pit);
  }
  return moves.concat(rest);
}

/** Depth-7 alpha-beta on store difference; ties broken by `random`. Always returns a legal sow. */
export function mancalaBot(state: MancalaState, seat: number, random = Math.random): Action {
  let best = -Infinity, choice = -1, bestNoise = 0;
  for (const pit of order(state.pits, seat)) {
    const next = state.pits.slice();
    const result = sow(next, seat, pit, false);
    const score = result.ended
      ? evaluate(next, seat, true)
      : search(next, result.extraTurn ? seat : 1 - seat, seat, DEPTH - 1, -Infinity, Infinity);
    const noise = random();
    if (score > best || (score === best && noise > bestNoise)) { best = score; choice = pit; bestNoise = noise; }
  }
  if (choice < 0) choice = Math.max(0, state.pits.slice(seat * 7, seat * 7 + PITS).findIndex(n => n > 0));
  return { type: 'sow', pit: choice };
}
