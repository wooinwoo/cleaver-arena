import { type BaseState, type Action, finished, integer } from './tabletop-types.ts';

export type CoupRole = 'duke' | 'assassin' | 'captain' | 'ambassador' | 'contessa';
export const COUP_ROLES: readonly CoupRole[] = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
export const COUP_ROLE_NAME: Record<CoupRole, string> = { duke: '공작', assassin: '암살자', captain: '선장', ambassador: '대사', contessa: '콘테스타' };
export type CoupActionKind = 'income' | 'aid' | 'coup' | 'tax' | 'steal' | 'assassinate' | 'exchange';
export const COUP_ACTION_NAME: Record<CoupActionKind, string> = { income: '수입', aid: '해외 원조', coup: '쿠', tax: '세금', steal: '강탈', assassinate: '암살', exchange: '교환' };
export const COUP_ACTION_COST: Record<CoupActionKind, number> = { income: 0, aid: 0, coup: 7, tax: 0, steal: 0, assassinate: 3, exchange: 0 };
export const COUP_CLAIM: Partial<Record<CoupActionKind, CoupRole>> = { tax: 'duke', steal: 'captain', assassinate: 'assassin', exchange: 'ambassador' };
export const COUP_ACTION_RULE: Record<CoupActionKind, string> = {
  income: '코인 1개를 받아요. 아무도 막을 수 없어요.',
  aid: '코인 2개를 받아요. 공작 주장으로 저지할 수 있어요.',
  coup: '코인 7개를 써서 상대 영향력 1장을 강제 공개해요. 막을 수 없어요.',
  tax: '공작 주장. 코인 3개를 받아요.',
  steal: '선장 주장. 상대 코인 최대 2개를 가져가요. 선장·대사 주장으로 저지할 수 있어요.',
  assassinate: '암살자 주장. 코인 3개를 써서 상대 영향력 1장을 암살해요. 콘테스타 주장으로 저지할 수 있어요.',
  exchange: '대사 주장. 더미 2장과 내 카드를 교환해요.',
};

interface CoupCard { id: string; role: CoupRole }
export interface CoupInfluence { card: CoupCard; revealed: boolean }
export interface CoupPlayer { coins: number; influence: CoupInfluence[] }
export interface CoupDeclared { kind: CoupActionKind; actor: number; target?: number }

type After =
  | { after: 'nextTurn' }
  | { after: 'resolve'; action: CoupDeclared }
  | { after: 'blocked' };

export type CoupStage =
  | { kind: 'action' }
  | { kind: 'react'; action: CoupDeclared; step: number }
  | { kind: 'blockReact'; action: CoupDeclared; blocker: number; role: CoupRole; step: number }
  | { kind: 'reveal'; seat: number; cause: string; pending: After }
  | { kind: 'exchange'; seat: number; drawn: CoupCard[] };

export interface CoupState extends BaseState {
  kind: 'coup';
  players: CoupPlayer[];
  deck: CoupCard[];
  stage: CoupStage;
}

const alive = (player: CoupPlayer) => player.influence.some(card => !card.revealed);
const aliveSeats = (state: CoupState) => state.players.map((_, seat) => seat).filter(seat => alive(state.players[seat]));
const needsTarget = (kind: CoupActionKind) => kind === 'coup' || kind === 'steal' || kind === 'assassinate';
export function coupBlockRoles(kind: CoupActionKind): CoupRole[] {
  if (kind === 'aid') return ['duke'];
  if (kind === 'steal') return ['captain', 'ambassador'];
  if (kind === 'assassinate') return ['contessa'];
  return [];
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function createCoup(seats: number): CoupState {
  const deck: CoupCard[] = [];
  for (const role of COUP_ROLES) for (let copy = 0; copy < 3; copy++) deck.push({ id: crypto.randomUUID(), role });
  shuffle(deck);
  const players: CoupPlayer[] = Array.from({ length: seats }, () => ({
    coins: 2,
    influence: [deck.pop()!, deck.pop()!].map(card => ({ card, revealed: false })),
  }));
  return {
    kind: 'coup', turn: 0, winner: null, draw: false,
    log: '1번부터 시작해요. 행동을 고르고, 거짓말을 걸면 챌린지!',
    players, deck, stage: { kind: 'action' },
  };
}

function drawCard(state: CoupState): CoupCard {
  const card = state.deck.pop();
  if (card) {
    card.id = crypto.randomUUID();
    return card;
  }
  // 극히 드문 완전 소진: 이미 공개된 카드를 회수해 다시 섞는다.
  const spent: CoupCard[] = [];
  for (const player of state.players) for (const influence of player.influence) if (influence.revealed) spent.push(influence.card);
  shuffle(spent);
  state.deck = spent;
  for (const player of state.players) player.influence = player.influence.filter(influence => !influence.revealed);
  const drawn = state.deck.pop()!;
  drawn.id = crypto.randomUUID();
  return drawn;
}

function nextTurn(state: CoupState) {
  const aliveList = aliveSeats(state);
  if (aliveList.length === 1) {
    state.winner = aliveList[0];
    state.log += ` ${aliveList[0] + 1}번 승리!`;
    return;
  }
  let next = state.turn;
  do next = (next + 1) % state.players.length;
  while (!alive(state.players[next]));
  state.turn = next;
  state.stage = { kind: 'action' };
  state.log += ` ${next + 1}번 차례.`;
}

function loseInfluence(state: CoupState, seat: number, cause: string, pending: After) {
  const player = state.players[seat];
  const hidden = player.influence.map((influence, index) => influence.revealed ? -1 : index).filter(index => index >= 0);
  const reveal = (index: number) => {
    player.influence[index].revealed = true;
    state.log += ` ${seat + 1}번의 ${COUP_ROLE_NAME[player.influence[index].card.role]} 공개.`;
    if (!alive(player)) state.log += ` ${seat + 1}번 탈락!`;
  };
  if (hidden.length === 1) {
    reveal(hidden[0]);
    if (!finished(state)) after(state, pending);
    else if (state.winner === null && aliveSeats(state).length === 1) state.winner = aliveSeats(state)[0];
    return;
  }
  state.stage = { kind: 'reveal', seat, cause, pending };
}

function after(state: CoupState, pending: After) {
  if (finished(state)) return;
  if (pending.after === 'nextTurn') nextTurn(state);
  else if (pending.after === 'blocked') {
    state.log += ' 저지되어 행동이 무효가 됐어요.';
    nextTurn(state);
  } else resolveAction(state, pending.action);
}

function resolveAction(state: CoupState, action: CoupDeclared) {
  const actor = state.players[action.actor];
  const target = action.target !== undefined ? state.players[action.target] : null;
  switch (action.kind) {
    case 'tax':
      actor.coins += 3;
      state.log += ` 세금으로 +3코인.`;
      nextTurn(state);
      break;
    case 'aid':
      actor.coins += 2;
      state.log += ' 해외 원조 +2코인.';
      nextTurn(state);
      break;
    case 'steal':
      if (target) {
        const gain = Math.min(2, target.coins);
        target.coins -= gain;
        actor.coins += gain;
        state.log += ` ${gain}코인 강탈.`;
      }
      nextTurn(state);
      break;
    case 'assassinate':
      if (action.target === undefined || !target || !alive(target)) {
        state.log += ' 대상이 이미 없어요.';
        nextTurn(state);
        return;
      }
      actor.coins -= 3;
      state.log += ` 암살 실행!`;
      loseInfluence(state, action.target, '암살당했어요. 공개할 카드를 골라 주세요.', { after: 'nextTurn' });
      break;
    case 'exchange': {
      const drawn = [drawCard(state), drawCard(state)];
      state.stage = { kind: 'exchange', seat: action.actor, drawn };
      break;
    }
    default: nextTurn(state);
  }
}

function challenge(state: CoupState, claimant: number, role: CoupRole, challenger: number, onTruth: After, onLie: After) {
  const player = state.players[claimant];
  const index = player.influence.findIndex(influence => !influence.revealed && influence.card.role === role);
  if (index >= 0) {
    player.influence[index].card.id = crypto.randomUUID();
    state.deck.push(player.influence[index].card);
    shuffle(state.deck);
    player.influence[index].card = drawCard(state);
    state.log += ` ${claimant + 1}번의 ${COUP_ROLE_NAME[role]} 주장은 사실! 챌린지를 건 ${challenger + 1}번이 영향력을 잃어요.`;
    loseInfluence(state, challenger, '챌린지 실패. 공개할 카드를 골라 주세요.', onTruth);
  } else {
    state.log += ` ${claimant + 1}번의 ${COUP_ROLE_NAME[role]} 주장은 거짓!`;
    loseInfluence(state, claimant, '거짓 주장이 들통났어요. 공개할 카드를 골라 주세요.', onLie);
  }
}

export function reactors(state: CoupState, pivot: number): number[] {
  const seats: number[] = [];
  for (let step = 1; step <= state.players.length; step++) {
    const seat = (pivot + step) % state.players.length;
    if (seat !== pivot && alive(state.players[seat])) seats.push(seat);
  }
  return seats;
}

export function actCoup(state: CoupState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기예요.';
  if (!integer(seat, 0, state.players.length - 1)) return '플레이어 자리를 확인해 주세요.';
  const stage = state.stage;
  if (stage.kind === 'action') {
    if (seat !== state.turn) return '내 차례가 아니에요.';
    if (action.type !== 'act') return '행동을 선택해 주세요.';
    const kind = action.kind;
    if (typeof kind !== 'string' || !(kind in COUP_ACTION_NAME)) return '알 수 없는 행동이에요.';
    const me = state.players[seat];
    if (me.coins >= 10 && kind !== 'coup') return '코인이 10개 이상이면 쿠를 해야 해요.';
    const cost = COUP_ACTION_COST[kind as CoupActionKind];
    if (me.coins < cost) return '코인이 부족해요.';
    let target: number | undefined;
    if (needsTarget(kind as CoupActionKind)) {
      if (!integer(action.target, 0, state.players.length - 1) || action.target === seat) return '대상을 다시 골라 주세요.';
      target = action.target as number;
      if (!alive(state.players[target])) return '이미 탈락한 대상이에요.';
    }
    const declared: CoupDeclared = { kind: kind as CoupActionKind, actor: seat, ...(target !== undefined ? { target } : {}) };
    if (kind === 'income') {
      me.coins++;
      state.log += ` 수입 +1코인.`;
      nextTurn(state);
      return null;
    }
    if (kind === 'coup') {
      me.coins -= 7;
      state.log += ` 쿠! ${target! + 1}번의 영향력 1장이 공개돼요.`;
      loseInfluence(state, target!, '쿠를 당했어요. 공개할 카드를 골라 주세요.', { after: 'nextTurn' });
      return null;
    }
    state.stage = { kind: 'react', action: declared, step: 0 };
    state.log += ` ${seat + 1}번이 ${COUP_ACTION_NAME[kind as CoupActionKind]}${target !== undefined ? ` → ${target + 1}번` : ''} 선언.`;
    return null;
  }
  if (stage.kind === 'react') {
    const order = reactors(state, stage.action.actor);
    const reactor = order[stage.step];
    if (reactor === undefined) { resolveAction(state, stage.action); return null; }
    if (seat !== reactor) return '지금은 반응할 순서가 아니에요.';
    if (action.type === 'pass') {
      state.stage = { ...stage, step: stage.step + 1 };
      if (state.stage.kind === 'react' && (state.stage as { step: number }).step >= order.length) resolveAction(state, stage.action);
      return null;
    }
    if (action.type === 'challenge') {
      const role = COUP_CLAIM[stage.action.kind];
      if (!role) return '역할 주장이 없는 행동은 챌린지할 수 없어요.';
      challenge(state, stage.action.actor, role, seat, { after: 'resolve', action: stage.action }, { after: 'nextTurn' });
      return null;
    }
    if (action.type === 'block') {
      const role = action.role;
      if (typeof role !== 'string' || !coupBlockRoles(stage.action.kind).includes(role as CoupRole)) return '이 행동을 저지할 수 있는 역할이 아니에요.';
      state.stage = { kind: 'blockReact', action: stage.action, blocker: seat, role: role as CoupRole, step: 0 };
      state.log += ` ${seat + 1}번이 ${COUP_ROLE_NAME[role as CoupRole]} 주장으로 저지!`;
      return null;
    }
    return '반응을 선택해 주세요.';
  }
  if (stage.kind === 'blockReact') {
    const order = reactors(state, stage.blocker);
    const reactor = order[stage.step];
    if (reactor === undefined) { after(state, { after: 'blocked' }); return null; }
    if (seat !== reactor) return '지금은 반응할 순서가 아니에요.';
    if (action.type === 'accept') {
      state.stage = { ...stage, step: stage.step + 1 };
      if (state.stage.kind === 'blockReact' && (state.stage as { step: number }).step >= order.length) after(state, { after: 'blocked' });
      return null;
    }
    if (action.type === 'challenge') {
      challenge(state, stage.blocker, stage.role, seat, { after: 'blocked' }, { after: 'resolve', action: stage.action });
      return null;
    }
    return '반응을 선택해 주세요.';
  }
  if (stage.kind === 'reveal') {
    if (seat !== stage.seat) return '공개할 사람이 아니에요.';
    if (action.type !== 'reveal' || !integer(action.index, 0, state.players[seat].influence.length - 1)) return '공개할 카드를 골라 주세요.';
    const influence = state.players[seat].influence[action.index as number];
    if (influence.revealed) return '아직 숨은 카드를 골라 주세요.';
    influence.revealed = true;
    state.log += ` ${seat + 1}번의 ${COUP_ROLE_NAME[influence.card.role]} 공개.`;
    if (!alive(state.players[seat])) {
      state.log += ` ${seat + 1}번 탈락!`;
      const left = aliveSeats(state);
      if (left.length === 1) { state.winner = left[0]; state.log += ` ${left[0] + 1}번 승리!`; return null; }
    }
    after(state, stage.pending);
    return null;
  }
  if (stage.kind === 'exchange') {
    if (seat !== stage.seat) return '교환할 사람이 아니에요.';
    if (action.type !== 'keep' || !Array.isArray(action.cards)) return '유지할 카드를 골라 주세요.';
    const mine = state.players[seat];
    const options = [...mine.influence.filter(influence => !influence.revealed).map(influence => influence.card), ...stage.drawn];
    const ids = action.cards as unknown[];
    const keepCount = mine.influence.filter(influence => !influence.revealed).length;
    if (ids.length !== keepCount || new Set(ids.map(String)).size !== ids.length) return `카드 ${keepCount}장을 골라 주세요.`;
    const chosen = ids.map(id => options.find(card => card.id === id));
    if (chosen.some(card => !card)) return '선택한 카드가 올바르지 않아요.';
    const returned = options.filter(card => !ids.includes(card.id));
    for (const card of options) card.id = crypto.randomUUID();
    state.deck.push(...returned);
    shuffle(state.deck);
    const revealedOld = mine.influence.filter(influence => influence.revealed);
    mine.influence = [...chosen.map(card => ({ card: card as CoupCard, revealed: false })), ...revealedOld];
    state.log += ` 카드를 교환했어요.`;
    nextTurn(state);
    return null;
  }
  return '알 수 없는 요청이에요.';
}

export interface CoupViewPlayer { coins: number; influence: { id: string; role: CoupRole | null; revealed: boolean }[] }
export interface CoupView extends Omit<BaseState, 'kind'> {
  kind: 'coup';
  players: CoupViewPlayer[];
  deckCount: number;
  stage:
    | { kind: 'action' }
    | { kind: 'react'; action: CoupDeclared; step: number; reactor: number }
    | { kind: 'blockReact'; action: CoupDeclared; blocker: number; role: CoupRole; step: number; reactor: number }
    | { kind: 'reveal'; seat: number; cause: string }
    | { kind: 'exchange'; seat: number; options?: { id: string; role: CoupRole }[] };
}

export function coupView(state: CoupState, seat: number): CoupView {
  return {
    kind: 'coup', turn: state.turn, winner: state.winner, draw: state.draw, log: state.log,
    players: state.players.map((player, owner) => ({
      coins: player.coins,
      influence: player.influence.map(influence => ({
        id: influence.card.id,
        role: owner === seat || influence.revealed || finished(state) ? influence.card.role : null,
        revealed: influence.revealed,
      })),
    })),
    deckCount: state.deck.length,
    stage: state.stage.kind === 'action' ? { kind: 'action' }
      : state.stage.kind === 'react' ? { kind: 'react', action: state.stage.action, step: state.stage.step, reactor: reactors(state, state.stage.action.actor)[state.stage.step] ?? -1 }
      : state.stage.kind === 'blockReact' ? { kind: 'blockReact', action: state.stage.action, blocker: state.stage.blocker, role: state.stage.role, step: state.stage.step, reactor: reactors(state, state.stage.blocker)[state.stage.step] ?? -1 }
      : state.stage.kind === 'reveal' ? { kind: 'reveal', seat: state.stage.seat, cause: state.stage.cause }
      : state.stage.kind === 'exchange'
        ? { kind: 'exchange', seat: state.stage.seat, ...(seat === state.stage.seat ? { options: [...state.players[seat].influence.filter(influence => !influence.revealed).map(influence => influence.card), ...state.stage.drawn].map(card => ({ id: card.id, role: card.role })) } : {}) }
        : { kind: 'action' },
  };
}
