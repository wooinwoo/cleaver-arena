import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoup, actCoup, coupView, coupBlockRoles, COUP_CLAIM, reactors, type CoupState, type CoupRole } from '../shared/coup.ts';
import type { Action } from '../shared/tabletop-types.ts';

function withInfluence(seats: number, roles: CoupRole[][]): CoupState {
  const state = createCoup(seats);
  state.players.forEach((player, seat) => {
    player.influence.forEach((influence, index) => { influence.card.role = roles[seat][index] ?? influence.card.role; });
  });
  return state;
}
const pass: Action = { type: 'pass' };
const accept: Action = { type: 'accept' };

test('coup deals two hidden influences, keeps roles private per seat, hides pending and deck', () => {
  const state = withInfluence(3, [['duke', 'contessa'], ['captain', 'captain'], ['assassin', 'ambassador']]);
  assert.equal(state.deck.length, 15 - 6);
  for (const player of state.players) {
    assert.equal(player.coins, 2);
    assert.equal(player.influence.filter(i => !i.revealed).length, 2);
  }
  for (let seat = 0; seat < 3; seat++) {
    const view = coupView(state, seat);
    assert.ok(!('deck' in view));
    assert.equal(typeof view.deckCount, 'number');
    for (let other = 0; other < 3; other++) {
      for (const card of view.players[other].influence) {
        assert.equal(card.role === null, other !== seat);
      }
    }
  }
});

function assertCardIds(state: CoupState) {
  const cards = [...state.deck, ...state.players.flatMap(player => player.influence.map(influence => influence.card)), ...(state.stage.kind === 'exchange' ? state.stage.drawn : [])];
  assert.equal(cards.length, 15);
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
  for (const card of cards) assert.match(card.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

test('coup assigns unique UUIDs across initial hands, decks and games', () => {
  const ids = new Set<string>();
  for (const seats of [2, 3, 4, 5, 6]) {
    const state = createCoup(seats);
    assertCardIds(state);
    assert.ok(!('nextId' in state));
    for (const card of [...state.deck, ...state.players.flatMap(player => player.influence.map(influence => influence.card))]) {
      assert.ok(!ids.has(card.id));
      ids.add(card.id);
    }
  }
});

for (const redraw of [false, true]) {
  test(`truthful challenge refreshes returned and drawn UUIDs, redraw=${redraw}`, t => {
    const state = withInfluence(2, [['duke', 'contessa'], ['captain', 'assassin']]);
    const returned = state.players[0].influence[0].card;
    const oldId = returned.id;
    const deckIds = state.deck.map(card => card.id);
    const otherInfluence = structuredClone(state.players[0].influence[1]);
    const opponent = structuredClone(state.players[1]);
    const roles = [...state.deck, ...state.players[0].influence.map(influence => influence.card)].map(card => card.role).sort();
    t.mock.method(Math, 'random', () => redraw ? 0.999 : 0);
    assert.equal(actCoup(state, 0, { type: 'act', kind: 'tax' }), null);
    assert.equal(actCoup(state, 1, { type: 'challenge' }), null);
    const drawn = state.players[0].influence[0].card;
    assert.notEqual(returned.id, oldId);
    assert.notEqual(drawn.id, oldId);
    assert.ok(!deckIds.includes(drawn.id));
    assert.equal(drawn === returned, redraw);
    assert.equal(state.deck.includes(returned), !redraw);
    assert.ok(!state.deck.some(card => card.id === oldId));
    assert.deepEqual(state.players[0].influence[1], otherInfluence);
    assert.deepEqual(state.players[1], opponent);
    assert.deepEqual([...state.deck, ...state.players[0].influence.map(influence => influence.card)].map(card => card.role).sort(), roles);
    assertCardIds(state);
    assert.equal(state.stage.kind, 'reveal');
    assert.equal(actCoup(state, 1, { type: 'reveal', index: 0 }), null);
    assert.equal(state.players[0].coins, 5);
    assert.equal(state.turn, 1);
  });
}

test('income is instant; ten coins force a coup; coup pays 7 and forces a reveal', () => {
  const state = withInfluence(2, [['duke', 'duke'], ['contessa', 'captain']]);
  state.players[0].coins = 10;
  assert.equal(actCoup(state, 0, { type: 'act', kind: 'tax' }), '코인이 10개 이상이면 쿠를 해야 해요.');
  assert.equal(actCoup(state, 1, { type: 'act', kind: 'income' }), '내 차례가 아니에요.');
  assert.equal(actCoup(state, 0, { type: 'act', kind: 'coup', target: 1 }), null);
  assert.equal(state.players[0].coins, 3);
  assert.equal(String(state.stage.kind), 'reveal');
  if (state.stage.kind === 'reveal') {
    assert.equal(state.stage.seat, 1);
    assert.equal(actCoup(state, 0, { type: 'reveal', index: 0 }), '공개할 사람이 아니에요.');
    assert.equal(actCoup(state, 1, { type: 'reveal', index: 1 }), null);
    assert.equal(state.players[1].influence[1].revealed, true);
    assert.equal(state.turn, 1);
    assert.equal(String(state.stage.kind), 'action');
  }
});

test('foreign aid blocked by a lying duke falls to a challenge and still resolves', () => {
  const state = withInfluence(3, [['captain', 'contessa'], ['assassin', 'captain'], ['duke', 'duke']]);
  assert.equal(actCoup(state, 0, { type: 'act', kind: 'aid' }), null);
  assert.equal(String(state.stage.kind), 'react');
  assert.equal(actCoup(state, 2, { type: 'block', role: 'duke' }), '지금은 반응할 순서가 아니에요.');
  assert.equal(actCoup(state, 1, { type: 'block', role: 'contessa' }), '이 행동을 저지할 수 있는 역할이 아니에요.');
  assert.equal(actCoup(state, 1, { type: 'block', role: 'duke' }), null);
  assert.equal(String(state.stage.kind), 'blockReact');
  assert.equal(actCoup(state, 2, accept), null);
  assert.equal(actCoup(state, 0, { type: 'challenge' }), null);
  assert.equal(String(state.stage.kind), 'reveal');
  if (state.stage.kind === 'reveal') {
    assert.equal(state.stage.seat, 1);
    assert.equal(actCoup(state, 1, { type: 'reveal', index: 0 }), null);
    assert.equal(state.players[0].coins, 4);
    assert.equal(String(state.stage.kind), 'action');
    assert.equal(state.turn, 1);
  }
});

test('a truthful captain block survives a challenge and voids the steal', () => {
  const state = withInfluence(2, [['duke', 'assassin'], ['captain', 'contessa']]);
  assert.equal(actCoup(state, 0, { type: 'act', kind: 'steal', target: 1 }), null);
  assert.equal(actCoup(state, 1, { type: 'block', role: 'captain' }), null);
  assert.equal(actCoup(state, 0, { type: 'challenge' }), null);
  assert.equal(String(state.stage.kind), 'reveal');
  if (state.stage.kind === 'reveal') {
    assert.equal(state.stage.seat, 0);
    actCoup(state, 0, { type: 'reveal', index: 0 });
    assert.equal(state.players[0].coins, 2);
    assert.equal(state.players[1].coins, 2);
    assert.equal(state.turn, 1);
  }
});

test('assassination pays on resolve, refunds when contessa-blocked, and challenge on a lying assassin kills the actor', () => {
  const refund = withInfluence(2, [['assassin', 'duke'], ['contessa', 'captain']]);
  refund.players[0].coins = 5;
  assert.equal(actCoup(refund, 0, { type: 'act', kind: 'assassinate', target: 1 }), null);
  assert.equal(actCoup(refund, 1, { type: 'block', role: 'contessa' }), null);
  assert.equal(actCoup(refund, 0, accept), null);
  assert.equal(refund.players[0].coins, 5);
  assert.equal(refund.players[1].influence.every(i => !i.revealed), true);

  const kill = withInfluence(2, [['duke', 'duke'], ['contessa', 'captain']]);
  kill.players[0].coins = 5;
  assert.equal(actCoup(kill, 0, { type: 'act', kind: 'assassinate', target: 1 }), null);
  assert.equal(actCoup(kill, 1, { type: 'challenge' }), null);
  assert.equal(kill.stage.kind, 'reveal');
  if (kill.stage.kind === 'reveal') {
    assert.equal(kill.stage.seat, 0);
    actCoup(kill, 0, { type: 'reveal', index: 0 });
    assert.equal(kill.players[0].coins, 5);
    assert.equal(kill.players[1].influence.every(i => !i.revealed), true);
    assert.equal(kill.turn, 1);
  }

  const direct = withInfluence(2, [['assassin', 'duke'], ['contessa', 'captain']]);
  direct.players[0].coins = 3;
  assert.equal(actCoup(direct, 0, { type: 'act', kind: 'assassinate', target: 1 }), null);
  assert.equal(actCoup(direct, 1, pass), null);
  assert.equal(direct.players[0].coins, 0);
  assert.equal(direct.stage.kind, 'reveal');
});

test('ambassador exchange swaps exactly the live cards and hides options from others', () => {
  const state = withInfluence(3, [['ambassador', 'duke'], ['captain', 'captain'], ['duke', 'duke']]);
  const before = state.deck.length;
  assert.equal(actCoup(state, 0, { type: 'act', kind: 'exchange' }), null);
  assert.equal(String(state.stage.kind), 'react');
  assert.equal(actCoup(state, 1, pass), null);
  assert.equal(actCoup(state, 2, pass), null);
  assert.equal(String(state.stage.kind), 'exchange');
  const mine = coupView(state, 0);
  const other = coupView(state, 1);
  assert.ok(mine.stage.kind === 'exchange' && mine.stage.options && mine.stage.options.length === 4);
  assert.deepEqual(mine.stage.kind === 'exchange' ? mine.stage.options!.map(card => card.mine).sort() : [], [false, false, true, true]);
  assert.ok(other.stage.kind === 'exchange' && (other.stage as { options?: unknown }).options === undefined);
  const keep = mine.stage.kind === 'exchange' ? mine.stage.options!.map(card => card.id).slice(0, 2) : [];
  assert.equal(actCoup(state, 0, { type: 'keep', cards: keep }), null);
  assert.equal(state.players[0].influence.length, 2);
  assert.equal(state.deck.length, before);
  assert.equal(String(state.stage.kind), 'action');
  assert.equal(state.turn, 1);
  assert.equal(actCoup(state, 0, { type: 'act', kind: 'income' }), '내 차례가 아니에요.');
});

test('exchange refreshes every chosen and returned UUID after matching selections', () => {
  for (const selection of [[0, 1], [0, 2], [2, 3], [1]]) {
    const state = withInfluence(2, [['ambassador', 'duke'], ['captain', 'contessa']]);
    if (selection.length === 1) state.players[0].influence[1].revealed = true;
    const revealed = structuredClone(state.players[0].influence.filter(influence => influence.revealed));
    const opponent = structuredClone(state.players[1]);
    const deckBefore = structuredClone(state.deck);
    const drawnBefore = deckBefore.slice(-2);
    assert.equal(actCoup(state, 0, { type: 'act', kind: 'exchange' }), null);
    assert.equal(actCoup(state, 1, pass), null);
    assert.ok(state.stage.kind === 'exchange');
    assert.deepEqual(state.stage.drawn.map(card => card.role), drawnBefore.map(card => card.role).reverse());
    for (const card of state.stage.drawn) assert.ok(!deckBefore.some(old => old.id === card.id));
    assertCardIds(state);
    const view = coupView(state, 0);
    assert.ok(view.stage.kind === 'exchange' && view.stage.options);
    const options = view.stage.options;
    const chosen = selection.map(index => options[index]);
    const returned = options.filter(card => !chosen.includes(card));
    const beforeKeep = structuredClone(state);
    assert.notEqual(actCoup(state, 0, { type: 'keep', cards: [] }), null);
    assert.deepEqual(state, beforeKeep);
    assert.equal(actCoup(state, 0, { type: 'keep', cards: chosen.map(card => card.id) }), null);
    const hand = state.players[0].influence.filter(influence => !influence.revealed);
    assert.deepEqual(hand.map(influence => influence.card.role), chosen.map(card => card.role));
    const untouchedIds = new Set(deckBefore.slice(0, -2).map(card => card.id));
    assert.deepEqual(state.deck.filter(card => !untouchedIds.has(card.id)).map(card => card.role).sort(), returned.map(card => card.role).sort());
    for (const card of deckBefore.slice(0, -2)) assert.deepEqual(state.deck.find(current => current.id === card.id), card);
    for (const card of [...state.deck, ...hand.map(influence => influence.card)]) assert.ok(!options.some(option => option.id === card.id));
    assert.deepEqual(state.players[0].influence.filter(influence => influence.revealed), revealed);
    assert.deepEqual(state.players[1], opponent);
    assert.equal(state.deck.length, deckBefore.length);
    assert.equal(state.turn, 1);
    assertCardIds(state);
  }
});

test('random coup games always end with a single winner and consistent coins', () => {
  for (const seats of [2, 3, 4, 5, 6]) {
    for (let round = 0; round < 40; round++) {
      const state = createCoup(seats);
      let steps = 0;
      while (state.winner === null && !state.draw && steps++ < 2000) {
        const stage = state.stage;
        let action: Action;
        if (stage.kind === 'action') {
          const me = state.players[state.turn];
          const targets = state.players.map((_, seat) => seat).filter(seat => seat !== state.turn && state.players[seat].influence.some(i => !i.revealed));
          if (me.coins >= 10) action = { type: 'act', kind: 'coup', target: targets[0] };
          else if (me.coins >= 7 && Math.random() < 0.8) action = { type: 'act', kind: 'coup', target: targets[Math.floor(Math.random() * targets.length)] };
          else {
            const pool: Action[] = [
              { type: 'act', kind: 'income' },
              { type: 'act', kind: 'aid' },
              { type: 'act', kind: 'tax' },
              { type: 'act', kind: 'exchange' },
            ];
            if (me.coins >= 3 && targets.length) pool.push({ type: 'act', kind: 'assassinate', target: targets[0] }, { type: 'act', kind: 'steal', target: targets[0] });
            action = pool[Math.floor(Math.random() * pool.length)];
          }
        } else if (stage.kind === 'react' || stage.kind === 'blockReact') {
          const roll = Math.random();
          const claim = stage.kind === 'react' ? COUP_CLAIM[stage.action.kind] : 'role' in stage;
          if (stage.kind === 'react' && roll < 0.15 && claim) action = { type: 'challenge' };
          else if (stage.kind === 'react' && roll < 0.4) {
            const roles = coupBlockRoles(stage.action.kind);
            action = roles.length ? { type: 'block', role: roles[Math.floor(Math.random() * roles.length)] } : pass;
          } else if (stage.kind === 'blockReact' && roll < 0.3) action = { type: 'challenge' };
          else action = stage.kind === 'react' ? pass : accept;
        } else if (stage.kind === 'reveal') {
          const hidden = state.players[stage.seat].influence.map((i, index) => i.revealed ? -1 : index).filter(i => i >= 0);
          action = { type: 'reveal', index: hidden[Math.floor(Math.random() * hidden.length)] };
        } else {
          const aliveCount = state.players[stage.seat].influence.filter(i => !i.revealed).length;
          const view = coupView(state, stage.seat);
          const options = view.stage.kind === 'exchange' ? view.stage.options ?? [] : [];
          action = { type: 'keep', cards: options.map(card => card.id).slice(0, aliveCount) };
        }
        const problem = actCoup(state, expectActor(state), action);
        if (problem !== null) { assert.fail(`seats=${seats} step=${steps} ${JSON.stringify(action)} -> ${problem} @ ${state.log.slice(-160)}`); }
        for (const player of state.players) assert.ok(player.coins >= 0 && player.coins <= 60);
        if (steps % 7 === 0 && state.winner === null) {
          for (let seat = 0; seat < seats; seat++) {
            const view = coupView(state, seat);
            view.players.forEach((player, owner) => player.influence.forEach(card => {
              if (owner !== seat && !card.revealed) assert.equal(card.role, null);
            }));
          }
        }
      }
      assert.ok(state.winner !== null && state.winner >= 0 && state.winner < seats, `seats=${seats}: ${state.log.slice(-160)}`);
      // 종료 후에는 모든 역할이 공개된다.
      for (let seat = 0; seat < seats; seat++) {
        const view = coupView(state, seat);
        view.players.forEach(player => player.influence.forEach(card => {
          assert.ok(card.role !== null);
        }));
      }
    }
  }
});

function expectActor(state: CoupState): number {
  const stage = state.stage;
  if (stage.kind === 'action') return state.turn;
  if (stage.kind === 'react') return reactors(state, stage.action.actor)[stage.step]!;
  if (stage.kind === 'blockReact') return reactors(state, stage.blocker)[stage.step]!;
  return stage.seat;
}
