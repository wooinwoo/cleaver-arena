import { randomInt } from 'node:crypto';
import { finished, integer, type Action, type BaseState } from './tabletop-types.ts';
import type { PokerVariant } from './catalog.ts';

export interface PokerState extends BaseState {
  kind: 'poker';
  cards: number[];
  chips: number[];
  bets: number[];
  folded: boolean[];
  acted: boolean[];
  bet: number;
  pot: number;
  variant: PokerVariant;
  stage: 'betting' | 'reveal';
  hand: number;
  handWinner: number | null;
  nextReady: boolean[];
  decks: number[][];
  remaining: number[];
}
function shuffledDeck() {
  const deck = Array.from({ length: 10 }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
function nextHand(state: PokerState) {
  const ante = Math.min(1, ...state.chips);
  state.hand++;
  state.turn = (state.hand - 1) % 2;
  state.stage = 'betting'; state.handWinner = null;
  state.folded.fill(false); state.acted.fill(false); state.nextReady.fill(false);
  state.bets.fill(ante); state.bet = ante; state.pot += ante * 2;
  state.cards = state.decks.map((deck, seat) => {
    if (!deck.length) state.decks[seat] = deck = shuffledDeck();
    state.chips[seat] -= ante;
    return deck.pop()!;
  });
  state.remaining = state.decks.map(deck => deck.length);
  state.log = ante ? `${state.hand}번째 판 · 기본 칩 1개씩 냈어요. 내 카드만 보이지 않아요.` :
    `${state.hand}번째 판 · 이월된 칩으로 승부해요. 추가 칩 없이 둘 다 체크하면 공개해요.`;
}
export function createPoker(seats: number, variant: PokerVariant = 'party'): PokerState {
  if (variant !== 'party' && variant !== 'duel') throw new Error('포커 룰을 다시 선택해 주세요.');
  if (!integer(seats, 2, 6)) throw new Error('2–6명이 필요해요.');
  if (variant === 'duel' && seats !== 2) throw new Error('1:1 룰은 2명이 필요해요.');
  const state: PokerState = {
    kind: 'poker', variant, turn: 0, winner: null, draw: false, stage: 'betting', hand: 1, handWinner: null,
    log: '기본 칩 1개씩 냈어요. 내 카드만 보이지 않아요.', cards: [],
    chips: Array(seats).fill(19), bets: Array(seats).fill(1), folded: Array(seats).fill(false),
    acted: Array(seats).fill(false), nextReady: Array(seats).fill(false), bet: 1, pot: seats, decks: [], remaining: [],
  };
  if (variant === 'party') state.cards = shuffledDeck().slice(0, seats);
  else {
    state.chips.fill(20); state.pot = 0; state.hand = 0; state.decks = [[], []];
    nextHand(state);
  }
  return state;
}
export function pokerView(state: PokerState, seat: number) {
  const { decks: _decks, ...publicState } = state;
  return { ...publicState, cards: state.cards.map((card, index) => state.stage === 'betting' && !finished(state) && index === seat ? null : card) };
}
function settle(state: PokerState, active: number[]) {
  state.stage = 'reveal';
  state.nextReady.fill(false);
  if (state.variant === 'duel' && active.length === 2 && state.cards[0] === state.cards[1]) {
    state.handWinner = null;
    state.log = `같은 카드예요. 모인 ${state.pot}칩을 다음 판으로 이월해요. 둘 다 준비하면 계속해요.`;
    return;
  }
  const winner = active.reduce((best, seat) => state.cards[seat] > state.cards[best] ? seat : best);
  state.handWinner = winner;
  const prize = state.pot;
  state.chips[winner] += prize;
  if (state.variant === 'party') {
    state.winner = winner;
    state.log = `${winner + 1}번 플레이어가 ${prize}칩을 가져가요. 다음 판은 모두 20칩으로 시작해요.`;
  } else {
    const loser = 1 - winner;
    const penalty = state.folded[loser] && state.cards[loser] === 10 ? Math.min(10, state.chips[loser]) : 0;
    state.chips[loser] -= penalty; state.chips[winner] += penalty; state.pot = 0;
    if (state.chips[loser] === 0) state.winner = winner;
    state.log = `${winner + 1}번 플레이어가 ${prize}칩을 가져가요.${penalty ? ` 10 카드를 포기한 상대에게서 추가 ${penalty}칩을 받아요.` : ''}` +
      (state.winner !== null ? ' 상대의 칩이 없어 경기에서 승리했어요.' : ' 둘 다 다음 판을 준비해 주세요.');
  }
}
export function actPoker(state: PokerState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기예요.';
  if (!integer(seat, 0, state.cards.length - 1)) return '플레이어 자리를 확인해 주세요.';
  if (action.type === 'next') {
    if (state.variant !== 'duel' || state.stage !== 'reveal') return '카드를 공개한 뒤 다음 판을 준비해 주세요.';
    if (state.nextReady[seat]) return '이미 다음 판을 준비했어요.';
    state.nextReady[seat] = true;
    state.log = `${seat + 1}번 플레이어가 다음 판을 준비했어요.`;
    if (state.nextReady.every(Boolean)) nextHand(state);
    return null;
  }
  if (state.stage !== 'betting') return '다음 판을 준비해 주세요.';
  if (seat !== state.turn || state.folded[seat]) return '내 차례가 아니에요.';
  if (!['call', 'raise', 'fold'].includes(action.type)) return '콜, 올리기, 포기 중에서 선택해 주세요.';
  if (action.type === 'fold') {
    state.folded[seat] = true;
    state.log = `${seat + 1}번 플레이어가 포기했어요.`;
  } else {
    // ponytail: Equal affordable bets avoid side pots. Add side-pot accounting if all-in rules are introduced.
    const limit = Math.min(...state.chips.map((chips, i) => state.folded[i] ? Infinity : chips + state.bets[i]));
    let amount = 0;
    if (action.type === 'raise') {
      const requested = state.variant === 'duel' && action.amount !== undefined ? action.amount : 1;
      if (!integer(requested, 1, limit - state.bet)) return '모두가 낼 수 있는 범위에서 1칩 이상 정수로 올려 주세요.';
      amount = requested;
    }
    const target = state.bet + amount;
    if (target > limit) return '모두가 낼 수 있는 칩까지만 올릴 수 있어요.';
    const cost = target - state.bets[seat];
    state.chips[seat] -= cost;
    state.bets[seat] = target;
    state.pot += cost;
    if (action.type === 'raise') { state.bet = target; state.acted.fill(false); }
    state.acted[seat] = true;
    state.log = `${seat + 1}번 플레이어가 ${action.type === 'raise' ? `${amount}칩 올렸어요` : cost ? `${cost}칩 콜했어요` : '체크했어요'}.`;
  }
  const active = state.folded.map((folded, i) => folded ? -1 : i).filter(i => i >= 0);
  if (active.length === 1 || active.every(i => state.acted[i] && state.bets[i] === state.bet)) {
    settle(state, active);
  } else {
    do { state.turn = (state.turn + 1) % state.cards.length; }
    while (state.folded[state.turn]);
  }
  return null;
}
