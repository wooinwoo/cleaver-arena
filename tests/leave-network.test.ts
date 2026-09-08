import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import type { Socket } from 'node:net';
import { createArenaServer } from '../server/index.ts';

test('explicit leave ends play without close acknowledgement, rejects queued actions and cannot affect a replacement', async () => {
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const port = (arena.server.address() as { port: number }).port;
  const sockets: WebSocket[] = [];
  async function client(kind: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/${kind === 'cleaver' ? 'ws' : 'table-ws'}`);
    sockets.push(ws);
    const messages: Record<string, any>[] = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>(done => ws.once('open', done));
    return { ws, messages, send: (data: unknown) => ws.send(JSON.stringify(data)),
      async wait(predicate: (data: Record<string, any>) => boolean) {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise(done => setTimeout(done, 10));
        }
        throw new Error('Leave regression response timeout');
      } };
  }
  try {
    for (const kind of ['gomoku', 'cleaver']) {
      const a = await client(kind), b = await client(kind);
      a.send({ type: 'create', game: kind, name: '첫째' });
      const joined = await a.wait(m => m.type === 'joined');
      b.send({ type: 'join', game: kind, code: joined.code, name: '둘째' });
      await b.wait(m => m.type === 'joined');
      a.send({ type: 'ready' }); b.send({ type: 'ready' });
      const state = (m: Record<string, any>) => kind === 'cleaver' ? m.game : m.room;
      await b.wait(m => state(m)?.phase === 'playing');
      b.messages.length = 0;
      // Hold the close acknowledgement and place both frames in the same TCP write.
      const transport = (a.ws as WebSocket & { _socket: Socket })._socket;
      a.ws.pause(); transport.cork();
      a.send({ type: 'leave' });
      a.send(kind === 'cleaver' ? { type: 'input', input: { x: 0, z: 0, yaw: Math.PI / 2, fire: true } } : { type: 'action', action: { type: 'place', r: 7, c: 7 } });
      transport.uncork();
      const ended = state(await b.wait(m => state(m)?.phase === 'finished' && state(m)?.players.length === 1));
      assert.match(kind === 'cleaver' ? ended.winner : ended.result, /둘째 승리/);
      if (kind === 'gomoku') assert.equal(ended.game.board[112], null);
      else assert.equal(ended.nextShot, 0);
      assert.ok(b.messages.every(m => kind === 'cleaver' || m.room?.game?.board[112] !== 0));
      const stale = await client(kind);
      stale.send({ type: 'resume', game: kind, code: joined.code, token: joined.token });
      await stale.wait(m => m.type === 'expired');
      const replacement = await client(kind);
      replacement.send({ type: 'join', game: kind, code: joined.code, name: '새 친구' });
      await replacement.wait(m => m.type === 'joined');
      const closed = new Promise<void>(done => a.ws.once('close', () => done()));
      a.ws.resume(); await closed;
      b.send({ type: 'ready' }); replacement.send({ type: 'ready' });
      const next = state(await replacement.wait(m => state(m)?.round === 2));
      assert.ok(next.players.every((p: { connected: boolean }) => p.connected));
    }
    for (const kind of ['poker', 'cleaver']) {
      const a = await client(kind), b = await client(kind), c = await client(kind);
      a.send({ type: 'create', game: kind, mode: 'teams', name: '첫째' });
      const joined = await a.wait(m => m.type === 'joined');
      for (const guest of [b, c]) {
        guest.send({ type: 'join', game: kind, code: joined.code, name: '친구' });
        await guest.wait(m => m.type === 'joined');
      }
      a.send({ type: 'ready' }); b.send({ type: 'ready' });
      const state = (m: Record<string, any>) => kind === 'cleaver' ? m.game : m.room;
      await a.wait(m => state(m)?.players.filter((p: { ready: boolean }) => p.ready).length === 2);
      c.send({ type: 'leave' });
      const started = state(await a.wait(m => state(m)?.players.length === 2 && state(m)?.round === 1));
      assert.equal(started.phase, kind === 'cleaver' ? 'countdown' : 'playing');
    }
  } finally { sockets.forEach(ws => ws.terminate()); await arena.close(); }
});
