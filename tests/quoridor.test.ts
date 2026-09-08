import assert from 'node:assert/strict';
import test from 'node:test';
import { actQuoridor, createQuoridor, type QuoridorState } from '../shared/quoridor.ts';
import type { Action } from '../shared/tabletop-types.ts';

function rejected(state: QuoridorState, seat: number, action: Action) {
  const before = structuredClone(state);
  assert.equal(typeof actQuoridor(state, seat, action), 'string');
  assert.deepEqual(state, before, '거부된 행동은 상태를 변경하지 않아야 합니다.');
}

test('초기 배치, 차례, 잘못된 입력과 승리 후 행동', () => {
  const state = createQuoridor();
  assert.deepEqual(state.pawns, [{ r: 8, c: 4 }, { r: 0, c: 4 }]);
  assert.deepEqual(state.remaining, [10, 10]);
  rejected(state, 1, { type: 'move', r: 1, c: 4 });
  rejected(state, -1, { type: 'move', r: 7, c: 4 });
  for (const r of [-1, 9, 1.5, NaN, '7', undefined]) rejected(state, 0, { type: 'move', r, c: 4 });
  rejected(state, 0, { type: 'move', r: 7, c: 5 });
  rejected(state, 0, { type: 'move', r: 6, c: 4 });
  rejected(state, 0, { type: 'unknown' });
  assert.equal(actQuoridor(state, 0, { type: 'move', r: 7, c: 4 }), null);
  assert.equal(state.turn, 1);
  state.pawns = [{ r: 7, c: 4 }, { r: 7, c: 3 }];
  assert.equal(actQuoridor(state, 1, { type: 'move', r: 8, c: 3 }), null);
  assert.equal(state.winner, 1);
  rejected(state, 1, { type: 'move', r: 7, c: 3 });
  const first = createQuoridor();
  first.pawns[0] = { r: 1, c: 3 };
  assert.equal(actQuoridor(first, 0, { type: 'move', r: 0, c: 3 }), null);
  assert.equal(first.winner, 0);
});

test('정면 점프는 허용하고 열린 정면에서 대각선 점프는 거부', () => {
  const state = createQuoridor();
  state.pawns = [{ r: 4, c: 4 }, { r: 3, c: 4 }];
  rejected(state, 0, { type: 'move', r: 3, c: 4 });
  rejected(state, 0, { type: 'move', r: 3, c: 3 });
  assert.equal(actQuoridor(state, 0, { type: 'move', r: 2, c: 4 }), null);
  state.turn = 0;
  state.pawns = [{ r: 4, c: 4 }, { r: 4, c: 5 }];
  assert.equal(actQuoridor(state, 0, { type: 'move', r: 4, c: 6 }), null);
});

test('상대 뒤 벽이나 보드 끝에서만 옆으로 점프하고 옆 벽은 통과 불가', () => {
  for (const c of [3, 5]) {
    const state = createQuoridor();
    state.pawns = [{ r: 4, c: 4 }, { r: 3, c: 4 }];
    state.walls = [{ r: 2, c: 4, dir: 'h' }];
    rejected(state, 0, { type: 'move', r: 2, c: 4 });
    assert.equal(actQuoridor(state, 0, { type: 'move', r: 3, c }), null);
  }
  const edge = createQuoridor();
  edge.pawns = [{ r: 1, c: 4 }, { r: 0, c: 4 }];
  assert.equal(actQuoridor(edge, 0, { type: 'move', r: 0, c: 3 }), null);
  const blocked = createQuoridor();
  blocked.pawns = [{ r: 4, c: 4 }, { r: 3, c: 4 }];
  blocked.walls = [{ r: 2, c: 4, dir: 'h' }, { r: 3, c: 3, dir: 'v' }];
  rejected(blocked, 0, { type: 'move', r: 3, c: 3 });
  blocked.walls = [{ r: 3, c: 4, dir: 'h' }];
  rejected(blocked, 0, { type: 'move', r: 2, c: 4 });
});

test('벽 설치는 수량과 차례를 갱신하고 중복·교차·부분 중첩을 거부', () => {
  const state = createQuoridor();
  for (const action of [
    { type: 'wall', r: 8, c: 1, dir: 'h' },
    { type: 'wall', r: 1, c: 8, dir: 'v' },
    { type: 'wall', r: 1, c: 1, dir: 'bad' },
  ]) rejected(state, 0, action);
  assert.equal(actQuoridor(state, 0, { type: 'wall', r: 4, c: 4, dir: 'h' }), null);
  assert.deepEqual(state.remaining, [9, 10]);
  assert.equal(state.turn, 1);
  for (const c of [3, 4, 5]) rejected(state, 1, { type: 'wall', r: 4, c, dir: 'h' });
  rejected(state, 1, { type: 'wall', r: 4, c: 4, dir: 'v' });
  assert.equal(actQuoridor(state, 1, { type: 'wall', r: 4, c: 6, dir: 'h' }), null);
  state.walls = [{ r: 4, c: 4, dir: 'v' }];
  for (const r of [3, 4, 5]) rejected(state, 0, { type: 'wall', r, c: 4, dir: 'v' });
  state.remaining[0] = 0;
  rejected(state, 0, { type: 'wall', r: 0, c: 0, dir: 'v' });
});

test('가로·세로 벽의 두 칸을 통과할 수 없음', () => {
  for (const c of [4, 5]) {
    const state = createQuoridor();
    state.pawns[0] = { r: 5, c };
    state.walls = [{ r: 4, c: 4, dir: 'h' }];
    rejected(state, 0, { type: 'move', r: 4, c });
  }
  for (const r of [4, 5]) {
    const state = createQuoridor();
    state.pawns[0] = { r, c: 5 };
    state.walls = [{ r: 4, c: 4, dir: 'v' }];
    rejected(state, 0, { type: 'move', r, c: 4 });
  }
});

test('자신 또는 상대의 마지막 경로를 막는 벽은 거부', () => {
  for (const seat of [0, 1]) {
    const state = createQuoridor();
    state.turn = seat;
    state.pawns[0] = { r: 8, c: 0 };
    assert.equal(actQuoridor(state, seat, { type: 'wall', r: 7, c: 0, dir: 'v' }), null);
    rejected(state, state.turn, { type: 'wall', r: 6, c: 0, dir: 'h' });
  }
});
