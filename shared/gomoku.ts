import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';

export interface GomokuState extends BaseState {
  kind: 'gomoku';
  board: (number | null)[];
  last: number | null;
  count: number;
}

export function createGomoku(): GomokuState {
  return {
    kind: 'gomoku', turn: 0, winner: null, draw: false,
    log: '흑부터 시작합니다. 금수 없이 다섯 개 이상 연결하면 승리합니다.',
    board: Array(225).fill(null), last: null, count: 0,
  };
}

export function actGomoku(state: GomokuState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, 1) || seat !== state.turn) return '자신의 차례에만 둘 수 있습니다.';
  const { r, c } = action;
  if (action.type !== 'place' || !integer(r, 0, 14) || !integer(c, 0, 14)) return '바둑판 안의 교차점을 선택해 주세요.';
  const index = r * 15 + c;
  if (state.board[index] !== null) return '이미 돌이 있는 자리입니다.';
  state.board[index] = seat;
  state.last = index;
  state.count++;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let length = 1;
    for (const sign of [-1, 1]) {
      let row = r + dr * sign, col = c + dc * sign;
      while (row >= 0 && row < 15 && col >= 0 && col < 15 && state.board[row * 15 + col] === seat) {
        length++;
        row += dr * sign;
        col += dc * sign;
      }
    }
    if (length >= 5) {
      state.winner = seat;
      state.log = `${seat === 0 ? '흑' : '백'} 승리!`;
      return null;
    }
  }
  state.draw = state.count === 225;
  if (state.draw) state.log = '빈자리가 없어 무승부입니다.';
  else {
    state.turn = 1 - seat;
    state.log = `${state.turn === 0 ? '흑' : '백'} 차례입니다.`;
  }
  return null;
}
