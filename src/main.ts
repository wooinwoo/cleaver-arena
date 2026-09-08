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
let mouseFire = false;
let pulseUntil = 0;
let stick = { x: 0, z: 0 };
const keys = new Set<string>();
let soundEnabled = false;
let audio: AudioContext | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
let latestInput: Input = { x: 0, z: 0, yaw: 0, fire: false };

function openGame() {
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
      world.applyState(state!, myId);
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
  const active = state.phase === 'playing' || state.phase === 'countdown';
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
        document.querySelector<HTMLElement>('.room-title')!.textContent = state.winner;
        $('ready-help').textContent = '한 판 더? 모두 다시 준비하면 시작해요.';
        sound(me.hp > 0 ? 650 : 180, .3);
      }
    }
    world.engine.resize();
  }
  $('health').textContent = String(me.hp);
  $('health-fill').style.transform = `scaleX(${me.hp / 100})`;
  $('my-name').textContent = `${me.name}${me.hp <= 0 ? ' · 탈락' : ''}`;
  $('round').textContent = `ROUND ${state.round}`;
  const seconds = Math.ceil(state.time);
  $('timer').textContent = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  $('alive').textContent = `${state.players.filter(p => p.hp > 0 && p.connected).length}명 생존`;
  $('announcement').textContent = state.phase === 'countdown' ? `${Math.max(1, Math.ceil(state.countdown))}\n준비, 식칼!` :
    me.hp <= 0 ? '이번 판은 여기까지!\n탑뷰로 남은 경기를 구경해요.' : '';
  if (me.hp <= 0 && world.view === 'fps') setView('top');
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
    $('room-mode').textContent = `${state.map === 'ward' ? '원형 와드' : '기존 장애물'} · ${state.mode === 'teams' ? '팀전' : state.mode === 'duel' ? '1:1' : '개인전'}`;
    $('ready').textContent = me.ready ? '준비 취소' : '준비하기';
    if (state.phase === 'lobby') $('ready-help').textContent = (state.mode === 'teams' ? '2·4·6명이 모여 모두 준비하면 시작해요.' : state.mode === 'duel' ? '둘 다 준비하면 시작해요.' : '2명 이상 모두 준비하면 시작해요.') + (state.map === 'ward' ? ' 중앙 와드를 넘지 않고 식칼을 던져요.' : ' 장애물로 식칼을 피하고 자유롭게 이동해요.');
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
  if (name) connect({ type: 'create', name, map: mapInput.value, mode: $<HTMLSelectElement>('mode').value, practice });
}

mapInput.onchange = () => {
  const ward = mapInput.value === 'ward', mode = $<HTMLSelectElement>('mode');
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
  $('crosshair').hidden = view !== 'fps' || !['playing', 'countdown'].includes(state?.phase ?? '');
  $('controls-help').textContent = touch ? (view === 'fps' ? '왼손 이동 · 오른손 좌우 시점 회전 · 손 떼면 발사' : '왼손 이동 · 오른손 조준 · 손 떼면 발사') :
    view === 'fps' ? '화면 클릭으로 마우스 고정 · WASD 이동 · 클릭 발사 · Esc 해제 · V 시점' : 'WASD 이동 · 마우스 조준 · 클릭 발사 · V 시점 전환';
}
$('top-view').onclick = () => setView('top');
$('fps-view').onclick = () => setView('fps');

function resetControls() {
  keys.clear(); mouseFire = false; pulseUntil = 0; stick = { x: 0, z: 0 };
  latestInput = { x: 0, z: 0, yaw: world?.yaw ?? 0, fire: false };
  if (world) world.input = latestInput;
  send({ type: 'input', input: latestInput });
  document.querySelectorAll<HTMLElement>('.pad-thumb').forEach(thumb => { thumb.style.transform = ''; });
}

function isTyping(target: EventTarget | null) { return target instanceof HTMLInputElement || target instanceof HTMLSelectElement; }
window.addEventListener('keydown', event => {
  if (!world) return;
  if (isTyping(event.target)) return;
  if (event.code === 'KeyV' && !event.repeat) setView(world.view === 'top' ? 'fps' : 'top');
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ'].includes(event.code)) {
    if (event.target instanceof HTMLButtonElement && event.code === 'Space') return;
    event.preventDefault(); keys.add(event.code);
  }
});
window.addEventListener('keyup', event => { keys.delete(event.code); });
window.addEventListener('blur', resetControls);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetControls(); });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) resetControls(); });
canvas.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  if (world.view === 'top') world.aimAt(event.clientX, event.clientY);
  else if (document.pointerLockElement === canvas) world.yaw += event.movementX * .003;
});
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' || event.button !== 0) return;
  canvas.focus();
  if (world.view === 'fps' && document.pointerLockElement !== canvas) {
    if (canvas.requestPointerLock) Promise.resolve(canvas.requestPointerLock()).catch(() => toast('마우스 고정을 허용하거나 방향키로 이동해 주세요.'));
  } else mouseFire = true;
});
window.addEventListener('pointerup', event => { if (event.pointerType !== 'touch') mouseFire = false; });
canvas.addEventListener('contextmenu', event => event.preventDefault());

function pad(id: string, aim: boolean) {
  const element = $(id), thumb = element.querySelector<HTMLElement>('.pad-thumb')!;
  let pointer: number | null = null, lastX = 0, didAim = false;
  const update = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const radius = rect.width * .3, length = Math.max(radius, Math.hypot(dx, dy));
    thumb.style.transform = `translate(${dx / length * radius}px, ${dy / length * radius}px)`;
    if (!aim) stick = { x: dx / length, z: -dy / length };
    else if (world.view === 'fps') { world.yaw += (event.clientX - lastX) * .012; didAim = true; }
    else if (Math.hypot(dx, dy) > 8) { world.yaw = Math.atan2(dx, -dy); didAim = true; }
    lastX = event.clientX;
  };
  element.addEventListener('pointerdown', event => {
    if (pointer !== null) return;
    pointer = event.pointerId; lastX = event.clientX; didAim = false;
    element.setPointerCapture(pointer); update(event); event.preventDefault();
  });
  element.addEventListener('pointermove', event => { if (event.pointerId === pointer) update(event); });
  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (aim && didAim && event.type === 'pointerup') pulseUntil = performance.now() + 120;
    if (!aim) stick = { x: 0, z: 0 };
    pointer = null; thumb.style.transform = '';
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, event => end(event as PointerEvent));
}
pad('move-pad', false); pad('aim-pad', true);
$('fire').addEventListener('pointerdown', event => { $('fire').setPointerCapture(event.pointerId); mouseFire = true; event.preventDefault(); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('fire').addEventListener(type, () => { mouseFire = false; });

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
  $<HTMLButtonElement>('choose-cleaver').disabled = true;
}
try {
  const { World: GameWorld } = await import('./world.ts');
  world = new GameWorld(canvas);
  world.onShot = () => sound(360, .08);
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
  if (roomCode) { codeInput.value = roomCode.toUpperCase().slice(0, 6); toast('초대받았어요! 닉네임을 입력하고 입장을 눌러 주세요.'); }
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
    if (saved?.code && saved?.token && (!roomCode || saved.code === roomCode.toUpperCase())) {
      session = saved; openGame(); connect({ type: 'resume', ...saved });
    }
  } catch { sessionStorage.removeItem(sessionKey); }
  function updateInput() {
    let x = stick.x + Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    let z = stick.z + Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    const length = Math.max(1, Math.hypot(x, z)); x /= length; z /= length;
    if (world.view === 'fps') {
      const cos = Math.cos(world.yaw), sin = Math.sin(world.yaw);
      [x, z] = [x * cos + z * sin, z * cos - x * sin];
    }
    latestInput = { x, z, yaw: world.yaw, fire: mouseFire || performance.now() < pulseUntil || keys.has('Space') || keys.has('KeyQ') };
    world.input = latestInput;
  }
  setInterval(() => {
    updateInput();
    if (session && !document.hidden) send({ type: 'input', input: latestInput });
  }, 50);
  setInterval(() => { if (session) send({ type: 'ping', time: Date.now() }); }, 3000);
} catch (cause) {
  console.error(cause);
  if (home) toast('3D 미리보기를 사용할 수 없어요. 다른 보드게임은 플레이할 수 있어요.');
  else $('loading').innerHTML = '<strong>3D 화면을 시작하지 못했어요</strong><span>Chrome 또는 Safari에서 다시 열어 주세요.</span>';
}
}
void boot();
