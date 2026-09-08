import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createArenaServer } from '../server/index.ts';

test('duel rooms preserve rules, private hands and chips through next, resume, bankruptcy and rematch', async () => {
  const arena = createArenaServer();
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const port = (arena.server.address() as { port: number }).port;
  const sockets: WebSocket[] = [];
  async function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/table-ws`);
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
        throw new Error(`Duel response timeout: ${JSON.stringify(messages)}`);
      } };
  }
  try {
    const invalid = await client();
    for (const variant of ['unknown', null, 1]) {
      invalid.send({ type: 'create', game: 'poker', variant, name: '검증' });
      assert.match((await invalid.wait(message => message.type === 'error')).message, /룰/);
    }
    const legacy = await client();
    legacy.send({ type: 'create', game: 'poker', name: '파티방' });
    const party = await legacy.wait(message => message.type === 'joined');
    for (let seat = 1; seat < 3; seat++) {
      const guest = await client();
      guest.send({ type: 'join', game: 'poker', code: party.code, variant: 'duel', name: `파티${seat}` });
      await guest.wait(message => message.type === 'joined');
      assert.equal((await guest.wait(message => message.type === 'table-state')).room.variant, 'party');
    }

    const a = await client();
    let b = await client();
    a.send({ type: 'create', game: 'poker', variant: 'duel', name: '첫째' });
    const joined = await a.wait(message => message.type === 'joined');
    b.send({ type: 'join', game: 'poker', code: joined.code, variant: 'party', name: '둘째' });
    const second = await b.wait(message => message.type === 'joined');
    assert.equal((await b.wait(message => message.type === 'table-state')).room.variant, 'duel');
    const third = await client();
    third.send({ type: 'join', game: 'poker', code: joined.code, variant: 'party', name: '셋째' });
    assert.match((await third.wait(message => message.type === 'error')).message, /정원/);

    a.send({ type: 'ready' }); b.send({ type: 'ready' });
    let views = await Promise.all([a, b].map(async peer =>
      (await peer.wait(message => message.room?.phase === 'playing')).room));
    const game = () => views[0].game;
    function conserved() {
      for (const room of views) {
        assert.equal(room.variant, 'duel'); assert.equal(room.game.variant, 'duel');
        assert.equal(room.game.chips.reduce((sum: number, chips: number) => sum + chips, room.game.pot), 40);
        assert.ok(room.game.chips.every((chips: number) => Number.isInteger(chips) && chips >= 0));
        assert.ok(!('decks' in room.game));
        assert.ok(room.players.every((player: Record<string, unknown>) => !('token' in player)));
      }
    }
    function privateHand(hand: number) {
      conserved();
      for (const [seat, room] of views.entries()) {
        assert.equal(room.phase, 'playing'); assert.equal(room.me, seat);
        assert.equal(room.game.stage, 'betting'); assert.equal(room.game.hand, hand);
        assert.equal(room.game.turn, (hand - 1) % 2);
        assert.equal(room.game.cards[seat], null);
        assert.ok(Number.isInteger(room.game.cards[1 - seat]) && room.game.cards[1 - seat] >= 1 && room.game.cards[1 - seat] <= 10);
        assert.deepEqual(room.game.remaining, Array(2).fill(9 - (hand - 1) % 10));
        assert.deepEqual(room.game.nextReady, [false, false]);
      }
    }
    async function act(seat: number, action: Record<string, unknown>) {
      // Stay below the real server's message limit even when a match needs several folds.
      await new Promise(done => setTimeout(done, 100));
      for (const peer of [a, b]) peer.messages.length = 0;
      [a, b][seat].send({ type: 'action', action });
      views = await Promise.all([a, b].map(async peer =>
        (await peer.wait(message => message.type === 'table-state')).room));
      conserved();
    }
    async function next() {
      const before = structuredClone(game());
      await act(0, { type: 'next' });
      assert.equal(game().stage, 'reveal'); assert.equal(game().hand, before.hand);
      assert.deepEqual(game().chips, before.chips); assert.deepEqual(game().cards, before.cards);
      assert.equal(game().pot, before.pot); assert.deepEqual(game().nextReady, [true, false]);
      await act(1, { type: 'next' });
      const ante = Math.min(1, ...before.chips);
      assert.deepEqual(game().chips, before.chips.map((chips: number) => chips - ante));
      assert.equal(game().pot, before.pot + ante * 2);
      privateHand(before.hand + 1);
    }

    privateHand(1);
    assert.deepEqual(game().chips, [19, 19]); assert.equal(game().pot, 2);
    a.send({ type: 'action', action: { type: 'next' } });
    assert.match((await a.wait(message => message.type === 'error')).message, /공개/);
    a.send({ type: 'action', action: { type: 'raise', amount: 1.5 } });
    assert.match((await a.wait(message => message.type === 'error')).message, /정수/);
    await act(0, { type: 'raise', amount: 3 });
    assert.deepEqual(game().chips, [16, 19]); assert.equal(game().pot, 5); assert.equal(game().bet, 4);
    await act(1, { type: 'call' });
    assert.equal(views[0].phase, 'playing'); assert.equal(game().stage, 'reveal');
    assert.ok(game().cards.every((card: unknown) => typeof card === 'number'));
    assert.equal(game().pot, game().cards[0] === game().cards[1] ? 8 : 0);
    await next();

    const beforeResume = structuredClone(game());
    b.ws.close();
    await new Promise<void>(done => b.ws.once('close', () => done()));
    await a.wait(message => message.room?.players.some((player: { connected: boolean }) => !player.connected));
    b = await client();
    b.send({ type: 'resume', game: 'poker', code: joined.code, token: second.token, variant: 'party' });
    assert.equal((await b.wait(message => message.type === 'joined')).token, second.token);
    views = await Promise.all([a, b].map(async peer =>
      (await peer.wait(message => message.room?.players.every((player: { connected: boolean }) => player.connected))).room));
    privateHand(2); assert.deepEqual(game(), beforeResume);

    const maximum = Math.min(...game().chips.map((chips: number, seat: number) => chips + game().bets[seat])) - game().bet;
    await act(game().turn, { type: 'raise', amount: maximum });
    await act(game().turn, { type: 'call' });
    assert.equal(game().stage, 'reveal');
    // An all-in tie can leave both stacks at zero; a normal fold awards the carried pot.
    // Otherwise fold the smaller stack so random cards cannot make this test run forever.
    for (let hands = 0; views[0].phase !== 'finished' && hands < 40; hands++) {
      await next();
      const loser = game().chips[0] <= game().chips[1] ? 0 : 1;
      if (game().turn !== loser) await act(game().turn, { type: 'call' });
      const before = structuredClone(game());
      const loserCard = views[1 - loser].game.cards[loser];
      await act(loser, { type: 'fold' });
      const penalty = loserCard === 10 ? Math.min(10, before.chips[loser]) : 0;
      assert.equal(game().chips[loser], before.chips[loser] - penalty);
      assert.equal(game().chips[1 - loser], before.chips[1 - loser] + before.pot + penalty);
    }
    assert.equal(views[0].phase, 'finished'); assert.equal(game().stage, 'reveal');
    assert.deepEqual([...game().chips].sort((x: number, y: number) => x - y), [0, 40]);
    assert.ok(game().cards.every((card: unknown) => typeof card === 'number'));
    assert.match(views[0].result, /승리/);
    a.messages.length = 0;
    a.send({ type: 'ready' });
    const waiting = (await a.wait(message => message.type === 'table-state')).room;
    assert.equal(waiting.phase, 'finished'); assert.equal(waiting.round, 1);
    b.send({ type: 'ready' });
    views = await Promise.all([a, b].map(async peer =>
      (await peer.wait(message => message.room?.round === 2)).room));
    privateHand(1);
    assert.deepEqual(game().chips, [19, 19]); assert.equal(game().pot, 2); assert.equal(game().winner, null);
  } finally { sockets.forEach(ws => ws.terminate()); await arena.close(); }
});
