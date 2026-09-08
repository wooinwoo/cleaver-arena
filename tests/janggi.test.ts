import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actJanggi, createJanggi, RULES, type JanggiState, type Piece } from '../shared/janggi.ts';

function position(pieces: [number, Piece][], turn = 0): JanggiState {
  const state = createJanggi();
  state.board.fill(null);
  for (const [square, piece] of pieces) state.board[square] = piece;
  state.turn = turn;
  state.positions = [];
  return state;
}

test('janggi begins mirrored and rejects invalid input without mutation', () => {
  const state = createJanggi(), before = structuredClone(state);
  assert.equal(state.board.length, 12);
  assert.equal(state.board.filter(Boolean).length, 8);
  assert.deepEqual(state.board[1], { owner: 1, kind: 'king' });
  assert.deepEqual(state.board[10], { owner: 0, kind: 'king' });
  for (const [seat, action] of [
    [1, { type: 'move', from: 4, to: 7 }],
    [0, { type: 'move', from: 7, to: 6 }],
    [0, { type: 'move', from: 7, to: 10 }],
    [0, { type: 'move', from: NaN, to: 0 }],
    [0, { type: 'drop', piece: 'pawn', to: 3 }],
    [0, { type: 'move', from: 7, to: 12 }],
    [0, { type: 'drop', piece: 'king', to: 3 }],
  ] as const) {
    assert.equal(typeof actJanggi(state, seat, action), 'string');
    assert.deepEqual(state, before);
  }
});

test('janggi capture creates a hand and a later drop consumes it', () => {
  const state = createJanggi();
  assert.equal(actJanggi(state, 0, { type: 'move', from: 7, to: 4 }), null);
  assert.deepEqual(state.hands[0], ['pawn']);
  assert.equal(actJanggi(state, 1, { type: 'move', from: 1, to: 4 }), null);
  assert.equal(actJanggi(state, 0, { type: 'drop', piece: 'pawn', to: 7 }), null);
  assert.deepEqual(state.hands[0], []);
  assert.deepEqual(state.board[7], { owner: 0, kind: 'pawn' });
});

test('janggi promotes pawn, demotes captured hen, and permits unpromoted last-row drops', () => {
  const state = position([[10, { owner: 0, kind: 'king' }], [5, { owner: 1, kind: 'king' }], [3, { owner: 0, kind: 'pawn' }], [1, { owner: 1, kind: 'rook' }]]);
  assert.equal(actJanggi(state, 0, { type: 'move', from: 3, to: 0 }), null);
  assert.equal(state.board[0]?.kind, 'hen');
  assert.equal(actJanggi(state, 1, { type: 'move', from: 1, to: 0 }), null);
  assert.deepEqual(state.hands[1], ['pawn']);
  const drop = position([[10, { owner: 0, kind: 'king' }], [2, { owner: 1, kind: 'king' }]]);
  drop.hands[0] = ['pawn'];
  assert.equal(actJanggi(drop, 0, { type: 'drop', piece: 'pawn', to: 0 }), null);
  assert.equal(drop.board[0]?.kind, 'pawn');
  assert.match(RULES, /투입만으로 승급하지/);
});

test('janggi king cannot enter attack; safe opposite-home entry wins immediately', () => {
  const state = position([[3, { owner: 0, kind: 'king' }], [8, { owner: 1, kind: 'king' }], [1, { owner: 1, kind: 'rook' }]]);
  const before = structuredClone(state);
  assert.match(actJanggi(state, 0, { type: 'move', from: 3, to: 0 })!, /왕이 공격/);
  assert.deepEqual(state, before);
  state.board[1] = null;
  assert.equal(actJanggi(state, 0, { type: 'move', from: 3, to: 0 }), null);
  assert.equal(state.winner, 0);
  const won = structuredClone(state);
  assert.ok(actJanggi(state, 1, { type: 'move', from: 8, to: 5 }));
  assert.deepEqual(state, won);
});

test('janggi rejects moves and drops that leave its own king attacked', () => {
  const state = position([[10, { owner: 0, kind: 'king' }], [1, { owner: 1, kind: 'king' }], [7, { owner: 1, kind: 'rook' }], [9, { owner: 0, kind: 'rook' }]]);
  state.hands[0] = ['pawn'];
  const before = structuredClone(state);
  assert.ok(actJanggi(state, 0, { type: 'move', from: 9, to: 6 }));
  assert.ok(actJanggi(state, 0, { type: 'drop', piece: 'pawn', to: 3 }));
  assert.deepEqual(state, before);
  assert.equal(actJanggi(state, 0, { type: 'move', from: 10, to: 7 }), null);
});

test('janggi king capture wins and never adds king to hand', () => {
  const state = position([[10, { owner: 0, kind: 'king' }], [1, { owner: 1, kind: 'king' }], [4, { owner: 0, kind: 'rook' }]]);
  assert.equal(actJanggi(state, 0, { type: 'move', from: 4, to: 1 }), null);
  assert.equal(state.winner, 0);
  assert.deepEqual(state.hands[0], []);
});

test('janggi one-step directions and promotion mirror with each owner', () => {
  for (const owner of [0, 1] as const) {
    const from = owner === 0 ? 7 : 4;
    const forward = owner === 0 ? -3 : 3;
    for (const [kind, delta, allowed] of [
      ['rook', forward, true], ['rook', 1, true], ['rook', forward + 1, false],
      ['rook', forward * 2, false], ['bishop', forward + 1, true], ['bishop', forward, false],
      ['pawn', forward, true], ['pawn', -forward, false],
      ['hen', forward + 1, true], ['hen', -forward, true], ['hen', -forward + 1, false],
    ] as const) {
      const state = position([[9, { owner: 0, kind: 'king' }], [2, { owner: 1, kind: 'king' }], [from, { owner, kind }]], owner);
      const result = actJanggi(state, owner, { type: 'move', from, to: from + delta });
      assert.equal(result === null, allowed, `${owner} ${kind} ${delta}: ${result}`);
    }
  }
  const state = position([[2, { owner: 0, kind: 'king' }], [0, { owner: 1, kind: 'king' }], [6, { owner: 1, kind: 'pawn' }]], 1);
  assert.equal(actJanggi(state, 1, { type: 'move', from: 6, to: 9 }), null);
  assert.equal(state.board[9]?.kind, 'hen');
});

test('janggi third identical position including turn draws', () => {
  const state = position([[9, { owner: 0, kind: 'king' }], [2, { owner: 1, kind: 'king' }]]);
  for (let i = 0; i < 9; i++) {
    const moves = [[9, 10], [2, 1], [10, 9], [1, 2]];
    const [from, to] = moves[i % 4];
    assert.equal(actJanggi(state, i % 2, { type: 'move', from, to }), null);
  }
  assert.equal(state.draw, true);
  assert.equal(state.winner, null);
});

test('janggi player with no safe move loses', () => {
  const state = position([[9, { owner: 0, kind: 'king' }], [2, { owner: 1, kind: 'king' }], [6, { owner: 0, kind: 'rook' }], [5, { owner: 0, kind: 'hen' }], [4, { owner: 0, kind: 'rook' }]]);
  assert.equal(actJanggi(state, 0, { type: 'move', from: 6, to: 3 }), null);
  assert.equal(state.winner, 0);
  assert.match(state.log, /둘 수 없어/);
});

test('genius forbids every captured piece on the opponent home row, mirrored for both seats', () => {
  for (const seat of [0, 1] as const) for (const piece of ['rook', 'bishop', 'pawn'] as const) {
    const state = createJanggi('genius');
    state.turn = seat;
    state.hands[seat] = [piece];
    const to = seat === 0 ? 0 : 11;
    state.board[to] = null;
    const before = structuredClone(state);
    assert.match(actJanggi(state, seat, { type: 'drop', piece, to })!, /상대 진영/);
    assert.deepEqual(state, before);
    assert.equal(actJanggi(state, seat, { type: 'drop', piece, to: seat === 0 ? 6 : 5 }), null);
    assert.equal(state.hands[seat].length, 0);
  }
});

test('genius home entry waits for the opponent turn and capture takes priority', () => {
  for (const seat of [0, 1] as const) {
    const mirror = (square: number) => seat === 0 ? square : 11 - square;
    for (const capture of [false, true]) {
      const state = createJanggi('genius');
      state.board.fill(null); state.positions = []; state.turn = seat;
      state.board[mirror(3)] = { owner: seat, kind: 'king' };
      state.board[mirror(8)] = { owner: (1 - seat) as 0 | 1, kind: 'king' };
      state.board[mirror(1)] = { owner: (1 - seat) as 0 | 1, kind: 'rook' };
      assert.equal(actJanggi(state, seat, { type: 'move', from: mirror(3), to: mirror(0) }), null);
      assert.equal(state.winner, null);
      assert.match(state.log, /한 턴/);
      const before = structuredClone(state);
      assert.ok(actJanggi(state, 1 - seat, { type: 'move', from: mirror(1), to: mirror(7) }));
      assert.deepEqual(state, before);
      assert.equal(actJanggi(state, 1 - seat, capture
        ? { type: 'move', from: mirror(1), to: mirror(0) }
        : { type: 'move', from: mirror(8), to: mirror(5) }), null);
      assert.equal(state.winner, capture ? 1 - seat : seat);
      if (!capture) assert.ok(state.log.includes(`${seat + 1}번 왕이 상대 진영에서 한 턴을 버텨 승리`));
      assert.ok(!state.hands[1 - seat].includes('king'));
    }
  }
});

test('genius permits ignoring an attack and ends only when the king is captured', () => {
  const state = position([[10, { owner: 0, kind: 'king' }], [1, { owner: 1, kind: 'king' }], [7, { owner: 1, kind: 'rook' }], [9, { owner: 0, kind: 'rook' }]]);
  state.variant = 'genius';
  assert.equal(actJanggi(state, 0, { type: 'move', from: 9, to: 6 }), null);
  assert.equal(state.winner, null);
  assert.equal(actJanggi(state, 1, { type: 'move', from: 7, to: 10 }), null);
  assert.equal(state.winner, 1);
});
