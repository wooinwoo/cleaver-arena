import { randomInt } from 'node:crypto';
import { finished, type Action, type BaseState } from './tabletop-types.ts';

export interface PokerState extends BaseState {
  kind: 'poker';
  cards: number[];
  chips: number[];
  bets: number[];
  folded: boolean[];
  acted: boolean[];
  bet: number;
  pot: number;
}
export function createPoker(seats: number): PokerState {
  if (!Number.isInteger(seats) || seats < 2 || seats > 6) throw new Error('2–6명이 필요해요.');
  const deck = Array.from({ length: 10 }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return { kind: 'poker', turn: 0, winner: null, draw: false, log: '기본 칩 1개씩 냈어요. 내 카드만 보이지 않아요.',
    cards: deck.slice(0, seats), chips: Array(seats).fill(19), bets: Array(seats).fill(1),
    folded: Array(seats).fill(false), acted: Array(seats).fill(false), bet: 1, pot: seats };
}
export function pokerView(state: PokerState, seat: number) {
  return { ...state, cards: state.cards.map((card, index) => !finished(state) && index === seat ? null : card) };
}
export function actPoker(state: PokerState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기예요.';
  if (seat !== state.turn || state.folded[seat]) return '내 차례가 아니에요.';
  if (!['call', 'raise', 'fold'].includes(action.type)) return '콜, 올리기, 포기 중에서 선택해 주세요.';
  if (action.type === 'fold') {
    state.folded[seat] = true;
    state.log = `${seat + 1}번 플레이어가 포기했어요.`;
  } else {
    const target = state.bet + Number(action.type === 'raise');
    // ponytail: Equal affordable bets avoid side pots. Add side-pot accounting if all-in rules are introduced.
    const limit = Math.min(...state.chips.map((chips, i) => state.folded[i] ? Infinity : chips + state.bets[i]));
    if (target > limit) return '모두가 낼 수 있는 칩까지만 올릴 수 있어요.';
    const cost = target - state.bets[seat];
    state.chips[seat] -= cost;
    state.bets[seat] = target;
    state.pot += cost;
    if (action.type === 'raise') { state.bet = target; state.acted.fill(false); }
    state.acted[seat] = true;
    state.log = `${seat + 1}번 플레이어가 ${action.type === 'raise' ? '1칩 올렸어요' : cost ? `${cost}칩 콜했어요` : '체크했어요'}.`;
  }
  const active = state.folded.map((folded, i) => folded ? -1 : i).filter(i => i >= 0);
  if (active.length === 1 || active.every(i => state.acted[i] && state.bets[i] === state.bet)) {
    const winner = active.reduce((best, i) => state.cards[i] > state.cards[best] ? i : best);
    state.winner = winner;
    state.chips[winner] += state.pot;
    state.log = `${winner + 1}번 플레이어가 ${state.pot}칩을 가져가요. 다음 판은 모두 20칩으로 시작해요.`;
  } else {
    do { state.turn = (state.turn + 1) % state.cards.length; }
    while (state.folded[state.turn]);
  }
  return null;
}
