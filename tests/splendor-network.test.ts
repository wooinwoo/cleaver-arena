import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createArenaServer } from '../server/index.ts';
import { chooseSplendorAction } from './splendor-helpers.ts';
import type { Action } from '../shared/tabletop-types.ts';

test('splendor enforces four seats, preserves private return-phase reconnects and finishes 3/4-player network games', async () => {
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const port = (arena.server.address() as { port: number }).port;
  const sockets: WebSocket[] = [];
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/table-ws`); sockets.push(ws);
    const messages: any[] = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>(done => ws.once('open', done));
    return { ws, send: (data: unknown) => ws.send(JSON.stringify(data)),
      async wait(predicate: (data: any) => boolean) {
        const deadline = performance.now() + 10_000;
        while (performance.now() < deadline) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise(done => setTimeout(done, 5));
        }
        throw new Error('Splendor response timed out');
      } };
  }
  try {
    for (const seats of [3, 4]) {
      const players: Awaited<ReturnType<typeof connect>>[] = [], joins: { code: string; token: string }[] = [];
      for (let seat = 0; seat < seats; seat++) {
        const peer = await connect(); players.push(peer);
        peer.send({ type: seat ? 'join' : 'create', game: 'splendor', code: joins[0]?.code, name: `참가자${seat + 1}` });
        const joined = await peer.wait(data => data.type === 'joined');
        joins.push({ code: joined.code, token: joined.token });
      }
      if (seats === 4) {
        const extra = await connect(); extra.send({ type: 'join', game: 'splendor', code: joins[0].code, name: '다섯째' });
        assert.match((await extra.wait(data => data.type === 'error')).message, /정원/); extra.ws.close();
      }
      players.forEach(peer => peer.send({ type: 'ready' }));
      let views = await Promise.all(players.map(peer => peer.wait(data => data.type === 'table-state' && data.room.phase === 'playing')));
      let room = views[0].room;
      let resumedReturn = false, actions = 0;
      while (room.phase === 'playing') {
        const game = room.game, seat = game.turn;
        assert.ok(actions++ < 1200, 'Network game stalled');
        const current = views[seat].room;
        assert.equal('decks' in current.game, false);
        current.game.players.forEach((p: any, owner: number) => { if (owner !== seat) assert.ok(p.reserved.every((id: unknown) => id === null)); });
        if (!resumedReturn && current.game.stage === 'return') {
          players[seat].ws.terminate();
          await players[(seat + 1) % seats].wait(data => data.type === 'table-state' && data.room.players.some((p: any) => !p.connected));
          const resumed = await connect();
          resumed.send({ type: 'resume', game: 'splendor', ...joins[seat] });
          await resumed.wait(data => data.type === 'joined');
          const restored = (await resumed.wait(data => data.type === 'table-state')).room;
          assert.equal(restored.me, seat); assert.deepEqual(restored.game, current.game);
          players[seat] = resumed; resumedReturn = true;
        }
        let action: Action;
        if (!resumedReturn && seat === 0 && current.game.stage === 'action') {
          if (current.game.players[0].reserved.length < 3) action = { type: 'reserve', tier: 2 };
          else {
            const colors = current.game.bank.slice(0, 5).map((count: number, color: number) => ({ count, color })).filter((gem: { count: number }) => gem.count > 0);
            const gems = [0, 0, 0, 0, 0]; colors.slice(0, 3).forEach((gem: { color: number }) => gems[gem.color] = 1);
            action = gems.some(Boolean) ? { type: 'take', gems } : chooseSplendorAction(current.game);
          }
        } else action = chooseSplendorAction(current.game);
        players[seat].send({ type: 'action', action, seat: (seat + 1) % seats });
        views = await Promise.all(players.map(peer => peer.wait(data => data.type === 'table-state' && data.room.game?.revision === game.revision + 1)));
        room = views[0].room;
        // Keep this transport test below the server's per-client flood limit.
        await new Promise(done => setTimeout(done, 40));
      }
      assert.ok(resumedReturn, 'A pending token return must survive reconnect');
      assert.match(room.result, /승리|무승부/);
      players.forEach(peer => peer.send({ type: 'ready' }));
      const fresh = (await players[0].wait(data => data.type === 'table-state' && data.room.round === 2)).room;
      assert.equal(fresh.game.revision, 0); assert.equal(fresh.game.finalRound, false);
      assert.ok(fresh.game.players.every((p: any) => p.tokens.every((n: number) => n === 0) && p.cards.length === 0 && p.reserved.length === 0));
      console.log(`PASS Splendor ${seats}-player WebSocket match: ${actions} actions, return-phase reconnect, result and rematch.`);
      players.forEach(peer => peer.ws.terminate());
    }
  } finally { sockets.forEach(ws => ws.terminate()); await arena.close(); }
});
