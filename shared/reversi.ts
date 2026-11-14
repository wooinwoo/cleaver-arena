import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';
import type { TableInfo } from '../src/games/types.ts';

export const INFO: TableInfo = {
  title: '리버시',
  min: 2,
  max: 2,
  groups: ['board'],
  description: '8×8 판에서 상대 돌을 사이에 끼워 뒤집는 2인 보드게임입니다.',
  rules: [
    '8×8 판의 가운데에 흑 2개, 백 2개를 엇갈려 놓고 시작합니다. 흑이 먼저 둡니다.',
    '내 돌과 새로 놓는 돌 사이에 상대 돌이 한 줄(가로, 세로, 대각선)로 끼면 그 돌을 모두 내 색으로 뒤집습니다.',
    '한 개 이상 뒤집을 수 있는 자리에만 둘 수 있습니다. 여러 방향이 동시에 끼면 모두 뒤집습니다.',
    '둘 곳이 없으면 차례가 자동으로 상대에게 넘어갑니다.',
    '두 사람 모두 둘 곳이 없거나 판이 가득 차면 끝납니다. 돌이 더 많은 쪽이 이기고, 같으면 무승부입니다.',
  ].join('\n'),
};

export interface ReversiState extends BaseState {
  kind: 'reversi';
  /** 64 cells, row-major: 0 = 흑, 1 = 백, null = empty. */
  board: (number | null)[];
  /** Index of the last placed disc. */
  last: number | null;
  /** Indices flipped by the last move. */
  flipped: number[];
  /** Disc counts [흑, 백]. */
  counts: [number, number];
  /** Seat whose turn was skipped right after the last move, or null. */
  passed: number | null;
}

export const SIZE = 8;
const DIRECTIONS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] as const;
const color = (seat: number) => (seat === 0 ? '흑' : '백');

/** Indices that a disc of `seat` placed at `index` would flip (empty if illegal). */
export function reversiFlips(board: (number | null)[], index: number, seat: number): number[] {
  if (board[index] !== null) return [];
  const r = Math.floor(index / SIZE), c = index % SIZE;
  const flips: number[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    const line: number[] = [];
    let row = r + dr, col = c + dc;
    while (row >= 0 && row < SIZE && col >= 0 && col < SIZE && board[row * SIZE + col] === 1 - seat) {
      line.push(row * SIZE + col);
      row += dr; col += dc;
    }
    if (line.length && row >= 0 && row < SIZE && col >= 0 && col < SIZE && board[row * SIZE + col] === seat) flips.push(...line);
  }
  return flips;
}

function legalMoves(board: (number | null)[], seat: number): number[] {
  const moves: number[] = [];
  for (let index = 0; index < board.length; index++) if (reversiFlips(board, index, seat).length) moves.push(index);
  return moves;
}

/** Legal target indices for `seat` (empty when the game is over). */
export function reversiMoves(state: ReversiState, seat: number): number[] {
  if (finished(state) || !integer(seat, 0, 1)) return [];
  return legalMoves(state.board, seat);
}

export function createReversi(): ReversiState {
  const board: (number | null)[] = Array(SIZE * SIZE).fill(null);
  board[27] = 1; board[28] = 0; board[35] = 0; board[36] = 1;
  return {
    kind: 'reversi', turn: 0, winner: null, draw: false,
    log: '흑부터 시작합니다. 상대 돌을 끼워 뒤집을 수 있는 자리에 두세요.',
    board, last: null, flipped: [], counts: [2, 2], passed: null,
  };
}

export function actReversi(state: ReversiState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, 1) || seat !== state.turn) return '자신의 차례에만 둘 수 있습니다.';
  const r = action?.r, c = action?.c;
  if (action?.type !== 'place' || !integer(r, 0, SIZE - 1) || !integer(c, 0, SIZE - 1)) return '판 안의 칸을 선택해 주세요.';
  const index = r * SIZE + c;
  if (state.board[index] !== null) return '이미 돌이 있는 칸입니다.';
  const flips = reversiFlips(state.board, index, seat);
  if (!flips.length) return '상대 돌을 하나 이상 뒤집을 수 있는 칸에만 둘 수 있습니다.';

  state.board[index] = seat;
  for (const flip of flips) state.board[flip] = seat;
  state.last = index;
  state.flipped = flips;
  state.counts[seat] += flips.length + 1;
  state.counts[1 - seat] -= flips.length;
  state.passed = null;

  const placed = `${color(seat)} ${r + 1}행 ${c + 1}열, ${flips.length}개 뒤집음.`;
  const other = 1 - seat;
  if (legalMoves(state.board, other).length) {
    state.turn = other;
    state.log = `${placed} ${color(other)} 차례입니다.`;
  } else if (legalMoves(state.board, seat).length) {
    state.passed = other;
    state.log = `${placed} ${color(other)}은 둘 곳이 없어 차례를 넘깁니다. ${color(seat)} 차례입니다.`;
  } else {
    const [black, white] = state.counts;
    if (black === white) {
      state.draw = true;
      state.log = `${placed} 두 사람 모두 둘 곳이 없습니다. ${black}대 ${white} 무승부입니다.`;
    } else {
      state.winner = black > white ? 0 : 1;
      state.log = `${placed} 두 사람 모두 둘 곳이 없습니다. ${black}대 ${white}로 ${color(state.winner)} 승리!`;
    }
  }
  return null;
}
