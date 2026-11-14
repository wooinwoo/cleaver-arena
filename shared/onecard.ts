import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';
import type { TableInfo } from '../src/games/types.ts';

export const INFO: TableInfo = {
  title: '원카드',
  min: 2,
  max: 6,
  groups: ['mind'],
  description: '같은 무늬나 숫자의 카드를 내며 손패를 먼저 비우는 카드게임입니다.',
  rules: [
    '카드 52장과 조커 2장(흑백 조커, 컬러 조커)을 씁니다. 2~3명은 7장씩, 4~6명은 5장씩 받습니다.',
    '더미에서 특수 카드가 아닌 카드 1장을 뒤집어 시작합니다.',
    '내 차례에는 맨 위 카드와 무늬나 숫자가 같은 카드 1장을 내거나, 더미에서 1장을 받습니다. 카드를 받으면 차례가 끝납니다.',
    '공격 카드: 2는 2장, A는 3장, ♠A는 5장, 흑백 조커는 5장, 컬러 조커는 7장을 다음 사람에게 먹입니다. 조커는 공격 중이 아닐 때 아무 카드 위에나 낼 수 있습니다.',
    '공격을 받으면 맨 위 카드와 무늬나 숫자가 같은 공격 카드나 조커로 막을 수 있고, 장수가 더해져 다음 사람에게 넘어갑니다. 맨 위가 조커이면 어떤 공격 카드로든 막을 수 있습니다.',
    '막지 못하면 쌓인 장수만큼 카드를 받고 공격이 끝납니다.',
    'J는 다음 사람을 건너뜁니다. Q는 진행 방향을 바꿉니다(2명일 때는 건너뛰기와 같습니다). K를 내면 한 번 더 냅니다(내거나 1장 받아야 합니다).',
    '7을 내면 다음 무늬를 정합니다. 다음 사람은 정한 무늬나 숫자 7을 내야 합니다.',
    '조커 위에는 공격 중이 아니면 아무 카드나 낼 수 있습니다.',
    '더미가 떨어지면 맨 위 카드를 뺀 버린 카드를 섞어 다시 더미로 씁니다. 그래도 없으면 받을 수 있는 만큼만 받습니다.',
    '손패를 가장 먼저 모두 낸 사람이 이깁니다.',
  ].join('\n'),
};

export type OneCardSuit = 'S' | 'H' | 'D' | 'C';
export const ONECARD_SUITS: OneCardSuit[] = ['S', 'H', 'D', 'C'];
export const ONECARD_SUIT_SYMBOL: Record<OneCardSuit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const ONECARD_SUIT_NAME: Record<OneCardSuit, string> = { S: '스페이드', H: '하트', D: '다이아', C: '클로버' };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
/** Card ids: suit letter + rank ('SA', 'H10', 'DQ') or 'JB' (흑백 조커) / 'JC' (컬러 조커). */
export const BLACK_JOKER = 'JB';
export const COLOR_JOKER = 'JC';

export interface OneCardInfo { suit: OneCardSuit | null; rank: string; joker: boolean; red: boolean }
export function oneCardInfo(id: string): OneCardInfo | null {
  if (id === BLACK_JOKER) return { suit: null, rank: 'JB', joker: true, red: false };
  if (id === COLOR_JOKER) return { suit: null, rank: 'JC', joker: true, red: true };
  const suit = id[0] as OneCardSuit, rank = id.slice(1);
  if (!ONECARD_SUITS.includes(suit) || !RANKS.includes(rank)) return null;
  return { suit, rank, joker: false, red: suit === 'H' || suit === 'D' };
}
export function oneCardName(id: string): string {
  if (id === BLACK_JOKER) return '흑백 조커';
  if (id === COLOR_JOKER) return '컬러 조커';
  const info = oneCardInfo(id);
  return info ? `${ONECARD_SUIT_SYMBOL[info.suit!]}${info.rank}` : id;
}
/** Penalty an attack card adds (0 for non-attack cards). */
export function oneCardAttack(id: string): number {
  if (id === COLOR_JOKER) return 7;
  if (id === BLACK_JOKER || id === 'SA') return 5;
  const rank = id.slice(1);
  return rank === 'A' ? 3 : rank === '2' ? 2 : 0;
}
const SPECIAL = new Set(['A', '2', '7', 'J', 'Q', 'K', 'JB', 'JC']);
export const oneCardSpecial = (id: string) => SPECIAL.has(oneCardInfo(id)?.rank ?? '');

export interface OneCardLastPlay { seat: number; card: string | null; suit: OneCardSuit | null; drew: number }

export interface OneCardState extends BaseState {
  kind: 'onecard';
  /** Draw pile; the last element is drawn next. Hidden in the view. */
  deck: string[];
  /** Discard pile; the last element is the top card. */
  discard: string[];
  hands: string[][];
  top: string;
  declaredSuit: OneCardSuit | null;
  /** Pending attack penalty (0 = none). */
  attack: number;
  direction: 1 | -1;
  lastPlay: OneCardLastPlay | null;
  counts: number[];
  /** Seeded generator state for reshuffles (hidden in the view). */
  seed: number;
}

export interface OneCardView extends Omit<BaseState, 'kind'> {
  kind: 'onecard';
  /** The seat this view was made for. */
  me: number;
  /** My hand (card ids). */
  hand: string[];
  counts: number[];
  deckCount: number;
  discardCount: number;
  top: string;
  declaredSuit: OneCardSuit | null;
  attack: number;
  direction: 1 | -1;
  lastPlay: OneCardLastPlay | null;
  /** Every hand, shown only after the game ends; null while playing. */
  finalHands: string[][] | null;
}

const dealCount = (seats: number) => (seats <= 3 ? 7 : 5);

function nextRandom(state: OneCardState) {
  // mulberry32 so the state stays plain JSON and reshuffles are reproducible.
  let t = (state.seed = (state.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(cards: string[], random: () => number) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

export function createOneCard(seats: number, random = Math.random): OneCardState {
  const n = integer(seats, 2, 6) ? seats : 2;
  const deck: string[] = [];
  for (const suit of ONECARD_SUITS) for (const rank of RANKS) deck.push(suit + rank);
  deck.push(BLACK_JOKER, COLOR_JOKER);
  shuffle(deck, random);
  const hands: string[][] = Array.from({ length: n }, () => []);
  for (let round = 0; round < dealCount(n); round++) for (let seat = 0; seat < n; seat++) hands[seat].push(deck.pop()!);
  let top = deck.pop()!;
  while (oneCardSpecial(top)) { deck.unshift(top); top = deck.pop()!; }
  const state: OneCardState = {
    kind: 'onecard', turn: 0, winner: null, draw: false,
    log: `시작 카드는 ${oneCardName(top)}이에요. 1번부터 시작해요.`,
    deck, discard: [top], hands, top, declaredSuit: null, attack: 0, direction: 1, lastPlay: null,
    counts: hands.map(hand => hand.length), seed: Math.floor(random() * 4294967296) >>> 0,
  };
  return state;
}

/** Whether `card` may be played on the current table (ignores whose turn it is). */
function canPlay(top: string, declaredSuit: OneCardSuit | null, attack: number, card: string) {
  const info = oneCardInfo(card), topInfo = oneCardInfo(top);
  if (!info || !topInfo) return false;
  if (attack > 0) {
    if (!oneCardAttack(card)) return false;
    if (info.joker || topInfo.joker) return true;
    return info.suit === topInfo.suit || info.rank === topInfo.rank;
  }
  if (info.joker || topInfo.joker) return true;
  const suit = declaredSuit ?? topInfo.suit;
  return info.suit === suit || info.rank === topInfo.rank;
}

/** Card ids `seat` can play right now. Works on the full state or on that seat's view. */
export function oneCardPlayable(game: OneCardState | OneCardView, seat: number): string[] {
  if (finished(game) || game.turn !== seat) return [];
  const hand = 'hands' in game ? game.hands[seat] : game.me === seat ? game.hand : [];
  if (!hand) return [];
  return hand.filter(card => canPlay(game.top, game.declaredSuit, game.attack, card));
}

function step(state: OneCardState, count: number) {
  const n = state.hands.length;
  state.turn = (((state.turn + state.direction * count) % n) + n) % n;
}

function drawCards(state: OneCardState, seat: number, count: number) {
  let got = 0;
  for (let i = 0; i < count; i++) {
    if (!state.deck.length && state.discard.length > 1) {
      const top = state.discard.pop()!;
      state.deck = state.discard;
      state.discard = [top];
      shuffle(state.deck, () => nextRandom(state));
    }
    const card = state.deck.pop();
    if (!card) break;
    state.hands[seat].push(card);
    got++;
  }
  return got;
}

const sync = (state: OneCardState) => {
  state.top = state.discard[state.discard.length - 1];
  state.counts = state.hands.map(hand => hand.length);
};

export function actOneCard(state: OneCardState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기예요.';
  if (!integer(seat, 0, state.hands.length - 1)) return '플레이어 자리를 확인해 주세요.';
  if (seat !== state.turn) return '자신의 차례가 아니에요.';
  if (!action || typeof action !== 'object') return '알 수 없는 행동이에요.';
  const who = `${seat + 1}번`;
  if (action.type === 'draw') {
    const want = state.attack > 0 ? state.attack : 1;
    const got = drawCards(state, seat, want);
    state.log = state.attack > 0
      ? `${who}이 공격을 받아 ${got}장을 가져갔어요.`
      : got ? `${who}이 1장을 받았어요.` : `${who}이 받으려 했지만 남은 카드가 없어요.`;
    state.attack = 0;
    state.lastPlay = { seat, card: null, suit: null, drew: got };
    step(state, 1);
    sync(state);
    return null;
  }
  if (action.type === 'play') {
    const card = action.card;
    if (typeof card !== 'string' || !state.hands[seat].includes(card)) return '손에 있는 카드를 골라 주세요.';
    if (!canPlay(state.discard[state.discard.length - 1], state.declaredSuit, state.attack, card)) {
      return state.attack > 0 ? '공격 중에는 맞는 공격 카드나 조커만 낼 수 있어요.' : '무늬나 숫자가 맞는 카드만 낼 수 있어요.';
    }
    const info = oneCardInfo(card)!;
    let suit: OneCardSuit | null = null;
    if (info.rank === '7') {
      if (typeof action.suit !== 'string' || !ONECARD_SUITS.includes(action.suit as OneCardSuit)) return '7을 낼 때는 다음 무늬를 골라 주세요.';
      suit = action.suit as OneCardSuit;
    }
    const hand = state.hands[seat];
    hand.splice(hand.indexOf(card), 1);
    state.discard.push(card);
    state.declaredSuit = suit;
    state.lastPlay = { seat, card, suit, drew: 0 };
    const name = oneCardName(card);
    if (!hand.length) {
      state.winner = seat;
      state.attack = 0;
      state.log = `${who}이 ${name}을(를) 내고 손패를 모두 비웠어요. ${who} 승리!`;
      sync(state);
      return null;
    }
    const n = state.hands.length;
    const power = oneCardAttack(card);
    if (power) {
      state.attack += power;
      state.log = `${who}이 ${name} 공격! 쌓인 공격 ${state.attack}장.`;
      step(state, 1);
    } else if (info.rank === 'J') {
      state.log = `${who}이 ${name}을(를) 내서 다음 사람을 건너뛰어요.`;
      step(state, 2);
    } else if (info.rank === 'Q') {
      if (n === 2) {
        state.log = `${who}이 ${name}을(를) 내서 상대를 건너뛰어요.`;
        step(state, 2);
      } else {
        state.direction = state.direction === 1 ? -1 : 1;
        state.log = `${who}이 ${name}을(를) 내서 방향이 바뀌었어요.`;
        step(state, 1);
      }
    } else if (info.rank === 'K') {
      state.log = `${who}이 ${name}을(를) 내고 한 번 더 내요.`;
    } else if (info.rank === '7') {
      state.log = `${who}이 ${name}을(를) 내고 ${ONECARD_SUIT_SYMBOL[suit!]} ${ONECARD_SUIT_NAME[suit!]}로 바꿨어요.`;
      step(state, 1);
    } else {
      state.log = `${who}이 ${name}을(를) 냈어요.`;
      step(state, 1);
    }
    if (hand.length === 1) state.log += ` ${who} 원카드!`;
    sync(state);
    return null;
  }
  return '알 수 없는 행동이에요.';
}

export function oneCardView(state: OneCardState, seat: number): OneCardView {
  const { deck, discard, hands, seed, ...rest } = state;
  const open = finished(state);
  return {
    ...rest,
    me: seat,
    hand: [...(hands[seat] ?? [])],
    counts: hands.map(hand => hand.length),
    deckCount: deck.length,
    discardCount: discard.length,
    lastPlay: state.lastPlay ? { ...state.lastPlay } : null,
    finalHands: open ? hands.map(hand => [...hand]) : null,
  };
}
