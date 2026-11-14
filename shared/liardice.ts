import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';
import type { TableInfo } from '../src/games/types.ts';

export const INFO: TableInfo = {
  title: '거짓말 주사위',
  min: 2,
  max: 6,
  groups: ['mind'],
  description: '숨긴 주사위로 전체 개수를 입찰하고 거짓말을 잡아내는 주사위 게임이에요.',
  rules: [
    '모두 주사위 5개로 시작하고, 판마다 모두 몰래 주사위를 굴려요. 내 주사위는 나만 볼 수 있어요.',
    '시작한 사람이 "전체 주사위 중 X가 N개 이상"이라고 입찰해요. 눈 X는 2부터 6까지 고를 수 있어요.',
    '1은 와일드라서 모든 눈으로 함께 세요. 1에는 입찰할 수 없어요.',
    '다음 사람(시계 방향, 탈락한 사람은 건너뜀)은 입찰을 올리거나 "거짓말!"을 외쳐요.',
    '입찰을 올릴 때는 개수를 늘리거나, 같은 개수에 더 높은 눈을 불러야 해요. 개수는 남은 주사위 전체 수를 넘을 수 없어요.',
    '"거짓말!"을 외치면 모든 주사위를 공개해요. 그 눈과 1을 합친 개수가 입찰 이상이면 외친 사람이, 모자라면 입찰한 사람이 주사위 1개를 잃어요.',
    '공개 뒤 진 사람이 "다음 판"을 눌러 새 판을 시작해요. 진 사람이 탈락했다면 그다음 사람이 시작해요.',
    '주사위를 모두 잃으면 탈락이에요. 마지막까지 주사위가 남은 한 사람이 이겨요.',
  ].join('\n'),
};

export interface LiarDiceBid { count: number; face: number; seat: number }
export interface LiarDiceResult {
  bid: LiarDiceBid;
  caller: number;
  /** Dice showing the bid face plus wild 1s. */
  actual: number;
  loser: number;
  eliminated: boolean;
  /** Every die as rolled this round, before the loser's die was removed. */
  dice: number[][];
}
export interface LiarDiceState extends BaseState {
  kind: 'liardice';
  dice: number[][];
  stage: 'bid' | 'reveal';
  bid: LiarDiceBid | null;
  round: number;
  lastResult: LiarDiceResult | null;
}
export interface LiarDiceView extends Omit<BaseState, 'kind'> {
  kind: 'liardice';
  /** Faces per seat; `null` for dice this seat may not see. Length = dice count. */
  dice: (number | null)[][];
  counts: number[];
  totalDice: number;
  stage: 'bid' | 'reveal';
  bid: LiarDiceBid | null;
  round: number;
  lastResult: LiarDiceResult | null;
  /** True when every die is public (reveal stage or finished game). */
  revealed: boolean;
}

const roll = (random: () => number) => 1 + Math.floor(random() * 6);
export const totalDice = (dice: { length: number }[]) => dice.reduce((sum, hand) => sum + hand.length, 0);
export const countFace = (dice: number[][], face: number) =>
  dice.reduce((sum, hand) => sum + hand.filter(value => value === face || value === 1).length, 0);
/** True when (count, face) beats `bid` (or there is no bid yet). */
export const isRaise = (bid: { count: number; face: number } | null, count: number, face: number) =>
  !bid || count > bid.count || (count === bid.count && face > bid.face);

function nextAlive(dice: number[][], from: number) {
  for (let step = 1; step <= dice.length; step++) {
    const seat = (from + step) % dice.length;
    if (dice[seat].length) return seat;
  }
  return from;
}

function rollAll(state: LiarDiceState, random: () => number) {
  state.dice = state.dice.map(hand => hand.map(() => roll(random)));
}

export function createLiarDice(seats: number, random = Math.random): LiarDiceState {
  const state: LiarDiceState = {
    kind: 'liardice', turn: 0, winner: null, draw: false,
    log: '1번부터 입찰해요. 1은 모든 눈으로 셉니다.',
    dice: Array.from({ length: seats }, () => Array.from({ length: 5 }, () => 1)),
    stage: 'bid', bid: null, round: 1, lastResult: null,
  };
  rollAll(state, random);
  return state;
}

export function actLiarDice(state: LiarDiceState, seat: number, action: Action, random = Math.random): string | null {
  if (finished(state)) return '이미 끝난 경기예요.';
  if (!integer(seat, 0, state.dice.length - 1)) return '플레이어 자리를 확인해 주세요.';
  if (!state.dice[seat].length) return '탈락한 자리예요.';
  if (seat !== state.turn) return '자신의 차례가 아니에요.';
  if (action.type === 'next') {
    if (state.stage !== 'reveal') return '아직 판이 끝나지 않았어요.';
    rollAll(state, random);
    state.stage = 'bid';
    state.bid = null;
    state.lastResult = null;
    state.round++;
    state.log = `${state.round}판 시작. ${seat + 1}번이 먼저 입찰해요.`;
    return null;
  }
  if (state.stage !== 'bid') return '공개 중이에요. 다음 판을 기다려 주세요.';
  if (action.type === 'bid') {
    const { count, face } = action;
    const total = totalDice(state.dice);
    if (!integer(face, 2, 6)) return '눈은 2부터 6까지 고를 수 있어요.';
    if (!integer(count, 1, total)) return `개수는 1부터 ${total}까지예요.`;
    if (!isRaise(state.bid, count, face)) return '개수를 늘리거나, 같은 개수에 더 높은 눈을 불러야 해요.';
    state.bid = { count, face, seat };
    state.turn = nextAlive(state.dice, seat);
    state.log = `${seat + 1}번: ${face}이(가) ${count}개 이상.`;
    return null;
  }
  if (action.type === 'call') {
    const bid = state.bid;
    if (!bid) return '아직 입찰이 없어요. 먼저 입찰해 주세요.';
    const actual = countFace(state.dice, bid.face);
    const loser = actual >= bid.count ? seat : bid.seat;
    const snapshot = state.dice.map(hand => [...hand]);
    state.dice[loser].pop();
    const eliminated = state.dice[loser].length === 0;
    state.lastResult = { bid: { ...bid }, caller: seat, actual, loser, eliminated, dice: snapshot };
    state.stage = 'reveal';
    state.log = `${seat + 1}번이 거짓말을 외쳤어요. ${bid.face}(1 포함) ${actual}개 / 입찰 ${bid.count}개. ${loser + 1}번이 주사위 1개를 잃어요.`;
    if (eliminated) state.log += ` ${loser + 1}번 탈락.`;
    const left = state.dice.map((_, s) => s).filter(s => state.dice[s].length);
    if (left.length === 1) {
      state.winner = left[0];
      state.turn = left[0];
      state.log += ` ${left[0] + 1}번 승리!`;
      return null;
    }
    state.turn = eliminated ? nextAlive(state.dice, loser) : loser;
    return null;
  }
  return '알 수 없는 행동이에요.';
}

export function liarDiceView(state: LiarDiceState, seat: number): LiarDiceView {
  const { dice, ...rest } = state;
  const revealed = state.stage === 'reveal' || finished(state);
  return {
    ...rest,
    bid: state.bid && { ...state.bid },
    lastResult: state.lastResult && { ...state.lastResult, bid: { ...state.lastResult.bid }, dice: state.lastResult.dice.map(hand => [...hand]) },
    dice: dice.map((hand, owner) => hand.map(value => (revealed || owner === seat ? value : null))),
    counts: dice.map(hand => hand.length),
    totalDice: totalDice(dice),
    revealed,
  };
}
