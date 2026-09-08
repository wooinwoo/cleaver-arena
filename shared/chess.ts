import { Chess, type PieceSymbol } from 'chess.js';
import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';

export interface ChessState extends BaseState {
  kind: 'chess';
  fen: string;
  history: string[];
  board: ({ type: PieceSymbol; color: 'w' | 'b'; square: string } | null)[];
  legal: { from: string; to: string; promotion?: string }[];
  check: boolean;
  last: { from: string; to: string } | null;
}

function snapshot(chess: Chess, last: ChessState['last']): ChessState {
  const turn = chess.turn() === 'w' ? 0 : 1;
  const winner = chess.isCheckmate() ? 1 - turn : null;
  const draw = winner === null && chess.isDraw();
  const history = chess.history();
  const check = chess.isCheck();
  const status = winner !== null ? `${winner === 0 ? '백' : '흑'} 체크메이트 승리!`
    : draw ? '무승부입니다.' : `${turn === 0 ? '백' : '흑'} 차례입니다.${check ? ' 체크!' : ''}`;
  return {
    kind: 'chess', turn, winner, draw, fen: chess.fen(), history, check, last,
    board: chess.board().flat(),
    legal: winner !== null || draw ? [] : chess.moves({ verbose: true }).map(({ from, to, promotion }) => ({
      from, to, ...(promotion ? { promotion } : {}),
    })),
    log: `${history.length ? `${history.at(-1)} · ` : ''}${status}`,
  };
}

export function createChess(): ChessState {
  return snapshot(new Chess(), null);
}

export function actChess(state: ChessState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, 1) || seat !== state.turn) return '자신의 차례에만 움직일 수 있습니다.';
  const { from, to, promotion } = action;
  if (action.type !== 'move' || typeof from !== 'string' || !/^[a-h][1-8]$/.test(from)
    || typeof to !== 'string' || !/^[a-h][1-8]$/.test(to)
    || (promotion !== undefined && (typeof promotion !== 'string' || !/^[qrbn]$/.test(promotion)))) {
    return '올바른 출발 칸, 도착 칸과 승격 기물을 선택해 주세요.';
  }
  const chess = new Chess();
  // ponytail: replay costs O(move count) per turn; retain a server-side Chess instance if long games become expensive.
  for (const move of state.history) chess.move(move);
  try {
    chess.move({ from, to, promotion: promotion ?? 'q' });
  } catch {
    return '그 칸으로 움직일 수 없습니다. 체크와 이동 규칙을 확인해 주세요.';
  }
  Object.assign(state, snapshot(chess, { from, to }));
  return null;
}
