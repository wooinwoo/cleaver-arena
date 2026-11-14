import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const NAME_MIN = 2;
export const NAME_MAX = 12;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
/** A session ends once it has gone unused for this long. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Session tokens are 32 random bytes written in base64url. */
export const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const RESERVED_NAME_MESSAGE = '이미 가입된 닉네임이에요. 로그인하거나 다른 닉네임을 써 주세요.';

const FAILURES = {
  'invalid-name': `닉네임은 ${NAME_MIN}–${NAME_MAX}자로 정해 주세요.`,
  'invalid-password': `비밀번호는 ${PASSWORD_MIN}–${PASSWORD_MAX}자로 정해 주세요.`,
  'name-taken': '이미 가입된 닉네임이에요. 다른 닉네임을 써 주세요.',
  'bad-credentials': '닉네임 또는 비밀번호가 맞지 않아요.',
  unavailable: '지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요.',
} as const;

export type AccountProfile = { id: string; name: string };
export type AccountFailureReason = keyof typeof FAILURES;
export type AccountFailure = { ok: false; reason: AccountFailureReason; message: string };
/** A finished sign-up or login. `token` is the only copy of the session secret. */
export type SessionGrant = { ok: true; account: AccountProfile; token: string };
export type AccountResult = SessionGrant | AccountFailure;

export interface AccountStore {
  /** Creates an account and logs it in. */
  signup(name: unknown, password: unknown): Promise<AccountResult>;
  login(name: unknown, password: unknown): Promise<AccountResult>;
  /** Ends the session the token belongs to. Unknown tokens are ignored. */
  logout(token: string | null | undefined): Promise<void>;
  /** Resolves a session token. Every hit pushes the session's expiry back. */
  accountForToken(token: string | null | undefined): AccountProfile | null;
  /** True when a member owns this nickname or another spelling of it. */
  isReserved(name: string): boolean;
  /** Waits until everything accepted so far is stored. */
  close(): Promise<void>;
}

export type ScryptCost = { N: number; r: number; p: number };
export type AccountStoreOptions = {
  /** Clock used for session expiry. */
  now?: () => number;
  /** Password hashing work factor. Tests lower it to stay fast. */
  cost?: ScryptCost;
  maxAccounts?: number;
};

/**
 * 32 MiB and three passes per hash. The cost is stored with every hash, so changing it
 * here re-hashes each account the next time it logs in.
 */
const DEFAULT_COST: ScryptCost = { N: 32768, r: 8, p: 3 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;
/** Hashing is memory-hungry and shares a thread pool with file reads, so little of it runs at once. */
const HASHES_AT_ONCE = 2;
const HASHES_WAITING = 32;
const DEFAULT_MAX_ACCOUNTS = 20_000;
const MAX_SESSIONS_PER_ACCOUNT = 10;
/** A session in steady use is written back at most this often. */
const SESSION_SAVE_INTERVAL_MS = 60 * 60 * 1000;
const ACCOUNTS_FILE = 'accounts.json';

const CONTROL = /[\p{C}]/gu;
/** Characters that leave no mark on screen: spacing, default-ignorable fillers and the blank braille cell. */
const UNSEEN = /[\p{C}\p{White_Space}\p{Default_Ignorable_Code_Point}⠀]/gu;

/** Nickname clean-up every socket server applies to what a guest types. */
export function sanitizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(CONTROL, '').slice(0, NAME_MAX) : '';
}

/**
 * Two nicknames with the same key are the same nickname: width, case, spacing and
 * invisible characters do not tell them apart.
 */
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(UNSEEN, '').normalize('NFKC');
}

/**
 * The nickname an account is stored and shown under, or '' when it cannot be one.
 * It gets the guest clean-up, but a name that does not fit is refused instead of cut short.
 */
export function accountName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.replace(CONTROL, '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length > NAME_MAX || [...name].length < NAME_MIN) return '';
  // The visible part must be long enough too, so a name cannot be padded out with blanks.
  return [...nameKey(name)].length < NAME_MIN ? '' : name;
}

/** The form of a password that gets hashed, or null when its length is out of range. */
function usablePassword(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > PASSWORD_MAX * 8) return null;
  // One normal form, so the same password typed on another keyboard still matches.
  const password = value.normalize('NFKC');
  const length = [...password].length;
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX ? password : null;
}

export type PlayerName =
  | { ok: true; name: string; member: boolean }
  | { ok: false; reason: 'empty' | 'reserved'; message: string };

/**
 * Decides the nickname a socket plays under. A logged-in member always gets the account
 * nickname, whatever was requested; a guest gets the requested one unless a member owns it.
 */
export function playerName(accounts: AccountStore, sessionToken: string | null, requested: unknown): PlayerName {
  const account = accounts.accountForToken(sessionToken);
  if (account) return { ok: true, name: account.name, member: true };
  const name = sanitizeName(requested);
  if (!name) return { ok: false, reason: 'empty', message: '닉네임을 입력해 주세요.' };
  if (accounts.isReserved(name)) return { ok: false, reason: 'reserved', message: RESERVED_NAME_MESSAGE };
  return { ok: true, name, member: false };
}

type Account = { id: string; name: string; key: string; salt: Buffer; hash: Buffer; cost: ScryptCost; createdAt: number };
type Session = {
  accountId: string; createdAt: number; lastSeenAt: number;
  /** `lastSeenAt` as of the last save that was asked for. */
  savedSeenAt: number;
};
type StoredAccount = { id: string; name: string; salt: string; hash: string; cost: ScryptCost; createdAt: number };
type StoredSession = { tokenHash: string; accountId: string; createdAt: number; lastSeenAt: number };
type StoredFile = { version: 1; accounts: StoredAccount[]; sessions: StoredSession[] };

const failure = (reason: AccountFailureReason): AccountFailure => ({ ok: false, reason, message: FAILURES[reason] });
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const sameCost = (a: ScryptCost, b: ScryptCost) => a.N === b.N && a.r === b.r && a.p === b.p;

function validCost(value: unknown): value is ScryptCost {
  if (!isRecord(value)) return false;
  const { N, r, p } = value;
  return typeof N === 'number' && Number.isInteger(N) && N >= 1024 && N <= 2 ** 17 && (N & (N - 1)) === 0
    && r === 8 && typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 16;
}

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((done, fail) => {
    scrypt(password, salt, KEY_BYTES, { ...cost, maxmem: 256 * cost.N * cost.r }, (error, key) => error ? fail(error) : done(key));
  });
}

/** Runs at most `limit` jobs at once and lets `backlog` more wait. Beyond that the caller gets null. */
function createGate(limit: number, backlog: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(job: () => Promise<T>): Promise<T | null> {
    if (running < limit) running++;
    else if (waiting.length >= backlog) return null;
    else await new Promise<void>(next => waiting.push(next));
    try { return await job(); }
    finally {
      // A finished job hands its place straight to the next one in line.
      const next = waiting.shift();
      if (next) next(); else running--;
    }
  };
}

/** Problems are logged without the request that caused them: no nicknames, passwords or tokens. */
function report(what: string, error: unknown) {
  console.error(`${what}: ${error instanceof Error ? error.message : String(error)}`);
}

class MemoryAccountStore implements AccountStore {
  protected readonly accounts = new Map<string, Account>();
  /** Sessions by the SHA-256 of their token; the token itself is never kept. */
  protected readonly sessions = new Map<string, Session>();
  private readonly keys = new Map<string, Account>();
  /** Nickname keys of sign-ups that are still hashing. */
  private readonly claimed = new Set<string>();
  private readonly hashing = createGate(HASHES_AT_ONCE, HASHES_WAITING);
  private readonly decoy: Pick<Account, 'salt' | 'hash' | 'cost'>;
  protected readonly now: () => number;
  private readonly cost: ScryptCost;
  private readonly maxAccounts: number;
  private sweptAt = 0;
  /** A session was used since the last save. */
  protected stale = false;

  constructor(options: AccountStoreOptions) {
    this.now = options.now ?? Date.now;
    this.cost = options.cost ?? DEFAULT_COST;
    if (!validCost(this.cost)) throw new Error('Unsupported scrypt cost');
    this.maxAccounts = options.maxAccounts ?? DEFAULT_MAX_ACCOUNTS;
    this.decoy = { salt: randomBytes(SALT_BYTES), hash: randomBytes(KEY_BYTES), cost: this.cost };
  }

  async signup(rawName: unknown, rawPassword: unknown): Promise<AccountResult> {
    const name = accountName(rawName);
    if (!name) return failure('invalid-name');
    const password = usablePassword(rawPassword);
    if (password === null) return failure('invalid-password');
    const key = nameKey(name);
    if (this.keys.has(key) || this.claimed.has(key)) return failure('name-taken');
    if (this.accounts.size + this.claimed.size >= this.maxAccounts) return failure('unavailable');
    this.claimed.add(key);
    let account: Account;
    try {
      const salt = randomBytes(SALT_BYTES);
      const hash = await this.hash(password, salt, this.cost);
      if (!hash) return failure('unavailable');
      account = { id: randomUUID(), name, key, salt, hash, cost: this.cost, createdAt: this.now() };
      this.accounts.set(account.id, account);
      this.keys.set(key, account);
    } finally { this.claimed.delete(key); }
    const token = this.openSession(account.id);
    if (!await this.saved()) {
      // An account that could not be stored would vanish on restart, so it is not handed out.
      this.accounts.delete(account.id);
      this.keys.delete(key);
      this.sessions.delete(digest(token));
      return failure('unavailable');
    }
    return { ok: true, account: { id: account.id, name }, token };
  }

  async login(rawName: unknown, rawPassword: unknown): Promise<AccountResult> {
    const name = accountName(rawName), password = usablePassword(rawPassword);
    // Input that could never have been registered is refused without hashing.
    if (!name || password === null) return failure('bad-credentials');
    const account = this.keys.get(nameKey(name));
    // An unknown nickname is checked against a decoy so both kinds of failure cost the same.
    const { salt, hash, cost } = account ?? this.decoy;
    const derived = await this.hash(password, salt, cost);
    if (!derived) return failure('unavailable');
    if (!timingSafeEqual(derived, hash) || !account || this.accounts.get(account.id) !== account) return failure('bad-credentials');
    if (!sameCost(account.cost, this.cost)) {
      const fresh = randomBytes(SALT_BYTES), upgraded = await this.hash(password, fresh, this.cost);
      if (upgraded) Object.assign(account, { salt: fresh, hash: upgraded, cost: this.cost });
    }
    const token = this.openSession(account.id);
    if (!await this.saved()) {
      this.sessions.delete(digest(token));
      return failure('unavailable');
    }
    return { ok: true, account: { id: account.id, name: account.name }, token };
  }

  async logout(token: string | null | undefined): Promise<void> {
    if (typeof token !== 'string' || !SESSION_TOKEN.test(token)) return;
    if (this.sessions.delete(digest(token))) await this.saved();
  }

  accountForToken(token: string | null | undefined): AccountProfile | null {
    if (typeof token !== 'string' || !SESSION_TOKEN.test(token)) return null;
    const key = digest(token), session = this.sessions.get(key);
    if (!session) return null;
    const now = this.now(), account = this.accounts.get(session.accountId);
    if (!account || now - session.lastSeenAt >= SESSION_TTL_MS) {
      this.sessions.delete(key);
      void this.saved();
      return null;
    }
    session.lastSeenAt = now;
    if (now - session.savedSeenAt >= SESSION_SAVE_INTERVAL_MS) {
      session.savedSeenAt = now;
      void this.saved();
    } else this.stale = true;
    return { id: account.id, name: account.name };
  }

  isReserved(name: string): boolean {
    if (typeof name !== 'string') return false;
    const key = nameKey(name);
    return key !== '' && this.keys.has(key);
  }

  async close(): Promise<void> {}

  /** Makes the current state durable. Nothing to do when it only lives in memory. */
  protected persist(): Promise<void> { return Promise.resolve(); }

  /** Like persist(), but reports a failure instead of throwing. */
  protected async saved(): Promise<boolean> {
    try { await this.persist(); return true; }
    catch (error) { report('Could not save accounts', error); return false; }
  }

  private async hash(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer | null> {
    try { return await this.hashing(() => derive(password, salt, cost)); }
    catch (error) { report('Could not hash a password', error); return null; }
  }

  private openSession(accountId: string): string {
    const now = this.now();
    if (now - this.sweptAt >= SESSION_SAVE_INTERVAL_MS) this.dropExpired(now);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(digest(token), { accountId, createdAt: now, lastSeenAt: now, savedSeenAt: now });
    const own = [...this.sessions].filter(([, session]) => session.accountId === accountId);
    if (own.length > MAX_SESSIONS_PER_ACCOUNT) {
      // The devices that have been away longest are logged out first.
      own.sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
      for (const [key] of own.slice(0, own.length - MAX_SESSIONS_PER_ACCOUNT)) this.sessions.delete(key);
    }
    return token;
  }

  private dropExpired(now: number) {
    this.sweptAt = now;
    for (const [key, session] of this.sessions) {
      if (now - session.lastSeenAt >= SESSION_TTL_MS || !this.accounts.has(session.accountId)) this.sessions.delete(key);
    }
  }

  protected snapshot(): StoredFile {
    this.dropExpired(this.now());
    this.stale = false;
    return {
      version: 1,
      accounts: [...this.accounts.values()].map(({ id, name, salt, hash, cost, createdAt }) => (
        { id, name, salt: salt.toString('base64'), hash: hash.toString('base64'), cost, createdAt })),
      sessions: [...this.sessions].map(([tokenHash, session]) => {
        session.savedSeenAt = session.lastSeenAt;
        return { tokenHash, accountId: session.accountId, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt };
      }),
    };
  }

  /** Loads a snapshot into an empty store. Throws on anything it does not fully understand. */
  protected restore(data: unknown) {
    if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.sessions)) throw new Error('unknown layout or version');
    for (const entry of data.accounts as unknown[]) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string'
        || typeof entry.salt !== 'string' || typeof entry.hash !== 'string' || !validCost(entry.cost) || !isTime(entry.createdAt)) throw new Error('unreadable account entry');
      const salt = Buffer.from(entry.salt, 'base64'), hash = Buffer.from(entry.hash, 'base64'), key = nameKey(entry.name);
      if (salt.length !== SALT_BYTES || hash.length !== KEY_BYTES || !key) throw new Error('unreadable account entry');
      if (this.accounts.has(entry.id) || this.keys.has(key)) throw new Error('duplicate account entry');
      const account: Account = { id: entry.id, name: entry.name, key, salt, hash, cost: entry.cost, createdAt: entry.createdAt };
      this.accounts.set(account.id, account);
      this.keys.set(key, account);
    }
    const now = this.now();
    for (const entry of data.sessions as unknown[]) {
      if (!isRecord(entry) || typeof entry.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.tokenHash)
        || typeof entry.accountId !== 'string' || !isTime(entry.createdAt) || !isTime(entry.lastSeenAt)) throw new Error('unreadable session entry');
      if (!this.accounts.has(entry.accountId) || now - entry.lastSeenAt >= SESSION_TTL_MS) continue;
      this.sessions.set(entry.tokenHash, { accountId: entry.accountId, createdAt: entry.createdAt, lastSeenAt: entry.lastSeenAt, savedSeenAt: entry.lastSeenAt });
    }
  }
}

/** Renames over the target, waiting out the brief locks virus scanners and indexers take on Windows. */
async function replaceFile(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw error;
      await new Promise(done => setTimeout(done, 20 * 2 ** attempt));
    }
  }
}

class FileAccountStore extends MemoryAccountStore {
  private readonly file: string;
  /** Settles when every write asked for so far has finished. Never rejects. */
  private tail: Promise<void> = Promise.resolve();
  /** A write that has not started yet; it will pick up every change made until it does. */
  private queued: Promise<void> | null = null;

  private constructor(file: string, options: AccountStoreOptions) {
    super(options);
    this.file = file;
  }

  static async open(directory: string, options: AccountStoreOptions): Promise<FileAccountStore> {
    const store = new FileAccountStore(join(directory, ACCOUNTS_FILE), options);
    await mkdir(directory, { recursive: true });
    let text: string;
    try { text = await readFile(store.file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return store;
      throw error;
    }
    // A file that cannot be read is left alone: starting empty would overwrite every account in it.
    try { store.restore(JSON.parse(text.replace(/^﻿/, ''))); }
    catch (error) { throw new Error(`Cannot load accounts from ${store.file} (${error instanceof Error ? error.message : String(error)}). Fix or move the file, then start again.`); }
    return store;
  }

  /** One write at a time. Each caller gets the outcome of a write that began after its change. */
  protected override persist(): Promise<void> {
    if (this.queued) return this.queued;
    const write = this.tail.then(() => {
      this.queued = null;
      return this.write();
    });
    this.queued = write;
    this.tail = write.catch(() => {});
    return write;
  }

  /** The whole state goes to a temporary file first, so the real one is always complete. */
  private async write(): Promise<void> {
    const text = JSON.stringify(this.snapshot());
    const temporary = `${this.file}.tmp`;
    try {
      const handle = await open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      await replaceFile(temporary, this.file);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  override async close(): Promise<void> {
    if (this.stale) await this.saved();
    let tail: Promise<void>;
    do { tail = this.tail; await tail; } while (tail !== this.tail);
  }
}

/** Accounts that last as long as the process. */
export function createMemoryAccountStore(options: AccountStoreOptions = {}): AccountStore {
  return new MemoryAccountStore(options);
}

/** Accounts kept in `accounts.json` under `directory`. A missing file means no accounts yet. */
export function createFileAccountStore(directory: string, options: AccountStoreOptions = {}): Promise<AccountStore> {
  return FileAccountStore.open(directory, options);
}
