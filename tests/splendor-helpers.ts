import type { Action } from '../shared/tabletop-types.ts';
import type { splendorView } from '../shared/splendor.ts';
import { SPLENDOR_CARDS, SPLENDOR_NOBLES, splendorBonuses, splendorCanPass, splendorCost, splendorPayment } from '../shared/splendor-data.ts';

// A goal-directed player for exercising complete matches through the same public view as a browser.
export function chooseSplendorAction(game: ReturnType<typeof splendorView>): Action {
  const player = game.players[game.turn];
  if (game.stage === 'noble') {
    const bonuses = splendorBonuses(player);
    return { type: 'noble', noble: game.nobles.find(id => SPLENDOR_NOBLES[id].every((need, color) => bonuses[color] >= need)) };
  }
  const cards = [...game.market.flat(), ...player.reserved].filter((id): id is number => id !== null);
  const rank = (id: number) => SPLENDOR_CARDS[id].points * 3 + 3 - splendorBonuses(player)[SPLENDOR_CARDS[id].bonus];
  const affordable = cards.filter(id => splendorPayment(player, id) !== null).sort((a, b) => rank(b) - rank(a));
  const target = [...cards].filter(id => splendorCost(player, id).reduce((sum, n) => sum + n, 0) <= 10).sort((a, b) => {
    const distance = (id: number) => splendorCost(player, id).reduce((sum, n, color) => sum + Math.max(0, n - player.tokens[color]), 0) * 5 - rank(id);
    return distance(a) - distance(b);
  })[0] ?? cards[0];
  const cost = target === undefined ? [0, 0, 0, 0, 0] : splendorCost(player, target);
  if (game.stage === 'return') {
    const gems = [0, 0, 0, 0, 0, 0], held = [...player.tokens];
    let excess = held.reduce((sum, n) => sum + n, 0) - 10;
    while (excess-- > 0) {
      const color = [0, 1, 2, 3, 4, 5].filter(c => held[c] > 0).sort((a, b) => (held[b] - (cost[b] ?? 10)) - (held[a] - (cost[a] ?? 10)))[0];
      gems[color]++; held[color]--;
    }
    return { type: 'return', gems };
  }
  if (affordable.length) return { type: 'buy', card: affordable[0] };
  const colors = [0, 1, 2, 3, 4].filter(color => game.bank[color] > 0).sort((a, b) => (cost[b] - player.tokens[b]) - (cost[a] - player.tokens[a]));
  const double = colors.find(color => game.bank[color] >= 4 && cost[color] - player.tokens[color] >= 2);
  const gems = [0, 0, 0, 0, 0];
  if (double !== undefined) gems[double] = 2;
  else colors.slice(0, 3).forEach(color => gems[color] = 1);
  if (gems.some(Boolean)) return { type: 'take', gems };
  if (player.reserved.length < 3) {
    const id = game.market.flat().find(id => id !== null);
    if (id !== undefined && id !== null) return { type: 'reserve', card: id };
  }
  if (splendorCanPass(game.bank, game.market, game.remaining, player)) return { type: 'pass' };
  throw new Error('No action available to the test player');
}
