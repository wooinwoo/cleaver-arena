import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RESERVED_NAME_MESSAGE, SESSION_TTL_MS, accountName, createFileAccountStore, createMemoryAccountStore, nameKey, playerName, sanitizeName,
  type AccountStore, type SessionGrant,
} from '../server/accounts.ts';

// A light work factor keeps these tests quick; one test below uses the real one.
const cost = { N: 1024, r: 8, p: 1 };
const PASSWORD = 'correct horse';
const DAY = 24 * 60 * 60 * 1000;

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
async function temporaryDirectory() { return mkdtemp(join(tmpdir(), 'sideplay-accounts-')); }

test('nicknames are cleaned like guest names and must be 2–12 characters', async () => {
  const store = createMemoryAccountStore({ cost });
  assert.equal((await granted(store.signup('  우\u0007주​  ', PASSWORD))).account.name, '우주');
  assert.equal((await granted(store.signup('가나다라마바사아자차카타', PASSWORD))).account.name, '가나다라마바사아자차카타');
  assert.equal((await granted(store.signup('a  \t b', PASSWORD))).account.name, 'a b');
  for (const name of ['', ' ', '가', ' 가 ', '가\u0000', '가나다라마바사아자차카타파', 'a'.repeat(13), 'ㅤㅤㅤ', 'Aㅤ', '❤️', 12, null, undefined, {}, ['ab']]) {
    const result = await refused(store.signup(name, PASSWORD));
    assert.equal(result.reason, 'invalid-name', JSON.stringify(name));
    assert.match(result.message, /2–12자/);
  }
  // Whatever an account is called, the guest clean-up leaves it untouched.
  for (const name of ['우주', 'a b', '가나다라마바사아자차카타']) assert.equal(sanitizeName(accountName(name)), name);
  assert.equal(accountName('abcdefghijklm'), '', 'a name that does not fit is refused, not cut');
  assert.equal(sanitizeName('  abcdefghijklm\u0007  '), 'abcdefghijkl', 'guest names are still cut to 12');
});

test('the same nickname in another case, width or spacing is a duplicate', async () => {
  const store = createMemoryAccountStore({ cost });
  await granted(store.signup('Woo', PASSWORD));
  for (const name of ['Woo', 'woo', 'WOO', 'ｗｏｏ ', 'Ｗｏｏ', 'W o o', 'w　oo', 'Wooㅤ', 'wo­o']) {
    const result = await refused(store.signup(name, 'another password'));
    assert.equal(result.reason, 'name-taken', JSON.stringify(name));
    assert.equal(store.isReserved(name), true, JSON.stringify(name));
  }
  assert.equal(nameKey('ｗｏｏ '), nameKey('Woo'));
  for (const name of ['Woo2', 'Wo', 'oow', '', '   ']) assert.equal(store.isReserved(name), false, JSON.stringify(name));
  await granted(store.signup('Woo2', PASSWORD));
  // Two sign-ups racing for one nickname: exactly one gets it.
  const race = await Promise.all(['한글', '한 글', '한글', '한글'].map(name => store.signup(name, PASSWORD)));
  assert.equal(race.filter(result => result.ok).length, 1);
  assert.ok(race.every(result => result.ok || result.reason === 'name-taken'));
});

test('passwords must be 8–128 characters', async () => {
  const store = createMemoryAccountStore({ cost });
  for (const password of ['', '1234567', 'a'.repeat(129), '😀'.repeat(7), 12345678, null, undefined]) {
    const result = await refused(store.signup('비밀번호', password));
    assert.equal(result.reason, 'invalid-password');
    assert.match(result.message, /8–128자/);
  }
  assert.equal(store.isReserved('비밀번호'), false, 'a refused sign-up reserves nothing');
  await granted(store.signup('여덟글자', '12345678'));
  await granted(store.signup('긴비밀번호', 'a'.repeat(128)));
  await granted(store.login('긴비밀번호', 'a'.repeat(128)));
  // A bad nickname is reported before a bad password.
  assert.equal((await refused(store.signup('가', 'short'))).reason, 'invalid-name');
});

test('login needs the right password and fails the same way for unknown nicknames', async () => {
  const store = createMemoryAccountStore({ cost });
  const signup = await granted(store.signup('Woo', PASSWORD));
  const wrong = await refused(store.login('Woo', 'correct horsf'));
  const unknown = await refused(store.login('Nobody', PASSWORD));
  assert.deepEqual(wrong, unknown);
  assert.equal(wrong.reason, 'bad-credentials');
  for (const [name, password] of [['Woo', ''], ['Woo', 'short'], ['', PASSWORD], ['W', PASSWORD], ['Woo', 'a'.repeat(200)], [null, null]] as const) {
    assert.deepEqual(await refused(store.login(name, password)), wrong);
  }
  const login = await granted(store.login('ｗｏｏ ', PASSWORD));
  assert.deepEqual(login.account, signup.account, 'any spelling logs into the same account under its stored nickname');
  assert.equal(login.account.name, 'Woo');
  assert.notEqual(login.token, signup.token);
});

test('session tokens resolve the account until logout', async () => {
  const store = createMemoryAccountStore({ cost });
  const first = await granted(store.signup('Woo', PASSWORD));
  const second = await granted(store.login('Woo', PASSWORD));
  const other = await granted(store.signup('Other', PASSWORD));
  for (const { token } of [first, second, other]) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(new Set([first.token, second.token, other.token]).size, 3);
  assert.deepEqual(store.accountForToken(first.token), first.account);
  assert.deepEqual(store.accountForToken(other.token), other.account);
  for (const token of [null, undefined, '', 'nope', first.token.slice(1), `${first.token}x`, 'A'.repeat(43)]) assert.equal(store.accountForToken(token), null);
  await store.logout(first.token);
  assert.equal(store.accountForToken(first.token), null);
  assert.deepEqual(store.accountForToken(second.token), first.account, 'other sessions of the account stay');
  await store.logout(first.token);
  await store.logout('nope');
  await store.logout(null);
  assert.deepEqual(store.accountForToken(other.token), other.account);
});

test('a session lasts 30 days from its last use', async () => {
  let clock = Date.UTC(2026, 0, 1);
  const store = createMemoryAccountStore({ cost, now: () => clock });
  const idle = await granted(store.signup('Idle', PASSWORD));
  const active = await granted(store.signup('Active', PASSWORD));
  const edge = await granted(store.signup('Edge', PASSWORD));
  assert.equal(SESSION_TTL_MS, 30 * DAY);
  clock += 29 * DAY;
  assert.ok(store.accountForToken(active.token), 'used on day 29');
  clock += DAY - 1;
  assert.ok(store.accountForToken(edge.token), 'still valid just before 30 idle days');
  clock += 1;
  assert.equal(store.accountForToken(idle.token), null, 'gone after 30 idle days');
  clock += 20 * DAY;
  assert.ok(store.accountForToken(active.token), 'each use pushes the expiry back');
  assert.ok(store.accountForToken(edge.token));
  clock += 30 * DAY;
  assert.equal(store.accountForToken(active.token), null);
  clock -= 60 * DAY;
  assert.equal(store.accountForToken(active.token), null, 'an expired session does not come back');
  // Expiry never touches the account itself.
  assert.equal(store.isReserved('Idle'), true);
  await granted(store.login('Idle', PASSWORD));
});

test('an account keeps at most ten sessions and drops the longest unused', async () => {
  let clock = 1_000_000;
  const store = createMemoryAccountStore({ cost, now: () => clock });
  const tokens = [(await granted(store.signup('Woo', PASSWORD))).token];
  for (let i = 0; i < 9; i++) { clock += 1000; tokens.push((await granted(store.login('Woo', PASSWORD))).token); }
  assert.ok(tokens.every(token => store.accountForToken(token)), 'ten devices fit');
  clock += 1000;
  assert.ok(store.accountForToken(tokens[0]), 'the first device is used again');
  clock += 1000;
  const eleventh = (await granted(store.login('Woo', PASSWORD))).token;
  assert.equal(store.accountForToken(tokens[1]), null, 'the longest unused session is dropped');
  assert.ok(store.accountForToken(tokens[0]) && store.accountForToken(tokens[2]) && store.accountForToken(eleventh));
});

test('hashing takes a bounded queue and sign-ups stop at the account limit', async () => {
  const busy = createMemoryAccountStore({ cost });
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => busy.signup(`동시${i}`, PASSWORD)));
  assert.equal(results.filter(result => result.ok).length, 34, 'two at once and thirty-two waiting');
  assert.ok(results.every(result => result.ok || result.reason === 'unavailable'));
  assert.equal(busy.isReserved('동시39'), false);
  await granted(busy.signup('동시39', PASSWORD));

  const full = createMemoryAccountStore({ cost, maxAccounts: 2 });
  await granted(full.signup('하나', PASSWORD));
  await granted(full.signup('둘둘', PASSWORD));
  assert.equal((await refused(full.signup('셋셋', PASSWORD))).reason, 'unavailable');
  await granted(full.login('하나', PASSWORD));
});

test('guests cannot take a member nickname and members always play under their own', async () => {
  const store = createMemoryAccountStore({ cost });
  const { token } = await granted(store.signup('Woo', PASSWORD));
  assert.deepEqual(playerName(store, token, '다른 이름'), { ok: true, name: 'Woo', member: true });
  assert.deepEqual(playerName(store, token, undefined), { ok: true, name: 'Woo', member: true });
  assert.deepEqual(playerName(store, null, '  손님\u0007  '), { ok: true, name: '손님', member: false });
  assert.deepEqual(playerName(store, null, 'abcdefghijklmnop'), { ok: true, name: 'abcdefghijkl', member: false });
  assert.deepEqual(playerName(store, null, 'A'), { ok: true, name: 'A', member: false }, 'guest names may still be one character');
  for (const name of ['Woo', 'ｗｏｏ ', 'WOO']) assert.deepEqual(playerName(store, null, name), { ok: false, reason: 'reserved', message: RESERVED_NAME_MESSAGE });
  assert.equal(RESERVED_NAME_MESSAGE, '이미 가입된 닉네임이에요. 로그인하거나 다른 닉네임을 써 주세요.');
  for (const name of ['', '   ', 7, null]) assert.deepEqual(playerName(store, null, name), { ok: false, reason: 'empty', message: '닉네임을 입력해 주세요.' });
  await store.logout(token);
  assert.equal(playerName(store, token, 'Woo').ok, false, 'after logout the old token is a guest again');
  assert.deepEqual(playerName(store, 'not a token', '손님'), { ok: true, name: '손님', member: false });
});

test('passwords are hashed with a fresh 16-byte salt into a 64-byte key and no secret reaches the disk', async () => {
  const directory = await temporaryDirectory();
  try {
    const store = await createFileAccountStore(directory, { cost });
    const first = await granted(store.signup('Woo', PASSWORD));
    const second = await granted(store.signup('Twin', PASSWORD));
    await granted(store.login('Woo', PASSWORD));
    await store.close();
    const text = await readFile(join(directory, 'accounts.json'), 'utf8');
    assert.ok(!text.includes(PASSWORD) && !text.includes(first.token) && !text.includes(second.token), 'no password or token on disk');
    const stored = JSON.parse(text);
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.accounts.map((account: { name: string }) => account.name), ['Woo', 'Twin']);
    for (const account of stored.accounts) {
      assert.equal(Buffer.from(account.salt, 'base64').length, 16);
      assert.equal(Buffer.from(account.hash, 'base64').length, 64);
      assert.deepEqual(account.cost, cost);
      assert.deepEqual(Object.keys(account).sort(), ['cost', 'createdAt', 'hash', 'id', 'name', 'salt']);
    }
    assert.notEqual(stored.accounts[0].salt, stored.accounts[1].salt);
    assert.notEqual(stored.accounts[0].hash, stored.accounts[1].hash, 'the same password hashes differently per account');
    assert.equal(stored.sessions.length, 3);
    for (const session of stored.sessions) {
      assert.match(session.tokenHash, /^[0-9a-f]{64}$/);
      assert.deepEqual(Object.keys(session).sort(), ['accountId', 'createdAt', 'lastSeenAt', 'tokenHash']);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the default work factor works, and an account hashed with another one is upgraded at login', async () => {
  const directory = await temporaryDirectory();
  const costs = async () => JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8')).accounts.map((account: { cost: unknown }) => account.cost);
  try {
    const light = await createFileAccountStore(directory, { cost });
    await granted(light.signup('Old', PASSWORD));
    await light.close();
    assert.deepEqual(await costs(), [cost]);

    const store = await createFileAccountStore(directory);
    assert.equal((await refused(store.login('Old', 'wrong password'))).reason, 'bad-credentials');
    assert.deepEqual(await costs(), [cost], 'a failed login changes nothing');
    await granted(store.login('Old', PASSWORD));
    await granted(store.signup('New', PASSWORD));
    assert.deepEqual(await costs(), [{ N: 32768, r: 8, p: 3 }, { N: 32768, r: 8, p: 3 }]);
    await store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the file store starts empty without a file and brings accounts and sessions back after a reload', async () => {
  const root = await temporaryDirectory();
  const directory = join(root, 'nested', 'data');
  let clock = Date.UTC(2026, 0, 1);
  const options = { cost, now: () => clock };
  try {
    let store = await createFileAccountStore(directory, options);
    assert.equal(store.isReserved('Woo'), false);
    assert.equal(store.accountForToken('A'.repeat(43)), null);
    const woo = await granted(store.signup('Woo', PASSWORD));
    const gone = await granted(store.login('Woo', PASSWORD));
    const kim = await granted(store.signup('김철수', 'another password'));
    await store.logout(gone.token);
    await store.close();
    assert.deepEqual(await readdir(directory), ['accounts.json'], 'no temporary file is left behind');

    store = await createFileAccountStore(directory, options);
    assert.deepEqual(store.accountForToken(woo.token), woo.account);
    assert.deepEqual(store.accountForToken(kim.token), kim.account);
    assert.equal(store.accountForToken(gone.token), null, 'a logout survives the reload');
    assert.equal(store.isReserved('ｗｏｏ'), true);
    assert.equal((await refused(store.signup('woo', PASSWORD))).reason, 'name-taken');
    assert.equal((await refused(store.login('김철수', PASSWORD))).reason, 'bad-credentials');
    assert.deepEqual((await granted(store.login('김철수', 'another password'))).account, kim.account);
    // A session used shortly before shutdown keeps that use across the restart.
    clock += 29 * DAY;
    assert.ok(store.accountForToken(woo.token));
    await store.close();
    clock += 2 * DAY;
    store = await createFileAccountStore(directory, options);
    assert.deepEqual(store.accountForToken(woo.token), woo.account, 'used 2 days ago');
    assert.equal(store.accountForToken(kim.token), null, 'unused for 31 days');
    await store.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent sign-ups, logins and logouts leave a complete file', async () => {
  const directory = await temporaryDirectory();
  try {
    const store = await createFileAccountStore(directory, { cost });
    const names = Array.from({ length: 24 }, (_, i) => `친구${i}`);
    const results = await Promise.all([...names, '친구0', '친 구 1', '친구２'].map(name => store.signup(name, `${name} password`)));
    assert.equal(results.filter(result => result.ok).length, names.length);
    assert.ok(results.every(result => result.ok || result.reason === 'name-taken'));
    const tokens = results.filter((result): result is SessionGrant => result.ok).map(result => result.token);
    // Mix every kind of write while more sign-ups are still landing.
    const mixed = await Promise.all([
      ...names.slice(0, 8).map(name => store.login(name, `${name} password`)),
      ...tokens.slice(0, 8).map(token => store.logout(token)),
      ...Array.from({ length: 6 }, (_, i) => store.signup(`나중${i}`, PASSWORD)),
    ]);
    assert.ok(mixed.every(result => result === undefined || result.ok));
    const stored = JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8'));
    assert.equal(stored.accounts.length, 30, 'every acknowledged sign-up is already on disk');
    assert.equal(stored.sessions.length, 24 - 8 + 8 + 6);
    await store.close();
    assert.deepEqual(await readdir(directory), ['accounts.json']);

    const reloaded = await createFileAccountStore(directory, { cost });
    for (const name of [...names, '나중0', '나중5']) assert.equal(reloaded.isReserved(name), true, name);
    tokens.forEach((token, index) => assert.equal(reloaded.accountForToken(token)?.name, index < 8 ? undefined : names[index]));
    await granted(reloaded.login('친구23', '친구23 password'));
    await reloaded.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an unreadable accounts file stops the start and is left untouched', async () => {
  const directory = await temporaryDirectory();
  try {
    const file = join(directory, 'accounts.json');
    const account = { id: 'a', name: 'Woo', salt: Buffer.alloc(16).toString('base64'), hash: Buffer.alloc(64).toString('base64'), cost, createdAt: 1 };
    const broken = [
      '', '{"version":1,"accounts":[', '[]', 'null',
      JSON.stringify({ version: 2, accounts: [], sessions: [] }),
      JSON.stringify({ version: 1, accounts: [{ ...account, hash: 'short' }], sessions: [] }),
      JSON.stringify({ version: 1, accounts: [{ ...account, cost: { N: 2 ** 30, r: 8, p: 1 } }], sessions: [] }),
      JSON.stringify({ version: 1, accounts: [account, { ...account, id: 'b', name: 'ｗｏｏ' }], sessions: [] }),
      JSON.stringify({ version: 1, accounts: [account], sessions: [{ tokenHash: 'x', accountId: 'a', createdAt: 1, lastSeenAt: 1 }] }),
    ];
    for (const text of broken) {
      await writeFile(file, text);
      await assert.rejects(createFileAccountStore(directory, { cost }), /Cannot load accounts/);
      assert.equal(await readFile(file, 'utf8'), text);
    }
    // The same entries load once they are well-formed; sessions of unknown accounts are dropped.
    await writeFile(file, `﻿${JSON.stringify({ version: 1, accounts: [account], sessions: [{ tokenHash: 'f'.repeat(64), accountId: 'missing', createdAt: 1, lastSeenAt: Date.now() }] })}`);
    const store = await createFileAccountStore(directory, { cost });
    assert.equal(store.isReserved('woo'), true);
    await store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a sign-up that cannot be stored is refused and reserves nothing', async context => {
  const directory = await temporaryDirectory();
  const logged = context.mock.method(console, 'error', () => {});
  try {
    const store = await createFileAccountStore(directory, { cost });
    const kept = await granted(store.signup('Kept', PASSWORD));
    await rm(directory, { recursive: true, force: true });
    assert.equal((await refused(store.signup('Lost', PASSWORD))).reason, 'unavailable');
    assert.equal(store.isReserved('Lost'), false);
    assert.equal((await refused(store.login('Kept', PASSWORD))).reason, 'unavailable');
    assert.deepEqual(store.accountForToken(kept.token), kept.account, 'what was stored before keeps working');
    assert.ok(logged.mock.calls.length >= 2);
    assert.ok(logged.mock.calls.every(call => !String(call.arguments[0]).includes(PASSWORD) && !String(call.arguments[0]).includes('Lost')), 'the log names no nickname or password');
    await store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
