import { COLORS } from '../palette.ts';
import { ruleSteps } from './rules-dialog.ts';

/** Markup and slot rendering shared by every room page (table games and the bumper arena). */
export interface RoomShellOptions {
  /** Cover art SVG markup for the bar thumbnail. */
  art: string;
  title: string;
  /** One factual line about the game. */
  blurb: string;
  rules: string;
  /** Short facts shown as chips beside the preview: '2인', '봇 가능'. */
  facts: string[];
  /** Initial contents of #t-board (cover art or an empty board). */
  board: string;
  /** Extra controls shown only while creating a room (rule variant select...). */
  createExtras?: string;
}

/**
 * One page, two looks driven by body classes:
 * - `lobby-open` (no room yet, waiting, finished): a client-style lobby window with slots, preview and a start dock.
 * - playing: the slim bar on top and the game filling the stage.
 * Element ids are a contract with tabletop.ts, bumper.ts and the browser tests.
 */
export function roomShell(o: RoomShellOptions): string {
  return `
    <div class="table-bar">
      <div class="tb-identity"><span class="tb-art" aria-hidden="true">${o.art}</span><div class="tb-copy"><h1>${o.title}</h1><small>${o.blurb}</small></div></div>
      <div class="table-status"><span id="t-round"></span><strong id="t-turn" role="status"></strong></div>
      <div class="tb-actions">
        <div id="t-room" hidden>
          <span class="tb-code">방 코드 <strong id="t-code"></strong></span>
          <button id="t-copy" type="button">초대 링크 복사</button>
          <details class="tb-people"><summary><span class="tb-people-label">참가자</span><span id="t-count"></span></summary>
            <div class="tb-panel"><ul id="t-players"></ul></div>
          </details>
        </div>
        <details class="table-rules"><summary id="t-rules-title">규칙</summary><p id="t-rules-text">${o.rules}</p></details>
        <button id="t-leave" class="tb-leave" type="button">나가기</button>
      </div>
    </div>
    <div class="table-stage">
      <button id="t-result-review" type="button" aria-expanded="false" aria-controls="t-board-wrap" hidden>마지막 보드 보기</button>
      <div id="t-toolbar" hidden></div><div id="t-hands"></div>
      <div class="t-stage-area">
        <div id="t-board-wrap"><div id="t-board" class="empty-board">${o.board}</div></div>
        <aside class="t-about"><strong>${o.title}</strong><p>${o.blurb}</p><ul class="t-facts">${o.facts.map(fact => `<li>${fact}</li>`).join('')}</ul></aside>
        <div id="t-start">
          <form id="t-entry"><strong class="t-start-title" id="t-entry-title">${o.title} 시작하기</strong><label for="t-name">내 닉네임</label><input id="t-name" maxlength="12" autocomplete="nickname" placeholder="닉네임" required />
            <div class="t-create">${o.createExtras ?? ''}
            <button class="primary" type="submit">방 만들기</button></div><div class="join-row"><label class="sr-only" for="t-code-input">방 코드</label><input id="t-code-input" maxlength="6" placeholder="초대받은 방 코드 6자리"/><button type="button" id="t-join">입장</button></div>
            <button type="button" class="link-button" id="t-new-room" hidden>대신 새 방 만들기</button></form>
          <div id="t-lobby" hidden>
            <div class="t-lobby-head">
              <div class="room-name"><h2 id="t-title"></h2><button type="button" id="t-title-edit" class="room-name-edit" aria-label="방 제목 바꾸기" title="방 제목 바꾸기" hidden>✎</button></div>
              <strong class="t-start-title" id="t-start-title"></strong>
            </div>
            <ul id="t-lobby-roster" class="slots" aria-label="참가자"></ul>
            <div class="t-howto"><strong>게임 방법</strong><ol id="t-howto">${howToItems(o.rules)}</ol></div>
          </div>
        </div>
        <div class="t-dock" hidden>
          <p id="t-ready-note"></p>
          <div class="t-dock-actions">
            <button id="t-invite" class="primary" type="button" hidden>친구 초대 링크 복사</button>
            <button id="t-bot" class="primary" type="button" hidden>봇이랑 바로 시작</button>
            <button id="t-ready" class="primary" type="button">준비하기</button>
          </div>
        </div>
      </div>
      <div id="t-action-bar" hidden><span id="t-choice">칸을 선택하세요</span><button id="t-confirm" class="primary" disabled>선택한 수 확정</button><button id="t-cancel">취소</button></div>
      <p id="t-error" role="alert"></p>
      <p id="t-log" role="status"></p>
    </div>`;
}

const escapeText = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** First three rule sentences, as the lobby's quick how-to. */
function howToItems(rules: string) { return ruleSteps(rules).slice(0, 3).map(step => `<li>${escapeText(step)}</li>`).join(''); }
/** Refreshes the how-to when a room's rule variant changes. */
export function renderHowTo(list: HTMLElement, rules: string) { list.innerHTML = howToItems(rules); }

export interface SlotPlayer { id: string; name: string; seat: number; ready: boolean; connected: boolean; bot?: boolean; member?: boolean }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * Fills the lobby slot grid: one card per player, then one dashed card per free seat that copies the invite link.
 * Names are user input and only ever reach the DOM through textContent.
 */
export function renderSlots(list: HTMLElement, players: SlotPlayer[], options: { capacity: number; me: string; host: string | null; onInvite: () => void }) {
  const cards = players.map(player => {
    const bot = player.bot ?? player.name === '봇';
    const card = el('li', 'slot');
    card.classList.toggle('me', player.id === options.me);
    card.classList.toggle('ready', player.ready && player.connected);
    card.classList.toggle('away', !player.connected);
    card.style.setProperty('--seat', COLORS[player.seat % COLORS.length]);
    const avatar = el('span', 'slot-avatar', bot ? '봇' : [...player.name.trim()][0] ?? '?');
    avatar.setAttribute('aria-hidden', 'true');
    const copy = el('span', 'slot-copy');
    const tags = [player.id === options.host ? '방장' : '', player.id === options.me ? '나' : '', bot ? '봇' : ''].filter(Boolean).join(' · ');
    const name = el('strong', '', player.name);
    if (player.member) name.append(el('span', 'slot-member', '회원'));
    copy.append(name, el('small', '', tags || `${player.seat + 1}번 자리`));
    const state = el('span', 'slot-state', !player.connected ? '재접속 대기' : player.ready ? '준비 완료' : '준비 전');
    card.append(avatar, copy, state);
    return card;
  });
  const free = Math.max(0, options.capacity - players.length);
  for (let index = 0; index < free; index++) {
    const card = el('li', 'slot empty');
    const button = el('button', 'slot-invite');
    button.type = 'button';
    button.onclick = options.onInvite;
    const plus = el('span', 'slot-avatar', '+'); plus.setAttribute('aria-hidden', 'true');
    const copy = el('span', 'slot-copy');
    // Wide screens show every free seat; phones fold them into the first card with the count.
    copy.append(el('strong', 'slot-empty-one', '빈 자리'), el('strong', 'slot-empty-all', `빈 자리 ${free}개`), el('small', '', '초대 링크 복사'));
    button.append(plus, copy);
    card.append(button);
    cards.push(card);
  }
  list.replaceChildren(...cards);
}
