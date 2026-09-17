import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDavinci, actDavinci, davinciView, type DaVinciState } from '../shared/davinci.ts';
import type { Action } from '../shared/tabletop-types.ts';

function fresh(seats = 2): DaVinciState {
  const state = createDavinci(seats);
  assert.equal(state.hands.length, seats);
  assert.equal(state.hands[0].length, seats === 2 ? 4 : 3);
  assert.equal(state.deck.length, 24 - seats * (seats === 2 ? 4 : 3));
  return state;
}

function botAction(state: DaVinciState): Action {
  if (state.stage === 'draw') return { type: 'draw' };
  // 정답을 아는 봇이 아니라 공개 정보만으로 추측한다: 실패하지 않은 가장 작은 숫자.
  for (let target = 0; target < state.hands.length; target++) {
    if (target === state.turn) continue;
    const tile = state.hands[target].findIndex(candidate => !candidate.revealed);
    if (tile < 0) continue;
    const num = Array.from({ length: 12 }, (_, n) => n).find(n => !state.hands[target][tile].failed.includes(n))!;
    return { type: 'guess', target, tile, num };
  }
  return { type: 'stop' };
}

test('davinci assigns unique UUIDs across decks, hands and games and preserves drawn identity', () => {
  const ids = new Set<string>();
  for (const seats of [2, 3, 4]) {
    const state = fresh(seats);
    const tiles = [...state.deck, ...state.hands.flat()];
    assert.equal(tiles.length, 24);
    for (const tile of tiles) {
      assert.match(tile.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.ok(!ids.has(tile.id));
      ids.add(tile.id);
    }
    const drawn = structuredClone(state.deck[state.deck.length - 1]);
    assert.equal(actDavinci(state, 0, { type: 'draw' }), null);
    assert.equal(state.drawnId, drawn.id);
    assert.deepEqual(state.hands[0].find(tile => tile.id === drawn.id), drawn);
    assert.equal(new Set([...state.deck, ...state.hands.flat()].map(tile => tile.id)).size, 24);
    assert.equal(davinciView(state, 0).drawnId, drawn.id);
    assert.equal(davinciView(state, 1).drawnId, null);
  }
});

test('davinci deals sorted hands and hides numbers, order and drawn tile', () => {
  const state = fresh(3);
  for (const hand of state.hands) {
    const keys = hand.map(tile => tile.num * 2 + (tile.color === 'B' ? 0 : 1));
    assert.deepEqual([...keys].sort((a, b) => a - b), keys);
  }
  assert.equal(actDavinci(state, 0, { type: 'draw' }), null);
  assert.equal(state.stage, 'guess');
  for (let seat = 0; seat < 3; seat++) {
    const view = davinciView(state, seat);
    assert.equal(view.deckCount, state.deck.length);
    assert.ok(!('deck' in view));
    for (let owner = 0; owner < 3; owner++) {
      for (const tile of view.hands[owner]) {
        assert.equal(tile.num === null, owner !== seat && !tile.revealed);
        if (owner !== seat) assert.ok(tile.color === 'B' || tile.color === 'W');
      }
    }
    assert.equal(view.drawnId, state.turn === seat ? state.drawnId : null);
  }
  assert.equal(JSON.stringify(state.deck).includes('"revealed":true'), false);
});

test('davinci wrong guess reveals drawn tile and passes the turn; errors keep state', () => {
  const state = fresh();
  const prior = JSON.stringify(state);
  assert.equal(actDavinci(state, 1, { type: 'draw' }), '자신의 차례가 아니에요.');
  assert.equal(actDavinci(state, 0, { type: 'guess', target: 1, tile: 0, num: 0 }), '먼저 타일을 뽑아 주세요.');
  assert.equal(actDavinci(state, 0, { type: 'stop' }), '그만둘 수 있는 차례가 아니에요.');
  assert.equal(JSON.stringify(state), prior);
  assert.equal(actDavinci(state, 0, { type: 'draw' }), null);
  const drawn = state.drawnId!;
  const target = state.hands[1].find(tile => !tile.revealed)!;
  const wrong = target.num === 0 ? 1 : 0;
  const before = JSON.stringify(state);
  assert.equal(actDavinci(state, 0, { type: 'guess', target: 1, tile: state.hands[1].indexOf(target), num: 12 }), '0부터 11까지 숫자를 골라 주세요.');
  assert.equal(JSON.stringify(state), before);
  assert.equal(actDavinci(state, 0, { type: 'guess', target: 1, tile: state.hands[1].indexOf(target), num: wrong }), null);
  assert.deepEqual(target.failed, [wrong]);
  assert.equal(state.hands[0].find(tile => tile.id === drawn)!.revealed, true);
  assert.equal(state.turn, 1);
  assert.equal(state.stage, 'draw');
  assert.equal(actDavinci(state, 1, { type: 'stop' }), '그만둘 수 있는 차례가 아니에요.');
});

test('davinci correct guesses chain and stop needs a hit; repeat numbers rejected', () => {
  const state = fresh();
  assert.equal(actDavinci(state, 0, { type: 'draw' }), null);
  const tile = state.hands[1].find(candidate => !candidate.revealed)!;
  const index = state.hands[1].indexOf(tile);
  assert.equal(actDavinci(state, 0, { type: 'guess', target: 1, tile: index, num: tile.num }), null);
  assert.equal(tile.revealed, true);
  assert.equal(state.turn, 0);
  assert.equal(actDavinci(state, 0, { type: 'guess', target: 1, tile: index, num: tile.num }), '아직 공개되지 않은 상대 타일을 골라 주세요.');
  const other = state.hands[1].find(candidate => !candidate.revealed)!;
  const otherIndex = state.hands[1].indexOf(other);
  const miss = other.num === 0 ? 1 : 0;
  assert.equal(actDavinci(state, 0, { type: 'guess', target: 0, tile: 0, num: 0 }), '상대 타일을 골라 주세요.');
  assert.equal(actDavinci(state, 0, { type: 'guess', target: 1, tile: otherIndex, num: miss }), null);
  // 실패했으므로 방금 뽑은 타일이 공개되고 차례가 넘어간다.
  assert.equal(state.turn, 1);
  const rival = fresh();
  assert.equal(actDavinci(rival, 0, { type: 'draw' }), null);
  assert.equal(actDavinci(rival, 0, { type: 'stop' }), '한 번 이상 맞힌 뒤에 그만둘 수 있어요.');
  const first = rival.hands[1].find(candidate => !candidate.revealed)!;
  assert.equal(actDavinci(rival, 0, { type: 'guess', target: 1, tile: rival.hands[1].indexOf(first), num: first.num }), null);
  assert.equal(actDavinci(rival, 0, { type: 'stop' }), null);
  assert.equal(rival.turn, 1);
});

test('davinci full games always eliminate down to one winner', () => {
  for (const seats of [2, 3, 4]) {
    for (let round = 0; round < 5; round++) {
      const state = createDavinci(seats);
      let steps = 0;
      while (state.winner === null && !state.draw && steps++ < 500) {
        const action = state.stage === 'guess' && state.guessed && Math.random() < 0.5 ? { type: 'stop' } : botAction(state);
        assert.equal(actDavinci(state, state.turn, action), null);
      }
      assert.equal(state.draw, false);
      assert.ok(state.winner !== null && state.winner >= 0 && state.winner < seats);
      // 탈락자의 타일은 모두 공개, 승자만 숨길 수 있다.
      for (let seat = 0; seat < seats; seat++) {
        if (seat === state.winner) continue;
        assert.ok(state.hands[seat].every(tile => tile.revealed));
      }
      const revealed = state.hands.flat().filter(tile => tile.revealed).length;
      assert.ok(revealed >= 24 - state.deck.length - state.hands[state.winner!].length);
      // view는 덱 순서와 남의 숫자를 절대 노출하지 않는다.
      for (let seat = 0; seat < seats; seat++) {
        const view = davinciView(state, seat);
        assert.equal(view.deckCount, state.deck.length);
        assert.equal(view.drawnId, state.turn === seat ? state.drawnId : null);
        view.hands.forEach((hand, owner) => hand.forEach((tile, i) => {
          const real = state.hands[owner][i];
          const open = owner === seat || real.revealed || state.winner !== null || state.draw;
          assert.equal(tile.num, open ? real.num : null);
        }));
      }
    }
  }
});
