import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createArenaServer } from '../server/index.ts';
import { TABLE_GAMES, type TableId } from '../shared/catalog.ts';

test('all table games create/join/start/action; private poker views; wrong-game and out-of-turn denial', async () => {
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const port = (arena.server.address() as { port: number }).port;
  const sockets: WebSocket[] = [];
  async function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/table-ws`); sockets.push(ws);
    const messages: Record<string, any>[] = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>(done => ws.once('open', done));
    return { ws, send: (data: unknown) => ws.send(JSON.stringify(data)),
      async wait(predicate: (data: Record<string, any>) => boolean) {
        const deadline = performance.now() + 15000;
        while (performance.now() < deadline) {
          const i = messages.findIndex(predicate);
          if (i >= 0) return messages.splice(i, 1)[0];
          await new Promise(done => setTimeout(done, 10));
        }
        throw new Error('Table server response timeout');
      } };
  }
  try {
    const cases: { kind: TableId; variant?: 'animal' | 'genius' }[] = (Object.keys(TABLE_GAMES) as TableId[]).map(kind => ({ kind }));
    cases.push({ kind: 'janggi', variant: 'genius' });
    const invalid = await client();
    invalid.send({ type: 'create', game: 'janggi', name: '검증', variant: 'unknown' });
    assert.match((await invalid.wait(data => data.type === 'error')).message, /룰/);
    for (const { kind, variant } of cases) {
      const a = await client(), b = await client();
      a.send({ type: 'create', game: kind, name: '첫째', variant });
      const joined = await a.wait(data => data.type === 'joined');
      b.send({ type: 'join', game: kind, name: '둘째', code: joined.code, variant: 'animal' });
      const second = await b.wait(data => data.type === 'joined');
      a.send({ type: 'ready' }); b.send({ type: 'ready' });
      const snapshotA = await a.wait(data => data.type === 'table-state' && data.room.phase === 'playing');
      const snapshotB = await b.wait(data => data.type === 'table-state' && data.room.phase === 'playing');
      assert.equal(snapshotA.room.game.kind, kind);
      assert.equal(snapshotA.room.me, 0); assert.equal(snapshotB.room.me, 1);
      if (kind === 'janggi') {
        assert.equal(snapshotA.room.variant, variant ?? 'animal');
        assert.equal(snapshotB.room.game.variant, variant ?? 'animal');
      }
      assert.ok(snapshotA.room.players.every((p: Record<string, unknown>) => !('token' in p)));
      const actions = { chess: { type: 'move', from: 'e2', to: 'e4' }, gomoku: { type: 'place', r: 7, c: 7 }, quoridor: { type: 'move', r: 7, c: 4 }, janggi: { type: 'move', from: 7, to: 4 }, poker: { type: 'call' } };
      b.send({ type: 'action', action: actions[kind], seat: 0 });
      assert.match((await b.wait(data => data.type === 'error')).message, /차례/);
      if (kind === 'poker') {
        assert.equal(snapshotA.room.game.cards[0], null);
        assert.equal(snapshotB.room.game.cards[1], null);
        assert.equal(typeof snapshotA.room.game.cards[1], 'number');
        assert.equal(typeof snapshotB.room.game.cards[0], 'number');
      }
      a.send({ type: 'action', action: actions[kind] });
      const after = await b.wait(data => data.type === 'table-state' && data.room.game?.turn === 1);
      assert.equal(after.room.phase, 'playing');
      const outsider = await client();
      outsider.send({ type: 'join', game: kind === 'poker' ? 'gomoku' : 'poker', name: '다른 게임', code: joined.code });
      assert.match((await outsider.wait(data => data.type === 'error')).message, /방을 찾을 수 없어요/);
      const busy = await client();
      const busyClosed = new Promise<number>(done => busy.ws.once('close', done));
      busy.send({ type: 'resume', game: kind, code: joined.code, token: second.token });
      assert.equal((await busy.wait(data => data.type === 'error' || data.type === 'expired')).type, 'error');
      assert.equal(await busyClosed, 1013);
      b.ws.close();
      await new Promise<void>(done => b.ws.once('close', () => done()));
      const resumed = await client();
      resumed.send({ type: 'resume', game: kind, code: joined.code, token: second.token });
      await resumed.wait(data => data.type === 'joined');
      const restored = await resumed.wait(data => data.type === 'table-state');
      assert.equal(restored.room.me, 1);
      if (kind === 'janggi') assert.equal(restored.room.variant, variant ?? 'animal');
      if (variant === 'genius') {
        resumed.send({ type: 'action', action: { type: 'move', from: 0, to: 3 } });
        await a.wait(data => data.type === 'table-state' && data.room.game?.turn === 0 && data.room.game?.board[3]?.kind === 'rook');
        a.send({ type: 'action', action: { type: 'move', from: 4, to: 1 } });
        const won = await a.wait(data => data.type === 'table-state' && data.room.phase === 'finished');
        assert.equal(won.room.game.winner, 0);
        a.send({ type: 'ready' }); resumed.send({ type: 'ready' });
        const rematch = await a.wait(data => data.type === 'table-state' && data.room.round === 2);
        assert.equal(rematch.room.game.variant, 'genius');
        assert.equal(rematch.room.game.winner, null);
      }
      if (kind === 'poker') assert.equal(restored.room.game.cards[1], null);
      if (kind === 'poker') {
        resumed.send({ type: 'action', action: { type: 'call' } });
        const result = await a.wait(data => data.type === 'table-state' && data.room.phase === 'finished');
        assert.ok(result.room.game.cards.every((card: unknown) => typeof card === 'number'));
        a.send({ type: 'ready' }); resumed.send({ type: 'ready' });
        const rematch = await a.wait(data => data.type === 'table-state' && data.room.round === 2);
        assert.equal(rematch.room.game.cards[0], null);
        a.send({ type: 'action', action: { type: 'fold' } });
        await a.wait(data => data.type === 'table-state' && data.room.round === 2 && data.room.phase === 'finished');
        const third = await client();
        third.send({ type: 'join', game: kind, name: '새 친구', code: joined.code });
        await third.wait(data => data.type === 'joined');
        const freshLobby = await third.wait(data => data.type === 'table-state');
        assert.equal(freshLobby.room.phase, 'lobby');
        assert.equal(freshLobby.room.game, null);
        assert.equal(freshLobby.room.players.length, 3);
        third.ws.close();
      }
      a.ws.close(); resumed.ws.close(); outsider.ws.close();
    }
  } finally { sockets.forEach(ws => ws.terminate()); await arena.close(); }
});
