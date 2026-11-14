import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { WebSocket } from 'ws';
import { createArenaServer } from '../server/index.ts';
import { RESERVED_NAME_MESSAGE, createMemoryAccountStore } from '../server/accounts.ts';
import { createRateLimiter } from '../server/auth.ts';
import { TABLE_GAMES } from '../shared/catalog.ts';

const PASSWORD = 'correct horse';
const JSON_TYPE = { 'Content-Type': 'application/json' };
type Reply = { status: number; headers: IncomingHttpHeaders; text: string; json: Record<string, any> | undefined };

async function start() {
  // A light work factor keeps the suite quick; the real one is covered in accounts.test.ts.
  const arena = createArenaServer({ accounts: createMemoryAccountStore({ cost: { N: 1024, r: 8, p: 1 } }) });
  await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
  const port = (arena.server.address() as { port: number }).port;
  const sockets: WebSocket[] = [];

  /** One request on its own connection. `body` as an array is sent in chunks without a length. */
  function send(method: string, path: string, options: { headers?: Record<string, string>; body?: string | Buffer | Buffer[]; hold?: boolean } = {}) {
    return new Promise<Reply>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method, path, agent: false, headers: options.headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Reply['json'];
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode!, headers: res.headers, text, json });
          if (options.hold) req.destroy();
        });
      });
      req.on('error', error => { if (!options.hold) reject(error); });
      if (options.hold) req.flushHeaders();
      else if (Array.isArray(options.body)) { for (const chunk of options.body) req.write(chunk); req.end(); }
      else req.end(options.body);
    });
  }
  const post = (path: string, payload: unknown, headers: Record<string, string> = {}) => send('POST', path, { headers: { ...JSON_TYPE, ...headers }, body: JSON.stringify(payload) });
  /** The `name=value` pair a browser would send back. */
  const cookieOf = (reply: Reply) => {
    const cookie = reply.headers['set-cookie']?.[0];
    assert.ok(cookie, 'a session cookie was set');
    return cookie.split(';')[0];
  };
  async function signup(name: string, headers: Record<string, string> = {}) {
    const reply = await post('/api/signup', { name, password: PASSWORD }, headers);
    assert.equal(reply.status, 200, reply.text);
    return cookieOf(reply);
  }
  async function socket(path: string, cookie?: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, cookie ? { headers: { Cookie: cookie } } : undefined);
    sockets.push(ws);
    const messages: Record<string, any>[] = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return {
      ws, send: (data: unknown) => ws.send(JSON.stringify(data)),
      async wait(predicate: (data: Record<string, any>) => boolean) {
        const deadline = performance.now() + 8000;
        while (performance.now() < deadline) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return messages.splice(0, index + 1).at(-1)!;
          await new Promise(done => setTimeout(done, 10));
        }
        throw new Error(`No matching message on ${path}`);
      },
    };
  }
  return {
    arena, port, send, post, cookieOf, signup, socket,
    async close() { sockets.forEach(ws => ws.terminate()); await arena.close(); },
  };
}

test('signup, me, logout and login manage the session cookie', async () => {
  const site = await start();
  try {
    assert.deepEqual((await site.send('GET', '/api/me')).json, { ok: true, member: false });

    const signup = await site.post('/api/signup', { name: '  Woo ', password: PASSWORD });
    assert.equal(signup.status, 200);
    assert.deepEqual(signup.json, { ok: true, member: true, name: 'Woo' });
    assert.equal(signup.headers['cache-control'], 'no-store');
    assert.equal(signup.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(signup.headers['x-content-type-options'], 'nosniff');
    assert.equal(signup.headers['set-cookie']?.length, 1);
    assert.match(signup.headers['set-cookie']![0], /^sideplay_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/, 'no Secure flag over plain HTTP');
    const cookie = site.cookieOf(signup);

    const me = await site.send('GET', '/api/me', { headers: { Cookie: `theme=dark; ${cookie}; other=1` } });
    assert.deepEqual(me.json, { ok: true, member: true, name: 'Woo' });
    assert.equal(me.headers['cache-control'], 'no-store');
    assert.equal(me.headers['set-cookie']?.[0], signup.headers['set-cookie']![0], 'me renews the same cookie');
    const head = await site.send('HEAD', '/api/me', { headers: { Cookie: cookie } });
    assert.equal(head.status, 200); assert.equal(head.text, '');
    for (const stale of ['sideplay_session=', 'sideplay_session=nope', `sideplay_session=${'A'.repeat(43)}`, `other_${cookie}`]) {
      const guest = await site.send('GET', '/api/me', { headers: { Cookie: stale } });
      assert.deepEqual(guest.json, { ok: true, member: false });
      assert.equal(guest.headers['set-cookie'], undefined);
    }

    // Behind a TLS proxy the cookie is marked Secure.
    const secure = await site.post('/api/login', { name: 'woo', password: PASSWORD }, { 'X-Forwarded-Proto': 'https', Cookie: cookie });
    assert.deepEqual(secure.json, { ok: true, member: true, name: 'Woo' });
    assert.match(secure.headers['set-cookie']![0], /^sideplay_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/);
    const second = site.cookieOf(secure);
    assert.notEqual(second, cookie);
    assert.deepEqual((await site.send('GET', '/api/me', { headers: { Cookie: cookie } })).json, { ok: true, member: false }, 'logging in again ends the session the browser held');
    assert.deepEqual((await site.send('GET', '/api/me', { headers: { Cookie: second } })).json, { ok: true, member: true, name: 'Woo' });

    const logout = await site.send('POST', '/api/logout', { headers: { ...JSON_TYPE, Cookie: second } });
    assert.equal(logout.status, 200);
    assert.deepEqual(logout.json, { ok: true, member: false });
    assert.equal(logout.headers['cache-control'], 'no-store');
    assert.equal(logout.headers['set-cookie']![0], 'sideplay_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    assert.deepEqual((await site.send('GET', '/api/me', { headers: { Cookie: second } })).json, { ok: true, member: false });
    const again = await site.send('POST', '/api/logout', { headers: { ...JSON_TYPE, 'X-Forwarded-Proto': 'https' }, body: '{}' });
    assert.equal(again.status, 200, 'logging out without a session is not an error');
    assert.equal(again.headers['set-cookie']![0], 'sideplay_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure');
  } finally { await site.close(); }
});

test('sign-up and login failures answer with a status and a Korean message', async () => {
  const site = await start();
  try {
    await site.signup('Woo');
    const cases: [string, unknown, number, RegExp][] = [
      ['/api/signup', { name: '가', password: PASSWORD }, 400, /닉네임은 2–12자/],
      ['/api/signup', { name: 'a'.repeat(13), password: PASSWORD }, 400, /닉네임은 2–12자/],
      ['/api/signup', { name: '새이름', password: '1234567' }, 400, /비밀번호는 8–128자/],
      ['/api/signup', { name: 'ｗｏｏ ', password: PASSWORD }, 409, /이미 가입된 닉네임/],
      ['/api/signup', { name: '새이름' }, 400, /닉네임과 비밀번호를 입력/],
      ['/api/signup', { name: 7, password: PASSWORD }, 400, /닉네임과 비밀번호를 입력/],
      ['/api/login', { password: PASSWORD }, 400, /닉네임과 비밀번호를 입력/],
      ['/api/login', { name: 'Woo', password: null }, 400, /닉네임과 비밀번호를 입력/],
    ];
    for (const [path, payload, status, message] of cases) {
      const reply = await site.post(path, payload);
      assert.equal(reply.status, status, JSON.stringify(payload));
      assert.equal(reply.json?.ok, false);
      assert.match(reply.json?.message, message);
      assert.deepEqual(Object.keys(reply.json!), ['ok', 'message']);
      assert.equal(reply.headers['set-cookie'], undefined);
      assert.equal(reply.headers['cache-control'], 'no-store');
    }
    const wrong = await site.post('/api/login', { name: 'Woo', password: 'wrong password' }, { 'X-Forwarded-For': '10.1.0.1' });
    const unknown = await site.post('/api/login', { name: 'Nobody', password: PASSWORD }, { 'X-Forwarded-For': '10.1.0.2' });
    const shapeless = await site.post('/api/login', { name: '', password: '' }, { 'X-Forwarded-For': '10.1.0.3' });
    for (const reply of [wrong, unknown, shapeless]) {
      assert.equal(reply.status, 401);
      assert.deepEqual(reply.json, { ok: false, message: '닉네임 또는 비밀번호가 맞지 않아요.' });
      assert.equal(reply.headers['set-cookie'], undefined);
    }
  } finally { await site.close(); }
});

test('the API refuses malformed, oversized, mistyped and cross-site requests', async () => {
  const origin = await start();
  // Each request arrives from its own address so the per-address limit stays out of this test.
  let address = 0;
  const site = {
    ...origin,
    send: (method: string, path: string, options: Parameters<typeof origin.send>[2] = {}) =>
      origin.send(method, path, { ...options, headers: { 'X-Forwarded-For': `10.5.${++address >> 8}.${address & 255}`, ...options.headers } }),
    post: (path: string, payload: unknown, headers: Record<string, string> = {}) =>
      origin.post(path, payload, { 'X-Forwarded-For': `10.5.${++address >> 8}.${address & 255}`, ...headers }),
  };
  try {
    const good = JSON.stringify({ name: 'Woo', password: PASSWORD });
    for (const body of ['', '{', 'name=Woo', '[]', '"Woo"', 'null', '7', Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])]) {
      const reply = await site.send('POST', '/api/signup', { headers: JSON_TYPE, body });
      assert.equal(reply.status, 400, String(body));
      assert.deepEqual(reply.json, { ok: false, message: '요청을 읽지 못했어요.' });
    }

    const padded = JSON.stringify({ name: 'Woo', password: PASSWORD, padding: 'x'.repeat(2100) });
    const tooLarge = { ok: false, message: '요청이 너무 커요.' };
    const sized = await site.send('POST', '/api/signup', { headers: JSON_TYPE, body: padded });
    assert.equal(sized.status, 413); assert.deepEqual(sized.json, tooLarge);
    const chunked = await site.send('POST', '/api/signup', { headers: JSON_TYPE, body: [Buffer.from(padded.slice(0, 1500)), Buffer.from(padded.slice(1500))] });
    assert.equal(chunked.status, 413); assert.deepEqual(chunked.json, tooLarge);
    const huge = await site.send('POST', '/api/login', { headers: { ...JSON_TYPE, 'Content-Length': '5000000' }, hold: true });
    assert.equal(huge.status, 413, 'a huge body is refused before any of it is read');
    assert.equal(huge.headers.connection, 'close');
    const exact = JSON.stringify({ name: 'Edge', password: PASSWORD, padding: '' });
    const fits = JSON.stringify({ name: 'Edge', password: PASSWORD, padding: 'x'.repeat(2048 - exact.length) });
    assert.equal(Buffer.byteLength(fits), 2048);
    assert.equal((await site.send('POST', '/api/signup', { headers: JSON_TYPE, body: fits })).status, 200, 'exactly 2 KB is still accepted');

    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonp']) {
      for (const path of ['/api/signup', '/api/login', '/api/logout']) {
        const reply = await site.send('POST', path, { headers: type ? { 'Content-Type': type } : {}, body: good });
        assert.equal(reply.status, 415, `${type} ${path}`);
        assert.deepEqual(reply.json, { ok: false, message: '요청 형식이 올바르지 않아요.' });
      }
    }
    assert.equal((await site.send('POST', '/api/signup', { headers: { 'Content-Type': 'Application/JSON; charset=utf-8' }, body: good })).status, 200);

    const host = `127.0.0.1:${site.port}`;
    for (const origin of ['http://evil.example', `http://127.0.0.1:${site.port + 1}`, 'https://127.0.0.1', 'null', 'not a url']) {
      for (const path of ['/api/signup', '/api/login', '/api/logout']) {
        const reply = await site.post(path, { name: 'Cross', password: PASSWORD }, { Origin: origin });
        assert.equal(reply.status, 403, `${origin} ${path}`);
        assert.deepEqual(reply.json, { ok: false, message: '허용되지 않은 요청이에요.' });
        assert.equal(reply.headers['set-cookie'], undefined);
      }
    }
    assert.equal(site.arena.accounts.isReserved('Cross'), false);
    assert.equal((await site.post('/api/login', { name: 'Woo', password: PASSWORD }, { Origin: `http://${host}` })).status, 200, 'the site itself may post');

    for (const [method, path, allow] of [['GET', '/api/signup', 'POST'], ['GET', '/api/login', 'POST'], ['GET', '/api/logout', 'POST'], ['PUT', '/api/login', 'POST'], ['POST', '/api/me', 'GET, HEAD'], ['DELETE', '/api/me', 'GET, HEAD']]) {
      const reply = await site.send(method, path, { headers: JSON_TYPE });
      assert.equal(reply.status, 405, `${method} ${path}`);
      assert.equal(reply.headers.allow, allow);
      assert.equal(reply.json?.ok, false);
    }
    for (const path of ['/api', '/api/', '/api/unknown', '/api/login/', '/api/me/x', '/api/%6De']) {
      const reply = await site.send('GET', path);
      assert.equal(reply.status, 404, path);
      assert.deepEqual(reply.json, { ok: false, message: '찾을 수 없는 주소예요.' });
    }
    // The rest of the site is as before: only GET and HEAD.
    assert.equal((await site.send('POST', '/', { headers: JSON_TYPE, body: good })).status, 405);
    assert.equal((await site.send('POST', '/apiary', { headers: JSON_TYPE, body: good })).status, 405);
    assert.deepEqual((await site.send('GET', '/health')).json, { ok: true });
  } finally { await site.close(); }
});

test('an address gets 20 sign-up or login posts per 10 minutes', async () => {
  const site = await start();
  try {
    const from = (address: string) => ({ 'X-Forwarded-For': address });
    const limited = { ok: false, message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' };
    await site.signup('Woo', from('10.0.0.9'));
    // Requests from another site are refused without being counted.
    for (let i = 0; i < 25; i++) assert.equal((await site.post('/api/login', {}, { ...from('10.0.0.1, 172.16.0.1'), Origin: 'http://evil.example' })).status, 403);
    for (let i = 0; i < 20; i++) {
      const reply = i % 2 ? await site.send('POST', '/api/signup', { headers: { ...JSON_TYPE, ...from('10.0.0.1, 172.16.0.1') }, body: '{' })
        : await site.post('/api/login', { name: 'Woo', password: PASSWORD }, from(' 10.0.0.1 , 172.16.0.2'));
      assert.equal(reply.status, i % 2 ? 400 : 200, `post ${i + 1}`);
    }
    for (const path of ['/api/login', '/api/signup']) {
      const reply = await site.post(path, { name: 'Woo', password: PASSWORD }, from('10.0.0.1'));
      assert.equal(reply.status, 429);
      assert.deepEqual(reply.json, limited);
      const retry = Number(reply.headers['retry-after']);
      assert.ok(retry > 590 && retry <= 600, `Retry-After ${retry}`);
      assert.equal(reply.headers['cache-control'], 'no-store');
    }
    // Only the first forwarded hop counts, and other addresses are unaffected.
    assert.equal((await site.post('/api/login', { name: 'Woo', password: PASSWORD }, from('10.0.0.2, 10.0.0.1'))).status, 200);
    // Logging out and reading the session stay possible.
    const logout = await site.send('POST', '/api/logout', { headers: { ...JSON_TYPE, ...from('10.0.0.1') } });
    assert.equal(logout.status, 200);
    for (let i = 0; i < 25; i++) assert.equal((await site.send('POST', '/api/logout', { headers: { ...JSON_TYPE, ...from('10.0.0.3') } })).status, 200);
    assert.equal((await site.post('/api/login', { name: 'Woo', password: PASSWORD }, from('10.0.0.3'))).status, 200);
    assert.equal((await site.send('GET', '/api/me', { headers: from('10.0.0.1') })).status, 200);

    // Without a proxy header the peer address is the key.
    for (let i = 0; i < 20; i++) assert.equal((await site.send('POST', '/api/login', { headers: JSON_TYPE, body: '{' })).status, 400);
    assert.deepEqual((await site.post('/api/login', { name: 'Woo', password: PASSWORD })).json, limited);
  } finally { await site.close(); }
});

test('a nickname gets 8 failed logins per 10 minutes', async () => {
  const site = await start();
  try {
    let address = 0;
    // Every request comes from a new address, so only the per-nickname limit is in play.
    const login = (name: string, password: string) => site.post('/api/login', { name, password }, { 'X-Forwarded-For': `10.2.0.${++address}` });
    const limited = { ok: false, message: '로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' };
    await site.signup('Woo', { 'X-Forwarded-For': '10.3.0.1' });
    await site.signup('Kim', { 'X-Forwarded-For': '10.3.0.2' });

    // Successful logins are not failures, however many there are.
    for (let i = 0; i < 10; i++) assert.equal((await login('Kim', PASSWORD)).status, 200);
    // Guesses made at the same moment are all counted, in any spelling of the nickname.
    const guesses = await Promise.all(['Woo', 'woo', 'ＷＯＯ', ' W o o ', 'Woo', 'Woo', 'Woo', 'Woo', 'Woo', 'Woo', 'Woo', 'Woo'].map((name, i) => login(name, `guess number ${i}`)));
    assert.equal(guesses.filter(reply => reply.status === 401).length, 8);
    assert.equal(guesses.filter(reply => reply.status === 429).length, 4);
    const locked = await login('Woo', PASSWORD);
    assert.equal(locked.status, 429, 'even the right password waits once the limit is reached');
    assert.deepEqual(locked.json, limited);
    assert.equal(locked.headers['set-cookie'], undefined);
    const retry = Number(locked.headers['retry-after']);
    assert.ok(retry > 590 && retry <= 600, `Retry-After ${retry}`);
    assert.equal((await login('Kim', PASSWORD)).status, 200, 'other nicknames are unaffected');

    // A nickname nobody owns is limited the same way, so the limit does not reveal which exist.
    for (let i = 0; i < 8; i++) assert.equal((await login('Ghost', PASSWORD)).status, 401);
    assert.deepEqual((await login('ghost', PASSWORD)).json, limited);
    // Signing up is not a login attempt.
    assert.equal((await site.post('/api/signup', { name: 'Ghost', password: PASSWORD }, { 'X-Forwarded-For': '10.3.0.3' })).status, 200);
  } finally { await site.close(); }
});

test('the limiter counts a sliding window and gives uses back', () => {
  let clock = 0;
  const limiter = createRateLimiter(3, 1000, () => clock, 4);
  assert.deepEqual([limiter.take('a'), limiter.take('a'), limiter.take('a')], [0, 0, 0]);
  assert.equal(limiter.take('a'), 1000);
  clock = 400;
  assert.equal(limiter.take('a'), 600);
  assert.equal(limiter.take('b'), 0, 'keys are separate');
  limiter.refund('a');
  assert.equal(limiter.take('a'), 0, 'a refunded use is free again');
  limiter.refund('missing');
  clock = 999;
  assert.equal(limiter.take('a'), 1);
  clock = 1000;
  assert.equal(limiter.take('a'), 0, 'the oldest use has left the window');
  assert.equal(limiter.take('a'), 0);
  assert.equal(limiter.take('a'), 400, 'a refused use is not recorded, so the wait runs from the oldest kept use');
  // The table stays bounded: lapsed keys are dropped first, then the oldest.
  clock = 5000;
  for (const key of ['c', 'd', 'e', 'f', 'g', 'h']) assert.equal(limiter.take(key), 0);
  assert.deepEqual([limiter.take('h'), limiter.take('h')], [0, 0]);
  assert.ok(limiter.take('h') > 0);
});

test('a logged-in member plays under the account nickname on every socket', async () => {
  const site = await start();
  try {
    const cookie = await site.signup('Woo');
    const guestList = (players: Record<string, any>[]) => players.map(({ name, member }) => ({ name, member }));

    const cleaver = await site.socket('/ws', cookie);
    cleaver.send({ type: 'create', name: '가짜 이름', practice: true });
    const cleaverJoined = await cleaver.wait(data => data.type === 'joined');
    const cleaverState = await cleaver.wait(data => data.type === 'state');
    assert.deepEqual(guestList(cleaverState.game.players), [{ name: 'Woo', member: true }, { name: '연습 로봇', member: false }]);
    assert.equal(cleaverState.game.title, 'Woo의 문도피구');
    assert.equal(site.arena.rooms.get(cleaverJoined.code)!.game.players[0].member, true);

    const table = await site.socket('/table-ws', cookie);
    table.send({ type: 'create', game: 'gomoku', name: '가짜 이름' });
    const tableJoined = await table.wait(data => data.type === 'joined');
    const tableState = await table.wait(data => data.type === 'table-state');
    assert.deepEqual(tableState.room.players.map(({ id, token, ...rest }: Record<string, any>) => rest), [{ name: 'Woo', seat: 0, ready: false, connected: true, member: true }]);
    assert.equal(tableState.room.title, `Woo의 ${TABLE_GAMES.gomoku.title}`);
    // A guest joins the member's room: refused under the member's nickname, welcome under another.
    const visitor = await site.socket('/table-ws');
    visitor.send({ type: 'join', game: 'gomoku', code: tableJoined.code, name: 'ｗｏｏ' });
    assert.deepEqual(await visitor.wait(data => data.type === 'error'), { type: 'error', message: RESERVED_NAME_MESSAGE });
    visitor.send({ type: 'join', game: 'gomoku', code: tableJoined.code, name: '손님' });
    await visitor.wait(data => data.type === 'joined');
    assert.deepEqual(guestList((await visitor.wait(data => data.type === 'table-state' && data.room.players.length === 2)).room.players), [{ name: 'Woo', member: true }, { name: '손님', member: false }]);
    // A second member joining without sending any name at all.
    const kim = await site.socket('/table-ws', await site.signup('Kim', { 'X-Forwarded-For': '10.4.0.1' }));
    kim.send({ type: 'create', game: 'gomoku' });
    await kim.wait(data => data.type === 'joined');
    kim.send({ type: 'bot' });
    assert.deepEqual(guestList((await kim.wait(data => data.type === 'table-state' && data.room.players.length === 2)).room.players), [{ name: 'Kim', member: true }, { name: '봇', member: false }]);

    const bumper = await site.socket('/bumper-ws', cookie);
    bumper.send({ type: 'create', name: '가짜 이름', solo: true });
    await bumper.wait(data => data.type === 'joined');
    const bumperState = await bumper.wait(data => data.type === 'state');
    assert.deepEqual(guestList(bumperState.game.players), [{ name: 'Woo', member: true }, { name: '봇 1', member: false }, { name: '봇 2', member: false }, { name: '봇 3', member: false }]);
    assert.match(bumperState.game.title, /^Woo의 /);

    const lobby = await site.socket('/lobby-ws', cookie);
    lobby.send({ type: 'hello', name: '가짜 이름' });
    const listed = await lobby.wait(data => data.type === 'lobby' && data.members.length === 1);
    assert.deepEqual(guestList(listed.members), [{ name: 'Woo', member: true }]);
    assert.deepEqual(Object.keys(listed.members[0]).sort(), ['id', 'member', 'name']);
    const guest = await site.socket('/lobby-ws');
    guest.send({ type: 'hello', name: '손님' });
    assert.deepEqual(guestList((await guest.wait(data => data.type === 'lobby' && data.members.length === 2)).members), [{ name: 'Woo', member: true }, { name: '손님', member: false }]);
  } finally { await site.close(); }
});

test('a guest asking for a member nickname is refused on every socket', async () => {
  const site = await start();
  try {
    await site.signup('Woo');
    const refusal = { type: 'error', message: RESERVED_NAME_MESSAGE };
    assert.equal(refusal.message, '이미 가입된 닉네임이에요. 로그인하거나 다른 닉네임을 써 주세요.');
    const players = (data: Record<string, any>) => (data.game ?? data.room).players.map(({ name, member }: Record<string, any>) => ({ name, member }));

    for (const [path, extra] of [['/ws', {}], ['/table-ws', { game: 'gomoku' }], ['/bumper-ws', {}]] as const) {
      const guest = await site.socket(path);
      const rooms = site.arena.rooms.size;
      for (const name of ['Woo', 'ｗｏｏ ', 'W O O']) {
        guest.send({ type: 'create', name, ...extra });
        assert.deepEqual(await guest.wait(data => data.type === 'error'), refusal, `${path} ${name}`);
      }
      guest.send({ type: 'join', name: 'woo', code: 'ABCDEF', ...extra });
      assert.deepEqual(await guest.wait(data => data.type === 'error'), refusal, `${path} join`);
      assert.equal(site.arena.rooms.size, rooms, 'nothing was created');
      // The same socket is still free to play under another nickname.
      guest.send({ type: 'create', name: 'Woo2', ...extra });
      await guest.wait(data => data.type === 'joined');
      assert.deepEqual(players(await guest.wait(data => data.type === 'state' || data.type === 'table-state')), [{ name: 'Woo2', member: false }], path);
    }
    assert.equal(site.arena.rooms.size, 1);

    const lobby = await site.socket('/lobby-ws');
    const before = await lobby.wait(data => data.type === 'lobby');
    assert.deepEqual(before.members, []);
    assert.equal(before.rooms.length, 3, 'only the rooms made under allowed names exist');
    for (const name of ['Woo', 'ｗｏｏ']) {
      lobby.send({ type: 'hello', name });
      assert.deepEqual(await lobby.wait(data => data.type === 'error'), refusal);
    }
    lobby.send({ type: 'hello', name: '손님' });
    const listed = await lobby.wait(data => data.type === 'lobby' && data.members.length > 0);
    assert.deepEqual(listed.members.map(({ name, member }: Record<string, any>) => ({ name, member })), [{ name: '손님', member: false }]);
    // A refused name leaves the guest listed under the one it already had.
    lobby.send({ type: 'hello', name: 'woo' });
    assert.deepEqual(await lobby.wait(data => data.type === 'error'), refusal);
    lobby.send({ type: 'ping', time: 1 });
    await lobby.wait(data => data.type === 'pong');
    lobby.send({ type: 'hello', name: '손님2' });
    assert.deepEqual((await lobby.wait(data => data.type === 'lobby' && data.members[0]?.name === '손님2')).members.length, 1);
  } finally { await site.close(); }
});

test('a cookie that is logged out or made up is a guest on the sockets', async () => {
  const site = await start();
  try {
    const cookie = await site.signup('Woo');
    const refusal = { type: 'error', message: RESERVED_NAME_MESSAGE };
    const lobby = await site.socket('/lobby-ws', cookie);
    lobby.send({ type: 'hello' });
    assert.equal((await lobby.wait(data => data.type === 'lobby' && data.members.length === 1)).members[0].member, true);
    const waiting = await site.socket('/table-ws', cookie);

    assert.equal((await site.send('POST', '/api/logout', { headers: { ...JSON_TYPE, Cookie: cookie } })).status, 200);

    // Sockets opened while logged in stop acting as the member the next time they need a name.
    waiting.send({ type: 'create', game: 'gomoku', name: 'Woo' });
    assert.deepEqual(await waiting.wait(data => data.type === 'error'), refusal);
    lobby.send({ type: 'hello', name: 'Woo' });
    assert.deepEqual((await lobby.wait(data => data.type === 'lobby' && data.members.length === 0)).members, [], 'no longer listed under the account nickname');
    assert.deepEqual(await lobby.wait(data => data.type === 'error'), refusal);
    lobby.send({ type: 'hello', name: '손님' });
    assert.deepEqual((await lobby.wait(data => data.type === 'lobby' && data.members.length === 1)).members.map(({ name, member }: Record<string, any>) => ({ name, member })), [{ name: '손님', member: false }]);

    for (const stale of [cookie, `sideplay_session=${'A'.repeat(43)}`, 'sideplay_session=x']) {
      const guest = await site.socket('/bumper-ws', stale);
      guest.send({ type: 'create', name: 'Woo' });
      assert.deepEqual(await guest.wait(data => data.type === 'error'), refusal);
      guest.send({ type: 'create', name: '손님' });
      await guest.wait(data => data.type === 'joined');
      assert.deepEqual((await guest.wait(data => data.type === 'state')).game.players.map(({ name, member }: Record<string, any>) => ({ name, member })), [{ name: '손님', member: false }]);
    }
  } finally { await site.close(); }
});
