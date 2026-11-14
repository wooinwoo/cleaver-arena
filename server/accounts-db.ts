import {
  NameTakenError, SESSION_TTL_MS, UnreadableAccountsError, createAccountStore, nameKey,
  type AccountChange, type AccountPersistence, type AccountStore, type AccountStoreOptions, type StoredAccounts,
} from './accounts.ts';

/*
 * Accounts in a hosted libSQL database (Turso), reached over its HTTP API with plain fetch.
 * Each save is one `POST {url}/v2/pipeline`: the statements as `execute` requests, then `close`.
 *   Request and response shape: https://docs.turso.tech/sdk/http/reference
 *   Value, error and result types (Hrana): https://github.com/tursodatabase/libsql/blob/main/docs/HRANA_3_SPEC.md
 *
 * The store keeps the whole state in memory, as the others do, because session look-ups must
 * answer at once. The database is the durable copy, so one server instance should use it at a time.
 */

export type DatabaseConfig = {
  /** `libsql://…` as Turso shows it, or an `https://` / `http://` address. */
  url: string;
  authToken: string;
  /** How long one request may take. */
  timeoutMs?: number;
  /** Tries for the first load before giving up. */
  connectAttempts?: number;
};

type Arg = string | number | null;
type Statement = { sql: string; args?: Arg[]; addsAccount?: boolean };
type Value =
  | { type: 'null' } | { type: 'integer'; value: string } | { type: 'float'; value: number }
  | { type: 'text'; value: string } | { type: 'blob'; base64: string };
type StatementResult = { cols: unknown[]; rows: Value[][] };
type StreamResult =
  | { type: 'ok'; response: { type: string; result?: StatementResult } }
  | { type: 'error'; error: { message?: string; code?: string | null } };

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CONNECT_ATTEMPTS = 3;

const SCHEMA: Statement[] = [
  { sql: `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    cost_n INTEGER NOT NULL,
    cost_r INTEGER NOT NULL,
    cost_p INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )` },
  // Two sign-ups of one nickname, in any spelling, cannot both be stored.
  { sql: 'CREATE UNIQUE INDEX IF NOT EXISTS accounts_name_key ON accounts (name_key)' },
  { sql: `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )` },
  { sql: 'CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id)' },
];

/** The pipeline endpoint for a database address. `libsql://` is served over HTTPS. */
export function pipelineUrl(url: string): string {
  const address = new URL(url.trim().replace(/^libsql:\/\//i, 'https://'));
  if (address.protocol !== 'https:' && address.protocol !== 'http:') throw new Error('The database address must start with libsql://, https:// or http://');
  return `${address.origin}${address.pathname.replace(/\/+$/, '')}/v2/pipeline`;
}

/** The host part of a database address, safe to print. */
export function databaseHost(url: string): string {
  try { return new URL(pipelineUrl(url)).host; } catch { return 'unknown host'; }
}

function encode(arg: Arg): Value {
  if (arg === null) return { type: 'null' };
  if (typeof arg === 'string') return { type: 'text', value: arg };
  // Integers travel as strings so no precision is lost.
  return Number.isSafeInteger(arg) ? { type: 'integer', value: String(arg) } : { type: 'float', value: arg };
}

function decode(value: Value | undefined): string | number | null {
  if (!value || value.type === 'null') return null;
  if (value.type === 'integer') return Number(value.value);
  if (value.type === 'blob') return value.base64;
  return value.value;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A failed statement. The message comes from the database and never holds the statement's arguments. */
function statementError(result: Extract<StreamResult, { type: 'error' }>): Error {
  return new Error(`database refused a statement: ${String(result.error?.message ?? result.error?.code ?? 'unknown error').slice(0, 200)}`);
}

const isConstraint = (result: Extract<StreamResult, { type: 'error' }>) =>
  /CONSTRAINT/i.test(`${result.error?.code ?? ''} ${result.error?.message ?? ''}`);

/** The statements that store one change. Every value goes in as an argument, never into the SQL text. */
function statements(change: AccountChange): Statement[] {
  switch (change.type) {
    case 'add-account': {
      const { id, name, salt, hash, cost, createdAt } = change.account;
      return [{
        sql: 'INSERT INTO accounts (id, name, name_key, salt, hash, cost_n, cost_r, cost_p, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [id, name, nameKey(name), salt, hash, cost.N, cost.r, cost.p, createdAt], addsAccount: true,
      }];
    }
    case 'rehash': {
      const { id, salt, hash, cost } = change.account;
      return [{ sql: 'UPDATE accounts SET salt = ?, hash = ?, cost_n = ?, cost_r = ?, cost_p = ? WHERE id = ?', args: [salt, hash, cost.N, cost.r, cost.p, id] }];
    }
    case 'add-session': {
      const { tokenHash, accountId, createdAt, lastSeenAt } = change.session;
      // Only stored next to an account that exists, so a refused sign-up leaves no session behind.
      return [{
        sql: 'INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at) SELECT ?, id, ?, ? FROM accounts WHERE id = ?',
        args: [tokenHash, createdAt, lastSeenAt, accountId],
      }];
    }
    case 'touch-session':
      // Saves may arrive out of order; an older use never overwrites a newer one.
      return [{ sql: 'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at < ?', args: [change.lastSeenAt, change.tokenHash, change.lastSeenAt] }];
    case 'end-sessions':
      return change.tokenHashes.map(tokenHash => ({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [tokenHash] }));
  }
}

function client(config: DatabaseConfig) {
  const endpoint = pipelineUrl(config.url);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!config.authToken) throw new Error('The database needs an auth token');

  /** Runs the statements in order on a fresh stream. Rejects when the database cannot be reached or answers oddly. */
  return async function pipeline(list: Statement[]): Promise<StreamResult[]> {
    const body = JSON.stringify({
      requests: [
        ...list.map(({ sql, args = [] }) => ({ type: 'execute', stmt: { sql, args: args.map(encode) } })),
        { type: 'close' },
      ],
    });
    const lost = (error: unknown) => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      ? new Error(`database did not answer within ${timeoutMs} ms`)
      : new Error(`could not reach the database (${error instanceof Error ? error.message : String(error)})`);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.authToken}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) { throw lost(error); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`database answered HTTP ${response.status}`);
    }
    let answer: unknown;
    try { answer = JSON.parse(await response.text()); }
    catch (error) { throw error instanceof SyntaxError ? new Error('unexpected answer from the database') : lost(error); }
    if (!isRecord(answer) || !Array.isArray(answer.results) || answer.results.length !== list.length + 1
      || !answer.results.every(result => isRecord(result) && (result.type === 'ok' || result.type === 'error'))) {
      throw new Error('unexpected answer from the database');
    }
    return (answer.results as StreamResult[]).slice(0, list.length);
  };
}

function rowsOf(result: StreamResult): Array<Array<string | number | null>> {
  if (result.type === 'error') throw statementError(result);
  const rows = result.response?.result?.rows;
  if (!Array.isArray(rows)) throw new Error('unexpected answer from the database');
  return rows.map(row => (Array.isArray(row) ? row : []).map(decode));
}

/**
 * Accounts in a libSQL database. Tables are created when missing. Fails when the database
 * cannot be reached at start, after a few tries, or holds data it does not understand.
 * Once open, a failed save is a refused request, never a crash.
 */
export async function createDatabaseAccountStore(config: DatabaseConfig, options: AccountStoreOptions = {}): Promise<AccountStore> {
  const pipeline = client(config);
  const now = options.now ?? Date.now;
  /** Saves in flight, so close() can wait for them. */
  const pending = new Set<Promise<unknown>>();

  const persistence: AccountPersistence = {
    save(changes) {
      const list = changes.flatMap(statements);
      const saving = pipeline(list).then(results => {
        results.forEach((result, index) => {
          if (result.type !== 'error') return;
          if (list[index].addsAccount && isConstraint(result)) throw new NameTakenError();
          throw statementError(result);
        });
      });
      const settled = saving.catch(() => {});
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return saving;
    },
    async close() {
      while (pending.size) await Promise.all([...pending]);
    },
  };

  const load = async (): Promise<StoredAccounts> => {
    const results = await pipeline([
      ...SCHEMA,
      // Sessions that can never be used again are cleared on the way in.
      { sql: 'DELETE FROM sessions WHERE last_seen_at <= ? OR account_id NOT IN (SELECT id FROM accounts)', args: [now() - SESSION_TTL_MS] },
      { sql: 'SELECT id, name, salt, hash, cost_n, cost_r, cost_p, created_at FROM accounts ORDER BY created_at, rowid' },
      { sql: 'SELECT token_hash, account_id, created_at, last_seen_at FROM sessions' },
    ]);
    for (const result of results) if (result.type === 'error') throw statementError(result);
    const [accounts, sessions] = [rowsOf(results[results.length - 2]), rowsOf(results[results.length - 1])];
    return {
      version: 1,
      accounts: accounts.map(([id, name, salt, hash, N, r, p, createdAt]) => ({ id, name, salt, hash, cost: { N, r, p }, createdAt })) as StoredAccounts['accounts'],
      sessions: sessions.map(([tokenHash, accountId, createdAt, lastSeenAt]) => ({ tokenHash, accountId, createdAt, lastSeenAt })) as StoredAccounts['sessions'],
    };
  };

  // Bad options are reported before the database is contacted.
  createAccountStore(persistence, options);
  const attempts = Math.max(1, config.connectAttempts ?? DEFAULT_CONNECT_ATTEMPTS);
  const host = databaseHost(config.url);
  for (let attempt = 1; ; attempt++) {
    let stored: StoredAccounts;
    try { stored = await load(); }
    catch (error) {
      if (attempt >= attempts) throw new Error(`Cannot load accounts from the database at ${host} (${error instanceof Error ? error.message : String(error)}).`);
      await new Promise(done => setTimeout(done, 1000 * attempt));
      continue;
    }
    try { return createAccountStore(persistence, options, stored); }
    catch (error) {
      if (error instanceof UnreadableAccountsError) throw new Error(`Cannot load accounts from the database at ${host} (${error.message}). Fix the rows, then start again.`);
      throw error;
    }
  }
}
