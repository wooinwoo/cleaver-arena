import './style.css';
import type { World } from './world.ts';
import { COLORS } from './palette.ts';
import { isTableId } from '../shared/catalog.ts';
import { initTabletop } from './tabletop.ts';
import type { ArenaMap, Game, Input } from '../shared/game.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('has-touch', touch);
const nameInput = $<HTMLInputElement>('nickname');
const codeInput = $<HTMLInputElement>('room-code');
const mapInput = $<HTMLSelectElement>('map');
const error = $('error');
const sessionKey = 'cleaver-session';
let world: World;
let socket: WebSocket | null = null;
let state: Game | null = null;
let myId = '';
let session: { code: string; token: string } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let reconnects = 0;
let intentionalClose = false;
let connecting = false;
let rosterKey = '';
let phaseKey = '';
let lastPhase = '';
let lastAliveIds = '';
let settingsKey = '';
let mouseFire = false;
let pulseUntil = 0;
let stick = { x: 0, z: 0 };
let cursor: { x: number; y: number } | null = null;
let destination: Input['target'];
const keys = new Set<string>();
let soundEnabled = false;
let audio: AudioContext | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
let latestInput: Input = { x: 0, z: 0, yaw: 0, fire: false };
let freshState = false;
let hitAnimation: Animation | undefined;

function openGame() {
  if (!world) { location.assign('/?game=cleaver'); return; }
  $('hub').hidden = true;
  $('lobby').hidden = false;
  $('games-menu').hidden = false;
  document.body.classList.remove('in-hub');
  document.querySelector<HTMLElement>('.view-dock')!.hidden = false;
  history.replaceState(null, '', '/?game=cleaver');
  world.engine.resize();
}
$('choose-cleaver').onclick = openGame;
document.querySelectorAll<HTMLButtonElement>('[data-game]').forEach(button => {
  button.onclick = () => location.assign(`/?game=${button.dataset.game}`);
});
$('games-menu').onclick = () => { if (session) leave(); else location.assign('/'); };

function toast(message: string) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3000);
}

function sound(frequency: number, duration: number) {
  if (!soundEnabled || !audio) return;
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * .45, audio.currentTime + duration);
  gain.gain.setValueAtTime(.04, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(); oscillator.stop(audio.currentTime + duration);
}

function send(data: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}

function setBusy(busy: boolean) {
  connecting = busy;
  for (const id of ['create', 'join', 'practice']) $<HTMLButtonElement>(id).disabled = busy;
}

function connect(request: Record<string, unknown>) {
  error.textContent = '';
  intentionalClose = false;
  setBusy(true);
  $('connection').textContent = '서버 연결 중…';
  if (socket?.readyState === WebSocket.OPEN && !session) { send(request); return; }
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const thisSocket = socket;
  const timeout = setTimeout(() => {
    if (thisSocket.readyState !== WebSocket.OPEN) thisSocket.close();
  }, 12_000);
  thisSocket.onopen = () => { clearTimeout(timeout); send(request); };
  thisSocket.onmessage = event => {
    if (thisSocket !== socket) return;
    const data = JSON.parse(event.data);
    if (data.type === 'joined') {
      freshState = true;
      setBusy(false);
      reconnects = 0;
      myId = data.id;
      session = { code: data.code, token: data.token };
      sessionStorage.setItem(sessionKey, JSON.stringify(session));
      history.replaceState(null, '', `/?game=cleaver&room=${data.code}`);
      $('entry').hidden = true;
      $('room').hidden = false;
      $('code').textContent = data.code;
      $('connection').textContent = '연결됨';
      error.textContent = '';
    } else if (data.type === 'state') {
      state = data.game;
      world.applyState(state!, myId, freshState);
      freshState = false;
      renderState();
    } else if (data.type === 'error' || data.type === 'expired') {
      setBusy(false);
      error.textContent = data.message;
      toast(data.message);
      if (data.type === 'expired') {
        session = null; sessionStorage.removeItem(sessionKey);
        resetControls();
        $('entry').hidden = false; $('room').hidden = true;
        $('lobby').hidden = false; $('hud').hidden = true;
        $('touch-controls').hidden = true;
        document.body.classList.remove('in-match');
        state = null; phaseKey = ''; myId = '';
        lastPhase = ''; lastAliveIds = '';
        world.reset(); setView('top');
        if (document.pointerLockElement) document.exitPointerLock();
      }
    } else if (data.type === 'pong' && typeof data.time === 'number') {
      const latency = Date.now() - data.time;
      $('connection').textContent = `${latency} ms · 연결됨`;
    }
  };
  thisSocket.onclose = () => {
    clearTimeout(timeout);
    if (thisSocket !== socket) return;
    setBusy(false);
    resetControls();
    if (intentionalClose) return;
    $('connection').textContent = '연결 끊김';
    if (session && reconnects < 10) {
      $('announcement').textContent = '다시 연결 중…';
      const delay = Math.min(3000, 500 * 2 ** reconnects++);
      retryTimer = setTimeout(() => connect({ type: 'resume', ...session }), delay);
    } else {
      error.textContent = '서버에 연결하지 못했어요. 잠시 후 다시 입장해 주세요.';
      toast(error.textContent);
      if (session) {
        sessionStorage.removeItem(sessionKey); session = null;
        $('lobby').hidden = false; $('entry').hidden = false; $('room').hidden = true;
        $('hud').hidden = true; $('touch-controls').hidden = true;
        document.body.classList.remove('in-match');
        state = null; phaseKey = ''; myId = '';
        lastPhase = ''; lastAliveIds = '';
        world.reset(); setView('top');
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
  };
  thisSocket.onerror = () => { $('connection').textContent = '연결 확인 중…'; };
}

function renderState() {
  if (!state) return;
  const me = state.players.find(p => p.id === myId);
  if (!me) return;
  if (lastPhase === 'countdown' && state.phase === 'playing') { toast('시작! 식칼을 던져요'); sound(880, .15); }
  lastPhase = state.phase;
  const aliveIds = state.players.filter(p => p.hp > 0 && p.connected).map(p => p.id);
  if (state.phase === 'playing' && lastAliveIds && aliveIds.length < lastAliveIds.split(',').length) {
    const gone = state.players.filter(p => p.hp <= 0 && lastAliveIds.split(',').includes(p.id)).map(p => p.name);
    if (gone.length) toast(`${gone.join(', ')} 탈락!`);
  }
  lastAliveIds = aliveIds.join(',');
  const active = state.phase === 'playing' || state.phase === 'countdown';
  if ($('fps-view').getAttribute('aria-pressed') !== String(state.view === 'fps')) setView(state.view);
  for (const id of ['top-view', 'fps-view']) $<HTMLButtonElement>(id).disabled = true;
  $('view-note').textContent = `전원 ${state.view === 'fps' ? '1인칭' : '롤 시점'} · 시작 후 고정`;
  const host = state.players.find(player => !player.bot)?.id === myId;
  const nextSettings = JSON.stringify([state.code, state.view, state.spellCooldowns, host, active]);
  if (settingsKey !== nextSettings) {
    settingsKey = nextSettings;
    $<HTMLSelectElement>('room-view').value = state.view;
    $<HTMLInputElement>('flash-cooldown').value = String(state.spellCooldowns.flash);
    $<HTMLInputElement>('ghost-cooldown').value = String(state.spellCooldowns.ghost);
    $<HTMLFieldSetElement>('room-settings').disabled = !host || active;
    $('settings-note').textContent = host ? '설정을 적용하면 준비가 초기화돼요. 시작 후에는 바꿀 수 없어요.' : '방장이 시작 전에 설정해요. 참가자 모두 같은 설정으로 플레이해요.';
  }
  const nextPhaseKey = `${state.phase}:${state.round}`;
  if (phaseKey !== nextPhaseKey) {
    phaseKey = nextPhaseKey;
    document.body.classList.toggle('in-match', active);
    $('lobby').hidden = active;
    $('hud').hidden = !active;
    $('touch-controls').hidden = !active || !touch;
    $('crosshair').hidden = !active || world.view !== 'fps';
    if (active) canvas.focus({ preventScroll: true });
    if (!active) {
      resetControls();
      if (document.pointerLockElement) document.exitPointerLock();
      if (state.phase === 'finished') {
        const title = document.querySelector<HTMLElement>('.room-title')!;
        title.replaceChildren();
        const head = state.winner.endsWith(' 승리') ? state.winner.slice(0, -' 승리'.length) : state.winner;
        const headSpan = document.createElement('span'); headSpan.textContent = head; title.append(headSpan);
        if (head !== state.winner) { const tail = document.createElement('span'); tail.className = 'title-suffix'; tail.textContent = ' 승리'; title.append(tail); }
        $('ready-help').textContent = '한 판 더? 모두 다시 준비하면 시작해요.';
        sound(me.hp > 0 ? 650 : 180, .3);
      }
    }
    world.engine.resize();
  }
  $('health').textContent = String(me.hp);
  $('health-fill').style.transform = `scaleX(${me.hp / 100})`;
  $('health-fill').classList.toggle('low', me.hp > 0 && me.hp <= 25);
  $('spell-feedback').classList.toggle('ghost', state.phase === 'playing' && me.hp > 0 && me.ghostTime > 0);
  $('my-name').textContent = `${me.name}${state.mode === 'teams' ? (me.team === 0 ? ' · 민트' : ' · 코랄') : ''}${me.hp <= 0 ? ' · 탈락' : ''}`;
  $('round').textContent = `ROUND ${state.round}`;
  const seconds = Math.ceil(state.time);
  $('timer').textContent = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  $('timer').classList.toggle('low', state.phase === 'playing' && seconds <= 15);
  const survivors = state.players.filter(p => p.hp > 0 && p.connected).length;
  $('alive').textContent = `${survivors}명 생존`;
  for (const spell of ['flash', 'ghost'] as const) {
    const cooldown = me[spell === 'flash' ? 'flashCooldown' : 'ghostCooldown'];
    $<HTMLButtonElement>(spell).disabled = state.phase !== 'playing' || me.hp <= 0 || !me.connected || cooldown > 0;
    $(`${spell}-status`).textContent = spell === 'ghost' && me.ghostTime > 0 ? `가속 ${Math.ceil(me.ghostTime)}초` : cooldown > 0 ? `${Math.ceil(cooldown)}초` : '준비';
  }
  $('announcement').textContent = state.phase === 'countdown' ? `${Math.max(1, Math.ceil(state.countdown))}\n준비, 식칼!` :
    me.hp <= 0 ? `이번 판은 여기까지!\n생존 ${survivors}명 구경 중` : '';
  $('touch-controls').classList.toggle('spectating', state.phase === 'playing' && me.hp <= 0);
  const nextRoster = JSON.stringify(state.players.map(p => [p.id, p.name, p.ready, p.connected, p.team])) + state.phase;
  if (nextRoster !== rosterKey) {
    rosterKey = nextRoster;
    $('players').replaceChildren(...state.players.map(p => {
      const row = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot'; dot.textContent = String(p.slot + 1);
      dot.style.setProperty('--player-color', COLORS[state!.mode === 'ffa' ? p.slot : p.team]);
      const name = document.createElement('span'); name.className = 'player-name';
      name.textContent = `${p.name}${p.id === myId ? ' (나)' : ''}${state!.mode === 'teams' ? (p.team === 0 ? ' · 민트' : ' · 코랄') : ''}`;
      const ready = document.createElement('span'); ready.className = 'ready-state';
      ready.textContent = !p.connected ? '재접속 대기' : p.ready ? '준비 완료' : '준비 중';
      row.append(dot, name, ready); return row;
    }));
    $('count').textContent = `${state.players.length} / ${state.mode === 'duel' ? 2 : 6}명`;
    $('room-mode').textContent = `${state.map === 'baron' ? '바론 둥지' : state.map === 'ward' ? '원형 와드' : '기존 장애물'} · ${state.mode === 'teams' ? '팀전' : state.mode === 'duel' ? '1:1' : '개인전'}`;
    $('ready').textContent = me.ready ? '준비 취소' : '준비하기';
    if (state.phase === 'lobby') $('ready-help').textContent = (state.mode === 'teams' ? '2·4·6명이 모여 모두 준비하면 시작해요.' : state.mode === 'duel' ? '둘 다 준비하면 시작해요.' : '2명 이상 모두 준비하면 시작해요.') + (state.map !== 'arena' ? ' 중앙 와드를 넘지 않고 식칼을 던져요.' : ' 장애물로 식칼을 피하고 자유롭게 이동해요.');
  }
}

function nickname() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.reportValidity(); nameInput.focus(); return null; }
  localStorage.setItem('cleaver-name', name);
  return name;
}

function enter(practice = false) {
  if (connecting) return;
  const name = nickname();
  if (name) connect({ type: 'create', name, map: mapInput.value, mode: $<HTMLSelectElement>('mode').value, view: world.view, practice });
}

mapInput.onchange = () => {
  const ward = mapInput.value !== 'arena', mode = $<HTMLSelectElement>('mode');
  mode.options[0].value = ward ? 'duel' : 'ffa';
  mode.options[0].textContent = ward ? '1:1 · 각자의 반원에서 대결' : '개인전 · 마지막 생존자 승리';
  world.setMap(mapInput.value as ArenaMap);
};

$('entry-form').addEventListener('submit', event => { event.preventDefault(); enter(); });
$('practice').onclick = () => { if (!nameInput.value.trim()) nameInput.value = '연습생'; enter(true); };
$('join').onclick = () => {
  if (connecting) return;
  const name = nickname();
  if (!name) return;
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-F0-9]{6}$/.test(code)) { error.textContent = '초대받은 방 코드 6자리를 입력해 주세요.'; codeInput.focus(); return; }
  connect({ type: 'join', name, code });
};
codeInput.addEventListener('keydown', event => { if (event.key === 'Enter') $('join').click(); });
$('ready').onclick = () => send({ type: 'ready' });
function leave() {
  intentionalClose = true;
  clearTimeout(retryTimer);
  send({ type: 'leave' });
  socket?.close(); sessionStorage.removeItem(sessionKey);
  location.assign('/');
}
$('leave').onclick = leave;
$('match-leave').onclick = leave;
$('copy').onclick = async () => {
  const url = `${location.origin}/?game=cleaver&room=${state?.code ?? session?.code}`;
  try { await navigator.clipboard.writeText(url); toast('초대 링크 복사 완료! 친구에게 보내 주세요.'); }
  catch { window.prompt('초대 링크를 복사해 주세요.', url); }
};

function setView(view: 'top' | 'fps') {
  resetControls();
  if (document.pointerLockElement) document.exitPointerLock();
  world.setView(view);
  $('top-view').classList.toggle('selected', view === 'top');
  $('fps-view').classList.toggle('selected', view === 'fps');
  $('top-view').setAttribute('aria-pressed', String(view === 'top'));
  $('fps-view').setAttribute('aria-pressed', String(view === 'fps'));
  for (const id of ['top-view', 'fps-view']) $<HTMLButtonElement>(id).disabled = !!state;
  if (!state) $('view-note').textContent = '새 방의 시점 선택 · 참가자 모두 같은 시점';
  $('crosshair').hidden = view !== 'fps' || !['playing', 'countdown'].includes(state?.phase ?? '');
  $('controls-help').textContent = touch ? (view === 'fps' ? '왼손 이동 · 오른손 좌우 시점 회전 · 손 떼면 발사' : '왼손 이동 · 오른손 조준 · 손 떼면 발사') :
    view === 'fps' ? '화면 클릭으로 마우스 고정 · WASD 이동 · 클릭 발사 · F 점멸 · G 유체화' : '우클릭 이동 · 좌클릭 / Q 발사 · F 마우스 방향 점멸 · D 유체화';
  $('ghost').querySelector('kbd')!.textContent = view === 'top' ? 'D' : 'G';
  canvas.setAttribute('aria-label', `3D 식칼 피구 경기장. ${$('controls-help').textContent}`);
}
$('top-view').onclick = () => { if (!state) setView('top'); };
$('fps-view').onclick = () => { if (!state) setView('fps'); };
$('apply-settings').onclick = () => {
  const flash = $<HTMLInputElement>('flash-cooldown'), ghost = $<HTMLInputElement>('ghost-cooldown');
  if (!flash.reportValidity() || !ghost.reportValidity()) return;
  send({ type: 'settings', view: $<HTMLSelectElement>('room-view').value, flashCooldown: flash.valueAsNumber, ghostCooldown: ghost.valueAsNumber });
};
function useSpell(spell: 'flash' | 'ghost') {
  if (!state || $<HTMLButtonElement>(spell).disabled) return;
  let yaw = world.yaw;
  if (spell === 'flash') {
    if (world.view === 'top' && cursor) yaw = world.directionAt(cursor.x, cursor.y, 0) ?? yaw;
    destination = undefined;
    latestInput = { ...latestInput }; delete latestInput.target;
    world.input = latestInput;
    send({ type: 'input', input: latestInput });
  }
  send({ type: 'spell', spell, yaw });
}
$('flash').onclick = () => useSpell('flash');
$('ghost').onclick = () => useSpell('ghost');

function resetControls() {
  hitAnimation?.cancel(); $('hit-confirm').textContent = '';
  keys.clear(); mouseFire = false; pulseUntil = 0; stick = { x: 0, z: 0 };
  destination = undefined; cursor = null;
  latestInput = { x: 0, z: 0, yaw: world?.yaw ?? 0, fire: false };
  if (world) world.input = latestInput;
  send({ type: 'input', input: latestInput });
  document.querySelectorAll<HTMLElement>('.pad-thumb').forEach(thumb => { thumb.style.transform = ''; });
}

function publishInput() {
  if (!world) return;
  world.onInput();
  if (session && !document.hidden) send({ type: 'input', input: latestInput });
}

function isTyping(target: EventTarget | null) { return target instanceof HTMLInputElement || target instanceof HTMLSelectElement; }
window.addEventListener('keydown', event => {
  if (!world) return;
  if (isTyping(event.target)) return;
  if (event.code === 'KeyF' || event.code === (world.view === 'top' ? 'KeyD' : 'KeyG')) {
    event.preventDefault(); if (!event.repeat) useSpell(event.code === 'KeyF' ? 'flash' : 'ghost');
    return;
  }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ'].includes(event.code)) {
    if (event.target instanceof HTMLButtonElement && event.code === 'Space') return;
    event.preventDefault(); keys.add(event.code);
    if (!event.repeat && ['Space', 'KeyQ'].includes(event.code)) pulseUntil = performance.now() + 120;
    if (!event.repeat) publishInput();
  }
});
window.addEventListener('keyup', event => { if (keys.delete(event.code)) publishInput(); });
window.addEventListener('blur', resetControls);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetControls(); });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) resetControls(); });
canvas.addEventListener('pointermove', event => {
  if (!world || event.pointerType === 'touch') return;
  if (world.view === 'top') {
    cursor = { x: event.clientX, y: event.clientY };
    world.aimAt(cursor.x, cursor.y);
    if (event.buttons & 2) {
      const point = world.groundAt(cursor.x, cursor.y);
      if (point) destination = world.markDestination(point) ?? destination;
    }
  }
  else if (document.pointerLockElement === canvas) world.yaw += event.movementX * .003;
});
canvas.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') event.preventDefault(); });
canvas.addEventListener('mousedown', event => {
  if (!world || ![0, 2].includes(event.button)) return;
  canvas.focus();
  if (world.view === 'top') {
    cursor = { x: event.clientX, y: event.clientY };
    world.aimAt(cursor.x, cursor.y);
    if (event.button === 2) {
      const point = world.groundAt(cursor.x, cursor.y);
      if (point) destination = world.markDestination(point) ?? destination;
      publishInput(); event.preventDefault(); return;
    }
  }
  if (event.button !== 0) return;
  if (world.view === 'fps' && document.pointerLockElement !== canvas) {
    if (canvas.requestPointerLock) Promise.resolve(canvas.requestPointerLock()).catch(() => toast('마우스 고정을 허용하거나 방향키로 이동해 주세요.'));
  } else { mouseFire = true; pulseUntil = performance.now() + 120; publishInput(); }
});
window.addEventListener('mouseup', event => { if (event.button === 0) { mouseFire = false; publishInput(); } });
canvas.addEventListener('contextmenu', event => event.preventDefault());

function pad(id: string, aim: boolean) {
  const element = $(id), thumb = element.querySelector<HTMLElement>('.pad-thumb')!;
  let pointer: number | null = null, lastX = 0, didAim = false;
  const update = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const radius = rect.width * .3, length = Math.max(radius, Math.hypot(dx, dy));
    thumb.style.transform = `translate(${dx / length * radius}px, ${dy / length * radius}px)`;
    if (!aim) { destination = undefined; stick = { x: dx / length, z: -dy / length }; }
    else if (world.view === 'fps') { world.yaw += (event.clientX - lastX) * .012; didAim = true; }
    else if (Math.hypot(dx, dy) > 8) { world.yaw = Math.atan2(dx, -dy); didAim = true; }
    lastX = event.clientX;
  };
  element.addEventListener('pointerdown', event => {
    if (pointer !== null) return;
    cursor = null;
    pointer = event.pointerId; lastX = event.clientX; didAim = false;
    element.setPointerCapture(pointer); update(event); event.preventDefault();
    publishInput();
  });
  element.addEventListener('pointermove', event => { if (event.pointerId === pointer) update(event); });
  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (aim && didAim && event.type === 'pointerup') pulseUntil = performance.now() + 120;
    if (!aim) stick = { x: 0, z: 0 };
    pointer = null; thumb.style.transform = '';
    publishInput();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, event => end(event as PointerEvent));
}
pad('move-pad', false); pad('aim-pad', true);
$('fire').addEventListener('pointerdown', event => { $('fire').setPointerCapture(event.pointerId); mouseFire = true; pulseUntil = performance.now() + 120; publishInput(); event.preventDefault(); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('fire').addEventListener(type, () => { mouseFire = false; publishInput(); });

$('sound').onclick = () => {
  soundEnabled = !soundEnabled;
  if (soundEnabled) { audio ??= new AudioContext(); void audio.resume(); }
  $('sound').textContent = soundEnabled ? '소리 켜짐' : '소리 꺼짐';
  $('sound').setAttribute('aria-label', soundEnabled ? '효과음 끄기' : '효과음 켜기');
  $('sound').setAttribute('aria-pressed', String(soundEnabled));
  sound(550, .15);
};
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else toast('이 브라우저는 전체 화면을 지원하지 않아요. 가로로 돌려 플레이해 주세요.');
  } catch { toast('전체 화면을 사용할 수 없어요. 브라우저 화면에서 계속 플레이할 수 있어요.'); }
};

async function boot() {
const gameId = new URLSearchParams(location.search).get('game');
if (isTableId(gameId)) { initTabletop(gameId); return; }
const home = !gameId && !new URLSearchParams(location.search).has('room');
if (home) {
  document.body.classList.add('in-hub');
  document.querySelector<HTMLElement>('.view-dock')!.hidden = true;
  $('loading').hidden = true;
  $('connection').textContent = '게임을 선택해 주세요';
  return;
}
try {
  const { World: GameWorld } = await import('./world.ts');
  world = new GameWorld(canvas);
  world.onMapModel = status => {
    if (status === 'loading') toast('바론 둥지 불러오는 중…');
    else if (status === 'fallback') toast('바론 둥지를 불러오지 못해 기본 지형으로 표시해요.');
  };
  world.setMap(mapInput.value as ArenaMap);
  world.onShot = () => sound(360, .08);
  world.onConfirm = (damage, x, y) => {
    const indicator = $('hit-confirm');
    indicator.textContent = `명중 · ${damage}`;
    indicator.style.left = `${Math.max(50, Math.min(innerWidth - 50, x))}px`;
    indicator.style.top = `${Math.max(90, Math.min(innerHeight - 100, y - 38))}px`;
    hitAnimation?.cancel();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hitAnimation = indicator.animate([
      { opacity: 1, transform: 'translate(-50%, -50%)' },
      { opacity: 0, transform: reduced ? 'translate(-50%, -50%)' : 'translate(-50%, calc(-50% - 24px))' },
    ], { duration: reduced ? 220 : 550, easing: 'ease-out' });
    sound(720, .07);
  };
  world.onFlash = () => {
    $('spell-feedback').classList.add('flash');
    setTimeout(() => $('spell-feedback').classList.remove('flash'), 450);
    sound(800, .12);
  };
  world.onHit = () => {
    sound(130, .15);
    $('hit-flash').classList.add('hit');
    setTimeout(() => $('hit-flash').classList.remove('hit'), 150);
  };
  world.scene.executeWhenReady(() => { $('loading').hidden = true; $<HTMLButtonElement>('choose-cleaver').disabled = false; });
  setView('top');
  nameInput.value = localStorage.getItem('cleaver-name') ?? '';
  const roomCode = new URLSearchParams(location.search).get('room');
  if (roomCode || new URLSearchParams(location.search).get('game') === 'cleaver') {
    $('hub').hidden = true; $('lobby').hidden = false; $('games-menu').hidden = false;
  } else {
    document.body.classList.add('in-hub');
    document.querySelector<HTMLElement>('.view-dock')!.hidden = true;
  }
  if (roomCode) {
    codeInput.value = roomCode.toUpperCase().slice(0, 6);
    document.querySelector('#entry .fineprint')!.textContent = `${codeInput.value} 방 초대됨 → 닉네임 입력 후 입장을 눌러 주세요`;
    toast('초대받았어요! 닉네임을 입력하고 입장을 눌러 주세요.');
    nameInput.focus({ preventScroll: true });
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
    if (saved?.code && saved?.token && (!roomCode || saved.code === roomCode.toUpperCase())) {
      session = saved; openGame(); connect({ type: 'resume', ...saved });
    }
  } catch { sessionStorage.removeItem(sessionKey); }
  function updateInput() {
    const keyboard = world.view === 'fps';
    let x = stick.x + (keyboard ? Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) : 0);
    let z = stick.z + (keyboard ? Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) : 0);
    const length = Math.max(1, Math.hypot(x, z)); x /= length; z /= length;
    if (world.view === 'fps') {
      const cos = Math.cos(world.yaw), sin = Math.sin(world.yaw);
      [x, z] = [x * cos + z * sin, z * cos - x * sin];
    }
    if (world.view === 'top' && cursor) world.aimAt(cursor.x, cursor.y);
    const active = state?.phase === 'playing' && state.players.some(player => player.id === myId && player.hp > 0 && player.connected);
    latestInput = { x: active ? x : 0, z: active ? z : 0, yaw: world.yaw,
      fire: !!active && (mouseFire || performance.now() < pulseUntil || keys.has('Space') || keys.has('KeyQ')),
      ...(active && world.view === 'top' && destination ? { target: destination } : {}) };
    world.input = latestInput;
  }
  world.onInput = updateInput;
  setInterval(() => {
    if (document.hidden) return;
    updateInput();
    if (session) send({ type: 'input', input: latestInput });
  }, 50);
  setInterval(() => { if (session) send({ type: 'ping', time: Date.now() }); }, 3000);
} catch (cause) {
  console.error(cause);
  if (home) toast('3D 미리보기를 사용할 수 없어요. 다른 보드게임은 플레이할 수 있어요.');
  else $('loading').innerHTML = '<strong>3D 화면을 시작하지 못했어요</strong><span>Chrome 또는 Safari에서 다시 열어 주세요.</span>';
}
}
void boot();

// 앱처럼 설치·실행하기 위한 서비스워커 등록. 실패해도 게임 플레이에는 영향이 없다.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(cause => console.warn('service worker skipped', cause));
  });
}

// PWA 설치 버튼: 브라우저가 설치 신호를 주면 연결하고, iOS는 수동 추가 방법을 안내한다.
{
  type InstallPrompt = Event & { prompt: () => Promise<void> };
  const installButton = $<HTMLButtonElement>('install-app');
  const standalone = matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  let deferred: InstallPrompt | null = null;
  if (!standalone) {
    const ios = (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    if (ios) {
      installButton.hidden = false;
      installButton.onclick = () => toast('공유 버튼을 누르고 홈 화면에 추가를 선택해 주세요.');
    } else {
      installButton.onclick = () => { void deferred?.prompt(); };
      window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferred = event as InstallPrompt;
        installButton.hidden = false;
      });
    }
    window.addEventListener('appinstalled', () => { installButton.hidden = true; deferred = null; });
  }
}
