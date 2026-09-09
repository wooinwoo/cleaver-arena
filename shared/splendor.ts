import { randomInt } from 'node:crypto';
import { finished, integer, type Action, type BaseState } from './tabletop-types.ts';
import { SPLENDOR_CARDS, SPLENDOR_NOBLES, splendorBonuses, splendorCanPass, splendorCost, splendorPayment, splendorScore, splendorTakeError, type SplendorPlayer } from './splendor-data.ts';

export interface SplendorState extends BaseState {
  kind: 'splendor';
  bank: number[];
  decks: number[][];
  market: (number | null)[][];
  nobles: number[];
  players: SplendorPlayer[];
  stage: 'action' | 'return' | 'noble';
  finalRound: boolean;
  winners: number[];
  revision: number;
  passes: number;
  last: { seat: number; type: string; card?: number; gems?: number[] } | null;
}
function shuffle(values: number[]) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
export function createSplendor(seats: number): SplendorState {
  if (!integer(seats, 2, 4)) throw new Error('스플렌더는 2–4명이 필요해요.');
  const decks = [0, 1, 2].map(tier => shuffle(SPLENDOR_CARDS.filter(card => card.tier === tier).map(card => card.id)));
  return {
    kind: 'splendor', turn: 0, winner: null, draw: false,
    log: '1번 플레이어부터 시작해요. 보석 획득, 카드 구매 또는 예약을 선택하세요.',
    bank: [...Array(5).fill(seats === 2 ? 4 : seats === 3 ? 5 : 7), 5], decks,
    market: decks.map(deck => deck.splice(0, 4)), nobles: shuffle(SPLENDOR_NOBLES.map((_, id) => id)).slice(0, seats + 1),
    players: Array.from({ length: seats }, () => ({ tokens: [0, 0, 0, 0, 0, 0], cards: [], reserved: [], nobles: [] })),
    stage: 'action', finalRound: false, winners: [], revision: 0, passes: 0, last: null,
  };
}
export function splendorView(state: SplendorState, seat: number) {
  const { decks, players, ...publicState } = state;
  return { ...publicState, remaining: decks.map(deck => deck.length),
    players: players.map((player, index) => ({ ...player, reserved: player.reserved.map(id => index === seat ? id : null) })),
  };
}
export function eligibleNobles(state: Pick<SplendorState, 'nobles'>, player: Pick<SplendorPlayer, 'cards'>) {
  const bonuses = splendorBonuses(player);
  return state.nobles.filter(id => SPLENDOR_NOBLES[id].every((need, color) => bonuses[color] >= need));
}
function endTurn(state: SplendorState) {
  if (splendorScore(state.players[state.turn]) >= 15) state.finalRound = true;
  state.stage = 'action';
  if (state.finalRound && state.turn === state.players.length - 1) {
    const scores = state.players.map(splendorScore);
    const best = Math.max(...scores);
    const fewest = Math.min(...state.players.filter((_, seat) => scores[seat] === best).map(player => player.cards.length));
    state.winners = state.players.flatMap((player, seat) => scores[seat] === best && player.cards.length === fewest ? [seat] : []);
    state.winner = state.winners.length === 1 ? state.winners[0] : null;
    state.draw = state.winners.length > 1;
    state.log = `${state.winners.map(seat => `${seat + 1}번`).join(' · ')} ${state.draw ? '공동 승리' : '승리'}! ${best}점 · 구매 카드 ${fewest}장`;
  } else {
    state.turn = (state.turn + 1) % state.players.length;
    if (state.finalRound) state.log += ' 마지막 라운드예요.';
  }
}
function visitNoble(state: SplendorState, id: number) {
  state.passes = 0;
  state.nobles.splice(state.nobles.indexOf(id), 1);
  state.players[state.turn].nobles.push(id);
  state.log += ' 귀족이 방문해 3점을 얻었어요.';
  endTurn(state);
}
function finishAction(state: SplendorState) {
  const player = state.players[state.turn];
  const excess = player.tokens.reduce((sum, count) => sum + count, 0) - 10;
  if (excess > 0) {
    state.stage = 'return'; state.log += ` 보석 ${excess}개를 돌려 주세요.`; return;
  }
  const nobles = eligibleNobles(state, player);
  if (nobles.length === 1) visitNoble(state, nobles[0]);
  else if (nobles.length > 1) { state.stage = 'noble'; state.log += ' 방문할 귀족 1명을 골라 주세요.'; }
  else endTurn(state);
}
function vector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && Array.from(value).every(count => integer(count, 0, 10));
}
export function actSplendor(state: SplendorState, seat: number, action: Action): string | null {
  if (finished(state)) return '이미 끝난 경기예요.';
  if (!integer(seat, 0, state.players.length - 1) || seat !== state.turn) return '자신의 차례에만 행동할 수 있어요.';
  const player = state.players[seat];
  if (state.stage === 'return') {
    const gems = action.gems;
    const excess = player.tokens.reduce((sum, count) => sum + count, 0) - 10;
    if (action.type !== 'return' || !vector(gems, 6) || gems.some((count, color) => count > player.tokens[color])
      || gems.reduce((sum, count) => sum + count, 0) !== excess) return `보유한 보석 중 정확히 ${excess}개를 돌려 주세요.`;
    gems.forEach((count, color) => { player.tokens[color] -= count; state.bank[color] += count; });
    state.revision++; state.last = { seat, type: 'return' }; state.log = `${seat + 1}번 플레이어가 보석 ${excess}개를 돌려줬어요.`;
    finishAction(state); return null;
  }
  if (state.stage === 'noble') {
    if (action.type !== 'noble' || !integer(action.noble, 0, SPLENDOR_NOBLES.length - 1)
      || !eligibleNobles(state, player).includes(action.noble)) return '조건을 만족하는 귀족 1명을 골라 주세요.';
    state.revision++; state.last = { seat, type: 'noble' }; state.log = `${seat + 1}번 플레이어의 선택.`;
    visitNoble(state, action.noble); return null;
  }
  let last: NonNullable<SplendorState['last']> = { seat, type: action.type };
  if (action.type === 'pass') {
    if (!splendorCanPass(state.bank, state.market, state.decks.map(deck => deck.length), player)) return '가능한 행동이 있을 때는 패스할 수 없어요.';
    state.passes++; state.revision++; state.last = last;
    state.log = `${seat + 1}번 플레이어는 가능한 행동이 없어 패스했어요.`;
    finishAction(state);
    if (!finished(state) && state.stage === 'action' && state.passes >= state.players.length) {
      state.draw = true; state.log = '전원이 연속으로 행동할 수 없어 무승부예요.';
    }
    return null;
  } else if (action.type === 'take') {
    if (!vector(action.gems, 5)) return '보석의 색과 개수를 확인해 주세요.';
    const error = splendorTakeError(state.bank, action.gems);
    if (error) return error;
    action.gems.forEach((count, color) => { player.tokens[color] += count; state.bank[color] -= count; });
    last.gems = [...action.gems, 0];
    state.log = `${seat + 1}번 플레이어가 보석을 가져왔어요.`;
  } else if (action.type === 'reserve' || action.type === 'buy') {
    if (action.type === 'reserve' && player.reserved.length >= 3) return '예약 카드는 최대 3장이에요. 먼저 예약 카드를 구매해 주세요.';
    const blind = action.type === 'reserve' && action.tier !== undefined;
    let id: number, tier = -1, slot = -1, reserved = -1;
    if (blind) {
      if (action.card !== undefined || !integer(action.tier, 0, 2) || !state.decks[action.tier].length) return '카드가 남아 있는 더미를 골라 주세요.';
      tier = action.tier; id = state.decks[tier][state.decks[tier].length - 1];
    } else {
      if (!integer(action.card, 0, SPLENDOR_CARDS.length - 1)) return '구매하거나 예약할 카드를 골라 주세요.';
      id = action.card; tier = SPLENDOR_CARDS[id].tier; slot = state.market[tier].indexOf(id);
      reserved = player.reserved.indexOf(id);
      if (slot < 0 && (action.type !== 'buy' || reserved < 0)) return '공개 카드 또는 내 예약 카드를 골라 주세요.';
    }
    if (action.type === 'buy') {
      const cost = splendorCost(player, id);
      const payment = action.payment === undefined ? splendorPayment(player, id) : action.payment;
      if (!vector(payment, 6) || payment.some((count, color) => count > player.tokens[color])
        || cost.some((need, color) => payment[color] > need)
        || payment[5] !== cost.reduce((gold, need, color) => gold + need - payment[color], 0)) return '할인 후 비용에 맞게 보석과 황금을 지불해 주세요.';
      payment.forEach((count, color) => { player.tokens[color] -= count; state.bank[color] += count; });
      player.cards.push(id); last.card = id;
      state.log = `${seat + 1}번 플레이어가 카드를 구매했어요. 현재 ${splendorScore(player)}점.`;
    } else {
      player.reserved.push(id);
      const gold = state.bank[5] > 0 ? 1 : 0;
      state.bank[5] -= gold; player.tokens[5] += gold; last.gems = [0, 0, 0, 0, 0, gold];
      state.log = `${seat + 1}번 플레이어가 카드를 예약했어요.${gold ? ' 황금 1개를 가져왔어요.' : ' 남은 황금은 없어요.'}`;
    }
    if (blind) state.decks[tier].pop();
    else if (slot >= 0) state.market[tier][slot] = state.decks[tier].pop() ?? null;
    else player.reserved.splice(reserved, 1);
  } else return '보석 획득, 카드 구매 또는 예약을 선택해 주세요.';
  state.passes = 0; state.revision++; state.last = last;
  finishAction(state);
  return null;
}
