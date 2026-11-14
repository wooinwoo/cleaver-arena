import type { Action } from './tabletop-types.ts';
import { liarDiceView, isRaise, type LiarDiceState } from './liardice.ts';

/** P(X >= need) for X ~ Binomial(n, p). */
function atLeast(need: number, n: number, p: number) {
  if (need <= 0) return 1;
  if (need > n) return 0;
  let term = (1 - p) ** n, below = 0;
  for (let k = 0; k < need; k++) {
    below += term;
    term *= ((n - k) / (k + 1)) * (p / (1 - p));
  }
  return Math.max(0, 1 - below);
}

/**
 * Plays from `liarDiceView(state, seat)` only: each unknown die shows a given face or a wild 1 with
 * probability 1/3. Calls when the standing bid is unlikely, otherwise makes the most likely minimal raise,
 * leaning toward faces it holds.
 * ponytail: no opponent modelling (bids are not read as hints). Add it if the bot feels too naive.
 */
export function liarDiceBot(state: LiarDiceState, seat: number, random = Math.random): Action {
  const view = liarDiceView(state, seat);
  if (view.stage === 'reveal') return { type: 'next' };
  const mine = view.dice[seat] as number[];
  const unknown = view.totalDice - mine.length;
  const have = (face: number) => mine.filter(value => value === face || value === 1).length;
  const chance = (count: number, face: number) => atLeast(count - have(face), unknown, 1 / 3);

  const bid = view.bid;
  const standing = bid ? chance(bid.count, bid.face) : 1;
  let best: Action | null = null, bestScore = -Infinity;
  for (let face = 2; face <= 6; face++) {
    let count = bid ? (face > bid.face ? bid.count : bid.count + 1) : 1;
    if (!bid) count = Math.max(1, Math.floor(have(face) + unknown / 3));
    if (count > view.totalDice || !isRaise(bid, count, face)) continue;
    const score = chance(count, face) + have(face) * 0.03 + random() * 0.05;
    if (score > bestScore) { bestScore = score; best = { type: 'bid', count, face }; }
  }
  if (bid && (!best || standing < 0.4 + random() * 0.15 || bestScore < standing * 0.5 && standing < 0.6)) {
    return { type: 'call' };
  }
  return best ?? { type: 'call' };
}
