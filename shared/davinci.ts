import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';

export type DaVinciColor = 'B' | 'W';
export interface DaVinciTile {
  id: string;
  color: DaVinciColor;
  num: number;
  revealed: boolean;
  failed: number[];
}
export interface DaVinciState extends BaseState {
  kind: 'davinci';
  deck: DaVinciTile[];
  hands: DaVinciTile[][];
  stage: 'draw' | 'guess';
  guessed: boolean;
  drawnId: string | null;
}
export interface DaVinciPublicTile {
  id: string;
  color: DaVinciColor;
  num: number | null;
  revealed: boolean;
  failed: number[];
}
export interface DaVinciView extends Omit<BaseState, 'kind'> {
  kind: 'davinci';
  deckCount: number;
  hands: DaVinciPublicTile[][];
  stage: 'draw' | 'guess';
  guessed: boolean;
  drawnId: string | null;
}

export const DAVINCI_COLOR_NAME: Record<DaVinciColor, string> = { B: '흑', W: '백' };
const dealCount = (seats: number) => (seats === 2 ? 4 : 3);
const byTile = (a: DaVinciTile, b: DaVinciTile) => a.num - b.num || (a.color < b.color ? -1 : a.color > b.color ? 1 : 0);
const alive = (state: DaVinciState, seat: number) => state.hands[seat].some(tile => !tile.revealed);
const survivors = (state: DaVinciState) => state.hands.map((_, seat) => seat).filter(seat => alive(state, seat));

export function createDavinci(seats: number): DaVinciState {
  const tiles: DaVinciTile[] = [];
  for (const color of ['B', 'W'] as const) for (let num = 0; num <= 11; num++) {
    tiles.push({ id: crypto.randomUUID(), color, num, revealed: false, failed: [] });
  }
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  const hands: DaVinciTile[][] = Array.from({ length: seats }, () => []);
  for (let round = 0; round < dealCount(seats); round++) for (let seat = 0; seat < seats; seat++) hands[seat].push(tiles.pop()!);
  hands.forEach(hand => hand.sort(byTile));
  return {
    kind: 'davinci', turn: 0, winner: null, draw: false,
    log: '첫 번째 차례부터 시작해요. 타일을 뽑고 상대 타일의 숫자를 맞혀 보세요.',
    deck: tiles, hands, stage: 'draw', guessed: false, drawnId: null,
  };
}

function advance(state: DaVinciState) {
  const seats = state.hands.length;
  for (let step = 1; step <= seats; step++) {
    const next = (state.turn + step) % seats;
    if (alive(state, next)) {
      state.turn = next;
      state.stage = state.deck.length ? 'draw' : 'guess';
      state.guessed = false;
      state.drawnId = null;
      return;
    }
  }
  state.draw = true;
}

function settle(state: DaVinciState, seat: number) {
  if (alive(state, seat)) return;
  state.log += ` ${seat + 1}번의 타일이 모두 공개돼 탈락이에요.`;
  const left = survivors(state);
  if (left.length === 1) {
    state.winner = left[0];
    state.log += ` ${left[0] + 1}번 승리!`;
  }
}

export function actDavinci(state: DaVinciState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기예요.';
  if (!integer(seat, 0, state.hands.length - 1)) return '플레이어 자리를 확인해 주세요.';
  if (seat !== state.turn) return '자신의 차례가 아니에요.';
  if (action.type === 'draw') {
    if (state.stage !== 'draw') return '타일을 뽑을 차례가 아니에요.';
    const tile = state.deck.pop();
    if (!tile) return '남은 타일이 없어요. 추측만 할 수 있어요.';
    tile.revealed = false;
    state.hands[seat].push(tile);
    state.hands[seat].sort(byTile);
    state.drawnId = tile.id;
    state.stage = 'guess';
    state.log = `${seat + 1}번이 타일을 가져왔어요. 상대 타일의 숫자를 맞혀 보세요.`;
    return null;
  }
  if (action.type === 'guess') {
    if (state.stage !== 'guess') return '먼저 타일을 뽑아 주세요.';
    const { target, tile: index, num } = action;
    if (!integer(target, 0, state.hands.length - 1) || target === seat) return '상대 타일을 골라 주세요.';
    const tile = integer(index, 0, state.hands[target].length - 1) ? state.hands[target][index] : undefined;
    if (!tile || tile.revealed) return '아직 공개되지 않은 상대 타일을 골라 주세요.';
    if (!integer(num, 0, 11)) return '0부터 11까지 숫자를 골라 주세요.';
    if (tile.failed.includes(num)) return '이미 아니라고 나온 숫자예요.';
    if (tile.num === num) {
      tile.revealed = true;
      state.guessed = true;
      state.log = `${seat + 1}번 적중! ${target + 1}번의 ${DAVINCI_COLOR_NAME[tile.color]} 타일 ${num} 공개. 계속 맞히거나 그만둘 수 있어요.`;
      settle(state, target);
      return null;
    }
    tile.failed.push(num);
    const own = state.hands[seat].find(candidate => candidate.id === state.drawnId && !candidate.revealed)
      ?? state.hands[seat].find(candidate => !candidate.revealed);
    if (own) own.revealed = true;
    state.log = `${seat + 1}번 실패. ${num}이(가) 아니었어요. 내 타일 1장을 공개해요.`;
    settle(state, seat);
    if (!finished(state)) advance(state);
    return null;
  }
  if (action.type === 'stop') {
    if (state.stage !== 'guess') return '그만둘 수 있는 차례가 아니에요.';
    if (!state.guessed) return '한 번 이상 맞힌 뒤에 그만둘 수 있어요.';
    state.log = `${seat + 1}번이 추측을 마쳤어요.`;
    advance(state);
    return null;
  }
  return '알 수 없는 행동이에요.';
}

export function davinciView(state: DaVinciState, seat: number): DaVinciView {
  const { deck, hands, drawnId, ...rest } = state;
  const open = finished(state);
  return {
    ...rest,
    deckCount: deck.length,
    hands: hands.map((hand, owner) => hand.map(tile => ({
      id: tile.id,
      color: tile.color,
      num: owner === seat || tile.revealed || open ? tile.num : null,
      revealed: tile.revealed,
      failed: [...tile.failed],
    }))),
    drawnId: state.turn === seat ? drawnId : null,
  };
}
