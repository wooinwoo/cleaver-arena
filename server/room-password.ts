import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Optional room passwords shared by the three room servers. Only a salted scrypt hash is kept, in memory. */

export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 20;
/** Wrong guesses allowed per connection in PASSWORD_WINDOW_MS. */
export const PASSWORD_TRIES = 5;
export const PASSWORD_WINDOW_MS = 60_000;

export type RoomLock = { salt: Buffer; hash: Buffer };
export type PasswordGate = { failed: number[] };
export const createPasswordGate = (): PasswordGate => ({ failed: [] });

const hashOf = (password: string, salt: Buffer) => scryptSync(password.normalize('NFC'), salt, 32, { N: 8192 });

/** Reads a password a host wants to set: absent or empty clears it, otherwise 4–20 characters. */
export function readPassword(value: unknown): { ok: true; password: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, password: null };
  if (typeof value !== 'string') return { ok: false, message: '비밀번호를 다시 입력해 주세요.' };
  const password = value.trim();
  if (!password) return { ok: true, password: null };
  const length = [...password].length;
  if (length < PASSWORD_MIN || length > PASSWORD_MAX || /\p{Cc}/u.test(password)) {
    return { ok: false, message: `비밀번호는 ${PASSWORD_MIN}–${PASSWORD_MAX}자로 정해 주세요.` };
  }
  return { ok: true, password };
}

export function lockWith(password: string | null): RoomLock | null {
  if (!password) return null;
  const salt = randomBytes(16);
  return { salt, hash: hashOf(password, salt) };
}

export function passwordMatches(lock: RoomLock, attempt: string): boolean {
  return timingSafeEqual(hashOf(attempt, lock.salt), lock.hash);
}

/**
 * Checks a join attempt against a room's lock. Returns null when the player may enter, otherwise the error to send
 * (with `code: 'password'` so the client shows its password field). Wrong guesses count against the connection.
 */
export function admit(lock: RoomLock | null | undefined, attempt: unknown, gate: PasswordGate, now = Date.now()):
  null | { type: 'error'; code: 'password'; message: string } {
  if (!lock) return null;
  gate.failed = gate.failed.filter(at => now - at < PASSWORD_WINDOW_MS);
  if (gate.failed.length >= PASSWORD_TRIES) return { type: 'error', code: 'password', message: '비밀번호를 여러 번 틀렸어요. 1분 뒤에 다시 시도해 주세요.' };
  const guess = typeof attempt === 'string' ? attempt.trim() : '';
  if (!guess) return { type: 'error', code: 'password', message: '비밀번호가 걸린 방이에요. 비밀번호를 입력해 주세요.' };
  if ([...guess].length <= PASSWORD_MAX && passwordMatches(lock, guess)) return null;
  gate.failed.push(now);
  return { type: 'error', code: 'password', message: '비밀번호가 맞지 않아요.' };
}
