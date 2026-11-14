import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';
import type { TableInfo } from '../src/games/types.ts';

export const INFO: TableInfo = {
  title: '윷놀이',
  min: 2,
  max: 4,
  groups: ['board'],
  description: '윷을 던져 말 네 개를 먼저 판 밖으로 내보내는 전통 놀이입니다.',
  rules: [
    '2~4명이 각자 말 4개로 겨룹니다. 말 4개를 모두 먼저 내보낸 사람이 이깁니다.',
    '윷가락 4개를 던집니다. 도 1칸, 개 2칸, 걸 3칸, 윷 4칸, 모 5칸입니다. 표시된 가락 하나만 뒤집히면 빽도로 1칸 뒤로 갑니다.',
    '윷이나 모가 나오면 한 번 더 던집니다. 나온 결과는 모아 두었다가 원하는 순서로 하나씩 원하는 말에 씁니다.',
    '말은 참먹이에서 출발해 판 바깥을 시계 반대 방향으로 돕니다. 모나 뒷모 모서리에 딱 멈추면 다음 이동은 가운데(방)를 지나는 지름길로 갑니다. 방에 딱 멈추면 참먹이로 곧장 가는 짧은 길로 갑니다.',
    '내 말이 있는 자리에 도착하면 업어서 함께 움직입니다. 상대 말이 있는 자리에 도착하면 그 자리의 상대 말을 모두 잡아 처음으로 돌려보내고 한 번 더 던집니다.',
    '판 위에 말이 없을 때 나온 빽도는 버립니다. 첫 칸에서 빽도가 나오면 참먹이로 돌아가며, 이때는 아직 나간 것이 아닙니다.',
    '참먹이를 지나쳐야 말이 나갑니다. 참먹이에 딱 멈춘 말은 다음 이동에서 어떤 결과로든 나갑니다.',
  ].join('\n'),
};

/** Board points: 0 = 참먹이, 1..19 outer ring counter-clockwise, 5 = 모, 10 = 뒷모, 15 = 찌, 22 = 방. */
export const YUT_POINTS: { x: number; y: number }[] = (() => {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const side = Math.floor(i / 5), t = (i % 5) * 18;
    points.push([{ x: 95, y: 95 - t }, { x: 95 - t, y: 5 }, { x: 5, y: 5 + t }, { x: 5 + t, y: 95 }][side]);
  }
  for (const [x, y] of [[80, 20], [65, 35], [50, 50], [35, 65], [20, 80], [20, 20], [35, 35], [65, 65], [80, 80]]) points.push({ x, y });
  return points;
})();
/** Lines of the board for drawing: [from, to] point pairs. */
export const YUT_LINES: [number, number][] = [
  ...Array.from({ length: 20 }, (_, i) => [i, (i + 1) % 20] as [number, number]),
  [5, 20], [20, 21], [21, 22], [22, 23], [23, 24], [24, 15],
  [10, 25], [25, 26], [26, 22], [22, 27], [27, 28], [28, 0],
];
export const YUT_HOME = -1;
export const YUT_DONE = 29;
export const YUT_NAMES: Record<number, string> = { [-1]: '빽도', 1: '도', 2: '개', 3: '걸', 4: '윷', 5: '모' };
export const YUT_COLORS = ['#c0392b', '#1f5fae', '#1e8449', '#7d3c98'];
export const YUT_COLOR_NAMES = ['빨강', '파랑', '초록', '보라'];

export interface YutState extends BaseState {
  kind: 'yut';
  seats: number;
  stage: 'throw' | 'move';
  /** Thrown results waiting to be used (−1 = 빽도). */
  pending: number[];
  /** pieces[seat][i]: −1 at home, 0..28 on a point, 29 finished. */
  pieces: number[][];
  /** Point each piece stepped from on its last forward move (for 빽도 at the centre), or null. */
  prev: (number | null)[][];
  /** Most recent throw, for the UI. */
  lastThrow: { seat: number; value: number } | null;
  /** Most recent move, for highlighting. */
  lastMove: { seat: number; from: number; to: number; captured: number } | null;
}

const OUTER = Array.from({ length: 19 }, (_, i) => i + 1).concat(0);
const DIAG_A = [20, 21, 22, 23, 24, 15, 16, 17, 18, 19, 0];
const DIAG_B = [25, 26, 22, 27, 28, 0];
const PREDECESSOR: Record<number, number> = {
  0: 19, 20: 5, 21: 20, 22: 21, 23: 22, 24: 23, 25: 10, 26: 25, 27: 22, 28: 27,
};

/** Points a piece starting at `from` walks through on forward moves (ending at 참먹이; beyond = finish). */
function route(from: number): number[] {
  if (from === YUT_HOME) return OUTER;
  if (from === 0) return [];
  if (from === 5) return DIAG_A;
  if (from === 10) return DIAG_B;
  if (from === 22) return [27, 28, 0];
  if ([20, 21, 23, 24].includes(from)) return DIAG_A.slice(DIAG_A.indexOf(from) + 1);
  if (from >= 25) return DIAG_B.slice(DIAG_B.indexOf(from) + 1);
  return OUTER.slice(from);
}

/** Destination of a piece at `from` moving `steps` (−1 for 빽도): a point, YUT_DONE, or null if not possible. */
export function yutDestination(from: number, steps: number, prev: number | null = null): number | null {
  if (from === YUT_DONE) return null;
  if (steps === -1) {
    if (from === YUT_HOME) return null;
    if (prev !== null) return prev;
    return from >= 1 && from <= 19 ? from - 1 : PREDECESSOR[from];
  }
  const path = route(from);
  return steps <= path.length ? path[steps - 1] : YUT_DONE;
}

export function createYut(seats: number, _random: () => number = Math.random): YutState {
  if (!integer(seats, 2, 4)) throw new Error('윷놀이는 2~4명이 할 수 있습니다.');
  return {
    kind: 'yut', turn: 0, winner: null, draw: false,
    log: '첫 번째 사람부터 윷을 던집니다.',
    seats, stage: 'throw', pending: [],
    pieces: Array.from({ length: seats }, () => [YUT_HOME, YUT_HOME, YUT_HOME, YUT_HOME]),
    prev: Array.from({ length: seats }, () => [null, null, null, null]),
    lastThrow: null, lastMove: null,
  };
}

/** One throw of four fair sticks (stick 0 is marked). Uses four random draws. */
export function yutRoll(random: () => number = Math.random): number {
  const flat = [0, 1, 2, 3].map(() => random() < 0.5);
  const count = flat.filter(Boolean).length;
  if (count === 0) return 5;
  if (count === 1) return flat[0] ? -1 : 1;
  return count;
}

const onBoard = (position: number) => position >= 0 && position < YUT_DONE;

/** Destination for the UI: point index, 'finish', or null when the move is not legal. */
export function yutTargets(state: YutState, seat: number, piece: number, resultIndex: number): number | 'finish' | null {
  if (!integer(seat, 0, state.seats - 1) || !integer(piece, 0, 3) || !integer(resultIndex, 0, state.pending.length - 1)) return null;
  const to = yutDestination(state.pieces[seat][piece], state.pending[resultIndex], state.prev[seat][piece]);
  return to === null ? null : to === YUT_DONE ? 'finish' : to;
}

function nextTurn(state: YutState) {
  state.turn = (state.turn + 1) % state.seats;
  state.stage = 'throw';
  state.pending = [];
}

/** Ends the move stage when nothing usable is left (unused 빽도 with no piece on the board is dropped). */
function settle(state: YutState, note: string) {
  if (state.stage !== 'move') return note;
  if (state.pending.length && state.pending.every(value => value === -1) && !state.pieces[state.turn].some(onBoard)) {
    state.pending = [];
    note += ' 판 위에 말이 없어 빽도는 넘어갑니다.';
  }
  if (!state.pending.length) nextTurn(state);
  return note;
}

export function actYut(state: YutState, seat: number, action: Action, random: () => number = Math.random): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, state.seats - 1) || seat !== state.turn) return '자신의 차례에만 할 수 있습니다.';
  if (!action || typeof action !== 'object') return '알 수 없는 동작입니다.';
  if (action.type === 'throw') {
    if (state.stage !== 'throw') return '나온 결과로 먼저 말을 움직여 주세요.';
    const value = yutRoll(random);
    state.pending.push(value);
    state.lastThrow = { seat, value };
    let note = `${YUT_NAMES[value]}!`;
    if (value >= 4) note += ' 한 번 더 던집니다.';
    else {
      state.stage = 'move';
      note = settle(state, note);
    }
    state.log = note;
    return null;
  }
  if (action.type !== 'move') return '알 수 없는 동작입니다.';
  if (state.stage !== 'move') return '먼저 윷을 던져 주세요.';
  const { piece, result } = action;
  if (!integer(piece, 0, 3)) return '움직일 말을 골라 주세요.';
  if (!integer(result, 0, state.pending.length - 1)) return '쓸 결과를 골라 주세요.';
  const mine = state.pieces[seat];
  const from = mine[piece];
  if (from === YUT_DONE) return '이미 나간 말입니다.';
  const steps = state.pending[result];
  if (steps === -1 && from === YUT_HOME) return '빽도는 판 위의 말에만 쓸 수 있습니다.';
  const to = yutDestination(from, steps, state.prev[seat][piece]);
  if (to === null) return '그 말은 그렇게 움직일 수 없습니다.';

  const group = from === YUT_HOME ? [piece] : mine.flatMap((position, i) => position === from ? [i] : []);
  const stepPrev = steps === -1 || to === YUT_DONE ? null : (() => {
    const path = route(from);
    return steps >= 2 ? path[steps - 2] : from === YUT_HOME ? 0 : from;
  })();
  state.pending.splice(result, 1);
  for (const i of group) mine[i] = to;
  if (to !== YUT_DONE) mine.forEach((position, i) => { if (position === to) state.prev[seat][i] = stepPrev; });
  else for (const i of group) state.prev[seat][i] = null;
  let captured = 0;
  if (to !== YUT_DONE) {
    for (let other = 0; other < state.seats; other++) {
      if (other === seat) continue;
      state.pieces[other].forEach((position, i) => {
        if (position === to) { state.pieces[other][i] = YUT_HOME; state.prev[other][i] = null; captured++; }
      });
    }
  }
  state.lastMove = { seat, from, to, captured };
  const count = group.length > 1 ? `말 ${group.length}개가` : '말이';
  let note = to === YUT_DONE ? `${count} 나갔습니다.` : `${count} ${YUT_NAMES[steps]}로 움직였습니다.`;
  if (to !== YUT_DONE && mine.filter(position => position === to).length > group.length) note += ' 말을 업었습니다.';
  if (mine.every(position => position === YUT_DONE)) {
    state.winner = seat;
    state.pending = [];
    state.log = `${note} 말 4개가 모두 나가 승리했습니다!`;
    return null;
  }
  if (captured) {
    note += ` 상대 말 ${captured}개를 잡았습니다. 한 번 더 던집니다.`;
    state.stage = 'throw';
  } else note = settle(state, note);
  state.log = note;
  return null;
}
