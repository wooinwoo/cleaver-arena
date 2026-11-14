import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';
import type { TableInfo } from '../src/games/types.ts';

/** Boxes per side. The board has (SIZE + 1) × (SIZE + 1) dots. */
export const SIZE = 5;
export const LINES = 2 * SIZE * (SIZE + 1);

export const INFO: TableInfo = {
  title: '점과 상자',
  min: 2,
  max: 4,
  groups: ['board'],
  description: '점 사이에 선을 하나씩 그어 상자를 완성하는 2~4인 게임입니다.',
  rules: [
    '판은 가로세로 6개씩 놓인 36개의 점과 그 사이의 상자 25개로 이루어집니다.',
    '자리 순서대로 돌아가며, 차례마다 이웃한 두 점 사이에 아직 긋지 않은 선 하나를 긋습니다. 선은 가로 또는 세로로만 그을 수 있습니다.',
    '선을 그어 상자의 네 변이 모두 채워지면 그 상자는 선을 그은 사람의 것이 됩니다. 선 하나로 상자 두 개를 동시에 완성할 수도 있습니다.',
    '상자를 하나라도 완성하면 한 번 더 선을 긋습니다. 상자를 완성하지 못하면 다음 사람에게 차례가 넘어갑니다.',
    '선 60개를 모두 그으면 게임이 끝나고, 상자를 가장 많이 가진 사람이 이깁니다. 가장 많은 상자 수가 같은 사람이 둘 이상이면 무승부입니다.',
    '팁: 상자의 세 번째 변을 그으면 다음 사람이 그 상자를 가져갈 수 있습니다. 이어진 상자들은 한꺼번에 넘어갈 수 있으니 조심하세요.',
  ].join('\n'),
};

export type LineDir = 'h' | 'v';
export interface DotsLine { dir: LineDir; r: number; c: number }

export interface DotsState extends BaseState {
  kind: 'dots';
  seats: number;
  /** Horizontal lines: (SIZE + 1) rows × SIZE, index r * SIZE + c. Owner seat or null. */
  h: (number | null)[];
  /** Vertical lines: SIZE rows × (SIZE + 1), index r * (SIZE + 1) + c. Owner seat or null. */
  v: (number | null)[];
  /** Boxes: SIZE × SIZE, index r * SIZE + c. Owner seat or null. */
  boxes: (number | null)[];
  scores: number[];
  /** The most recent line drawn. */
  last: DotsLine | null;
  /** Box indexes claimed by the most recent line. */
  claimed: number[];
  /** Lines drawn so far. */
  count: number;
}

export const lineIndex = (dir: LineDir, r: number, c: number) => dir === 'h' ? r * SIZE + c : r * (SIZE + 1) + c;

/** Number of drawn sides of box (r, c). */
export function sides(state: Pick<DotsState, 'h' | 'v'>, r: number, c: number) {
  return Number(state.h[r * SIZE + c] !== null) + Number(state.h[(r + 1) * SIZE + c] !== null)
    + Number(state.v[r * (SIZE + 1) + c] !== null) + Number(state.v[r * (SIZE + 1) + c + 1] !== null);
}

/** Boxes (as [r, c]) that touch the given line. */
export function adjacentBoxes(dir: LineDir, r: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  if (dir === 'h') {
    if (r > 0) out.push([r - 1, c]);
    if (r < SIZE) out.push([r, c]);
  } else {
    if (c > 0) out.push([r, c - 1]);
    if (c < SIZE) out.push([r, c]);
  }
  return out;
}

/** Every line not yet drawn. */
export function openLines(state: Pick<DotsState, 'h' | 'v'>): DotsLine[] {
  const out: DotsLine[] = [];
  for (let r = 0; r <= SIZE; r++) for (let c = 0; c < SIZE; c++) if (state.h[r * SIZE + c] === null) out.push({ dir: 'h', r, c });
  for (let r = 0; r < SIZE; r++) for (let c = 0; c <= SIZE; c++) if (state.v[r * (SIZE + 1) + c] === null) out.push({ dir: 'v', r, c });
  return out;
}

const seatName = (seat: number) => `${seat + 1}번 자리`;

export function createDots(seats: number): DotsState {
  const players = integer(seats, 2, 4) ? seats : 2;
  return {
    kind: 'dots', turn: 0, winner: null, draw: false,
    log: '1번 자리부터 선을 긋습니다. 상자를 완성하면 한 번 더 긋습니다.',
    seats: players,
    h: Array((SIZE + 1) * SIZE).fill(null),
    v: Array(SIZE * (SIZE + 1)).fill(null),
    boxes: Array(SIZE * SIZE).fill(null),
    scores: Array(players).fill(0),
    last: null, claimed: [], count: 0,
  };
}

export function actDots(state: DotsState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, state.seats - 1) || seat !== state.turn) return '자신의 차례에만 선을 그을 수 있습니다.';
  if (action.type !== 'line') return '알 수 없는 동작입니다.';
  const { dir, r, c } = action;
  if (dir !== 'h' && dir !== 'v') return '가로 또는 세로 선을 선택해 주세요.';
  const rows = dir === 'h' ? SIZE : SIZE - 1, cols = dir === 'h' ? SIZE - 1 : SIZE;
  if (!integer(r, 0, rows) || !integer(c, 0, cols)) return '판 안의 선을 선택해 주세요.';
  const lines = dir === 'h' ? state.h : state.v;
  const index = lineIndex(dir, r, c);
  if (lines[index] !== null) return '이미 그은 선입니다.';

  lines[index] = seat;
  state.count++;
  state.last = { dir, r, c };
  state.claimed = [];
  for (const [br, bc] of adjacentBoxes(dir, r, c)) {
    if (sides(state, br, bc) === 4 && state.boxes[br * SIZE + bc] === null) {
      state.boxes[br * SIZE + bc] = seat;
      state.claimed.push(br * SIZE + bc);
    }
  }
  state.scores[seat] += state.claimed.length;

  if (state.count === LINES) {
    const best = Math.max(...state.scores);
    const leaders = state.scores.flatMap((score, i) => score === best ? [i] : []);
    if (leaders.length === 1) {
      state.winner = leaders[0];
      state.log = `${seatName(leaders[0])} 승리! 상자 ${best}개`;
    } else {
      state.draw = true;
      state.log = `상자 ${best}개로 공동 1위가 나와 무승부입니다.`;
    }
    return null;
  }
  if (state.claimed.length > 0) {
    state.log = `${seatName(seat)}가 상자 ${state.claimed.length}개를 완성해 한 번 더 긋습니다.`;
  } else {
    state.turn = (seat + 1) % state.seats;
    state.log = `${seatName(state.turn)} 차례입니다.`;
  }
  return null;
}
