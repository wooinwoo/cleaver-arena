import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';

type Position = { r: number; c: number };
type Wall = Position & { dir: 'h' | 'v' };
export interface QuoridorState extends BaseState {
  kind: 'quoridor';
  pawns: Position[];
  walls: Wall[];
  remaining: number[];
}

const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const same = (a: Position, b: Position) => a.r === b.r && a.c === b.c;

export function createQuoridor(): QuoridorState {
  return {
    kind: 'quoridor', turn: 0, winner: null, draw: false,
    log: '말을 움직이거나 벽을 놓으세요. 반대편 끝에 먼저 도착하면 승리합니다.',
    pawns: [{ r: 8, c: 4 }, { r: 0, c: 4 }], walls: [], remaining: [10, 10],
  };
}

// 벽의 좌표는 벽이 걸치는 네 칸 중 왼쪽 위 칸을 가리킵니다.
function open(walls: Wall[], from: Position, to: Position): boolean {
  if (!integer(to.r, 0, 8) || !integer(to.c, 0, 8)) return false;
  return !walls.some(wall => from.r !== to.r
    ? wall.dir === 'h' && wall.r === Math.min(from.r, to.r)
      && (wall.c === from.c || wall.c + 1 === from.c)
    : wall.dir === 'v' && wall.c === Math.min(from.c, to.c)
      && (wall.r === from.r || wall.r + 1 === from.r));
}

function moves(state: QuoridorState, seat: number): Position[] {
  const from = state.pawns[seat];
  const opponent = state.pawns[1 - seat];
  const legal: Position[] = [];
  for (const [dr, dc] of directions) {
    const next = { r: from.r + dr, c: from.c + dc };
    if (!open(state.walls, from, next)) continue;
    if (!same(next, opponent)) {
      legal.push(next);
      continue;
    }
    const jump = { r: next.r + dr, c: next.c + dc };
    if (open(state.walls, next, jump)) {
      legal.push(jump);
    } else {
      for (const sign of [-1, 1]) {
        const side = { r: next.r + dc * sign, c: next.c + dr * sign };
        if (open(state.walls, next, side)) legal.push(side);
      }
    }
  }
  return legal;
}

function hasRoute(walls: Wall[], start: Position, goal: number): boolean {
  const queue = [start];
  const seen = new Set([start.r * 9 + start.c]);
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    if (from.r === goal) return true;
    for (const [dr, dc] of directions) {
      const to = { r: from.r + dr, c: from.c + dc };
      const key = to.r * 9 + to.c;
      if (!seen.has(key) && open(walls, from, to)) {
        seen.add(key);
        queue.push(to);
      }
    }
  }
  return false;
}

export function actQuoridor(state: QuoridorState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기입니다.';
  if (!integer(seat, 0, 1) || state.turn !== seat) return '내 차례에만 둘 수 있습니다.';
  const { r, c } = action;
  if (action.type === 'move') {
    if (!integer(r, 0, 8) || !integer(c, 0, 8)) return '올바른 칸을 선택하세요.';
    if (!moves(state, seat).some(to => same(to, { r, c }))) return '그 칸으로 이동할 수 없습니다.';
    state.pawns[seat] = { r, c };
    state.log = `${seat + 1}번 플레이어가 말을 움직였습니다.`;
    if (r === (seat === 0 ? 0 : 8)) {
      state.winner = seat;
      state.log = `${seat + 1}번 플레이어가 반대편 끝에 도착했습니다!`;
    }
  } else if (action.type === 'wall') {
    const { dir } = action;
    if (!integer(r, 0, 7) || !integer(c, 0, 7) || (dir !== 'h' && dir !== 'v')) {
      return '올바른 벽 위치와 방향을 선택하세요.';
    }
    if (state.remaining[seat] <= 0) return '남은 벽이 없습니다.';
    if (state.walls.some(wall => wall.dir !== dir
      ? wall.r === r && wall.c === c
      : dir === 'h' ? wall.r === r && Math.abs(wall.c - c) < 2
        : wall.c === c && Math.abs(wall.r - r) < 2)) return '벽을 겹치거나 교차해서 놓을 수 없습니다.';
    const walls: Wall[] = [...state.walls, { r, c, dir }];
    if (!state.pawns.every((pawn, index) => hasRoute(walls, pawn, index === 0 ? 0 : 8))) {
      return '두 플레이어 모두 목적지로 가는 길이 남아 있어야 합니다.';
    }
    state.walls = walls;
    state.remaining[seat]--;
    state.log = `${seat + 1}번 플레이어가 벽을 놓았습니다.`;
  } else {
    return '지원하지 않는 행동입니다.';
  }
  if (state.winner === null) state.turn = 1 - seat;
  return null;
}
