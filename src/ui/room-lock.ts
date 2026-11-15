/** Room password UI shared by every room: the lock mark, the host's set/clear control and the form helpers. */
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 20;

/** Small padlock, drawn in the current text colour. */
export const LOCK_ICON = '<svg class="lock-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2.5" y="7" width="11" height="7.5" rx="1.5" fill="currentColor"/></svg>';

export const passwordProblem = (value: string) => {
  const length = [...value.trim()].length;
  return length < PASSWORD_MIN || length > PASSWORD_MAX ? `비밀번호는 ${PASSWORD_MIN}–${PASSWORD_MAX}자로 정해 주세요.` : '';
};

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export interface RoomLockControl { update(state: { locked: boolean; host: boolean; editable: boolean }): void }

/**
 * Lock status in the waiting room. Everyone sees '비밀번호 방' on a locked room; the host can set, change or clear it
 * before the match. Re-rendering is skipped while the host is typing, so frequent state updates never eat the field.
 */
export function roomLockControl(box: HTMLElement, save: (password: string | null) => void): RoomLockControl {
  let current = '', editing = false;
  let state = { locked: false, host: false, editable: false };
  box.classList.add('room-lock');
  function view() {
    editing = false;
    const { locked, host, editable } = state;
    box.hidden = !locked && !(host && editable);
    box.dataset.locked = String(locked);
    box.classList.remove('editing');
    const parts: HTMLElement[] = [];
    if (locked) {
      const mark = make('span', 'room-lock-mark');
      mark.innerHTML = LOCK_ICON;
      mark.append(make('span', '', '비밀번호 방'));
      parts.push(mark);
    }
    if (host && editable) {
      // One compact button: set a password, or change / clear the current one.
      const change = make('button', 'room-lock-edit');
      change.type = 'button';
      if (!locked) change.innerHTML = LOCK_ICON;
      change.append(locked ? '변경' : '비밀번호 걸기');
      change.onclick = edit;
      parts.push(change);
    }
    box.replaceChildren(...parts);
  }
  function edit() {
    editing = true;
    const form = make('form', 'room-lock-form');
    const input = make('input', 'room-lock-input');
    Object.assign(input, { type: 'password', maxLength: PASSWORD_MAX, placeholder: `새 비밀번호 ${PASSWORD_MIN}–${PASSWORD_MAX}자`, autocomplete: 'new-password', enterKeyHint: 'done' });
    input.setAttribute('aria-label', '새 방 비밀번호');
    const ok = make('button', 'room-lock-save', '저장'); ok.type = 'submit';
    const parts: HTMLElement[] = [input, ok];
    if (state.locked) {
      const clear = make('button', 'room-lock-clear', '풀기'); clear.type = 'button';
      clear.onclick = () => { save(null); view(); };
      parts.push(clear);
    }
    const cancel = make('button', 'room-lock-cancel', '취소'); cancel.type = 'button';
    cancel.onclick = view;
    const note = make('p', 'room-lock-note');
    note.setAttribute('role', 'alert');
    input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') view(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const problem = passwordProblem(input.value);
      if (problem) { note.textContent = problem; input.focus(); return; }
      save(input.value.trim());
      view();
    });
    form.append(...parts, cancel, note);
    box.hidden = false;
    box.classList.add('editing');
    box.replaceChildren(form);
    input.focus({ preventScroll: true });
  }
  return {
    update(next) {
      const key = JSON.stringify(next);
      if (key === current) return;
      current = key; state = next;
      if (editing && next.host && next.editable) return;
      view();
    },
  };
}

/**
 * The optional password a room creator sets on the entry form: a quiet link (or a lock icon button, when the button
 * has `data-icon`) that opens one field.
 */
export function createPasswordToggle(button: HTMLButtonElement, input: HTMLInputElement) {
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', input.id);
  button.onclick = () => {
    const opening = input.hidden;
    const label = opening ? '비밀번호 빼기' : '비밀번호 걸기';
    input.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
    if (button.dataset.icon !== undefined) { button.setAttribute('aria-label', label); button.title = label; }
    else button.textContent = label;
    if (opening) input.focus(); else input.value = '';
  };
}
