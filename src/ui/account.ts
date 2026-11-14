/**
 * Optional accounts. A guest only types a nickname; a member signs in with a nickname and a password and
 * keeps that nickname to themselves. The session lives in an HttpOnly cookie the page cannot read, so this
 * module only knows what the server answers.
 */
export interface Account { member: boolean; name: string }
type Reply = { ok: boolean; message?: string; member?: boolean; name?: string };

const GUEST: Account = { member: false, name: '' };
/** Remembers that this browser was signed in, only to notice an expired session on the next visit. */
const FLAG = 'sideplay-member';
let current: Account = GUEST;
const listeners = new Set<(account: Account) => void>();

async function call(path: string, body?: unknown): Promise<Reply> {
  try {
    const response = await fetch(path, body === undefined
      ? { credentials: 'same-origin', cache: 'no-store' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as Partial<Reply>;
    return { ...data, ok: response.ok && data.ok !== false };
  } catch {
    return { ok: false, message: '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
}

function set(next: Account) {
  current = next;
  if (next.member) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG);
  for (const listener of listeners) listener(current);
}
const signedIn = (reply: Reply): Account => (reply.ok && typeof reply.name === 'string' && reply.name ? { member: true, name: reply.name } : GUEST);

export function account() { return current; }
/** True when this browser was signed in on its last visit. */
export function wasMember() { return localStorage.getItem(FLAG) === '1'; }
export function onAccountChange(listener: (account: Account) => void) { listeners.add(listener); }

/** Asks the server who we are. Returns null, changing nothing, when the server could not be asked. */
export async function refreshAccount(): Promise<Account | null> {
  const reply = await call('/api/me');
  if (!reply.ok || typeof reply.member !== 'boolean') return null;
  set(reply.member ? signedIn(reply) : GUEST);
  return current;
}
export async function signUp(name: string, password: string) {
  const reply = await call('/api/signup', { name, password });
  if (reply.ok) set(signedIn(reply));
  return reply;
}
export async function logIn(name: string, password: string) {
  const reply = await call('/api/login', { name, password });
  if (reply.ok) set(signedIn(reply));
  return reply;
}
export async function logOut() {
  const reply = await call('/api/logout', {});
  set(GUEST);
  return reply;
}
