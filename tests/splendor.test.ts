import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSplendor, actSplendor, splendorView, type SplendorState } from '../shared/splendor.ts';
import { SPLENDOR_CARDS, SPLENDOR_NOBLES, splendorPayment, splendorScore } from '../shared/splendor-data.ts';
import type { Action } from '../shared/tabletop-types.ts';
import { chooseSplendorAction } from './splendor-helpers.ts';

function reject(state: SplendorState, action: Action, seat = state.turn) {
  const before = structuredClone(state);
  assert.equal(typeof actSplendor(state, seat, action), 'string');
  assert.deepEqual(state, before);
}
function play(state: SplendorState, action: Action) { assert.equal(actSplendor(state, state.turn, action), null, JSON.stringify(action)); }
function putCard(state: SplendorState, id: number) {
  for (const deck of state.decks) { const at = deck.indexOf(id); if (at >= 0) deck.splice(at, 1); }
  for (const row of state.market) { const at = row.indexOf(id); if (at >= 0) row[at] = null; }
  const card = SPLENDOR_CARDS[id], previous = state.market[card.tier][0];
  if (previous !== null) state.decks[card.tier].push(previous);
  state.market[card.tier][0] = id;
}
function giveTokens(state: SplendorState, seat: number, tokens: number[]) {
  tokens.forEach((count, color) => { state.bank[color] -= count - state.players[seat].tokens[color]; });
  state.players[seat].tokens = [...tokens];
}
function invariant(state: SplendorState, seats: number) {
  for (let color = 0; color < 6; color++) {
    const counts = [state.bank[color], ...state.players.map(player => player.tokens[color])];
    assert.ok(counts.every(n => Number.isInteger(n) && n >= 0));
    assert.equal(counts.reduce((sum, n) => sum + n, 0), color === 5 ? 5 : seats === 2 ? 4 : seats === 3 ? 5 : 7);
  }
  const cards = [...state.decks.flat(), ...state.market.flat().filter(id => id !== null), ...state.players.flatMap(p => [...p.cards, ...p.reserved])];
  assert.equal(cards.length, 90); assert.equal(new Set(cards).size, 90);
  const nobles = [...state.nobles, ...state.players.flatMap(p => p.nobles)];
  assert.equal(nobles.length, seats + 1); assert.equal(new Set(nobles).size, seats + 1);
  for (const [seat, player] of state.players.entries()) {
    assert.ok(player.reserved.length <= 3);
    assert.ok(player.tokens.reduce((sum, n) => sum + n, 0) <= (state.stage === 'return' && seat === state.turn ? 13 : 10));
  }
}

test('splendor has the complete base set and correct supplies for 2, 3 and 4 players', () => {
  assert.equal(SPLENDOR_CARDS.length, 90); assert.equal(SPLENDOR_NOBLES.length, 10);
  assert.deepEqual([0, 1, 2].map(tier => SPLENDOR_CARDS.filter(c => c.tier === tier).length), [40, 30, 20]);
  for (const tier of [0, 1, 2]) for (const color of [0, 1, 2, 3, 4]) assert.equal(SPLENDOR_CARDS.filter(c => c.tier === tier && c.bonus === color).length, [8, 6, 4][tier]);
  for (const seats of [2, 3, 4]) {
    const state = createSplendor(seats); invariant(state, seats);
    assert.deepEqual(state.decks.map(deck => deck.length), [36, 26, 16]);
    assert.deepEqual(state.market.map(row => row.length), [4, 4, 4]);
    assert.equal(state.turn, 0); assert.equal(state.finalRound, false);
  }
  for (const seats of [0, 1, 5, 2.5, NaN]) assert.throws(() => createSplendor(seats));
});

test('splendor validates token taking, stock thresholds, scarce colors and rejected actions atomically', () => {
  const state = createSplendor(2);
  for (const gems of [[], [1, 1], [0, 0, 0, 0, 0], [1, 1, 0, 0, 0], [1, 1, 1, 1, 0], [2, 1, 0, 0, 0], [3, 0, 0, 0, 0], [-1, 1, 1, 1, 1], [NaN, 1, 1, 0, 0], [0.5, 1, 1, 0, 0], [1, 1, 1, 0, 0, 1], Array(5)]) reject(state, { type: 'take', gems });
  for (const seat of [1, -1, 2, NaN]) reject(state, { type: 'take', gems: [1, 1, 1, 0, 0] }, seat);
  reject(state, { type: 'pass' });
  play(state, { type: 'take', gems: [2, 0, 0, 0, 0] });
  assert.equal(state.bank[0], 2); reject(state, { type: 'take', gems: [2, 0, 0, 0, 0] });
  state.bank = [0, 1, 2, 0, 0, 5];
  reject(state, { type: 'take', gems: [0, 1, 0, 0, 0] });
  play(state, { type: 'take', gems: [0, 1, 1, 0, 0] });
  play(state, { type: 'take', gems: [0, 0, 1, 0, 0] });
  reject(state, { type: 'take', gems: [0, 0, 1, 0, 0] });
});

test('splendor hides every opponent reservation and deck order, enforces three cards, and handles empty piles', () => {
  const state = createSplendor(3);
  const hidden = state.decks[2].at(-1)!;
  play(state, { type: 'reserve', tier: 2 });
  assert.equal(state.players[0].reserved[0], hidden); assert.equal(state.players[0].tokens[5], 1);
  for (const seat of [0, 1, 2, -1, NaN]) {
    const view = splendorView(state, seat);
    assert.equal('decks' in view, false);
    assert.deepEqual(view.remaining, [36, 26, 15]);
    assert.deepEqual(view.players[0].reserved, seat === 0 ? [hidden] : [null]);
    assert.equal('card' in view.last!, false);
  }
  reject(state, { type: 'buy', card: hidden });
  for (let i = 0; i < 2; i++) { state.turn = 0; play(state, { type: 'reserve', card: state.market[0][0] }); }
  state.turn = 0; reject(state, { type: 'reserve', tier: 0 });
  state.turn = 1; state.bank[5] = 0;
  play(state, { type: 'reserve', card: state.market[1][0] }); assert.equal(state.players[1].tokens[5], 0);
  state.decks[0] = []; const last = state.market[0][0];
  play(state, { type: 'reserve', card: last }); assert.equal(state.market[0][0], null);
  reject(state, { type: 'reserve', tier: 0 });
  reject(state, { type: 'reserve', tier: 1, card: state.market[1][0] });
});

test('splendor purchases use permanent discounts, exact payments, optional gold substitution and reserved cards', () => {
  const state = createSplendor(4);
  putCard(state, 0); // Onyx: one diamond, sapphire, emerald and ruby.
  giveTokens(state, 0, [1, 1, 1, 1, 0, 1]);
  reject(state, { type: 'buy', card: 0, payment: [1, 1, 1, 1, 0, 1] });
  reject(state, { type: 'buy', card: 0, payment: [0, 0, 0, 0, 0, 0] });
  play(state, { type: 'buy', card: 0, payment: [0, 1, 1, 1, 0, 1] });
  assert.deepEqual(state.players[0].tokens, [1, 0, 0, 0, 0, 0]);
  assert.equal(state.bank[5], 5); assert.deepEqual(state.players[0].cards, [0]);
  invariant(state, 4);
  putCard(state, 12); // Sapphire costs two onyx and one diamond.
  state.turn = 0; play(state, { type: 'reserve', card: 12 });
  state.turn = 0;
  assert.deepEqual(splendorPayment(state.players[0], 12), [1, 0, 0, 0, 0, 1]);
  play(state, { type: 'buy', card: 12 });
  assert.deepEqual(state.players[0].reserved, []);
  assert.deepEqual(state.players[0].cards, [0, 12]); invariant(state, 4);
  const free = createSplendor(2);
  free.players[0].cards = [8, 9, 10]; // Three sapphire discounts.
  putCard(free, 22); // Three sapphire cost.
  play(free, { type: 'buy', card: 22 });
  assert.equal(free.players[0].tokens.reduce((sum, n) => sum + n), 0);
});

test('splendor waits for exact excess returns including gold before allowing the next action', () => {
  const state = createSplendor(4);
  giveTokens(state, 0, [2, 2, 2, 2, 2, 0]);
  play(state, { type: 'take', gems: [1, 1, 1, 0, 0] });
  assert.equal(state.stage, 'return'); assert.equal(state.turn, 0);
  reject(state, { type: 'reserve', tier: 0 });
  reject(state, { type: 'return', gems: [1, 1, 0, 0, 0, 0] });
  reject(state, { type: 'return', gems: [0, 0, 0, 0, 0, 3] });
  play(state, { type: 'return', gems: [1, 1, 1, 0, 0, 0] });
  assert.equal(state.turn, 1); assert.equal(state.stage, 'action'); invariant(state, 4);
  state.turn = 0; play(state, { type: 'reserve', tier: 1 });
  assert.equal(state.stage, 'return');
  play(state, { type: 'return', gems: [0, 0, 0, 0, 0, 1] });
  assert.equal(state.players[0].tokens[5], 0); invariant(state, 4);
});

test('splendor visits at most one noble per turn and waits for the player to choose among eligible nobles', () => {
  const state = createSplendor(2);
  state.nobles = [0, 1, 2];
  state.players[0].cards = [16, 17, 18, 19, 8, 9, 10, 11, 24, 25, 26, 27];
  play(state, { type: 'take', gems: [1, 1, 1, 0, 0] });
  assert.equal(state.stage, 'noble'); assert.equal(state.turn, 0);
  reject(state, { type: 'take', gems: [1, 1, 1, 0, 0] }); reject(state, { type: 'noble', noble: 2 });
  play(state, { type: 'noble', noble: 1 });
  assert.equal(state.turn, 1); assert.deepEqual(state.players[0].nobles, [1]); assert.equal(splendorScore(state.players[0]), 3);
  state.turn = 0; play(state, { type: 'take', gems: [1, 1, 1, 0, 0] });
  assert.deepEqual(state.players[0].nobles, [1, 0]); assert.equal(state.turn, 1);
});

test('splendor allows only forced passes, resumes after a purchase, and draws if nobody can act', () => {
  const state = createSplendor(2);
  state.market = [[9, 19, 39, 20], [60, 48, 56, 66], [72, 74, 82, 75]];
  const reserves = [83, 89, 71, 76, 86, 77];
  state.decks = [0, 1, 2].map(tier => SPLENDOR_CARDS.filter(card => card.tier === tier && !state.market.flat().includes(card.id) && !reserves.includes(card.id)).map(card => card.id));
  state.decks[2].push(...[...reserves].reverse());
  for (let i = 0; i < 6; i++) play(state, { type: 'reserve', tier: 2 });
  const moves: [string, number[]][] = [
    ['take', [0, 1, 1, 0, 1]], ['take', [0, 1, 1, 1, 0]], ['take', [0, 1, 1, 0, 1]], ['take', [1, 0, 1, 1, 0]],
    ['take', [1, 1, 0, 0, 1]], ['return', [0, 0, 0, 0, 0, 2]], ['take', [1, 0, 0, 1, 1]], ['return', [0, 0, 0, 0, 0, 1]],
    ['take', [1, 0, 0, 1, 0]], ['return', [0, 1, 0, 0, 0, 1]], ['take', [0, 1, 0, 0, 0]], ['return', [0, 0, 0, 0, 0, 1]],
  ];
  for (const [type, gems] of moves) { play(state, { type, gems }); invariant(state, 2); }
  assert.deepEqual(state.bank, [0, 0, 0, 0, 0, 5]); assert.equal(state.turn, 0);
  play(state, { type: 'pass' }); assert.equal(state.turn, 1); assert.equal(state.passes, 1);
  reject(state, { type: 'pass' });
  play(state, { type: 'buy', card: 20 }); assert.equal(state.passes, 0); assert.equal(state.draw, false);
  invariant(state, 2);
  const blocked = createSplendor(2);
  blocked.market = [[6, 14, 22, 30], [40, 43, 46, 49], [72, 74, 82, 75]];
  blocked.players[0].reserved = reserves.slice(0, 3); blocked.players[1].reserved = reserves.slice(3);
  blocked.decks = [0, 1, 2].map(tier => SPLENDOR_CARDS.filter(card => card.tier === tier && !blocked.market.flat().includes(card.id) && !reserves.includes(card.id)).map(card => card.id));
  for (let seat = 0; seat < 2; seat++) giveTokens(blocked, seat, [2, 2, 2, 2, 2, 0]);
  invariant(blocked, 2);
  play(blocked, { type: 'pass' }); assert.equal(blocked.draw, false);
  play(blocked, { type: 'pass' }); assert.equal(blocked.draw, true); assert.deepEqual(blocked.winners, []);
  reject(blocked, { type: 'pass' });
});

test('splendor completes the round, breaks ties by purchased cards, shares exact ties and blocks further play', () => {
  for (const trigger of [0, 1, 2, 3]) {
    const state = createSplendor(4); state.nobles = [];
    state.players[trigger].cards = [73, 77, 81]; // Three five-point cards.
    state.turn = trigger;
    for (let seat = trigger; seat < 4; seat++) {
      play(state, { type: 'reserve', tier: 0 });
      assert.equal(state.finalRound, true); assert.equal(state.winner, seat === 3 ? trigger : null);
    }
    reject(state, { type: 'reserve', tier: 0 });
  }
  const tie = createSplendor(4); tie.nobles = [];
  tie.players[0].cards = [73, 77, 81];
  tie.players[1].cards = [73, 77, 81, 0];
  tie.players[2].cards = [73, 77, 81];
  for (let i = 0; i < 4; i++) play(tie, { type: 'reserve', tier: 0 });
  assert.equal(tie.draw, true); assert.equal(tie.winner, null); assert.deepEqual(tie.winners, [0, 2]);
  const overtake = createSplendor(2); overtake.nobles = [];
  overtake.players[0].cards = [73, 77, 81]; overtake.players[1].cards = [73, 77, 81, 7];
  play(overtake, { type: 'reserve', tier: 0 }); play(overtake, { type: 'reserve', tier: 0 });
  assert.equal(overtake.winner, 1);
});

test('splendor finishes full 2–4 player matches with conserved gems, cards, privacy and serialized phase state', () => {
  let turns = 0;
  for (const seats of [2, 3, 4]) for (let run = 0; run < 6; run++) {
    let state = createSplendor(seats), actions = 0;
    // Deterministic layouts keep failures reproducible while exercising eighteen different games.
    let seed = seats * 100 + run;
    state.decks = [0, 1, 2].map(tier => {
      const deck = SPLENDOR_CARDS.filter(card => card.tier === tier).map(card => card.id);
      for (let i = deck.length - 1; i > 0; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = seed % (i + 1); [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      return deck;
    });
    state.market = state.decks.map(deck => deck.splice(0, 4));
    state.nobles = Array.from({ length: seats + 1 }, (_, i) => (run + i) % 10);
    while (state.winner === null && !state.draw) {
      assert.ok(actions++ < 1200, `Game ${seats}/${run} stalled`);
      const view = splendorView(state, state.turn);
      view.players.forEach((p, seat) => { if (seat !== state.turn) assert.ok(p.reserved.every(id => id === null)); });
      const action = chooseSplendorAction(view);
      state = JSON.parse(JSON.stringify(state)); play(state, action); invariant(state, seats); turns++;
    }
    assert.ok(state.winners.length >= 1);
    assert.ok(Math.max(...state.players.map(splendorScore)) >= 15);
    assert.equal(state.turn, seats - 1);
    reject(state, { type: 'take', gems: [1, 1, 1, 0, 0] });
  }
  console.log(`Splendor: 18 full matches, ${turns} accepted actions with conservation checks.`);
});
