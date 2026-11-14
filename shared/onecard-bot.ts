import type { Action } from './tabletop-types.ts';
import {
  type OneCardState, type OneCardSuit, ONECARD_SUITS, oneCardView, oneCardPlayable, oneCardInfo, oneCardAttack,
} from './onecard.ts';

/**
 * Plays from what `oneCardView(state, seat)` shows only (own hand, counts, top card).
 * Under attack it defends with the smallest attack card it has. Otherwise it sheds plain cards
 * first and saves specials, but switches to attack / skip cards when an opponent is down to two or fewer.
 * K is played early when another card can follow it. 7 names the suit it holds most.
 */
export function oneCardBot(state: OneCardState, seat: number, random = Math.random): Action {
  const view = oneCardView(state, seat);
  const playable = oneCardPlayable(view, seat);
  if (!playable.length) return { type: 'draw' };
  const hand = view.hand;
  const others = view.counts.filter((_, s) => s !== seat);
  const danger = Math.min(...others) <= 2;
  const next = (((seat + view.direction) % view.counts.length) + view.counts.length) % view.counts.length;
  const nextLow = view.counts[next] <= 2;

  const suitCount = (exclude: string) => {
    const count: Record<OneCardSuit, number> = { S: 0, H: 0, D: 0, C: 0 };
    for (const card of hand) if (card !== exclude) { const suit = oneCardInfo(card)?.suit; if (suit) count[suit]++; }
    return count;
  };
  const score = (card: string) => {
    const info = oneCardInfo(card)!;
    const power = oneCardAttack(card);
    if (view.attack > 0) return 100 - power; // cheapest defence first, keep jokers
    if (hand.length === 1) return 1000;
    let value = 0;
    if (power) value = danger ? 60 + power * (nextLow ? 3 : 1) : 5 - power;
    else if (info.rank === 'J' || info.rank === 'Q') value = danger ? 45 : 10;
    else if (info.rank === 'K') value = hand.length > 2 && playable.length > 1 ? 70 : 8;
    else if (info.rank === '7') value = 12;
    else value = 30;
    // Prefer shedding cards of the suit I hold most so later turns stay flexible.
    if (info.suit) value += suitCount(card)[info.suit] * 0.5;
    return value + random() * 0.1;
  };
  let best = playable[0], bestScore = -Infinity;
  for (const card of playable) {
    const value = score(card);
    if (value > bestScore) { bestScore = value; best = card; }
  }
  if (oneCardInfo(best)?.rank === '7') {
    const count = suitCount(best);
    let suit: OneCardSuit = ONECARD_SUITS[Math.floor(random() * 4)], most = 0;
    for (const s of ONECARD_SUITS) if (count[s] > most) { most = count[s]; suit = s; }
    return { type: 'play', card: best, suit };
  }
  return { type: 'play', card: best };
}
