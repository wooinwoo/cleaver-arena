import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createArenaServer } from '../server/index.ts';
import { CHAT_BURST, CHAT_HISTORY, CHAT_MAX_LENGTH, cleanChatText, createChatLimiter, postChat, type ChatMessage } from '../server/chat.ts';
import { PASSWORD_TRIES, admit, createPasswordGate, lockWith, readPassword } from '../server/room-password.ts';

type Message = Record<string, any>;
async function arena() {
  const server = createArenaServer();
  await new Promise<void>(done => server.server.listen(0, '127.0.0.1', done));
  const port = (server.server.address() as { port: number }).port;
  const sockets: WebSocket[] = [];
  /** Every frame any socket received, raw, to check that nothing secret ever went out. */
  const wire: string[] = [];
  async function client(path: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`); sockets.push(ws);
    const messages: Message[] = [];
    ws.on('message', raw => { wire.push(raw.toString()); messages.push(JSON.parse(raw.toString())); });
    await new Promise<void>(done => ws.once('open', () => done()));
    return {
      ws, messages,
      send: (data: unknown) => ws.send(JSON.stringify(data)),
      async wait(predicate: (data: Message) => boolean, ms = 8000) {
        const deadline = performance.now() + ms;
        while (performance.now() < deadline) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise(done => setTimeout(done, 10));
        }
        throw new Error(`timeout on ${path}`);
      },
    };
  }
  return { server, port, wire, client, async close() { sockets.forEach(ws => ws.terminate()); await server.close(); } };
}

test('chat text is trimmed, collapsed, capped and rate limited per connection', () => {
  assert.equal(cleanChatText('  안녕\n\n  하세요 \t'), '안녕 하세요');
  assert.equal(cleanChatText('a‮b\u0007c'), 'abc');
  assert.equal(cleanChatText(42), '');
  const history: ChatMessage[] = [];
  const limiter = createChatLimiter();
  const me = { id: 'p1', name: '방장' };
  assert.match(postChat(history, limiter, me, '   ', 0).error!, /입력/);
  assert.match(postChat(history, limiter, me, 'x'.repeat(CHAT_MAX_LENGTH + 1), 0).error!, /200자/);
  assert.equal(postChat(history, limiter, me, 'x'.repeat(CHAT_MAX_LENGTH), 0).message!.text.length, CHAT_MAX_LENGTH);
  for (let n = 1; n < CHAT_BURST; n++) assert.ok(postChat(history, limiter, me, `m${n}`, 100 * n).message);
  assert.match(postChat(history, limiter, me, 'too fast', 1000).error!, /너무 빨리/);
  assert.ok(postChat(history, limiter, me, 'later', 5001).message, 'the window slides');
  // History keeps the most recent messages only.
  const long: ChatMessage[] = [];
  const other = createChatLimiter();
  for (let n = 0; n < CHAT_HISTORY + 10; n++) postChat(long, other, me, `n${n}`, n * 2000);
  assert.equal(long.length, CHAT_HISTORY);
  assert.equal(long[0].text, 'n10');
});

test('room passwords keep only a salted hash and limit wrong guesses', () => {
  assert.deepEqual(readPassword(undefined), { ok: true, password: null });
  assert.deepEqual(readPassword('  '), { ok: true, password: null });
  assert.equal(readPassword('abc').ok, false);
  assert.equal(readPassword('a'.repeat(21)).ok, false);
  assert.deepEqual(readPassword(' 1234 '), { ok: true, password: '1234' });
  const lock = lockWith('비밀번호1')!;
  assert.ok(lock.salt.length === 16 && lock.hash.length === 32);
  assert.ok(!lock.hash.toString('utf8').includes('비밀번호1'));
  assert.notDeepEqual(lockWith('비밀번호1')!.hash, lock.hash, 'each room has its own salt');
  const gate = createPasswordGate();
  assert.equal(admit(null, undefined, gate), null, 'open rooms admit everyone');
  assert.match(admit(lock, '', gate)!.message, /입력/);
  assert.equal(admit(lock, ' 비밀번호1 ', gate), null);
  for (let n = 0; n < PASSWORD_TRIES; n++) assert.equal(admit(lock, `wrong${n}`, gate, 1000)!.message, '비밀번호가 맞지 않아요.');
  assert.match(admit(lock, '비밀번호1', gate, 2000)!.message, /여러 번/, 'blocked even with the right password');
  assert.equal(admit(lock, '비밀번호1', gate, 70_000), null, 'the block lifts after a minute');
});

test('table rooms: locked join, chat broadcast, history on join and resume, lobby lock flag', async () => {
  const site = await arena();
  try {
    const lobby = await site.client('/lobby-ws');
    const host = await site.client('/table-ws');
    host.send({ type: 'create', game: 'onecard', name: '방장', password: 'abc' });
    assert.match((await host.wait(m => m.type === 'error')).message, /4–20자/);
    host.send({ type: 'create', game: 'onecard', name: '방장', password: 'sesame12' });
    const { code } = await host.wait(m => m.type === 'joined');
    assert.deepEqual((await host.wait(m => m.type === 'chat-history')).messages, []);
    const state = await host.wait(m => m.type === 'table-state');
    assert.equal(state.room.locked, true);
    const listed = await lobby.wait(m => m.type === 'lobby' && m.rooms.some((r: Message) => r.code === code));
    assert.equal(listed.rooms.find((r: Message) => r.code === code).locked, true);

    const guest = await site.client('/table-ws');
    guest.send({ type: 'join', game: 'onecard', name: '손님', code });
    const missing = await guest.wait(m => m.type === 'error');
    assert.equal(missing.code, 'password');
    guest.send({ type: 'join', game: 'onecard', name: '손님', code, password: 'nope' });
    assert.equal((await guest.wait(m => m.type === 'error')).message, '비밀번호가 맞지 않아요.');
    guest.send({ type: 'join', game: 'onecard', name: '손님', code, password: 'sesame12' });
    const joined = await guest.wait(m => m.type === 'joined');

    host.send({ type: 'chat', text: '  어서 와요\n반가워요  ', name: '사칭' });
    const heard = await guest.wait(m => m.type === 'chat');
    assert.equal(heard.text, '어서 와요 반가워요');
    assert.equal(heard.name, '방장', 'the name comes from the room, not the request');
    assert.equal(typeof heard.at, 'number');
    assert.equal(typeof heard.from, 'string');
    await host.wait(m => m.type === 'chat', 2000);
    guest.send({ type: 'chat', text: '안녕하세요' });
    await host.wait(m => m.type === 'chat' && m.name === '손님');

    // A newcomer gets the conversation so far.
    const third = await site.client('/table-ws');
    third.send({ type: 'join', game: 'onecard', name: '셋째', code, password: 'sesame12' });
    await third.wait(m => m.type === 'joined');
    assert.deepEqual((await third.wait(m => m.type === 'chat-history')).messages.map((m: Message) => m.text), ['어서 와요 반가워요', '안녕하세요']);

    // Too many, too fast: a short error to the sender only.
    for (let n = 0; n < CHAT_BURST + 1; n++) third.send({ type: 'chat', text: `빠르게 ${n}` });
    assert.match((await third.wait(m => m.type === 'chat-error')).message, /너무 빨리/);
    third.send({ type: 'chat', text: '' });
    assert.match((await third.wait(m => m.type === 'chat-error')).message, /입력/);

    // Reconnecting with the room token needs no password and restores the history.
    guest.ws.close();
    await new Promise(done => setTimeout(done, 100));
    const back = await site.client('/table-ws');
    back.send({ type: 'resume', game: 'onecard', code, token: joined.token });
    await back.wait(m => m.type === 'joined');
    assert.ok((await back.wait(m => m.type === 'chat-history')).messages.length >= 2);

    // Only the host changes the password, and clearing it opens the room.
    back.send({ type: 'password', password: null });
    assert.match((await back.wait(m => m.type === 'error')).message, /방장만/);
    host.send({ type: 'password', password: '' });
    await host.wait(m => m.type === 'table-state' && m.room.locked === false);
    await lobby.wait(m => m.type === 'lobby' && m.rooms.some((r: Message) => r.code === code && r.locked === false));
    const open = await site.client('/table-ws');
    open.send({ type: 'join', game: 'onecard', name: '넷째', code });
    await open.wait(m => m.type === 'joined');

    for (const frame of site.wire) {
      assert.ok(!frame.includes('sesame12'), 'the password never leaves the server');
      assert.ok(!/"(salt|hash|lock|password)":/.test(frame), `no lock data on the wire: ${frame.slice(0, 120)}`);
    }
  } finally { await site.close(); }
});

test('cleaver and bumper rooms share chat and passwords', async () => {
  const site = await arena();
  try {
    for (const path of ['/ws', '/bumper-ws']) {
      const host = await site.client(path);
      host.send({ type: 'create', name: '방장', password: 'open sesame' });
      const created = await host.wait(m => m.type === 'joined');
      await host.wait(m => m.type === 'chat-history');
      const state = await host.wait(m => m.type === 'state');
      assert.equal(state.locked, true);
      const guest = await site.client(path);
      guest.send({ type: 'join', name: '손님', code: created.code, password: 'closed' });
      const wrong = await guest.wait(m => m.type === 'error');
      assert.equal(wrong.message, '비밀번호가 맞지 않아요.');
      assert.equal(wrong.code, 'password');
      guest.send({ type: 'join', name: '손님', code: created.code, password: 'open sesame' });
      const joined = await guest.wait(m => m.type === 'joined');
      await guest.wait(m => m.type === 'chat-history');
      guest.send({ type: 'chat', text: '시작할까요?' });
      const heard = await host.wait(m => m.type === 'chat');
      assert.equal(heard.name, '손님');
      assert.equal(heard.from, joined.id);
      guest.ws.close();
      await new Promise(done => setTimeout(done, 100));
      const back = await site.client(path);
      back.send({ type: 'resume', code: created.code, token: joined.token });
      await back.wait(m => m.type === 'joined');
      assert.deepEqual((await back.wait(m => m.type === 'chat-history')).messages.map((m: Message) => m.text), ['시작할까요?']);
      host.send({ type: 'password', password: null });
      await host.wait(m => m.type === 'state' && m.locked === false);
      host.ws.close(); back.ws.close();
    }
    for (const frame of site.wire) {
      assert.ok(!frame.includes('open sesame'));
      assert.ok(!/"(salt|hash|lock|password)":/.test(frame));
    }
  } finally { await site.close(); }
});
