// Base-game numerical data, cross-checked against both transcriptions:
// https://github.com/bouk/splendimax/blob/master/Splendor%20Cards.csv
// https://github.com/seal256/splendor/blob/master/assets/cards.csv
// Color order: diamond, sapphire, emerald, ruby, onyx; gold is token index 5.
export const GEM_NAMES = ['다이아', '사파이어', '에메랄드', '루비', '오닉스', '황금'] as const;
export interface SplendorCard { id: number; tier: number; bonus: number; points: number; cost: number[] }

// Each row: level, bonus color, points, then five gem costs in the order above.
const rows = [
  [1, 4, 0, 1, 1, 1, 1, 0],
  [1, 4, 0, 1, 2, 1, 1, 0],
  [1, 4, 0, 2, 2, 0, 1, 0],
  [1, 4, 0, 0, 0, 1, 3, 1],
  [1, 4, 0, 0, 0, 2, 1, 0],
  [1, 4, 0, 2, 0, 2, 0, 0],
  [1, 4, 0, 0, 0, 3, 0, 0],
  [1, 4, 1, 0, 4, 0, 0, 0],
  [1, 1, 0, 1, 0, 1, 1, 1],
  [1, 1, 0, 1, 0, 1, 2, 1],
  [1, 1, 0, 1, 0, 2, 2, 0],
  [1, 1, 0, 0, 1, 3, 1, 0],
  [1, 1, 0, 1, 0, 0, 0, 2],
  [1, 1, 0, 0, 0, 2, 0, 2],
  [1, 1, 0, 0, 0, 0, 0, 3],
  [1, 1, 1, 0, 0, 0, 4, 0],
  [1, 0, 0, 0, 1, 1, 1, 1],
  [1, 0, 0, 0, 1, 2, 1, 1],
  [1, 0, 0, 0, 2, 2, 0, 1],
  [1, 0, 0, 3, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 2, 1],
  [1, 0, 0, 0, 2, 0, 0, 2],
  [1, 0, 0, 0, 3, 0, 0, 0],
  [1, 0, 1, 0, 0, 4, 0, 0],
  [1, 2, 0, 1, 1, 0, 1, 1],
  [1, 2, 0, 1, 1, 0, 1, 2],
  [1, 2, 0, 0, 1, 0, 2, 2],
  [1, 2, 0, 1, 3, 1, 0, 0],
  [1, 2, 0, 2, 1, 0, 0, 0],
  [1, 2, 0, 0, 2, 0, 2, 0],
  [1, 2, 0, 0, 0, 0, 3, 0],
  [1, 2, 1, 0, 0, 0, 0, 4],
  [1, 3, 0, 1, 1, 1, 0, 1],
  [1, 3, 0, 2, 1, 1, 0, 1],
  [1, 3, 0, 2, 0, 1, 0, 2],
  [1, 3, 0, 1, 0, 0, 1, 3],
  [1, 3, 0, 0, 2, 1, 0, 0],
  [1, 3, 0, 2, 0, 0, 2, 0],
  [1, 3, 0, 3, 0, 0, 0, 0],
  [1, 3, 1, 4, 0, 0, 0, 0],
  [2, 4, 1, 3, 2, 2, 0, 0],
  [2, 4, 1, 3, 0, 3, 0, 2],
  [2, 4, 2, 0, 1, 4, 2, 0],
  [2, 4, 2, 0, 0, 5, 3, 0],
  [2, 4, 2, 5, 0, 0, 0, 0],
  [2, 4, 3, 0, 0, 0, 0, 6],
  [2, 1, 1, 0, 2, 2, 3, 0],
  [2, 1, 1, 0, 2, 3, 0, 3],
  [2, 1, 2, 5, 3, 0, 0, 0],
  [2, 1, 2, 2, 0, 0, 1, 4],
  [2, 1, 2, 0, 5, 0, 0, 0],
  [2, 1, 3, 0, 6, 0, 0, 0],
  [2, 0, 1, 0, 0, 3, 2, 2],
  [2, 0, 1, 2, 3, 0, 3, 0],
  [2, 0, 2, 0, 0, 1, 4, 2],
  [2, 0, 2, 0, 0, 0, 5, 3],
  [2, 0, 2, 0, 0, 0, 5, 0],
  [2, 0, 3, 6, 0, 0, 0, 0],
  [2, 2, 1, 3, 0, 2, 3, 0],
  [2, 2, 1, 2, 3, 0, 0, 2],
  [2, 2, 2, 4, 2, 0, 0, 1],
  [2, 2, 2, 0, 5, 3, 0, 0],
  [2, 2, 2, 0, 0, 5, 0, 0],
  [2, 2, 3, 0, 0, 6, 0, 0],
  [2, 3, 1, 2, 0, 0, 2, 3],
  [2, 3, 1, 0, 3, 0, 2, 3],
  [2, 3, 2, 1, 4, 2, 0, 0],
  [2, 3, 2, 3, 0, 0, 0, 5],
  [2, 3, 2, 0, 0, 0, 0, 5],
  [2, 3, 3, 0, 0, 0, 6, 0],
  [3, 4, 3, 3, 3, 5, 3, 0],
  [3, 4, 4, 0, 0, 0, 7, 0],
  [3, 4, 4, 0, 0, 3, 6, 3],
  [3, 4, 5, 0, 0, 0, 7, 3],
  [3, 1, 3, 3, 0, 3, 3, 5],
  [3, 1, 4, 7, 0, 0, 0, 0],
  [3, 1, 4, 6, 3, 0, 0, 3],
  [3, 1, 5, 7, 3, 0, 0, 0],
  [3, 0, 3, 0, 3, 3, 5, 3],
  [3, 0, 4, 0, 0, 0, 0, 7],
  [3, 0, 4, 3, 0, 0, 3, 6],
  [3, 0, 5, 3, 0, 0, 0, 7],
  [3, 2, 3, 5, 3, 0, 3, 3],
  [3, 2, 4, 0, 7, 0, 0, 0],
  [3, 2, 4, 3, 6, 3, 0, 0],
  [3, 2, 5, 0, 7, 3, 0, 0],
  [3, 3, 3, 3, 5, 3, 0, 3],
  [3, 3, 4, 0, 0, 7, 0, 0],
  [3, 3, 4, 0, 3, 6, 3, 0],
  [3, 3, 5, 0, 0, 7, 3, 0],
];
export const SPLENDOR_CARDS: SplendorCard[] = rows.map(([level, bonus, points, ...cost], id) => ({
  id, tier: level - 1, bonus, points, cost,
}));

// Five adjacent pairs (4 + 4), and five adjacent triples (3 + 3 + 3).
export const SPLENDOR_NOBLES = [
  [4, 4, 0, 0, 0], [0, 4, 4, 0, 0], [0, 0, 4, 4, 0], [0, 0, 0, 4, 4], [4, 0, 0, 0, 4],
  [3, 3, 3, 0, 0], [0, 3, 3, 3, 0], [0, 0, 3, 3, 3], [3, 0, 0, 3, 3], [3, 3, 0, 0, 3],
];

export interface SplendorPlayer { tokens: number[]; cards: number[]; reserved: number[]; nobles: number[] }
export function splendorBonuses(player: Pick<SplendorPlayer, 'cards'>) {
  const bonuses = [0, 0, 0, 0, 0];
  for (const id of player.cards) bonuses[SPLENDOR_CARDS[id].bonus]++;
  return bonuses;
}
export function splendorScore(player: Pick<SplendorPlayer, 'cards' | 'nobles'>) {
  return player.cards.reduce((score, id) => score + SPLENDOR_CARDS[id].points, player.nobles.length * 3);
}
export function splendorCost(player: Pick<SplendorPlayer, 'cards'>, id: number) {
  const bonuses = splendorBonuses(player);
  return SPLENDOR_CARDS[id].cost.map((cost, color) => Math.max(0, cost - bonuses[color]));
}
export function splendorPayment(player: Pick<SplendorPlayer, 'cards' | 'tokens'>, id: number) {
  const cost = splendorCost(player, id);
  const payment = cost.map((need, color) => Math.min(need, player.tokens[color]));
  payment.push(cost.reduce((gold, need, color) => gold + need - payment[color], 0));
  return payment[5] <= player.tokens[5] ? payment : null;
}
export function splendorTakeError(bank: number[], gems: number[]) {
  if (gems.length !== 5 || gems.some((count, color) => !Number.isInteger(count) || count < 0 || count > 2 || count > bank[color])) return '공급처에 있는 보석을 골라 주세요.';
  const total = gems.reduce((sum, count) => sum + count, 0);
  const double = gems.indexOf(2);
  if (double >= 0) return total === 2 && bank[double] >= 4 ? null : '같은 색 2개는 공급처에 4개 이상 있을 때만 가져와요.';
  return total > 0 && total === Math.min(3, bank.slice(0, 5).filter(count => count > 0).length) ? null : '서로 다른 색 3개를 골라 주세요. 남은 색이 부족하면 가능한 색을 모두 골라요.';
}
export function splendorCanPass(bank: number[], market: (number | null)[][], remaining: number[], player: Pick<SplendorPlayer, 'cards' | 'tokens'> & { reserved: (number | null)[] }) {
  if (bank.slice(0, 5).some(count => count > 0)) return false;
  if (player.reserved.length < 3 && (remaining.some(count => count > 0) || market.flat().some(id => id !== null))) return false;
  return [...market.flat(), ...player.reserved].every(id => id === null || splendorPayment(player, id) === null);
}
