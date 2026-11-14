import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOneCard, actOneCard, oneCardView, oneCardPlayable, oneCardSpecial, INFO, type OneCardState,
} from '../shared/onecard.ts';
import { oneCardBot } from '../shared/onecard-bot.ts';
import { finished } from '../shared/tabletop-types.ts';

function seeded(seed: number) {
  return () => {
    let t = (seed = (seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a controlled table. Deck: last element is drawn first. */
function table(hands: string[][], top: string, deck: string[] = ['H3', 'H4', 'H5', 'H6', 'H8', 'H9'], extra: Partial<OneCardState> = {}): OneCardState {
  const state = createOneCard(hands.length, seeded(1));
  Object.assign(state, { hands, deck, discard: [top], top, counts: hands.map(h => h.length), declaredSuit: null, attack: 0, direction: 1, turn: 0 }, extra);
  return state;
}
const play = (state: OneCardState, seat: number, card: string, suit?: string) =>
  actOneCard(state, seat, suit ? { type: 'play', card, suit } : { type: 'play', card });

test('onecard info and deal sizes', () => {
  assert.equal(INFO.title, '원카드');
  assert.deepEqual([INFO.min, INFO.max], [2, 6]);
  for (const seats of [2, 3, 4, 5, 6]) {
    const state = createOneCard(seats, seeded(seats));
    const each = seats <= 3 ? 7 : 5;
    assert.equal(state.hands.length, seats);
    for (const hand of state.hands) assert.equal(hand.length, each);
    assert.deepEqual(state.counts, Array(seats).fill(each));
    assert.ok(!oneCardSpecial(state.top));
    assert.equal(state.deck.length + state.discard.length + seats * each, 54);
    const all = [...state.deck, ...state.discard, ...state.hands.flat()];
    assert.equal(new Set(all).size, 54);
    assert.ok(all.includes('JB') && all.includes('JC'));
  }
});

test('onecard matching by suit or rank, joker on anything, draw ends the turn', () => {
  const state = table([['H9', 'S5', 'C8', 'JB'], ['D3', 'D4']], 'S9');
  assert.deepEqual(oneCardPlayable(state, 0).sort(), ['JB', 'H9', 'S5'].sort());
  const before = structuredClone(state);
  assert.match(play(state, 0, 'C8')!, /맞는/);
  assert.deepEqual(state, before);
  assert.equal(play(state, 0, 'H9'), null);
  assert.equal(state.top, 'H9');
  assert.equal(state.turn, 1);
  assert.deepEqual(state.counts, [3, 2]);
  assert.equal(actOneCard(state, 1, { type: 'draw' }), null);
  assert.equal(state.hands[1].length, 3);
  assert.equal(state.turn, 0);
  // Anything goes on a joker when not under attack.
  const j = table([['C8', 'D4'], ['D3']], 'JB');
  assert.deepEqual(oneCardPlayable(j, 0).sort(), ['C8', 'D4']);
});

test('onecard attacks stack and the penalty is taken in full', () => {
  const state = table([['H2', 'C4', 'C5'], ['HA', 'D6', 'D8'], ['C9', 'JB', 'D9']], 'H5', ['S3', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'C3', 'C6', 'C10', 'D10', 'D5', 'D3', 'H3', 'H4', 'H6', 'H8']);
  assert.equal(play(state, 0, 'H2'), null);
  assert.equal(state.attack, 2);
  assert.deepEqual(oneCardPlayable(state, 1), ['HA']);
  assert.match(play(state, 1, 'D6')!, /공격/);
  assert.equal(play(state, 1, 'HA'), null);
  assert.equal(state.attack, 5);
  assert.deepEqual(oneCardPlayable(state, 2), ['JB']);
  assert.equal(play(state, 2, 'JB'), null);
  assert.equal(state.attack, 10);
  // On a joker any attack card defends, a plain card cannot.
  assert.deepEqual(oneCardPlayable(state, 0), []);
  assert.equal(actOneCard(state, 0, { type: 'draw' }), null);
  assert.equal(state.hands[0].length, 12);
  assert.equal(state.attack, 0);
  assert.equal(state.turn, 1);
  assert.equal(state.lastPlay?.drew, 10);
  // Attack over: anything goes on the joker.
  assert.deepEqual(oneCardPlayable(state, 1).sort(), ['D6', 'D8']);
});

test('onecard ♠A is +5, other A +3, colour joker +7', () => {
  const s = table([['SA', 'C3'], ['S2', 'C4']], 'S5');
  assert.equal(play(s, 0, 'SA'), null);
  assert.equal(s.attack, 5);
  assert.equal(play(s, 1, 'S2'), null);
  assert.equal(s.attack, 7);
  const a = table([['DA', 'C3'], ['JC', 'C4']], 'D5');
  assert.equal(play(a, 0, 'DA'), null);
  assert.equal(a.attack, 3);
  assert.equal(play(a, 1, 'JC'), null);
  assert.equal(a.attack, 10);
  assert.equal(a.turn, 0);
  // Attack card of another suit and rank cannot defend.
  const b = table([['H2', 'C3'], ['DA', 'C4']], 'H5');
  play(b, 0, 'H2');
  assert.deepEqual(oneCardPlayable(b, 1), []);
});

test('onecard J skips, Q reverses (skip with two), K plays again, 7 picks the suit', () => {
  const j = table([['HJ', 'C3'], ['D3'], ['D4']], 'H5');
  assert.equal(play(j, 0, 'HJ'), null);
  assert.equal(j.turn, 2);
  const q = table([['HQ', 'C3'], ['D3'], ['D4']], 'H5');
  assert.equal(play(q, 0, 'HQ'), null);
  assert.equal(q.direction, -1);
  assert.equal(q.turn, 2);
  const q2 = table([['HQ', 'C3'], ['D3']], 'H5');
  assert.equal(play(q2, 0, 'HQ'), null);
  assert.equal(q2.turn, 0);
  assert.equal(q2.direction, 1);
  const j2 = table([['HJ', 'C3'], ['D3']], 'H5');
  play(j2, 0, 'HJ');
  assert.equal(j2.turn, 0);
  const k = table([['HK', 'C3', 'C4'], ['D3']], 'H5');
  assert.equal(play(k, 0, 'HK'), null);
  assert.equal(k.turn, 0);
  assert.equal(actOneCard(k, 0, { type: 'draw' }), null);
  assert.equal(k.turn, 1);
  const seven = table([['H7', 'C3'], ['D3', 'S9', 'C7']], 'H5');
  const before = structuredClone(seven);
  assert.match(play(seven, 0, 'H7')!, /무늬/);
  assert.match(play(seven, 0, 'H7', 'X')!, /무늬/);
  assert.deepEqual(seven, before);
  assert.equal(play(seven, 0, 'H7', 'S'), null);
  assert.equal(seven.declaredSuit, 'S');
  assert.deepEqual(oneCardPlayable(seven, 1).sort(), ['C7', 'S9']);
  play(seven, 1, 'S9');
  assert.equal(seven.declaredSuit, null);
});

test('onecard reshuffles the discard keeping the top, and stops when nothing is left', () => {
  const state = table([['C3', 'C4'], ['D3', 'D4']], 'H5', []);
  state.discard = ['S8', 'S9', 'S10', 'H5'];
  assert.equal(actOneCard(state, 0, { type: 'draw' }), null);
  assert.equal(state.top, 'H5');
  assert.deepEqual(state.discard, ['H5']);
  assert.equal(state.deck.length, 2);
  assert.equal(state.hands[0].length, 3);
  const empty = table([['C3', 'C4'], ['D3', 'D4']], 'H5', []);
  assert.equal(actOneCard(empty, 0, { type: 'draw' }), null);
  assert.equal(empty.hands[0].length, 2);
  assert.equal(empty.turn, 1);
  // Attack larger than what is available draws what it can.
  const short = table([['H2', 'C4'], ['D3']], 'H5', ['S3']);
  play(short, 0, 'H2');
  assert.equal(actOneCard(short, 1, { type: 'draw' }), null);
  assert.equal(short.hands[1].length, 3); // S3, then H5 from the reshuffled discard
  assert.equal(short.attack, 0);
});

test('onecard last card wins and ends the game', () => {
  const state = table([['H9'], ['D3']], 'H5');
  assert.equal(play(state, 0, 'H9'), null);
  assert.equal(state.winner, 0);
  assert.ok(finished(state));
  assert.match(actOneCard(state, 1, { type: 'draw' })!, /끝난/);
});

test('onecard view hides other hands and the deck', () => {
  const state = createOneCard(4, seeded(9));
  const view = oneCardView(state, 1);
  assert.deepEqual(view.hand, state.hands[1]);
  assert.deepEqual(view.counts, [5, 5, 5, 5]);
  assert.equal(view.deckCount, state.deck.length);
  assert.equal(view.finalHands, null);
  const json = JSON.stringify(view);
  for (const card of [...state.hands[0], ...state.hands[2], ...state.hands[3], ...state.deck]) assert.ok(!json.includes(`"${card}"`), card);
  for (const key of ['deck', 'hands', 'discard', 'seed']) assert.ok(!(key in view), key);
  assert.deepEqual(oneCardPlayable(view, 0), []);
  assert.deepEqual(oneCardPlayable(oneCardView(state, 0), 0), oneCardPlayable(state, 0));
});

test('onecard rejects invalid input without mutation', () => {
  const state = table([['H9', 'C3'], ['D3']], 'H5');
  const before = structuredClone(state);
  for (const [seat, action] of [
    [1, { type: 'draw' }], [7, { type: 'draw' }], [0, { type: 'nope' }], [0, { type: 'play' }],
    [0, { type: 'play', card: 'D3' }], [0, { type: 'play', card: 'ZZ' }], [0, { type: 'play', card: 5 }],
    [0, { type: 'play', card: 'C3' }],
  ] as const) {
    assert.equal(typeof actOneCard(state, seat, action as never), 'string');
    assert.deepEqual(state, before);
  }
});

for (const seats of [2, 4]) test(`onecard bot self-play finishes for ${seats} seats`, () => {
  let wins = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const random = seeded(seed * 31 + seats);
    const state = createOneCard(seats, random);
    let turns = 0;
    while (!finished(state) && turns < 2000) {
      const seat = state.turn;
      const action = oneCardBot(state, seat, random);
      assert.equal(actOneCard(state, seat, action), null, JSON.stringify(action));
      assert.equal([...state.deck, ...state.discard, ...state.hands.flat()].length, 54);
      turns++;
    }
    if (state.winner !== null) { wins++; assert.equal(state.hands[state.winner].length, 0); }
  }
  assert.ok(wins >= 35, `wins ${wins}`);
});
