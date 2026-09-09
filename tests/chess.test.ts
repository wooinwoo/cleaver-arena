import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { actChess, createChess, type ChessState } from '../shared/chess.ts';

function play(state: ChessState, moves: string) {
  for (const move of moves.split(' ')) {
    assert.equal(actChess(state, state.turn, {
      type: 'move', from: move.slice(0, 2), to: move.slice(2, 4),
      ...(move[4] ? { promotion: move[4] } : {}),
    }), null, move);
  }
}

test('chess initializes board and rejects malformed, illegal and out-of-turn moves without mutation', () => {
  const state = createChess();
  assert.equal(state.board.length, 64);
  assert.deepEqual(state.board[0], { square: 'a8', type: 'r', color: 'b' });
  assert.deepEqual(state.board[63], { square: 'h1', type: 'r', color: 'w' });
  assert.equal(state.legal.length, 20);
  const before = structuredClone(state);
  for (const [seat, action] of [
    [1, { type: 'move', from: 'e2', to: 'e4' }],
    [NaN, { type: 'move', from: 'e2', to: 'e4' }],
    [2, { type: 'move', from: 'e2', to: 'e4' }],
    [0, { type: 'place', from: 'e2', to: 'e4' }],
    [0, { type: 'move', from: 'e2', to: 'e5' }],
    [0, { type: 'move', from: 'e7', to: 'e5' }],
    [0, { type: 'move', from: 'e1', to: 'g1' }],
    [0, { type: 'move', from: 'e2', to: 'e4', promotion: 'k' }],
    [0, { type: 'move', from: 'e2', to: 'e4', promotion: 1 }],
    [0, { type: 'move', from: 'e2', to: 'e9' }],
    [0, { type: 'move', from: 2, to: 'e4' }],
    [0, { type: 'move' }],
  ] as const) {
    assert.equal(typeof actChess(state, seat, action), 'string');
    assert.deepEqual(state, before);
  }
  play(state, 'e2e4');
  assert.equal(state.turn, 1);
  assert.deepEqual(state.last, { from: 'e2', to: 'e4' });
  assert.deepEqual(state.history, ['e4']);
});

test('chess supports castling, en passant and chosen or default promotion', () => {
  const castle = createChess();
  play(castle, 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1');
  assert.equal(castle.board.find(piece => piece?.square === 'f1')?.type, 'r');
  assert.equal(castle.board.find(piece => piece?.square === 'g1')?.type, 'k');
  assert.equal(castle.history.at(-1), 'O-O');
  const passant = createChess();
  play(passant, 'e2e4 a7a6 e4e5 d7d5 e5d6');
  assert.equal(passant.board.find(piece => piece?.square === 'd6')?.color, 'w');
  assert.equal(passant.board.find(piece => piece?.square === 'd5'), undefined);
  for (const promotion of ['', 'n', 'r', 'b']) {
    const state = createChess();
    play(state, `a2a4 h7h5 a4a5 h5h4 a5a6 h4h3 a6b7 h3g2 b7a8${promotion}`);
    assert.equal(state.board[0]?.type, promotion || 'q');
    assert.equal(state.board[0]?.color, 'w');
  }
});

test('chess prevents exposing the king and ends on checkmate', () => {
  const pinned = createChess();
  play(pinned, 'e2e3 d7d5 f1b5 b8c6 a2a3');
  const before = structuredClone(pinned);
  assert.equal(typeof actChess(pinned, 1, { type: 'move', from: 'c6', to: 'b4' }), 'string');
  assert.deepEqual(pinned, before);
  const mate = createChess();
  play(mate, 'f2f3 e7e5 g2g4 d8h4');
  assert.equal(mate.winner, 1);
  assert.equal(mate.check, true);
  assert.equal(mate.draw, false);
  assert.deepEqual(mate.legal, []);
  const ended = structuredClone(mate);
  assert.equal(typeof actChess(mate, 0, { type: 'move', from: 'a2', to: 'a3' }), 'string');
  assert.deepEqual(mate, ended);
});

test('chess preserves repetition history across serialized states', () => {
  let state = createChess();
  play(state, 'g1f3 g8f6 f3g1 f6g8');
  assert.equal(state.draw, false);
  state = JSON.parse(JSON.stringify(state));
  play(state, 'g1f3 g8f6 f3g1 f6g8');
  assert.equal(state.draw, true);
  assert.equal(state.winner, null);
  assert.deepEqual(state.legal, []);
  const before = structuredClone(state);
  assert.equal(typeof actChess(state, 0, { type: 'move', from: 'e2', to: 'e4' }), 'string');
  assert.deepEqual(state, before);
});

// Legal histories start from the standard position, exercising the wrapper's replay and draw detection together.
const captureOpening = 'e3 d6 Nc3 h5 Qxh5 Rxh5 Nge2 Rxh2 Rxh2 a6 Nb1 b6 f4 f5 Kd1 Kf7 Ng1 Bb7 Bxa6 Bxg2 Rxg2 Nxa6 Rxg7+ Kxg7 a4 c5 b4 Nxb4 Ra2 Nxa2 Nc3 Nxc1 Kxc1 Rxa4 Nxa4 Nf6 Nxc5 bxc5 e4 fxe4 Nf3 exf3 c3 Nh5 Kc2 Nxf4 d4 cxd4 cxd4 f2 Kc3 Qb6 d5 Nxd5+ Kc4 Ne3+ Kd3 Qa5 Kxe3 Qg5+ Kxf2 Qc5+ Ke2 Qc6 Ke1 Kg6 Kd1 Qe8 Kd2 d5 Ke3 Qd8 Kd3 Kf6 Kd2 Kf5 Ke3 Kg5 Kd4 Qc8 Kxd5';

function beforeLastMove(moves: string) {
  const chess = new Chess();
  const history = moves.split(' ');
  const final = history.pop()!;
  for (const move of history) chess.move(move);
  assert.equal(chess.isGameOver(), false);
  const state: ChessState = {
    ...createChess(), fen: chess.fen(), history: chess.history(),
    turn: chess.turn() === 'w' ? 0 : 1, board: chess.board().flat(), check: chess.isCheck(),
    legal: chess.moves({ verbose: true }).map(({ from, to, promotion }) => ({ from, to, promotion })),
  };
  const move = chess.move(final);
  assert.equal(actChess(state, state.turn, { type: 'move', from: move.from, to: move.to, promotion: move.promotion }), null);
  assert.equal(state.fen, chess.fen());
  assert.equal(state.draw, true);
  assert.equal(state.winner, null);
  return chess;
}

test('chess ends on insufficient material after a capture', () => {
  const chess = beforeLastMove(`${captureOpening} Bh6 Kd4 Qg8 Kc5 Kf5 Kc6 Qf8 Kc7 Kf6 Kd7 Bf4 Kc6 Qg7 Kc5 Qh7 Kb6 Bb8 Ka6 Qh5 Kb6 Kf7 Kc6 Qh2 Kd5 Bg3 Kc6 Qh7 Kd5 Qh4 Kc6 Ke6 Kc5 Be1 Kb5 Bb4 Ka4 Qh8 Kxb4 Qa8 Kb3 Qb8+ Kc4 Qa7 Kb3 Kd6 Kc2 Qc7+ Kd2 Qa5+ Kc2 e5 Kb1 Ke6 Kb2 Qc3+ Kxc3 Kf7 Kb4 Kg8 Ka3 Kh7 Ka4 Kh8 Ka5 Kg8 Kb6 Kg7 Kc7 Kf6 Kb6 Kf7 Kc5 e4 Kd6 Kf8 Ke5 Kg8 Kxe4`);
  assert.equal(chess.isInsufficientMaterial(), true);
});

test('chess ends on stalemate without checking the king', () => {
  const chess = beforeLastMove('e3 a5 Qh5 Ra6 Qxa5 h5 Qxc7 Rah6 h4 f6 Qxd7+ Kf7 Qxb7 Qd3 Qxb8 Qh7 Qxc8 Kg6 Qe6');
  assert.equal(chess.isStalemate(), true);
  assert.equal(chess.isCheck(), false);
});

test('chess ends after fifty moves without pawn movement or capture', () => {
  const chess = beforeLastMove(`${captureOpening} Qc7 Ke4 Qe5+ Kf3 Bg7 Kg2 Qe3 Kh2 Kg4 Kh1 Bc3 Kg2 Bg7 Kh2 Qe1 Kg2 Bf8 Kh2 Kf3 Kh3 Qe5 Kh4 Qh2+ Kg5 Qg2+ Kh4 Qb2 Kg5 Qb7 Kf5 Qa8 Kg5 Bh6+ Kg6 Bc1 Kf5 Qb7 Kg6 Ba3 Kg7 Qb1 Kf8 Qb6 Kg7 Qb4 Kf8 Kf4 Kf7 Qb6 Kg7 Qe3 Kf8 Qc3 Kf7 Bb2 Kg6 Ba3 Kh5 Qg7 Kh4 Bc5 Kh3 Qh7+ Kg2 Kg4 Kf1 Kf3 Ke1 Bd6 Kd2 Qh1 Kd3 Qh3 Kc3 Qg3 Kd2 Qf4+ Kc2 Qd4 Kb1 Bf4 Ka2 Ke3 Ka3 Qc5+ Kb2 Qf5 Kb3 Ke4 Kb4 Be5 Kc5 Qh5 Kb6 Bh2 Kc6 Qc5+ Kd7 Qd4+ Kc6`);
  assert.equal(chess.isDrawByFiftyMoves(), true);
  assert.equal(chess.isThreefoldRepetition(), false);
  assert.equal(chess.isInsufficientMaterial(), false);
});
