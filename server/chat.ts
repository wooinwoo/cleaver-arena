/** Room chat shared by the three room servers (/ws, /table-ws, /bumper-ws). */

export const CHAT_MAX_LENGTH = 200;
export const CHAT_HISTORY = 50;
/** At most CHAT_BURST messages per connection in any CHAT_WINDOW_MS. */
export const CHAT_BURST = 5;
export const CHAT_WINDOW_MS = 5000;

export type ChatMessage = { type: 'chat'; from: string; name: string; text: string; at: number; member?: true };
/** The room member speaking. The name always comes from the room, never from the chat request. */
export type ChatSender = { id: string; name: string; member?: boolean };
/** Per-connection send times for the rate limit. */
export type ChatLimiter = { sent: number[] };

export const createChatLimiter = (): ChatLimiter => ({ sent: [] });

/** Plain text on one line: whitespace collapsed, control and direction-override characters removed. */
export function cleanChatText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').replace(/[\p{Cc}‎‏‪-‮⁦-⁩]/gu, '').trim();
}

/**
 * Validates one chat request and, when it passes, appends it to the room's history (last CHAT_HISTORY kept).
 * The caller broadcasts `message` to everyone in the room.
 */
export function postChat(history: ChatMessage[], limiter: ChatLimiter, sender: ChatSender, raw: unknown, now = Date.now()):
  { message: ChatMessage; error?: undefined } | { error: string; message?: undefined } {
  const text = cleanChatText(raw);
  if (!text) return { error: '메시지를 입력해 주세요.' };
  if (text.length > CHAT_MAX_LENGTH) return { error: `메시지는 ${CHAT_MAX_LENGTH}자까지 보낼 수 있어요.` };
  limiter.sent = limiter.sent.filter(at => now - at < CHAT_WINDOW_MS);
  if (limiter.sent.length >= CHAT_BURST) return { error: '메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.' };
  limiter.sent.push(now);
  const message: ChatMessage = { type: 'chat', from: sender.id, name: sender.name, text, at: now, ...(sender.member ? { member: true as const } : {}) };
  history.push(message);
  if (history.length > CHAT_HISTORY) history.splice(0, history.length - CHAT_HISTORY);
  return { message };
}

/** Sent to a player right after they join or resume, so a reload keeps the conversation. */
export const chatHistory = (history: ChatMessage[]) => ({ type: 'chat-history', messages: history });
export const chatError = (message: string) => ({ type: 'chat-error', message });
