/** Inline room-name editing shared by the arena room and every tabletop room. */
export const ROOM_TITLE_MAX = 24;

export function cleanTitle(value: string) {
  return value.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, ROOM_TITLE_MAX);
}

/** Swaps the heading for a text field; Enter or blur commits, Escape restores. */
export function editTitle(heading: HTMLElement, current: string, commit: (title: string) => void) {
  if (heading.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'room-name-input';
  input.maxLength = ROOM_TITLE_MAX;
  input.value = current;
  input.setAttribute('aria-label', '방 제목');
  input.enterKeyHint = 'done';
  input.autocomplete = 'off';
  const previous = [...heading.childNodes];
  heading.replaceChildren(input);
  input.focus({ preventScroll: true });
  input.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const next = cleanTitle(input.value);
    heading.replaceChildren(...previous);
    if (save && next && next !== current) { heading.textContent = next; commit(next); }
  };
  input.onclick = (event) => event.stopPropagation();
  input.onblur = () => finish(true);
  input.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  };
}
