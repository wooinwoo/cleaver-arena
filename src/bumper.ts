import { BUMPER_CAPACITY, BUMPER_INFO, DASH_COOLDOWN, type BumperView } from '../shared/bumper.ts';
import type { BumperWorld } from './bumper-world.ts';
import { COLORS } from './palette.ts';
import { gameArt, gameAccent, gameWaiting } from './ui/game-art.ts';
import { openRules } from './ui/rules-dialog.ts';
import { editTitle } from './ui/room-title.ts';
import { roomShell, renderSlots } from './ui/room-shell.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = 'bumper-session';

/** 범퍼카 page: the shared lobby window before a match, a full-screen 3D arena with a HUD during it. */
export function initBumper(options: { create?: boolean; solo?: boolean } = {}) {
  document.body.classList.add('in-table', 'in-bumper', 'lobby-open');
  document.body.style.setProperty('--game-accent', gameAccent('bumper'));
  $('hub').hidden = true; $('lobby').hidden = true; $('loading').hidden = true; $('game').hidden = true;
  document.querySelector<HTMLElement>('.view-dock')!.hidden = true;
  $('games-menu').hidden = false;
  document.title = `${BUMPER_INFO.title} · SIDEPLAY`;

  const canvas = document.createElement('canvas');
  canvas.id = 'bumper-canvas';
  canvas.setAttribute('aria-label', '범퍼카 경기장');
  const section = document.createElement('section'); section.id = 'table-page';
  section.innerHTML = roomShell({
    art: gameArt('bumper', true), title: BUMPER_INFO.title, blurb: BUMPER_INFO.description, rules: BUMPER_INFO.rules,
    facts: ['1–6인', '봇 가능', '실시간 3D'], board: gameWaiting('bumper', BUMPER_INFO.title),
  });
  const hud = document.createElement('div'); hud.id = 'bumper-hud'; hud.hidden = true;
  hud.innerHTML = `
    <div class="bh-top"><span id="bh-round"></span><strong id="bh-time"></strong><ul id="bh-scores"></ul><button id="bh-leave" type="button">나가기</button></div>
    <div id="bh-banner" role="status"></div>
    <div id="bh-stick" aria-label="이동 패드"><i></i></div>
    <button id="bh-dash" type="button"><span>대시</span><small></small></button>
    <p class="bh-help">WASD · 방향키 이동 &nbsp;·&nbsp; Space 대시</p>`;
  document.body.append(canvas, section, hud);
  const dock = section.querySelector<HTMLElement>('.t-dock')!;
  // Host-only bot controls sit beside the ready button.
  const addBot = Object.assign(document.createElement('button'), { type: 'button', id: 't-bot-add', textContent: '봇 추가' });
  const removeBot = Object.assign(document.createElement('button'), { type: 'button', id: 't-bot-remove', textContent: '봇 빼기' });
  section.querySelector('.t-dock-actions')!.prepend(addBot, removeBot);
  const rules = section.querySelector<HTMLDetailsElement>('.table-rules')!;
  rules.addEventListener('toggle', () => { if (rules.open) { rules.open = false; openRules('bumper', BUMPER_INFO.title, BUMPER_INFO.rules); } });

  let ws: WebSocket | null = null, view: BumperView | null = null, world: BumperWorld | null = null;
  let session: { code: string; token: string } | null = null, myId = '';
  let intentional = false, connecting = false, retries = 0, timer: ReturnType<typeof setTimeout>;
  let soloIntent = !!options.solo, lobbySignature = '', scoreSignature = '';
  const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  document.body.classList.toggle('has-touch', touch);
  const name = $<HTMLInputElement>('t-name');
  name.value = localStorage.getItem('cleaver-name') ?? '';
  const invitation = new URLSearchParams(location.search).get('room');
  const entry = $('t-entry');
  if (invitation) $<HTMLInputElement>('t-code-input').value = invitation.toUpperCase().slice(0, 6);
  function setInvited(invited: boolean) {
    entry.classList.toggle('invited', invited);
    $('t-join').classList.toggle('primary', invited);
    $('t-join').textContent = invited ? '이 방에 입장' : '입장';
    $('t-new-room').hidden = !invited;
    $('t-entry-title').textContent = invited ? `초대받은 ${BUMPER_INFO.title} 방 · ${$<HTMLInputElement>('t-code-input').value}` : `${BUMPER_INFO.title} 시작하기`;
  }
  setInvited(!!invitation);
  $('t-new-room').onclick = () => { setInvited(false); $<HTMLInputElement>('t-code-input').value = ''; name.focus(); };

  void import('./bumper-world.ts').then(({ BumperWorld: World }) => {
    world = new World(canvas);
    world.onImpact = (kind, mine) => { if (mine && kind === 'hit' && navigator.vibrate) navigator.vibrate(18); };
    if (view) world.push(view, myId);
  }).catch(() => { $('t-error').textContent = '3D 화면을 시작하지 못했어요. Chrome 또는 Safari에서 다시 열어 주세요.'; });

  const send = (data: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  function busy(value: boolean) {
    connecting = value;
    for (const element of entry.querySelectorAll<HTMLButtonElement>('button')) element.disabled = value;
  }
  function resetEntry(message: string) {
    session = null; sessionStorage.removeItem(KEY); view = null; lobbySignature = '';
    $('t-entry').hidden = false; $('t-room').hidden = true; $('t-lobby').hidden = true; dock.hidden = true;
    $('t-error').textContent = message;
    setPlaying(false);
  }
  function connect(request: Record<string, unknown>) {
    $('t-error').textContent = ''; busy(true); $('connection').textContent = '연결 중…';
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bumper-ws`);
    const current = ws;
    const timeout = setTimeout(() => { if (current.readyState !== WebSocket.OPEN) current.close(); }, 12_000);
    ws.onopen = () => { clearTimeout(timeout); send(request); };
    ws.onmessage = event => {
      if (current !== ws) return;
      const data = JSON.parse(event.data);
      if (data.type === 'joined') {
        busy(false); retries = 0; myId = data.id;
        session = { code: data.code, token: data.token };
        sessionStorage.setItem(KEY, JSON.stringify(session));
        history.replaceState(null, '', `/?game=bumper&room=${data.code}`);
        $('t-entry').hidden = true; $('t-room').hidden = false; $('t-lobby').hidden = false; dock.hidden = false;
        $('t-code').textContent = data.code; $('connection').textContent = '연결됨';
      } else if (data.type === 'state') {
        view = data.game as BumperView;
        world?.push(view, myId);
        render();
        if (soloIntent && view.phase === 'lobby') { soloIntent = false; send({ type: 'ready' }); }
      } else if (data.type === 'error' || data.type === 'expired') {
        busy(false); $('t-error').textContent = data.message;
        if (data.type === 'expired') resetEntry(data.message);
      }
    };
    ws.onclose = () => {
      clearTimeout(timeout); busy(false);
      if (intentional || current !== ws) return;
      $('connection').textContent = '연결 끊김';
      if (session && retries < 10) timer = setTimeout(() => connect({ type: 'resume', ...session }), Math.min(3000, 500 * 2 ** retries++));
      else resetEntry('연결하지 못했어요. 잠시 후 다시 입장해 주세요.');
    };
  }
  function enter(type: 'create' | 'join') {
    if (connecting) return;
    if (!name.value.trim()) { name.reportValidity(); return; }
    const code = $<HTMLInputElement>('t-code-input').value.trim().toUpperCase();
    if (type === 'join' && !/^[A-F0-9]{6}$/.test(code)) { $('t-error').textContent = '방 코드 6자리를 확인해 주세요.'; return; }
    localStorage.setItem('cleaver-name', name.value.trim());
    connect({ type, name: name.value.trim(), code, ...(type === 'create' && soloIntent ? { solo: true } : {}) });
  }
  entry.addEventListener('submit', event => { event.preventDefault(); enter(entry.classList.contains('invited') ? 'join' : 'create'); });
  $('t-join').onclick = () => enter('join');
  $('t-code-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); enter('join'); } });
  $('t-ready').onclick = () => send({ type: 'ready' });
  // Alone in the room: fill it with three bots and go.
  $('t-bot').onclick = () => { for (let n = 0; n < 3; n++) send({ type: 'bot', add: true }); send({ type: 'ready' }); };
  addBot.onclick = () => send({ type: 'bot', add: true });
  removeBot.onclick = () => send({ type: 'bot', add: false });
  const copyLink = async () => {
    const url = `${location.origin}/?game=bumper&room=${session?.code}`;
    try {
      await navigator.clipboard.writeText(url);
      const copy = $('t-copy'); copy.textContent = '복사됨 ✓'; copy.classList.add('copied');
      setTimeout(() => { copy.textContent = '초대 링크 복사'; copy.classList.remove('copied'); }, 1800);
    } catch { window.prompt('초대 링크를 복사해 주세요.', url); }
  };
  $('t-copy').onclick = copyLink; $('t-invite').onclick = copyLink;
  function leave() { intentional = true; clearTimeout(timer); send({ type: 'leave' }); ws?.close(); sessionStorage.removeItem(KEY); location.assign('/'); }
  $('games-menu').onclick = leave; $('bh-leave').onclick = leave; $('t-leave').onclick = leave;
  $('t-title-edit').onclick = () => { if (view && (view.phase === 'lobby' || view.phase === 'finished')) editTitle($('t-title'), view.title, title => send({ type: 'title', title })); };

  function setPlaying(playing: boolean) {
    document.body.classList.toggle('lobby-open', !playing);
    document.body.classList.toggle('bumper-playing', playing);
    hud.hidden = !playing;
    if (!playing) { stick.x = 0; stick.z = 0; keys.clear(); dashQueued = false; }
  }

  function render() {
    if (!view) return;
    const playing = view.phase !== 'lobby' && view.phase !== 'finished';
    setPlaying(playing);
    const me = view.players.find(p => p.id === myId);
    const host = view.players.find(p => !p.bot);
    if (playing) { renderHud(me); return; }
    const signature = JSON.stringify([view.phase, view.title, view.winner, view.players.map(p => [p.id, p.name, p.ready, p.connected, p.slot, p.score])]);
    if (signature === lobbySignature) return;
    lobbySignature = signature;
    const isHost = !!me && host?.id === me.id;
    const humans = view.players.filter(p => !p.bot);
    const bots = view.players.length - humans.length;
    const heading = $('t-title');
    if (!heading.querySelector('input')) heading.textContent = view.title;
    document.title = `${view.title} · SIDEPLAY`;
    $('t-title-edit').hidden = !isHost;
    document.body.dataset.tablePhase = view.phase;
    $('t-count').textContent = `${view.players.length}/${BUMPER_CAPACITY}명`;
    renderSlots($('t-lobby-roster'), view.players.map(p => ({ id: p.id, name: p.name, seat: p.slot, ready: p.ready, connected: p.connected, bot: p.bot })),
      { capacity: BUMPER_CAPACITY, me: myId, host: host?.id ?? null, onInvite: copyLink });
    const alone = view.players.length < 2;
    $('t-start-title').textContent = view.phase === 'finished' ? view.winner : alone ? '봇을 넣거나 친구를 초대하세요' : '모두 준비하면 시작해요';
    $('t-bot').hidden = !alone;
    $('t-invite').hidden = true;
    $('t-ready').hidden = alone;
    $('t-ready').classList.toggle('primary', !alone);
    $('t-ready').textContent = me?.ready ? '준비 취소' : view.phase === 'finished' ? '한 판 더' : '준비하기';
    addBot.hidden = !isHost || alone || view.players.length >= BUMPER_CAPACITY;
    removeBot.hidden = !isHost || bots === 0;
    $('t-ready-note').textContent = view.phase === 'finished'
      ? view.players.slice().sort((a, b) => b.score - a.score).map(p => `${p.name} ${p.score}승`).join(' · ')
      : alone ? '혼자서는 시작할 수 없어요. 봇이나 친구가 필요해요.'
      : `준비 ${humans.filter(p => p.ready).length}/${humans.length}명${bots ? ` · 봇 ${bots}대` : ''} · 3라운드 선취`;
  }

  function renderHud(me: BumperView['players'][number] | undefined) {
    if (!view) return;
    $('bh-round').textContent = `${view.round}라운드`;
    const time = $('bh-time');
    time.textContent = view.time > 0 ? String(Math.ceil(view.time)) : '서든데스';
    time.classList.toggle('low', view.time <= 10);
    const signature = JSON.stringify(view.players.map(p => [p.id, p.score, p.alive, p.name]));
    if (signature !== scoreSignature) {
      scoreSignature = signature;
      $('bh-scores').replaceChildren(...view.players.slice().sort((a, b) => a.slot - b.slot).map(p => {
        const item = document.createElement('li');
        item.classList.toggle('out', !p.alive); item.classList.toggle('me', p.id === myId);
        item.style.setProperty('--seat', COLORS[p.slot % COLORS.length]);
        const who = document.createElement('span'); who.textContent = p.name;
        const wins = document.createElement('b'); wins.textContent = '●'.repeat(p.score) + '○'.repeat(Math.max(0, view!.target - p.score));
        wins.setAttribute('aria-label', `${p.score}승`);
        item.append(who, wins); return item;
      }));
    }
    const banner = $('bh-banner');
    const winner = view.players.find(p => p.id === view!.roundWinner);
    banner.textContent = view.phase === 'countdown' ? String(Math.max(1, Math.ceil(view.countdown)))
      : view.phase === 'roundEnd' ? (winner ? `${winner.name} 라운드 승리` : '무승부')
      : me && !me.alive ? '탈락 · 다음 라운드를 기다려요' : '';
    banner.dataset.kind = view.phase === 'countdown' ? 'count' : view.phase === 'roundEnd' ? 'result' : 'note';
    const dash = $<HTMLButtonElement>('bh-dash');
    const cooling = !me || !me.alive || me.dash > 0 || view.phase !== 'playing';
    dash.classList.toggle('cooling', cooling);
    dash.style.setProperty('--cool', String(me ? Math.min(1, me.dash / DASH_COOLDOWN) : 0));
    dash.querySelector('small')!.textContent = me && me.dash > 0 ? me.dash.toFixed(1) : '';
  }

  // —— input: keyboard, an on-screen stick and a dash button. Sent 20 times a second while playing.
  const keys = new Set<string>(), stick = { x: 0, z: 0 };
  let dashQueued = false;
  const MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  window.addEventListener('keydown', event => {
    if (hud.hidden || (event.target as HTMLElement).closest?.('input, textarea')) return;
    if (MOVE.includes(event.code)) { keys.add(event.code); event.preventDefault(); }
    if ((event.code === 'Space' || event.code === 'ShiftLeft') && !event.repeat) { dashQueued = true; event.preventDefault(); }
  });
  window.addEventListener('keyup', event => { keys.delete(event.code); });
  window.addEventListener('blur', () => { keys.clear(); stick.x = 0; stick.z = 0; });
  const pad = $('bh-stick'), thumb = pad.querySelector<HTMLElement>('i')!;
  let padPointer: number | null = null;
  const movePad = (event: PointerEvent) => {
    const box = pad.getBoundingClientRect(), half = box.width / 2;
    let dx = (event.clientX - box.left - half) / half, dy = (event.clientY - box.top - half) / half;
    const length = Math.hypot(dx, dy);
    if (length > 1) { dx /= length; dy /= length; }
    stick.x = dx; stick.z = -dy;
    thumb.style.transform = `translate(${dx * half * .55}px, ${dy * half * .55}px)`;
  };
  pad.addEventListener('pointerdown', event => { padPointer = event.pointerId; pad.setPointerCapture(event.pointerId); movePad(event); event.preventDefault(); });
  pad.addEventListener('pointermove', event => { if (event.pointerId === padPointer) movePad(event); });
  const releasePad = (event: PointerEvent) => { if (event.pointerId !== padPointer) return; padPointer = null; stick.x = 0; stick.z = 0; thumb.style.transform = ''; };
  pad.addEventListener('pointerup', releasePad); pad.addEventListener('pointercancel', releasePad);
  $('bh-dash').addEventListener('pointerdown', event => { dashQueued = true; event.preventDefault(); });
  setInterval(() => {
    if (hud.hidden || document.hidden) return;
    const right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    const up = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    send({ type: 'input', input: { x: stick.x + right, z: stick.z + up, dash: dashQueued } });
    dashQueued = false;
  }, 50);
  setInterval(() => send({ type: 'ping', time: Date.now() }), 5000);

  let resumed = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (saved?.code && saved?.token && (!invitation || invitation.toUpperCase() === saved.code)) { session = saved; resumed = true; connect({ type: 'resume', ...saved }); }
  } catch { sessionStorage.removeItem(KEY); }
  if (!resumed && options.create && !invitation && name.value.trim()) enter('create');
}
