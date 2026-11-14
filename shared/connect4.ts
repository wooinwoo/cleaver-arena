import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';
import type { TableInfo } from '../src/games/types.ts';

export const COLS = 7;
export const ROWS = 6;
export const COLOR_NAMES = ['빨강', '노랑'] as const;

export const INFO: TableInfo = {
  title: '사목',
  min: 2,
  max: 2,
  groups: ['board'],
  description: '세워 둔 판에 원반을 떨어뜨려 네 개를 잇는 2인 게임',
  rules: [
    '가로 7칸, 세로 6칸의 세워 둔 판에서 두 사람이 번갈아 원반을 넣습니다.',
    '빨강이 먼저 두고 노랑이 다음에 둡니다.',
    '열을 하나 고르면 원반은 그 열의 가장 아래 빈칸까지 떨어집니다. 꽉 찬 열에는 넣을 수 없습니다.',
    '자기 원반 네 개를 가로, 세로, 대각선 중 한 방향으로 먼저 이으면 이깁니다.',
    '판이 모두 찰 때까지 아무도 잇지 못하면 무승부입니다.',
  ].join('\n'),
};

export interface ConnectFourState extends BaseState {
  kind: 'connect4';
  /** Row-major, row 0 = top. null = empty, otherwise the seat (0 빨강, 1 노랑). */
  board: (number | null)[];
  /** Index of the last dropped disc. */
  last: number | null;
  /** Cell indices of the winning four (or longer) when someone has won. */
  line: number[] | null;
  count: number;
}

export function createConnectFour(): ConnectFourState {
  return {
    kind: 'connect4', turn: 0, winner: null, draw: false,
    log: '빨강부터 시작합니다. 네 개를 먼저 이으면 승리합니다.',
    board: Array(COLS * ROWS).fill(null), last: null, line: null, count: 0,
  };
}

/** Row a disc would land on in column c, or -1 when the column is full. */
export function landingRow(board: readonly (number | null)[], c: number) {
  for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + c] === null) return r;
  return -1;
}

/** Cells of the longest line of `seat` through (r, c) if it reaches four, else null. */
export function winningLine(board: readonly (number | null)[], r: number, c: number, seat: number): number[] | null {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [r * COLS + c];
    for (const sign of [-1, 1]) {
      let row = r + dr * sign, col = c + dc * sign;
      while (row >= 0 && row < ROWS && col >= 0 && col < COLS && board[row * COLS + col] === seat) {
        cells.push(row * COLS + col);
        row += dr * sign;
        col += dc * sign;
      }
    }
    if (cells.length >= 4) return cells.sort((a, b) => a - b);
  }
  return null;
}

export function actConnectFour(state: ConnectFourState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, 1) || seat !== state.turn) return '자신의 차례에만 둘 수 있습니다.';
  const { c } = action;
  if (action.type !== 'drop' || !integer(c, 0, COLS - 1)) return '판 안의 열을 선택해 주세요.';
  const r = landingRow(state.board, c);
  if (r < 0) return '이미 가득 찬 열입니다.';
  const index = r * COLS + c;
  state.board[index] = seat;
  state.last = index;
  state.count++;
  const line = winningLine(state.board, r, c, seat);
  if (line) {
    state.winner = seat;
    state.line = line;
    state.log = `${COLOR_NAMES[seat]} 승리!`;
    return null;
  }
  state.draw = state.count === COLS * ROWS;
  if (state.draw) state.log = '판이 가득 차 무승부입니다.';
  else {
    state.turn = 1 - seat;
    state.log = `${COLOR_NAMES[state.turn]} 차례입니다.`;
  }
  return null;
}
