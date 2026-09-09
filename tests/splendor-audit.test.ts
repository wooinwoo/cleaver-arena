import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actSplendor, createSplendor, splendorView } from '../shared/splendor.ts';
import { SPLENDOR_CARDS, splendorTakeError } from '../shared/splendor-data.ts';
import type { Action } from '../shared/tabletop-types.ts';

test('splendor token choices match an independent oracle at every stock boundary', () => {
  const digits = (n: number, radix: number) => Array.from({ length: 5 }, () => { const digit = n % radix; n = Math.floor(n / radix); return digit; });
  const picks = Array.from({ length: 243 }, (_, n) => digits(n, 3));
  // Stocks 0, 1, 2, 3 and 4 cover absence, scarcity and the exact double-take threshold.
  for (let b = 0; b < 3125; b++) {
    const bank = digits(b, 5);
    for (const gems of picks) {
      const count = gems.reduce((sum, n) => sum + n, 0), occupied = gems.filter(Boolean).length;
      const expected = gems.every((n, color) => n <= bank[color]) && (
        (occupied === 1 && count === 2 && bank[gems.indexOf(2)] >= 4) ||
        (gems.every(n => n <= 1) && count > 0 && count === Math.min(3, bank.filter(Boolean).length)));
      assert.equal(splendorTakeError(bank, gems) === null, expected, JSON.stringify({ bank, gems }));
    }
  }
  console.log('Splendor: 759375 token combinations match the independent rule oracle.');
});

test('splendor hidden deck order and opponent reservation contents cannot affect a public view', () => {
  for (const seats of [2, 3, 4]) {
    const state = createSplendor(seats);
    for (let seat = 0; seat < seats; seat++) assert.equal(actSplendor(state, seat, { type: 'reserve', tier: 2 }), null);
    for (let viewer = 0; viewer < seats; viewer++) {
      const altered = structuredClone(state);
      altered.decks.forEach(deck => deck.reverse());
      for (let owner = 0; owner < seats; owner++) if (owner !== viewer) {
        const old = altered.players[owner].reserved[0];
        altered.players[owner].reserved[0] = altered.decks[2].pop()!; altered.decks[2].push(old);
      }
      assert.deepEqual(splendorView(altered, viewer), splendorView(state, viewer));
    }
  }
});

test('splendor buys all ninety card costs with zero, one and three discounts per color', () => {
  let purchases = 0, substitutions = 0;
  for (const card of SPLENDOR_CARDS) for (const discount of [0, 1, 3]) {
    const state = createSplendor(4); state.nobles = [];
    const player = state.players[0];
    player.cards = [0, 1, 2, 3, 4].flatMap(color => SPLENDOR_CARDS
      .filter(other => other.id !== card.id && other.tier === 0 && other.points === 0 && other.bonus === color)
      .slice(0, discount).map(other => other.id));
    player.reserved = [card.id];
    const owned = new Set([...player.cards, card.id]);
    state.decks = state.decks.map(deck => deck.filter(id => !owned.has(id)));
    state.market = state.market.map((row, tier) => row.map(id => id !== null && owned.has(id) ? state.decks[tier].pop() ?? null : id));
    const cost = card.cost.map(n => Math.max(0, n - discount)), total = cost.reduce((sum, n) => sum + n, 0);
    player.tokens = [...cost, total < 10 ? 1 : 0];
    // Costs above ten are impossible without further discounts; keep the player's pool legal.
    let excess = Math.max(0, total - 10);
    for (let color = 0; color < 5; color++) { const remove = Math.min(excess, player.tokens[color]); player.tokens[color] -= remove; excess -= remove; }
    state.bank = state.bank.map((count, color) => count - player.tokens[color]);
    const normal = structuredClone(state), result = actSplendor(normal, 0, { type: 'buy', card: card.id });
    if (total > 10) { assert.equal(typeof result, 'string'); assert.deepEqual(normal, state); continue; }
    assert.equal(result, null); assert.deepEqual(normal.players[0].tokens, [0, 0, 0, 0, 0, player.tokens[5]]);
    assert.equal(normal.players[0].cards.at(-1), card.id); assert.deepEqual(normal.players[0].reserved, []); purchases++;
    const color = cost.findIndex(n => n > 0);
    if (color >= 0 && player.tokens[5] > 0) {
      const alternate = structuredClone(state), payment = [...cost, 1]; payment[color]--;
      assert.equal(actSplendor(alternate, 0, { type: 'buy', card: card.id, payment }), null);
      assert.equal(alternate.players[0].tokens[color], 1); assert.equal(alternate.players[0].tokens[5], 0); substitutions++;
    }
    const overpaid = structuredClone(state);
    assert.equal(typeof actSplendor(overpaid, 0, { type: 'buy', card: card.id, payment: [...cost, 1] }), 'string');
    assert.deepEqual(overpaid, state);
  }
  console.log(`Splendor: ${purchases} exact purchases and ${substitutions} voluntary gold substitutions across all ninety cards.`);
});

test('splendor malformed action fields leave every decision stage unchanged', () => {
  const invalid = [null, true, false, '0', {}, [], [1], -1, 0.1, NaN, Infinity];
  for (const stage of ['action', 'return', 'noble'] as const) {
    for (const type of ['take', 'return', 'noble', 'reserve', 'buy', 'pass']) for (const value of invalid) {
      const state = createSplendor(2); state.stage = stage;
      if (stage === 'return') { state.players[0].tokens = [3, 3, 3, 2, 0, 0]; state.bank = [1, 1, 1, 2, 4, 5]; }
      const before = structuredClone(state);
      const action: Action = { type, gems: value, card: value, tier: value, payment: value, noble: value };
      assert.equal(typeof actSplendor(state, 0, action), 'string'); assert.deepEqual(state, before);
    }
  }
});
