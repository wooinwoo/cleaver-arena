import { finished, integer, type Action, type BaseState } from './tabletop-types.ts';

export type PieceKind = 'king' | 'rook' | 'bishop' | 'pawn' | 'hen';
export type Piece = { owner: 0 | 1; kind: PieceKind };
export interface JanggiState extends BaseState {
  kind: 'janggi';
  board: (Piece | null)[];
  hands: PieceKind[][];
  positions: string[];
}

export const RULES = '동물장기 기반 십이장기: 왕은 8방향, 장은 상하좌우, 상은 대각선, 자는 앞으로 한 칸 이동합니다. 후는 뒤쪽 대각선을 제외한 6방향으로 한 칸 이동합니다. 자는 이동하여 상대 끝줄에 도착하면 후가 됩니다. 잡은 말은 빈칸에 투입하고 후는 자로 돌아옵니다. 자의 같은 열·끝줄 투입을 허용하며 투입만으로 승급하지 않습니다. 자기 왕을 공격받는 상태로 두는 수는 금지합니다. 왕 포획 또는 안전한 상대 끝줄 진입으로 즉시 승리합니다. 둘 수 있는 수가 없으면 패배하며 같은 차례·판·보유 말이 세 번 반복되면 무승부입니다.';

const names: Record<PieceKind, string> = { king: '왕', rook: '장', bishop: '상', pawn: '자', hen: '후' };
const row = (position: number) => Math.floor(position / 3);
const farRow = (owner: number) => owner === 0 ? 0 : 3;
const positionKey = (state: JanggiState) => JSON.stringify([
  state.turn, state.board, state.hands.map(hand => [...hand].sort()),
]);

export function createJanggi(): JanggiState {
  const state: JanggiState = {
    kind: 'janggi', turn: 0, winner: null, draw: false, log: '첫 번째 플레이어부터 시작합니다.',
    board: [
      { owner: 1, kind: 'rook' }, { owner: 1, kind: 'king' }, { owner: 1, kind: 'bishop' },
      null, { owner: 1, kind: 'pawn' }, null,
      null, { owner: 0, kind: 'pawn' }, null,
      { owner: 0, kind: 'bishop' }, { owner: 0, kind: 'king' }, { owner: 0, kind: 'rook' },
    ], hands: [[], []], positions: [],
  };
  state.positions.push(positionKey(state));
  return state;
}

function canStep(piece: Piece, from: number, to: number): boolean {
  const dx = to % 3 - from % 3, dy = row(to) - row(from);
  if ((!dx && !dy) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  const forward = piece.owner === 0 ? -1 : 1;
  switch (piece.kind) {
    case 'king': return true;
    case 'rook': return dx === 0 || dy === 0;
    case 'bishop': return Math.abs(dx) === 1 && Math.abs(dy) === 1;
    case 'pawn': return dx === 0 && dy === forward;
    case 'hen': return !(dx !== 0 && dy === -forward);
  }
}

function safe(board: (Piece | null)[], owner: number): boolean {
  const king = board.findIndex(piece => piece?.owner === owner && piece.kind === 'king');
  return king >= 0 && !board.some((piece, from) => piece && piece.owner !== owner && canStep(piece, from, king));
}

function movedBoard(board: (Piece | null)[], from: number, to: number): (Piece | null)[] {
  const next = board.slice(), piece = board[from]!;
  next[from] = null;
  next[to] = piece.kind === 'pawn' && row(to) === farRow(piece.owner) ? { ...piece, kind: 'hen' } : piece;
  return next;
}

function hasLegalAction(state: JanggiState, seat: 0 | 1): boolean {
  for (let to = 0; to < 12; to++) {
    if (state.board[to]?.owner === seat) continue;
    for (let from = 0; from < 12; from++) {
      const piece = state.board[from];
      if (piece?.owner === seat && canStep(piece, from, to) && safe(movedBoard(state.board, from, to), seat)) return true;
    }
    if (!state.board[to]) {
      for (const kind of state.hands[seat]) {
        const board = state.board.slice();
        board[to] = { owner: seat, kind };
        if (safe(board, seat)) return true;
      }
    }
  }
  return false;
}

export function actJanggi(state: JanggiState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, 1) || seat !== state.turn) return '내 차례가 아닙니다.';
  if (!action || !integer(action.to, 0, 11)) return '올바른 칸을 선택하세요.';
  const to = action.to, owner = seat as 0 | 1;
  let board: (Piece | null)[], capture: Piece | null = null, moving: Piece;
  const hands = state.hands.map(hand => hand.slice());
  if (action.type === 'move') {
    if (!integer(action.from, 0, 11)) return '이동할 말을 선택하세요.';
    const piece = state.board[action.from];
    if (!piece || piece.owner !== seat) return '내 말을 선택하세요.';
    if (state.board[to]?.owner === seat) return '내 말이 있는 칸입니다.';
    if (!canStep(piece, action.from, to)) return '그 방향으로 이동할 수 없습니다.';
    capture = state.board[to];
    board = movedBoard(state.board, action.from, to);
    moving = board[to]!;
    if (capture && capture.kind !== 'king') hands[seat].push(capture.kind === 'hen' ? 'pawn' : capture.kind);
  } else if (action.type === 'drop') {
    if (state.board[to]) return '빈칸에만 투입할 수 있습니다.';
    if (action.piece !== 'rook' && action.piece !== 'bishop' && action.piece !== 'pawn') return '투입할 수 없는 말입니다.';
    const index = hands[seat].indexOf(action.piece);
    if (index < 0) return '보유하지 않은 말입니다.';
    hands[seat].splice(index, 1);
    board = state.board.slice();
    moving = board[to] = { owner, kind: action.piece };
  } else return '지원하지 않는 행동입니다.';
  if (!safe(board, seat)) return '왕이 공격받는 수는 둘 수 없습니다.';

  state.board = board;
  state.hands = hands;
  state.log = `${seat + 1}번 ${names[moving.kind]} ${action.type === 'drop' ? '투입' : '이동'}${capture ? ` · ${names[capture.kind]} 포획` : ''}`;
  state.turn = 1 - seat;
  if (capture?.kind === 'king' || (moving.kind === 'king' && row(to) === farRow(seat))) {
    state.winner = seat;
    state.log += capture?.kind === 'king' ? ' · 왕 포획 승리' : ' · 안전 진입 승리';
  } else if (!hasLegalAction(state, state.turn as 0 | 1)) {
    state.winner = seat;
    state.log += ' · 상대가 둘 수 없어 승리';
  }
  const key = positionKey(state);
  state.positions.push(key);
  if (!finished(state) && state.positions.filter(position => position === key).length >= 3) {
    state.draw = true;
    state.log = '같은 배치가 세 번 반복되어 무승부입니다.';
  }
  return null;
}
