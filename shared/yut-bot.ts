import type { Action } from './tabletop-types.ts';
import { type YutState, YUT_DONE, YUT_HOME, yutDestination } from './yut.ts';

/** Forward steps left until the piece leaves the board (home counts as a full lap). */
function remaining(position: number, prev: number | null): number {
  if (position === YUT_DONE) return 0;
  for (let steps = 1; steps <= 30; steps++) if (yutDestination(position, steps, prev) === YUT_DONE) return steps;
  return 30;
}

/** True when some opponent piece could land on `point` with one normal throw (1..5). */
function threatened(state: YutState, seat: number, point: number) {
  for (let other = 0; other < state.seats; other++) {
    if (other === seat) continue;
    for (let i = 0; i < 4; i++) {
      const position = state.pieces[other][i];
      if (position === YUT_DONE) continue;
      for (let steps = 1; steps <= 5; steps++) if (yutDestination(position, steps, state.prev[other][i]) === point) return true;
    }
  }
  return false;
}

/**
 * Throws in the throw stage. When moving, scores every (piece, result) pair: captures first, then
 * finishing, then shortcuts and stacking, then advancing the rearmost piece onto a safe point.
 * ponytail: one-move greedy scoring, no planning of the order of several pending results.
 */
export function yutBot(state: YutState, seat: number, random = Math.random): Action {
  if (state.stage === 'throw') return { type: 'throw' };
  const mine = state.pieces[seat];
  let best = -Infinity, choice: Action = { type: 'throw' };
  const tried = new Set<string>();
  for (let result = 0; result < state.pending.length; result++) {
    const steps = state.pending[result];
    for (let piece = 0; piece < 4; piece++) {
      const from = mine[piece];
      const key = `${steps}:${from}`;
      if (from === YUT_DONE || tried.has(key)) continue;
      tried.add(key);
      if (steps === -1 && from === YUT_HOME) continue;
      const to = yutDestination(from, steps, state.prev[seat][piece]);
      if (to === null) continue;
      const group = from === YUT_HOME ? 1 : mine.filter(position => position === from).length;
      let score = random();
      if (to === YUT_DONE) score += 500 * group;
      else {
        let captured = 0;
        for (let other = 0; other < state.seats; other++) if (other !== seat) captured += state.pieces[other].filter(p => p === to).length;
        if (captured) score += 1000 + 50 * captured;
        if (to === 5 || to === 10 || to === 22) score += 200;
        if (from !== YUT_HOME && mine.some(position => position === to)) score += 120;
        if (!captured && threatened(state, seat, to)) score -= 150 * group;
        if (from !== YUT_HOME && threatened(state, seat, from)) score += 60 * group;
        score += remaining(from, state.prev[seat][piece]) * 3;
        if (steps === -1) score -= 40;
      }
      if (score > best) { best = score; choice = { type: 'move', piece, result }; }
    }
  }
  return choice;
}
