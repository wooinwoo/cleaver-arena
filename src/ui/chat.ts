/**
 * Room chat widget shared by the table rooms, 범퍼카 and 문도피구.
 *
 * Wide screens, before a match: an open panel inside the waiting room (`panelSlot`).
 * Phones before a match: a compact button beside the ready button (`dockHost`) that opens a bottom sheet.
 * During a match: a small toggle in the game's own bar (`playHost`) with an unread badge; the panel opens as a
 * popover next to it and starts closed, so the board and controls stay clear.
 * Everything users typed reaches the DOM through textContent only.
 */
export type ChatLine = { from: string; name: string; text: string; at: number; member?: boolean };

export interface RoomChat {
  /** `joined`: the player is in a room. `playing`: a match is on screen. */
  setState(state: { joined: boolean; playing: boolean }): void;
  /** The player's own id in the room, to mark their lines. */
  setSelf(id: string): void;
  add(line: ChatLine): void;
  reset(lines: ChatLine[]): void;
  error(message: string): void;
  clear(): void;
  /** Recomputes the popover position (call when the toggle moved). */
  reposition(): void;
  /** Opens the chat (during a match too) and puts the caret in the input. */
  focus(): void;
}

type Host = { parent: HTMLElement; before?: Element | null };
export interface ChatOptions {
  /** Sends one message; returns false when there is no connection. */
  send(text: string): boolean;
  /** Waiting-room slot for the open panel on wide screens. */
  panelSlot: HTMLElement;
  /** Where the toggle sits on phones before a match (next to the ready button). */
  dockHost(): Host;
  /** Where the toggle sits during a match (the game's bar). */
  playHost(): Host;
  /** Called when the input gains focus, so a game can drop held keys. */
  onFocus?(): void;
}

export const CHAT_MAX_LENGTH = 200;
const KEEP = 50;
const wide = matchMedia('(min-width: 761px)');

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const clock = (at: number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

export function mountChat(options: ChatOptions): RoomChat {
  let joined = false, playing = false, open = false, self = '', unread = 0;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;

  const panel = make('section', 'chat-panel');
  panel.setAttribute('aria-label', '방 채팅');
  panel.hidden = true;
  // A div, not <header>: the site styles every header element as the page's top bar.
  const head = make('div', 'chat-head');
  const close = make('button', 'chat-close', '✕');
  close.type = 'button'; close.setAttribute('aria-label', '채팅 닫기');
  head.append(make('strong', '', '채팅'), close);
  const log = make('ol', 'chat-log');
  log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
  const empty = make('li', 'chat-empty', '아직 대화가 없어요.');
  log.append(empty);
  const form = make('form', 'chat-form');
  const input = make('input', 'chat-input');
  Object.assign(input, { type: 'text', maxLength: CHAT_MAX_LENGTH, placeholder: '메시지 입력', autocomplete: 'off', enterKeyHint: 'send' });
  input.setAttribute('aria-label', '채팅 메시지');
  const submit = make('button', 'chat-send', '보내기');
  submit.type = 'submit';
  form.append(input, submit);
  const problem = make('p', 'chat-error');
  problem.setAttribute('role', 'alert');
  panel.append(head, log, form, problem);

  const toggle = make('button', 'chat-toggle');
  toggle.type = 'button'; toggle.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  const badge = make('span', 'chat-badge');
  badge.hidden = true;
  toggle.append(make('span', 'chat-toggle-label', '채팅'), badge);

  const inline = () => joined && !playing && wide.matches;
  const visible = () => joined && (inline() || open);

  function syncBadge() {
    badge.hidden = !unread;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    toggle.setAttribute('aria-label', unread ? `채팅 · 새 메시지 ${unread}개` : '채팅');
  }
  function layout() {
    if (!joined) { open = false; panel.hidden = true; toggle.hidden = true; return; }
    const showInline = inline();
    // Moving the panel keeps its log and draft; only the place and look change.
    if (showInline) {
      if (panel.parentElement !== options.panelSlot) options.panelSlot.append(panel);
      panel.classList.remove('is-popover');
      panel.hidden = false;
      toggle.hidden = true;
      unread = 0;
    } else {
      if (panel.parentElement !== document.body) document.body.append(panel);
      panel.classList.add('is-popover');
      panel.hidden = !open;
      const host = playing ? options.playHost() : options.dockHost();
      if (toggle.parentElement !== host.parent || (host.before && toggle.nextElementSibling !== host.before)) host.parent.insertBefore(toggle, host.before ?? null);
      toggle.dataset.place = playing ? 'bar' : 'dock';
      panel.dataset.anchor = playing ? 'toggle' : 'sheet';
      toggle.hidden = false;
      if (open) unread = 0;
    }
    close.hidden = showInline;
    toggle.setAttribute('aria-expanded', String(open && !showInline));
    toggle.classList.toggle('is-open', open && !showInline);
    syncBadge();
    if (!panel.hidden) { reposition(); scrollToEnd(); }
  }
  /** Popover beside the toggle on wide screens; phones get a bottom sheet from CSS. */
  function reposition() {
    if (!panel.classList.contains('is-popover') || panel.hidden) return;
    const box = toggle.getBoundingClientRect();
    const below = box.top + box.height / 2 < innerHeight / 2;
    panel.style.setProperty('--chat-right', `${Math.max(8, innerWidth - box.right)}px`);
    panel.style.setProperty('--chat-top', below ? `${Math.round(box.bottom + 8)}px` : 'auto');
    panel.style.setProperty('--chat-bottom', below ? 'auto' : `${Math.round(innerHeight - box.top + 8)}px`);
    panel.style.setProperty('--chat-room', `${Math.round(below ? innerHeight - box.bottom - 16 : box.top - 16)}px`);
  }
  function setOpen(value: boolean, focus = false) {
    open = value;
    layout();
    if (open && focus && !matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
  }
  const nearEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  function scrollToEnd() { log.scrollTop = log.scrollHeight; }
  function line(message: ChatLine) {
    const item = make('li', 'chat-line');
    item.classList.toggle('mine', message.from === self);
    item.dataset.from = message.from;
    const time = make('time', 'chat-time', clock(message.at));
    time.dateTime = new Date(message.at).toISOString();
    item.append(make('b', 'chat-name', message.name), make('span', 'chat-text', message.text), time);
    return item;
  }
  function showError(message: string) {
    problem.textContent = message;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { problem.textContent = ''; }, 3500);
  }

  toggle.onclick = () => setOpen(!open, true);
  close.onclick = () => { setOpen(false); toggle.focus({ preventScroll: true }); };
  // Game keys (WASD, Space, Q/F/D) never see what is typed here.
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !inline()) { setOpen(false); toggle.focus({ preventScroll: true }); }
  });
  input.addEventListener('focus', () => options.onFocus?.());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (options.send(text)) input.value = '';
    else showError('연결을 기다리고 있어요.');
  });
  wide.addEventListener('change', layout);
  addEventListener('resize', reposition);

  return {
    setState(state) {
      if (state.joined === joined && state.playing === playing) return;
      // A match starts with the chat folded away.
      if (state.playing && !playing) open = false;
      joined = state.joined; playing = state.playing;
      layout();
    },
    setSelf(id) {
      if (id === self) return;
      self = id;
      for (const item of log.querySelectorAll<HTMLElement>('.chat-line')) item.classList.toggle('mine', item.dataset.from === self);
    },
    add(message) {
      const stick = nearEnd();
      empty.remove();
      log.append(line(message));
      while (log.children.length > KEEP) log.firstElementChild?.remove();
      if (!visible() && message.from !== self) unread++;
      syncBadge();
      if (stick || message.from === self) scrollToEnd();
    },
    reset(lines) {
      log.replaceChildren(...(lines.length ? lines.map(line) : [empty]));
      unread = 0;
      syncBadge();
      scrollToEnd();
    },
    error: showError,
    clear() {
      log.replaceChildren(empty); unread = 0; input.value = '';
      joined = false; open = false; layout();
    },
    reposition,
    focus() {
      if (!joined) return;
      if (!inline()) setOpen(true);
      input.focus({ preventScroll: true });
    },
  };
}
