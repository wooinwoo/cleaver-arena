import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';
import type { TableInfo } from '../src/games/types.ts';

export const INFO: TableInfo = {
  title: '만칼라',
  min: 2,
  max: 2,
  groups: ['board'],
  description: '구덩이의 씨앗을 한 칸씩 뿌려 자기 창고에 더 많이 모으는 2인 보드게임입니다.',
  rules: [
    '판에는 한 사람당 작은 칸 6개와 창고 1개가 있습니다. 처음에는 작은 칸마다 씨앗이 4개씩 들어 있습니다.',
    '자기 차례에는 내 쪽의 씨앗이 있는 칸 하나를 고릅니다. 그 칸의 씨앗을 모두 집어 시계 반대 방향으로 다음 칸부터 하나씩 뿌립니다.',
    '뿌릴 때 내 창고에는 씨앗을 넣지만 상대 창고는 건너뜁니다.',
    '마지막 씨앗이 내 창고에 들어가면 한 번 더 둡니다.',
    '마지막 씨앗이 비어 있던 내 쪽 칸에 들어가고 마주 보는 상대 칸에 씨앗이 있으면, 그 씨앗과 마지막 씨앗을 모두 내 창고로 가져옵니다.',
    '어느 한쪽의 작은 칸 6개가 모두 비면 게임이 끝납니다. 다른 쪽에 남은 씨앗은 그 칸 주인의 창고로 들어갑니다.',
    '창고에 씨앗이 더 많은 사람이 이깁니다. 같으면 무승부입니다.',
  ].join('\n'),
};

export const PITS = 6;
export const STORE = [6, 13] as const;

export interface MancalaState extends BaseState {
  kind: 'mancala';
  /** 14 slots: 0–5 seat 0 pits, 6 seat 0 store, 7–12 seat 1 pits (opposite of 5–0), 13 seat 1 store. */
  pits: number[];
  /** The last move: who played which relative pit (0–5), or null before the first move. */
  last: { seat: number; pit: number } | null;
  /** Absolute indices that received a seed in the last move, in sowing order. */
  lastSow: number[];
  /** Seeds moved to the store by the last move's capture (0 when there was none). */
  captured: number;
  /** True when the last move ended in the mover's store and the mover plays again. */
  extraTurn: boolean;
  moves: number;
}

export function createMancala(): MancalaState {
  const pits = Array(14).fill(4);
  pits[6] = 0;
  pits[13] = 0;
  return {
    kind: 'mancala', turn: 0, winner: null, draw: false,
    log: '1번 자리부터 시작합니다. 내 쪽 칸을 골라 씨앗을 뿌리세요.',
    pits, last: null, lastSow: [], captured: 0, extraTurn: false, moves: 0,
  };
}

/** Absolute index of a seat's relative pit (0–5). */
export const pitIndex = (seat: number, pit: number) => seat * 7 + pit;
/** Index across the board (12 - index), for pits 0–5 and 7–12. */
export const opposite = (index: number) => 12 - index;

export interface SowResult { sown: number[]; captured: number; extraTurn: boolean; ended: boolean }

/**
 * Applies a Kalah move to a 14-slot array in place (no validation). Shared with the bot.
 * When either side is empty afterwards, sweeps the remaining seeds into their owner's store.
 */
export function sow(pits: number[], seat: number, pit: number, track = true): SowResult {
  const ownStore = STORE[seat], otherStore = STORE[1 - seat];
  let index = pitIndex(seat, pit);
  let seeds = pits[index];
  pits[index] = 0;
  const sown: number[] = [];
  while (seeds > 0) {
    index = (index + 1) % 14;
    if (index === otherStore) continue;
    pits[index]++;
    seeds--;
    if (track) sown.push(index);
  }
  let captured = 0;
  const own = index >= seat * 7 && index < seat * 7 + PITS;
  if (own && pits[index] === 1 && pits[opposite(index)] > 0) {
    captured = pits[index] + pits[opposite(index)];
    pits[ownStore] += captured;
    pits[index] = 0;
    pits[opposite(index)] = 0;
  }
  let empty0 = true, empty1 = true;
  for (let i = 0; i < PITS; i++) {
    if (pits[i]) empty0 = false;
    if (pits[7 + i]) empty1 = false;
  }
  const ended = empty0 || empty1;
  if (ended) {
    for (const side of [0, 1]) {
      for (let i = side * 7; i < side * 7 + PITS; i++) { pits[STORE[side]] += pits[i]; pits[i] = 0; }
    }
  }
  return { sown, captured, extraTurn: index === ownStore && !ended, ended };
}

export function actMancala(state: MancalaState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, 1) || seat !== state.turn) return '자신의 차례에만 둘 수 있습니다.';
  const { pit } = action;
  if (action.type !== 'sow' || !integer(pit, 0, PITS - 1)) return '내 쪽 칸 1~6 중 하나를 골라 주세요.';
  if (state.pits[pitIndex(seat, pit)] === 0) return '씨앗이 있는 칸을 골라 주세요.';
  const result = sow(state.pits, seat, pit);
  state.last = { seat, pit };
  state.lastSow = result.sown;
  state.captured = result.captured;
  state.extraTurn = result.extraTurn;
  state.moves++;
  const name = `${seat + 1}번`;
  if (result.ended) {
    const [a, b] = [state.pits[STORE[0]], state.pits[STORE[1]]];
    state.extraTurn = false;
    if (a === b) {
      state.draw = true;
      state.log = `${a} 대 ${b} 무승부입니다.`;
    } else {
      state.winner = a > b ? 0 : 1;
      state.log = `${state.winner + 1}번 승리 (${Math.max(a, b)} 대 ${Math.min(a, b)})`;
    }
    return null;
  }
  if (!result.extraTurn) state.turn = 1 - seat;
  const parts = [`${name}이 ${pit + 1}번 칸을 뿌렸습니다.`];
  if (result.captured) parts.push(`씨앗 ${result.captured}개를 가져왔습니다.`);
  parts.push(result.extraTurn ? '창고에 끝나 한 번 더 둡니다.' : `${state.turn + 1}번 차례입니다.`);
  state.log = parts.join(' ');
  return null;
}
