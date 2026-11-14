import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { type AccountStore, type SessionGrant } from '../server/accounts.ts';
import { createDatabaseAccountStore, databaseHost, pipelineUrl, type DatabaseConfig } from '../server/accounts-db.ts';

const cost = { N: 1024, r: 8, p: 1 };
const PASSWORD = 'correct horse';
const TOKEN = 'test-auth-token';
const DAY = 24 * 60 * 60 * 1000;

type Value = { type: string; value?: unknown; base64?: string };
type Logged = { authorization: string | undefined; path: string | undefined; statements: Array<{ sql: string; args: Value[] }> };
type Mode = 'ok' | 'reset' | 'hang' | 'error-500' | 'garbage';

/**
 * A stand-in for Turso's HTTP API: `POST /v2/pipeline` with `execute` and `close` requests,
 * answered in the documented shape and run on a real SQLite database.
 */
async function fakeDatabase() {
  const db = new DatabaseSync(':memory:');
  const log: Logged[] = [];
  let mode: Mode = 'ok';
  const toArg = (value: Value) => {
    if (value.type === 'null') return null;
    if (value.type === 'integer') return BigInt(String(value.value));
    if (value.type === 'float') return Number(value.value);
    if (value.type === 'text') return String(value.value);
    if (value.type === 'blob') return Buffer.from(String(value.base64), 'base64');
    throw new Error(`unknown value type ${value.type}`);
  };
  const toValue = (value: unknown): Value => {
    if (value === null || value === undefined) return { type: 'null' };
    if (typeof value === 'bigint') return { type: 'integer', value: String(value) };
    if (typeof value === 'number') return Number.isInteger(value) ? { type: 'integer', value: String(value) } : { type: 'float', value };
    if (value instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(value).toString('base64') };
    return { type: 'text', value: String(value) };
  };
  const execute = (stmt: { sql: string; args?: Value[] }) => {
    try {
      const prepared = db.prepare(stmt.sql);
      const args = (stmt.args ?? []).map(toArg);
      const columns = prepared.columns();
      if (columns.length) {
        const rows = prepared.all(...args).map(row => Object.values(row).map(toValue));
        return { type: 'ok', response: { type: 'execute', result: { cols: columns.map(column => ({ name: column.name, decltype: null })), rows, affected_row_count: 0, last_insert_rowid: null } } };
      }
      const outcome = prepared.run(...args);
      return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: Number(outcome.changes), last_insert_rowid: String(outcome.lastInsertRowid) } } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { type: 'error', error: { message: `SQLite error: ${message}`, code: /constraint/i.test(message) ? 'SQLITE_CONSTRAINT' : 'SQLITE_ERROR' } };
    }
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const requests: Array<{ type: string; stmt?: { sql: string; args?: Value[] } }> = body.requests ?? [];
      log.push({
        authorization: req.headers.authorization, path: req.url,
        statements: requests.filter(request => request.type === 'execute').map(request => ({ sql: request.stmt!.sql, args: request.stmt!.args ?? [] })),
      });
      if (mode === 'hang') return;
      if (mode === 'reset') { req.socket.destroy(); return; }
      if (mode === 'error-500') { res.writeHead(500).end('{"error":"down"}'); return; }
      if (mode === 'garbage') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"results":'); return; }
      if (req.method !== 'POST' || req.url !== '/v2/pipeline') { res.writeHead(404).end(); return; }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end('{"error":"Unauthorized"}'); return; }
      const results = requests.map(request => {
        if (request.type === 'close') return { type: 'ok', response: { type: 'close' } };
        if (request.type === 'execute' && request.stmt) return execute(request.stmt);
        return { type: 'error', error: { message: 'unsupported request' } };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url, db, log,
    config: (extra: Partial<DatabaseConfig> = {}): DatabaseConfig => ({ url, authToken: TOKEN, connectAttempts: 1, ...extra }),
    setMode(next: Mode) { mode = next; },
    count: (sql: string, ...args: string[]) => Number((db.prepare(sql).get(...args) as Record<string, unknown>).n),
    async close() {
      server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done()));
      db.close();
    },
  };
}

async function granted(result: Promise<Awaited<ReturnType<AccountStore['signup']>>>): Promise<SessionGrant> {
  const value = await result;
  assert.equal(value.ok, true, value.ok ? '' : value.message);
  return value as SessionGrant;
}
async function refused(result: Promise<Awaited<ReturnType<AccountStore['signup']>>>) {
  const value = await result;
  assert.equal(value.ok, false);
  if (value.ok) throw new Error('unreachable');
  assert.match(value.message, /[가-힣]/, 'failures carry a Korean message');
  return value;
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

test('database addresses become pipeline URLs and only the host is printed', () => {
  assert.equal(pipelineUrl('libsql://sideplay-me.aws-ap-northeast-1.turso.io'), 'https://sideplay-me.aws-ap-northeast-1.turso.io/v2/pipeline');
  assert.equal(pipelineUrl(' LIBSQL://db.example.io/ '), 'https://db.example.io/v2/pipeline');
  assert.equal(pipelineUrl('https://db.example.io'), 'https://db.example.io/v2/pipeline');
  assert.equal(pipelineUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080/v2/pipeline');
  assert.equal(databaseHost('libsql://db.example.io?authToken=secret'), 'db.example.io');
  assert.throws(() => pipelineUrl('ftp://db.example.io'));
});

test('the database store signs up, logs in and out like the other stores and creates its tables', async () => {
  const fake = await fakeDatabase();
  try {
    const store = await createDatabaseAccountStore(fake.config(), { cost });
    const tables = fake.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    assert.deepEqual(tables, ['accounts', 'accounts_name_key', 'sessions', 'sessions_account']);
    assert.equal(store.isReserved('Woo'), false);

    const signup = await granted(store.signup('  Woo ', PASSWORD));
    assert.equal(signup.account.name, 'Woo');
    assert.deepEqual(store.accountForToken(signup.token), signup.account);
    assert.equal((await refused(store.login('Woo', 'correct horsf'))).reason, 'bad-credentials');
    assert.equal((await refused(store.login('Nobody', PASSWORD))).reason, 'bad-credentials');
    assert.equal((await refused(store.signup('가', PASSWORD))).reason, 'invalid-name');
    assert.equal((await refused(store.signup('Short', 'short'))).reason, 'invalid-password');
    const login = await granted(store.login('ｗｏｏ', PASSWORD));
    assert.deepEqual(login.account, signup.account);

    const account = fake.db.prepare('SELECT * FROM accounts').get() as Record<string, unknown>;
    assert.equal(account.id, signup.account.id);
    assert.equal(account.name, 'Woo');
    assert.equal(account.name_key, 'woo');
    assert.equal(Buffer.from(String(account.salt), 'base64').length, 16);
    assert.equal(Buffer.from(String(account.hash), 'base64').length, 64);
    assert.deepEqual([account.cost_n, account.cost_r, account.cost_p], [cost.N, cost.r, cost.p]);
    const hashes = fake.db.prepare('SELECT token_hash FROM sessions ORDER BY created_at').all().map(row => row.token_hash);
    assert.deepEqual(new Set(hashes), new Set([sha256(signup.token), sha256(login.token)]), 'only the SHA-256 of each token is stored');
    const dump = JSON.stringify([fake.db.prepare('SELECT * FROM accounts').all(), fake.db.prepare('SELECT * FROM sessions').all()]);
    assert.ok(!dump.includes(PASSWORD) && !dump.includes(signup.token) && !dump.includes(login.token), 'no password or token in the database');

    await store.logout(signup.token);
    assert.equal(store.accountForToken(signup.token), null);
    assert.deepEqual(store.accountForToken(login.token), signup.account, 'other sessions of the account stay');
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM sessions'), 1, 'the logout reached the database');
    await store.logout('nope');
    await store.logout(null);
    assert.ok(fake.log.every(entry => entry.authorization === `Bearer ${TOKEN}` && entry.path === '/v2/pipeline'), 'every request carries the token');
    await store.close();
  } finally { await fake.close(); }
});

test('nicknames are unique in any spelling, also between two stores on one database', async () => {
  const fake = await fakeDatabase();
  try {
    const store = await createDatabaseAccountStore(fake.config(), { cost });
    await granted(store.signup('Woo', PASSWORD));
    for (const name of ['woo', 'WOO', 'ｗｏｏ ', 'W o o', 'Wooㅤ']) {
      assert.equal((await refused(store.signup(name, PASSWORD))).reason, 'name-taken', JSON.stringify(name));
      assert.equal(store.isReserved(name), true);
    }
    // A store that has not seen the account still cannot store it twice: the unique index refuses it.
    const other = await createDatabaseAccountStore(fake.config(), { cost });
    await store.signup('Later', PASSWORD);
    const late = await refused(other.signup('ＬＡＴＥＲ', PASSWORD));
    assert.equal(late.reason, 'name-taken');
    assert.equal(other.isReserved('Later'), false, 'a refused sign-up adds nothing to the other store');
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM accounts'), 2);
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM sessions'), 2, 'the refused sign-up left no session');
    await Promise.all([store.close(), other.close()]);
  } finally { await fake.close(); }
});

test('concurrent sign-ups of one nickname: exactly one wins', async () => {
  const fake = await fakeDatabase();
  try {
    const stores = await Promise.all([1, 2, 3, 4].map(() => createDatabaseAccountStore(fake.config(), { cost })));
    const spellings = ['한글', '한 글', 'Ｈａｎ', 'han'];
    // Two nicknames, each raced from four stores (and twice within each store).
    const results = await Promise.all(stores.flatMap(store => [
      store.signup(spellings[0], PASSWORD), store.signup(spellings[1], PASSWORD),
      store.signup(spellings[2], PASSWORD), store.signup(spellings[3], PASSWORD),
    ]));
    const won = results.filter((result): result is SessionGrant => result.ok);
    assert.equal(won.length, 2, 'one winner per nickname');
    assert.deepEqual(new Set(won.map(result => result.account.name.normalize('NFKC').toLowerCase().replace(/\s/g, ''))), new Set(['한글', 'han']));
    assert.ok(results.every(result => result.ok || result.reason === 'name-taken'));
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM accounts'), 2);
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM sessions'), 2);
    await Promise.all(stores.map(store => store.close()));
  } finally { await fake.close(); }
});

test('accounts and sessions survive a restart on the same database', async () => {
  const fake = await fakeDatabase();
  let clock = Date.UTC(2026, 0, 1);
  const options = { cost, now: () => clock };
  try {
    let store = await createDatabaseAccountStore(fake.config(), options);
    const woo = await granted(store.signup('Woo', PASSWORD));
    const gone = await granted(store.login('Woo', PASSWORD));
    const kim = await granted(store.signup('김철수', 'another password'));
    await store.logout(gone.token);
    await store.close();

    store = await createDatabaseAccountStore(fake.config(), options);
    assert.deepEqual(store.accountForToken(woo.token), woo.account);
    assert.deepEqual(store.accountForToken(kim.token), kim.account);
    assert.equal(store.accountForToken(gone.token), null, 'a logout survives the restart');
    assert.equal(store.isReserved('ｗｏｏ'), true);
    assert.equal((await refused(store.signup('woo', PASSWORD))).reason, 'name-taken');
    assert.deepEqual((await granted(store.login('김철수', 'another password'))).account, kim.account);
    // A use too recent to be saved on its own is written on close.
    clock += 29 * DAY;
    assert.ok(store.accountForToken(woo.token));
    clock += 1000;
    assert.ok(store.accountForToken(woo.token));
    await store.close();
    assert.equal((fake.db.prepare('SELECT last_seen_at AS t FROM sessions WHERE token_hash = ?').get(sha256(woo.token)) as { t: number }).t, clock);

    clock += 2 * DAY;
    store = await createDatabaseAccountStore(fake.config(), options);
    assert.deepEqual(store.accountForToken(woo.token), woo.account, 'used 2 days ago');
    assert.equal(store.accountForToken(kim.token), null, 'the sign-up session was unused for 31 days');
    await store.close();
  } finally { await fake.close(); }
});

test('sessions expire after 30 unused days and an account keeps at most ten', async () => {
  const fake = await fakeDatabase();
  let clock = Date.UTC(2026, 0, 1);
  const options = { cost, now: () => clock };
  try {
    const store = await createDatabaseAccountStore(fake.config(), options);
    const idle = await granted(store.signup('Idle', PASSWORD));
    const active = await granted(store.signup('Active', PASSWORD));
    clock += 29 * DAY;
    assert.ok(store.accountForToken(active.token));
    clock += DAY;
    assert.equal(store.accountForToken(idle.token), null, 'gone after 30 idle days');
    clock += 20 * DAY;
    assert.ok(store.accountForToken(active.token), 'each use pushes the expiry back');
    await store.close();
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?', sha256(idle.token)), 0, 'the expired session left the database');
    assert.equal(store.isReserved('Idle'), true, 'expiry never touches the account');

    // A session that expired while the server was down is cleared when it starts again.
    clock += 31 * DAY;
    const again = await createDatabaseAccountStore(fake.config(), options);
    assert.equal(again.accountForToken(active.token), null);
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM sessions'), 0);

    const tokens = [(await granted(again.login('Idle', PASSWORD))).token];
    for (let i = 0; i < 10; i++) { clock += 1000; tokens.push((await granted(again.login('Idle', PASSWORD))).token); }
    assert.equal(again.accountForToken(tokens[0]), null, 'the longest unused session is dropped');
    assert.ok(tokens.slice(1).every(token => again.accountForToken(token)));
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM sessions'), 10, 'the database keeps ten too');
    await again.close();
  } finally { await fake.close(); }
});

test('an account hashed with another work factor is upgraded in the database at login', async () => {
  const fake = await fakeDatabase();
  try {
    const light = await createDatabaseAccountStore(fake.config(), { cost });
    await granted(light.signup('Old', PASSWORD));
    await light.close();
    const heavier = { N: 2048, r: 8, p: 1 };
    const store = await createDatabaseAccountStore(fake.config(), { cost: heavier });
    await granted(store.login('Old', PASSWORD));
    const row = fake.db.prepare('SELECT cost_n AS n FROM accounts').get() as { n: number };
    assert.equal(row.n, heavier.N);
    await store.close();
    const reloaded = await createDatabaseAccountStore(fake.config(), { cost: heavier });
    await granted(reloaded.login('Old', PASSWORD));
    await reloaded.close();
  } finally { await fake.close(); }
});

test('no user input is ever written into SQL text', async () => {
  const fake = await fakeDatabase();
  try {
    const store = await createDatabaseAccountStore(fake.config(), { cost });
    const names = ["a'); DROP--", 'x" OR 1=1', "'; --", 'Bobby);'];
    const passwords = ["pass'word); --", 'p"; DELETE FROM accounts'];
    const grants = [];
    for (const name of names) grants.push(await granted(store.signup(name, passwords[0])));
    grants.push(await granted(store.login(names[0], passwords[0])));
    assert.equal((await refused(store.login(names[1], passwords[1]))).reason, 'bad-credentials');
    for (const grant of grants) store.accountForToken(grant.token);
    await store.logout(grants[0].token);
    await store.close();

    const reloaded = await createDatabaseAccountStore(fake.config(), { cost });
    for (const name of names) assert.equal(reloaded.isReserved(name), true, name);
    await reloaded.close();

    const sql = fake.log.flatMap(entry => entry.statements.map(statement => statement.sql));
    const secrets = [...names, ...passwords, ...grants.flatMap(grant => [grant.token, sha256(grant.token), grant.account.id])];
    for (const text of sql) for (const secret of secrets) assert.ok(!text.includes(secret), `SQL text holds input: ${text}`);
    // Values only ever travel as typed arguments.
    const args = fake.log.flatMap(entry => entry.statements.flatMap(statement => statement.args));
    assert.ok(args.some(arg => arg.type === 'text' && arg.value === names[0]));
    assert.ok(args.every(arg => ['text', 'integer', 'null', 'float'].includes(arg.type)));
    assert.ok(args.every(arg => arg.type !== 'integer' || /^-?\d+$/.test(String(arg.value))), 'integers are sent as strings');
    assert.ok(new Set(sql).size <= 16, 'a fixed set of statements');
  } finally { await fake.close(); }
});

test('an unreachable, slow or failing database refuses requests as unavailable and never throws', async context => {
  const fake = await fakeDatabase();
  const logged = context.mock.method(console, 'error', () => {});
  try {
    const store = await createDatabaseAccountStore(fake.config({ timeoutMs: 300 }), { cost });
    const kept = await granted(store.signup('Kept', PASSWORD));

    for (const [index, mode] of (['reset', 'error-500', 'garbage', 'hang'] as const).entries()) {
      fake.setMode(mode);
      const lost = `Lost${index}`;
      const started = Date.now();
      assert.equal((await refused(store.signup(lost, PASSWORD))).reason, 'unavailable', mode);
      assert.equal(store.isReserved(lost), false, `${mode}: a sign-up that was not stored reserves nothing`);
      assert.equal((await refused(store.login('Kept', PASSWORD))).reason, 'unavailable', mode);
      await store.logout('B'.repeat(43));
      assert.deepEqual(store.accountForToken(kept.token), kept.account, `${mode}: what was stored before keeps working`);
      assert.ok(Date.now() - started < 3000, `${mode}: the timeout cuts slow answers short`);
    }
    fake.setMode('ok');
    assert.ok(logged.mock.calls.length >= 8);
    assert.ok(logged.mock.calls.some(call => /did not answer within 300 ms/.test(String(call.arguments[0]))));
    assert.ok(logged.mock.calls.every(call => !/Lost|Kept|correct horse|test-auth-token/.test(String(call.arguments[0]))), 'the log names no nickname, password or token');
    // The database comes back and so do sign-ups.
    await granted(store.signup('Back', PASSWORD));
    await store.close();
  } finally { await fake.close(); }

  // A database that is gone altogether.
  const closed = await fakeDatabase();
  const store = await createDatabaseAccountStore(closed.config({ timeoutMs: 300 }), { cost });
  await closed.close();
  assert.equal((await refused(store.signup('Nowhere', PASSWORD))).reason, 'unavailable');
  await store.close();
});

test('the start fails clearly when the database cannot be read', async () => {
  const fake = await fakeDatabase();
  try {
    await assert.rejects(createDatabaseAccountStore({ ...fake.config(), authToken: 'wrong' }, { cost }), /Cannot load accounts from the database at 127\.0\.0\.1:\d+ \(database answered HTTP 401\)/);
    assert.equal(fake.log.at(-1)?.authorization, 'Bearer wrong');
    await assert.rejects(createDatabaseAccountStore({ ...fake.config(), authToken: '' }, { cost }), /auth token/);

    const store = await createDatabaseAccountStore(fake.config(), { cost });
    await granted(store.signup('Woo', PASSWORD));
    await store.close();
    fake.db.prepare("UPDATE accounts SET salt = 'short'").run();
    await assert.rejects(createDatabaseAccountStore(fake.config(), { cost }), /Cannot load accounts from the database .*unreadable account entry/);
    assert.equal(fake.count('SELECT COUNT(*) AS n FROM accounts'), 1, 'nothing is removed');
  } finally { await fake.close(); }
  const gone = await fakeDatabase();
  await gone.close();
  await assert.rejects(createDatabaseAccountStore(gone.config({ timeoutMs: 300 }), { cost }), /Cannot load accounts from the database .*could not reach the database/);
});

