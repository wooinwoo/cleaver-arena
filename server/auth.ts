import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SESSION_TOKEN, SESSION_TTL_MS, accountName, nameKey,
  type AccountFailureReason, type AccountStore,
} from './accounts.ts';

export const SESSION_COOKIE = 'sideplay_session';
const SESSION_MAX_AGE = SESSION_TTL_MS / 1000;
const BODY_LIMIT = 2048;
/** An oversized body up to this size is read and dropped, so its sender still receives the answer. */
const DRAIN_LIMIT = 64 * 1024;
const BODY_TIMEOUT_MS = 10_000;
const WINDOW_MS = 10 * 60 * 1000;
const POSTS_PER_ADDRESS = 20;
const FAILED_LOGINS_PER_NAME = 8;

const TEXT = {
  notFound: '찾을 수 없는 주소예요.',
  method: '지원하지 않는 요청 방식이에요.',
  origin: '허용되지 않은 요청이에요.',
  tooManyRequests: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  tooManyLogins: '로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.',
  contentType: '요청 형식이 올바르지 않아요.',
  tooLarge: '요청이 너무 커요.',
  unreadable: '요청을 읽지 못했어요.',
  missing: '닉네임과 비밀번호를 입력해 주세요.',
  failed: '지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요.',
};
const STATUS: Record<AccountFailureReason, number> = {
  'invalid-name': 400, 'invalid-password': 400, 'name-taken': 409, 'bad-credentials': 401, unavailable: 503,
};

export type RateLimiter = {
  /** Records one use of `key`. Returns 0 when it is allowed, otherwise the milliseconds until the next one is. */
  take(key: string): number;
  /** Gives back the most recent use of `key`. */
  refund(key: string): void;
};

/** At most `limit` uses of a key in any `windowMs`, counted in memory. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = 10_000): RateLimiter {
  const uses = new Map<string, number[]>();
  function current(key: string, at: number) {
    const times = uses.get(key);
    if (!times) return undefined;
    while (times.length && at - times[0] >= windowMs) times.shift();
    if (!times.length) { uses.delete(key); return undefined; }
    return times;
  }
  /** Keeps the table bounded: lapsed keys go first, then the ones added longest ago. */
  function makeRoom(at: number) {
    for (const key of [...uses.keys()]) current(key, at);
    for (const key of uses.keys()) {
      if (uses.size < maxKeys) break;
      uses.delete(key);
    }
  }
  return {
    take(key) {
      const at = now();
      let times = current(key, at);
      if (times && times.length >= limit) return times[0] + windowMs - at;
      if (!times) {
        if (uses.size >= maxKeys) makeRoom(at);
        times = [];
        uses.set(key, times);
      }
      times.push(at);
      return 0;
    },
    refund(key) {
      const times = uses.get(key);
      if (!times) return;
      times.pop();
      if (!times.length) uses.delete(key);
    },
  };
}

/**
 * Reads the session token from the request's cookies, or null when there is none.
 * Socket servers call this on the upgrade request and hand the token to `playerName`
 * each time a nickname is needed, so a logout takes effect on sockets that are already open.
 */
export function sessionTokenFromRequest(req: IncomingMessage): string | null {
  for (const pair of (req.headers.cookie ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at < 0 || pair.slice(0, at).trim() !== SESSION_COOKIE) continue;
    const value = pair.slice(at + 1).trim();
    if (SESSION_TOKEN.test(value)) return value;
  }
  return null;
}

const firstValue = (header: string | string[] | undefined) => (Array.isArray(header) ? header[0] : header)?.split(',')[0].trim();

function isHttps(req: IncomingMessage): boolean {
  return firstValue(req.headers['x-forwarded-proto'])?.toLowerCase() === 'https' || (req.socket as { encrypted?: boolean }).encrypted === true;
}

/** A null token clears the cookie. */
function sessionCookie(req: IncomingMessage, token: string | null): string {
  return `${SESSION_COOKIE}=${token ?? ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? SESSION_MAX_AGE : 0}${isHttps(req) ? '; Secure' : ''}`;
}

/** The first forwarded hop when a proxy names one, otherwise the peer address. */
function clientAddress(req: IncomingMessage): string {
  return (firstValue(req.headers['x-forwarded-for']) || req.socket.remoteAddress || 'unknown').slice(0, 64);
}

/** The rule the socket upgrades apply: a request that names its origin must come from this site. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/** True when the rest of the request body is not worth waiting for. */
function abandonsBody(req: IncomingMessage): boolean {
  return !req.complete && (req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > BODY_LIMIT);
}

function reply(req: IncomingMessage, res: ServerResponse, status: number, body: Record<string, unknown>, headers: Record<string, string> = {}, close = false) {
  if (res.headersSent) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text),
    ...(close || abandonsBody(req) ? { Connection: 'close' } : {}), ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : text);
}

type Body = { text: string } | { status: 400 | 408 | 413; close: boolean };

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise(done => {
    if (Number(req.headers['content-length']) > DRAIN_LIMIT) { done({ status: 413, close: true }); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (body: Body) => {
      clearTimeout(timer);
      req.off('data', onData).off('end', onEnd).off('error', onError);
      done(body);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > DRAIN_LIMIT) finish({ status: 413, close: true });
      else if (size > BODY_LIMIT) chunks.length = 0;
      else chunks.push(chunk);
    };
    const onEnd = () => {
      if (size > BODY_LIMIT) { finish({ status: 413, close: false }); return; }
      try { finish({ text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) }); }
      catch { finish({ status: 400, close: false }); }
    };
    const onError = () => finish({ status: 400, close: true });
    const timer = setTimeout(() => finish({ status: 408, close: true }), BODY_TIMEOUT_MS);
    timer.unref();
    req.on('data', onData).on('end', onEnd).on('error', onError);
  });
}

/**
 * JSON API under /api/: POST signup, login and logout, GET me.
 * Every answer is `{ ok: true, ... }` or `{ ok: false, message }` and is never cached.
 */
export function createAuthApi(accounts: AccountStore, options: { now?: () => number } = {}) {
  const posts = createRateLimiter(POSTS_PER_ADDRESS, WINDOW_MS, options.now);
  const failedLogins = createRateLimiter(FAILED_LOGINS_PER_NAME, WINDOW_MS, options.now);

  async function route(req: IncomingMessage, res: ServerResponse, pathname: string) {
    const fail = (status: number, message: string, headers?: Record<string, string>, close?: boolean) => reply(req, res, status, { ok: false, message }, headers, close);
    const tooMany = (wait: number, message: string) => fail(429, message, { 'Retry-After': String(Math.ceil(wait / 1000)) });

    if (pathname === '/api/me') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { fail(405, TEXT.method, { Allow: 'GET, HEAD' }); return; }
      const token = sessionTokenFromRequest(req), account = accounts.accountForToken(token);
      // Sending the cookie again keeps it alive in the browser for as long as the session is in use.
      if (account && token) reply(req, res, 200, { ok: true, member: true, name: account.name }, { 'Set-Cookie': sessionCookie(req, token) });
      else reply(req, res, 200, { ok: true, member: false });
      return;
    }
    if (pathname !== '/api/signup' && pathname !== '/api/login' && pathname !== '/api/logout') { fail(404, TEXT.notFound); return; }
    if (req.method !== 'POST') { fail(405, TEXT.method, { Allow: 'POST' }); return; }
    // Refused before anything is counted, so another site cannot use up a visitor's attempts.
    if (!sameOrigin(req)) { fail(403, TEXT.origin); return; }
    // Logging out is never limited: it must always be possible.
    if (pathname !== '/api/logout') {
      const wait = posts.take(clientAddress(req));
      if (wait) { tooMany(wait, TEXT.tooManyRequests); return; }
    }
    if (firstValue(req.headers['content-type'])?.split(';')[0].trim().toLowerCase() !== 'application/json') { fail(415, TEXT.contentType); return; }

    if (pathname === '/api/logout') {
      await accounts.logout(sessionTokenFromRequest(req));
      reply(req, res, 200, { ok: true, member: false }, { 'Set-Cookie': sessionCookie(req, null) });
      return;
    }

    const body = await readBody(req);
    if ('status' in body) { fail(body.status, body.status === 413 ? TEXT.tooLarge : TEXT.unreadable, undefined, body.close); return; }
    let input: unknown;
    try { input = JSON.parse(body.text); } catch { fail(400, TEXT.unreadable); return; }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) { fail(400, TEXT.unreadable); return; }
    const { name, password } = input as Record<string, unknown>;
    if (typeof name !== 'string' || typeof password !== 'string') { fail(400, TEXT.missing); return; }

    // Failed logins are counted per nickname, in whatever spelling it was typed.
    const clean = pathname === '/api/login' ? accountName(name) : '';
    const key = clean ? nameKey(clean) : '';
    if (key) {
      // The attempt is counted before the password is checked, so parallel guesses cannot slip past the limit.
      const wait = failedLogins.take(key);
      if (wait) { tooMany(wait, TEXT.tooManyLogins); return; }
    }
    let result;
    try { result = await (pathname === '/api/login' ? accounts.login(name, password) : accounts.signup(name, password)); }
    finally { if (key && (!result || result.ok || result.reason !== 'bad-credentials')) failedLogins.refund(key); }
    if (!result.ok) { fail(STATUS[result.reason], result.message); return; }

    // The session this browser held before is ended; its cookie is about to be replaced.
    const previous = sessionTokenFromRequest(req);
    if (previous && previous !== result.token) await accounts.logout(previous);
    reply(req, res, 200, { ok: true, member: true, name: result.account.name }, { 'Set-Cookie': sessionCookie(req, result.token) });
  }

  return {
    /** Answers a request whose path is /api or below. Never rejects. */
    async handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
      try { await route(req, res, pathname); }
      catch (error) {
        console.error(`Account request failed: ${error instanceof Error ? error.message : String(error)}`);
        if (res.headersSent) res.destroy();
        else reply(req, res, 500, { ok: false, message: TEXT.failed }, {}, true);
      }
    },
  };
}
