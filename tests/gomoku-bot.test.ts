import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createArenaServer } from '../server/index.ts';
import { createGomoku, actGomoku, type GomokuState } from '../shared/gomoku.ts';
import { gomokuBot } from '../shared/gomoku-bot.ts';
import { finished } from '../shared/tabletop-types.ts';

function board(stones: [r: number, c: number, seat: number][]): GomokuState {
  const state = createGomoku();
  for (const [r, c, seat] of stones) { state.board[r * 15 + c] = seat; state.count++; }
  return state;
}

test('gomoku bot finishes its own five before blocking', () => {
  const state = board([[7, 3, 1], [7, 4, 1], [7, 5, 1], [7, 6, 1], [3, 3, 0], [3, 4, 0], [3, 5, 0], [3, 6, 0]]);
  const move = gomokuBot(state, 1, () => 0);
  assert.ok((move.r === 7 && (move.c === 2 || move.c === 7)), JSON.stringify(move));
});

test('gomoku bot blocks an open three and a broken four', () => {
  const three = gomokuBot(board([[7, 5, 0], [7, 6, 0], [7, 7, 0], [9, 9, 1]]), 1, () => 0);
  assert.ok(three.r === 7 && (three.c === 4 || three.c === 8), JSON.stringify(three));
  const gap = gomokuBot(board([[5, 2, 0], [5, 3, 0], [5, 5, 0], [5, 6, 0], [9, 9, 1]]), 1, () => 0);
  assert.deepEqual(gap, { type: 'place', r: 5, c: 4 });
});

test('two bots play a legal game to the end', () => {
  const state = createGomoku();
  for (let i = 0; i < 225 && !finished(state); i++) {
    assert.equal(actGomoku(state, state.turn, gomokuBot(state, state.turn)), null);
  }
  assert.ok(finished(state));
});

test('a lone player starts gomoku against the server bot and gets its reply', async () => {
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const port = (arena.server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/table-ws`);
  const messages: Record<string, any>[] = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  const wait = async (predicate: (data: Record<string, any>) => boolean) => {
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise(done => setTimeout(done, 10));
    }
    throw new Error('Table server response timeout');
  };
  try {
    await new Promise<void>(done => ws.once('open', done));
    const send = (data: unknown) => ws.send(JSON.stringify(data));
    send({ type: 'create', game: 'gomoku', name: '혼자' });
    await wait(data => data.type === 'joined');
    send({ type: 'bot' });
    const playing = await wait(data => data.type === 'table-state' && data.room.phase === 'playing');
    assert.deepEqual(playing.room.players.map((p: { name: string }) => p.name), ['혼자', '봇']);
    send({ type: 'action', action: { type: 'place', r: 7, c: 7 } });
    const reply = await wait(data => data.type === 'table-state' && data.room.game?.count === 2);
    assert.equal(reply.room.game.turn, 0);
    send({ type: 'bot' });
    assert.match((await wait(data => data.type === 'error')).message, /혼자 있는 방/);
  } finally {
    ws.terminate();
    await arena.close();
  }
});
