import { TABLE_GAMES, POKER_VARIANTS, type PokerVariant, type TableId } from '../shared/catalog.ts';
import type { Action } from '../shared/tabletop-types.ts';
import type { GomokuState } from '../shared/gomoku.ts';
import { quoridorMoves, type QuoridorState } from '../shared/quoridor.ts';
import { JANGGI_VARIANTS, janggiTargets, type JanggiState, type JanggiVariant, type PieceKind } from '../shared/janggi.ts';
import type { pokerView } from '../shared/poker.ts';
import type { ChessState } from '../shared/chess.ts';
import type { DaVinciView } from '../shared/davinci.ts';
import { DAVINCI_COLOR_NAME } from '../shared/davinci.ts';
import type { CoupView, CoupActionKind, CoupRole } from '../shared/coup.ts';
import { COUP_ACTION_NAME, COUP_ACTION_COST, COUP_ACTION_RULE, COUP_CLAIM, COUP_ROLE_NAME, coupBlockRoles } from '../shared/coup.ts';
import type { PokerWorld } from './poker-world.ts';
import type { splendorView } from '../shared/splendor.ts';
import { renderSplendor } from './splendor.ts';
import { gameWaiting, gameAccent, gameIdentity } from './ui/game-art.ts';
import { openRules } from './ui/rules-dialog.ts';

type PublicPoker = ReturnType<typeof pokerView>;
type GameState = GomokuState | QuoridorState | JanggiState | PublicPoker | ChessState | ReturnType<typeof splendorView> | DaVinciView | CoupView;
type RoomState = { code: string; kind: TableId; variant?: JanggiVariant | PokerVariant; phase: 'lobby' | 'playing' | 'finished'; round: number; result: string;
  players: { id: string; name: string; seat: number; ready: boolean; connected: boolean }[]; me: number; game: GameState | null };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PIECES: Record<PieceKind, string> = { king: '왕', rook: '장', bishop: '상', pawn: '자', hen: '후' };

export function initTabletop(kind: TableId, options: { create?: boolean } = {}) {
  const config = TABLE_GAMES[kind];
  const variants: Record<string, { title: string; rules: string }> | null = kind === 'janggi' ? JANGGI_VARIANTS : kind === 'poker' ? POKER_VARIANTS : null;
  document.body.classList.add('in-table');
  document.body.style.setProperty('--game-accent', gameAccent(kind));
  if (kind === 'splendor') document.body.classList.add('in-splendor');
  $('hub').hidden = true; $('lobby').hidden = true; $('loading').hidden = true;
  $('game').hidden = true;
  document.querySelector<HTMLElement>('.view-dock')!.hidden = true;
  $('games-menu').hidden = false;
  document.title = `${config.title} · SIDEPLAY`;
  const section = document.createElement('section'); section.id = 'table-page';
  section.innerHTML = `
    <aside class="table-sidebar">
      ${gameIdentity(kind, config.title, config.description)}
      <form id="t-entry"><label for="t-name">내 닉네임</label><input id="t-name" maxlength="12" autocomplete="nickname" placeholder="친구들이 알아볼 이름" required />
        ${variants ? `<label for="t-variant">새 방의 룰</label><select id="t-variant" aria-describedby="t-variant-note">${Object.entries(variants).map(([value, rule]) => `<option value="${value}">${rule.title}</option>`).join('')}</select><p id="t-variant-note" class="help">입장할 때는 해당 방의 룰을 따라요.</p>` : ''}
        <button class="primary" type="submit">방 만들기</button><div class="join-row"><label class="sr-only" for="t-code-input">방 코드</label><input id="t-code-input" maxlength="6" placeholder="방 코드 6자리"/><button type="button" id="t-join">입장</button></div></form>
      <details id="t-room" open hidden><summary>방 정보 · 참가자</summary><div class="table-invite"><span>우리 방 <strong id="t-code"></strong></span><button id="t-copy">초대 링크 복사</button></div>
        <ul id="t-players"></ul><button id="t-ready" class="primary">준비하기</button><p id="t-ready-note">모두 준비하면 시작해요.</p></details>
      <p id="t-error" role="alert"></p><details class="table-rules" open><summary id="t-rules-title">이 게임의 규칙</summary><p id="t-rules-text">${config.rules}</p></details>
      <button id="t-leave" class="text-button">다른 게임 고르기</button>
    </aside>
    <div class="table-stage"><div class="table-status"><span id="t-round">친구를 기다리는 중</span><strong id="t-turn" role="status">방을 만들거나 입장해 주세요</strong></div>
      <button id="t-result-review" type="button" aria-expanded="false" aria-controls="t-board-wrap" hidden>마지막 보드 보기</button>
      <div id="t-toolbar" hidden></div><div id="t-hands"></div><div id="t-board-wrap"><div id="t-board" class="empty-board">${gameWaiting(kind, config.title)}</div></div>
      <div id="t-action-bar" hidden><span id="t-choice">칸을 선택하세요</span><button id="t-confirm" class="primary" disabled>선택한 수 확정</button><button id="t-cancel">취소</button></div>
      <p id="t-log" role="status"></p>
    </div>`;
  document.body.append(section);
  const resultReview = $<HTMLButtonElement>('t-result-review');
  resultReview.onclick = () => {
    const open = !document.body.hasAttribute('data-result-review');
    document.body.toggleAttribute('data-result-review', open);
    resultReview.setAttribute('aria-expanded', String(open));
    resultReview.textContent = open ? '보드 접기' : '마지막 보드 보기';
  };
  let ws: WebSocket | null = null, room: RoomState | null = null;
  let session: { code: string; token: string } | null = null;
  let intentional = false, connecting = false, retries = 0, timer: ReturnType<typeof setTimeout>;
  let pending: Action | null = null, selectedPiece: number | null = null, drop: PieceKind | null = null;
  let wallMode: 'move' | 'h' | 'v' = 'move';
  let davinciPick: { target: number; tile: number; num: number | null } | null = null;
  let coupTargeting: CoupActionKind | null = null;
  let coupKeep: string[] = [];
  let coupReveal: number | null = null;
  let lastRenderSig = '';
  let promotion = 'q';
  let pokerWorld: PokerWorld | null = null;
  let pokerLoading = false, pokerFailed = false, pokerLoadVersion = 0;
  const pokerCanvas = document.createElement('canvas');
  pokerCanvas.id = 'poker-canvas';
  pokerCanvas.setAttribute('aria-label', '1인칭 포커 테이블. 상대 이마의 카드를 보고 베팅하세요.');
  const pokerScene = document.createElement('div'); pokerScene.className = 'poker-scene';
  const pokerHint = document.createElement('p'); pokerHint.className = 'poker-scene-hint';
  pokerHint.textContent = '3D 테이블 준비 중…';
  pokerScene.append(pokerCanvas, pokerHint);
  const compact = matchMedia('(max-width: 760px)');
  const roomDetails = $<HTMLDetailsElement>('t-room');
  const rules = document.querySelector<HTMLDetailsElement>('.table-rules')!;
  const variant = $<HTMLSelectElement>('t-variant');
  function renderRules() {
    if (!variants) return;
    const selected = variants[room?.variant ?? variant.value];
    $('t-rules-title').textContent = `규칙 · ${selected.title}`;
    $('t-rules-text').textContent = selected.rules;
  }
  if (variant) variant.onchange = renderRules;
  renderRules();
  rules.open = false;
  // The sidebar row never expands in place: any toggle opens the centred rules dialog instead.
  rules.addEventListener('toggle', () => {
    if (!rules.open) return;
    rules.open = false;
    const selected = variants ? variants[room?.variant ?? variant.value] : null;
    openRules(kind, config.title, selected ? selected.rules : config.rules, selected?.title);
  });
  compact.addEventListener('change', () => {
    roomDetails.open = room?.phase !== 'playing' || !compact.matches;
    if (room?.phase === 'playing' && compact.matches) rules.open = false;
  });
  const key = `table-session-${kind}`;
  const name = $<HTMLInputElement>('t-name');
  name.value = localStorage.getItem('cleaver-name') ?? '';
  const invitation = new URLSearchParams(location.search).get('room');
  if (invitation) $<HTMLInputElement>('t-code-input').value = invitation.toUpperCase().slice(0, 6);
  let submitting = false;
  const send = (data: unknown) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    const action = (data as { type?: string }).type === 'action';
    if (action && submitting) return;
    if (action) {
      submitting = true;
      $('t-board').setAttribute('aria-busy', 'true');
      for (const button of document.querySelectorAll<HTMLButtonElement>('#t-board button, #t-toolbar button, #t-action-bar button')) button.disabled = true;
    }
    ws.send(JSON.stringify(data));
  };
  function busy(value: boolean) {
    connecting = value;
    for (const element of $('t-entry').querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')) element.disabled = value;
  }
  function disposePoker() {
    pokerLoadVersion++;
    pokerWorld?.dispose(); pokerWorld = null;
    pokerLoading = false; pokerFailed = false;
    pokerHint.textContent = '3D 테이블 준비 중…';
  }
  function resetEntry(message: string) {
    disposePoker();
    session = null; sessionStorage.removeItem(key); room = null; lastRenderSig = '';
    delete document.body.dataset.tablePhase;
    $('t-entry').hidden = false; $('t-room').hidden = true;
    $('t-error').textContent = message; $('t-turn').textContent = '다시 입장해 주세요';
    $('t-action-bar').hidden = true; $('t-toolbar').hidden = true;
    $('t-board').replaceChildren(); $('t-hands').replaceChildren();
    renderRules();
  }
  function connect(request: Record<string, unknown>) {
    $('t-error').textContent = ''; busy(true);
    $('connection').textContent = '연결 중…';
    if (ws?.readyState === WebSocket.OPEN && !session) { send(request); return; }
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/table-ws`);
    const current = ws;
    const timeout = setTimeout(() => { if (current.readyState !== WebSocket.OPEN) current.close(); }, 12_000);
    ws.onopen = () => { clearTimeout(timeout); send(request); };
    ws.onmessage = event => {
      if (current !== ws) return;
      const data = JSON.parse(event.data);
      if (['joined', 'table-state', 'error', 'expired'].includes(data.type)) {
        submitting = false;
        $('t-board').removeAttribute('aria-busy');
        // Errors leave state unchanged but lock action buttons; force a rebuild.
        if (data.type === 'error' || data.type === 'expired') lastRenderSig = '';
      }
      if (data.type === 'joined') {
        busy(false); retries = 0;
        $<HTMLButtonElement>('t-cancel').disabled = false;
        if (kind === 'splendor') delete $('t-board').dataset.revision;
        session = { code: data.code, token: data.token };
        sessionStorage.setItem(key, JSON.stringify(session));
        history.replaceState(null, '', `/?game=${kind}&room=${data.code}`);
        $('t-entry').hidden = true; $('t-room').hidden = false;
        $('t-code').textContent = data.code; $('connection').textContent = '연결됨';
      } else if (data.type === 'table-state') {
        room = data.room; pending = null; selectedPiece = null; drop = null;
        coupTargeting = null; coupKeep = []; coupReveal = null;
        $<HTMLButtonElement>('t-cancel').disabled = false;
        $('t-error').textContent = ''; render();
      } else if (data.type === 'error' || data.type === 'expired') {
        busy(false); $('t-error').textContent = data.message;
        $<HTMLButtonElement>('t-cancel').disabled = false;
        if (data.type === 'error') render();
        if (data.type === 'expired') resetEntry(data.message);
      }
    };
    ws.onclose = () => {
      clearTimeout(timeout); busy(false);
      if (intentional || current !== ws) return;
      submitting = false;
      $('t-board').removeAttribute('aria-busy');
      $<HTMLButtonElement>('t-cancel').disabled = false;
      lastRenderSig = '';
      $('connection').textContent = '연결 끊김';
      render();
      if (session && retries < 10) {
        $('t-turn').textContent = '다시 연결 중…';
        timer = setTimeout(() => connect({ type: 'resume', game: kind, ...session }), Math.min(3000, 500 * 2 ** retries++));
      } else resetEntry('연결하지 못했어요. 잠시 후 다시 입장해 주세요.');
    };
    ws.onerror = () => { $('connection').textContent = '서버 연결 확인 중'; };
  }
  $('t-entry').addEventListener('submit', event => { event.preventDefault(); enter('create'); });
  $('t-join').onclick = () => enter('join');
  $('t-code-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); enter('join'); }
  });
  // 홈 카드 탭으로 온 생성 의도: 닉네임이 있으면 방 만들기를 바로 확정한다.
  if (options.create && !invitation && name.value.trim()) {
    queueMicrotask(() => enter('create'));
  }
  function enter(type: 'create' | 'join') {
    if (connecting) return;
    if (!name.value.trim()) { name.reportValidity(); return; }
    const code = $<HTMLInputElement>('t-code-input').value.trim().toUpperCase();
    if (type === 'join' && !/^[A-F0-9]{6}$/.test(code)) { $('t-error').textContent = '방 코드 6자리를 확인해 주세요.'; return; }
    localStorage.setItem('cleaver-name', name.value.trim());
    connect({ type, game: kind, name: name.value.trim(), code, ...(type === 'create' && variant ? { variant: variant.value } : {}) });
  }
  $('t-ready').onclick = () => send({ type: 'ready' });
  $('t-copy').onclick = async () => {
    const url = `${location.origin}/?game=${kind}&room=${session?.code}`;
    try { await navigator.clipboard.writeText(url); $('t-ready-note').textContent = '링크 복사 완료! 친구에게 보내 주세요.'; }
    catch { window.prompt('초대 링크를 복사해 주세요.', url); }
  };
  function leave() { intentional = true; clearTimeout(timer); send({ type: 'leave' }); ws?.close(); sessionStorage.removeItem(key); location.assign('/'); }
  $('t-leave').onclick = leave; $('games-menu').onclick = leave;
  document.querySelector('.brand')?.addEventListener('click', event => {
    if (session?.code) { event.preventDefault(); location.assign(`/?game=${kind}&room=${session.code}`); }
  });
  $('t-confirm').onclick = () => { if (pending) { send({ type: 'action', action: pending }); pending = null; $<HTMLButtonElement>('t-confirm').disabled = true; } };
  $('t-cancel').onclick = () => { pending = null; selectedPiece = null; drop = null; davinciPick = null; coupReveal = null; render(); };
  function canAct() { return !submitting && ws?.readyState === WebSocket.OPEN && room?.phase === 'playing' && room.game?.turn === room.me && room.players.every(p => p.connected); }
  function choose(action: Action, text: string, button?: HTMLElement) {
    pending = action; $('t-choice').textContent = text; $<HTMLButtonElement>('t-confirm').disabled = false;
    $('t-board').querySelectorAll('.pending').forEach(cell => cell.classList.remove('pending'));
    button?.classList.add('pending');
  }
  function playerName(seat: number) { return room?.players.find(p => p.seat === seat)?.name ?? `${seat + 1}번`; }
  function render() {
    if (!room) return;
    renderRules();
    const sig = JSON.stringify([room.phase, room.round, room.game, room.players, room.me, room.result, room.variant,
      ws?.readyState, submitting, compact.matches, pokerLoading, pokerFailed,
      pending, selectedPiece, drop, wallMode, davinciPick, coupTargeting, coupKeep, coupReveal, promotion]);
    if (sig === lastRenderSig) return;
    lastRenderSig = sig;
    if (document.body.dataset.tablePhase !== room.phase) {
      document.body.dataset.tablePhase = room.phase;
      document.body.removeAttribute('data-result-review');
      resultReview.setAttribute('aria-expanded', 'false');
      resultReview.textContent = '마지막 보드 보기';
      roomDetails.open = room.phase !== 'playing' || !compact.matches;
      if (room.phase === 'playing' && compact.matches) rules.open = false;
    }
    const me = room.players.find(p => p.seat === room!.me)!;
    resultReview.hidden = room.phase !== 'finished';
    $('t-ready').hidden = room.phase === 'playing';
    $('t-ready').textContent = me.ready ? '준비 취소' : room.phase === 'finished' ? '다시 준비하기' : '준비하기';
    const capacity = kind === 'poker' ? POKER_VARIANTS[room.variant as PokerVariant].max : config.max;
    $('t-ready-note').textContent = room.phase === 'finished' ? '모두 다시 누르면 바로 다음 판이 시작해요.'
      : room.phase === 'playing' ? '진행 중 · 상대가 끊기면 최대 20초 기다려요.' : `${room.players.length} / ${capacity}명 · 모두 준비하면 시작해요.`;
    $('t-round').textContent = room.round ? `${config.title} · ${room.round}번째 판` : `${config.min}–${capacity}명 게임`;
    $('t-turn').textContent = room.phase === 'finished' ? room.result : room.phase === 'lobby' ? '친구와 함께 준비를 눌러 주세요' :
      room.players.some(p => !p.connected) ? '상대의 재접속을 기다리는 중…' : `${playerName(room.game!.turn)} 차례${canAct() ? ' · 내 차례!' : ''}`;
    $('t-players').replaceChildren(...room.players.map(p => {
      const li = document.createElement('li'); const dot = document.createElement('i'); dot.className = `seat-${p.seat % 2}`;
      const label = document.createElement('span'); label.textContent = `${p.name}${p.seat === room!.me ? ' (나)' : ''}`;
      const status = document.createElement('small'); status.textContent = !p.connected ? '재접속 대기' : room!.phase === 'playing' ? `${p.seat + 1}번` : p.ready ? '준비 완료' : '준비 중';
      li.append(dot, label, status); return li;
    }));
    if (!room.game) {
      disposePoker();
      $('t-board').className = 'empty-board';
      $('t-board').innerHTML = gameWaiting(kind, config.title);
      $('t-hands').replaceChildren(); $('t-log').textContent = '';
      $('t-toolbar').hidden = true; $('t-action-bar').hidden = true;
      return;
    }
    $('t-log').textContent = room.game.log;
    if (kind !== 'splendor') $('t-board').replaceChildren();
    $('t-hands').replaceChildren();
    $('t-toolbar').hidden = true;
    $('t-action-bar').hidden = !canAct() || kind === 'poker' || kind === 'splendor' || kind === 'coup';
    $('t-choice').textContent = room.phase === 'playing' && !canAct() ? '상대 차례 — 구경 중이에요'
      : kind === 'janggi' ? ((room?.game as JanggiState | null)?.variant === 'genius' ? '움직일 말 또는 보유 말을 선택하세요 · 끝줄 투입 금지' : '움직일 말 또는 보유 말을 선택하세요')
      : kind === 'davinci' ? '상대 타일을 고르고 숫자를 골라 주세요'
      : kind === 'gomoku' ? `당신은 ${room.me === 0 ? '흑' : '백'} · 칸을 선택한 뒤 확정하세요`
      : '칸을 선택한 뒤 확정하세요';
    $<HTMLButtonElement>('t-confirm').disabled = true;
    switch (room.game.kind) {
      case 'splendor': renderSplendor($('t-board'), room.game, room.me, playerName, canAct(), action => send({ type: 'action', action }), room.round); break;
      case 'gomoku': drawGomoku(room.game); break;
      case 'quoridor': drawQuoridor(room.game); break;
      case 'janggi': drawJanggi(room.game); break;
      case 'poker': drawPoker(room.game); break;
      case 'chess': drawChess(room.game); break;
      case 'davinci': drawDavinci(room.game); break;
      case 'coup': drawCoup(room.game); break;
    }
  }
  function drawDavinci(game: DaVinciView) {
    const board = $('t-board'); board.className = 'davinci-board';
    const acting = canAct();
    if (davinciPick && (!acting || game.stage !== 'guess' || game.hands[davinciPick.target]?.[davinciPick.tile]?.revealed)) davinciPick = null;
    const toolbar = $('t-toolbar'); toolbar.hidden = false; toolbar.replaceChildren();
    const mine = new Set(game.hands[room!.me].filter(tile => !tile.revealed).map(tile => `${tile.color}${tile.num}`));
    if (acting && game.stage === 'draw') $('t-turn').textContent += ' · 타일 뽑기 먼저';
    if (acting) {
      if (game.stage === 'draw') {
        const draw = document.createElement('button'); draw.id = 't-draw'; draw.className = 'primary'; draw.textContent = `타일 뽑기 · 더미 ${game.deckCount}장`;
        draw.onclick = () => send({ type: 'action', action: { type: 'draw' } });
        toolbar.append(draw);
      } else {
        const target = davinciPick ? game.hands[davinciPick.target][davinciPick.tile] : null;
        for (let num = 0; num <= 11; num++) {
          const button = document.createElement('button'); button.classList.add('t-num'); button.dataset.num = String(num); button.textContent = String(num);
          button.disabled = !target || target.failed.includes(num) || mine.has(`${target.color}${num}`);
          button.onclick = () => {
            const pick = davinciPick;
            const picked = pick ? game.hands[pick.target]?.[pick.tile] : null;
            if (!pick || !picked) return;
            davinciPick = { ...pick, num };
            choose({ type: 'guess', target: pick.target, tile: pick.tile, num }, `${DAVINCI_COLOR_NAME[picked.color]} ${num} 맞히기`,
              toolbar.querySelector<HTMLElement>(`.t-num[data-num="${num}"]`) ?? undefined);
          };
          toolbar.append(button);
        }
        const stop = document.createElement('button'); stop.id = 't-davinci-stop'; stop.textContent = '추측 마치기';
        stop.disabled = !game.guessed;
        stop.onclick = () => { davinciPick = null; send({ type: 'action', action: { type: 'stop' } }); };
        toolbar.append(stop);
      }
    } else if (game.stage === 'draw') {
      const info = document.createElement('span'); info.textContent = `더미 ${game.deckCount}장`; toolbar.append(info);
    }
    if (davinciPick?.num != null && acting && game.stage === 'guess' && !game.hands[davinciPick.target][davinciPick.tile].revealed) {
      const picked = game.hands[davinciPick.target][davinciPick.tile];
      choose({ type: 'guess', target: davinciPick.target, tile: davinciPick.tile, num: davinciPick.num },
        `${DAVINCI_COLOR_NAME[picked.color]} ${davinciPick.num} 맞히기`, toolbar.querySelector<HTMLElement>(`.t-num[data-num="${davinciPick.num}"]`) ?? undefined);
    }
    for (let seat = 0; seat < game.hands.length; seat++) {
      const rack = document.createElement('section'); rack.className = 'davinci-rack'; rack.dataset.seat = String(seat);
      if (room!.phase === 'playing' && game.turn === seat) rack.classList.add('davinci-turn');
      const heading = document.createElement('header');
      const hidden = game.hands[seat].filter(tile => !tile.revealed).length;
      heading.append(document.createElement('strong'), document.createElement('span'));
      heading.querySelector('strong')!.textContent = `${playerName(seat)}${seat === room!.me ? ' (나)' : ''}`;
      heading.querySelector('span')!.textContent = hidden ? `숨은 타일 ${hidden}장` : '모두 공개됨';
      rack.append(heading);
      const tiles = document.createElement('div'); tiles.className = 'davinci-tiles';
      game.hands[seat].forEach((tile, index) => {
        const button = document.createElement('button');
        button.className = `davinci-tile color-${tile.color}${tile.revealed ? ' revealed' : ''}${tile.id === game.drawnId ? ' drawn' : ''}`;
        button.dataset.tile = String(index);
        button.setAttribute('aria-label', `${playerName(seat)}의 ${DAVINCI_COLOR_NAME[tile.color]} 타일${tile.revealed ? ` ${tile.num} 공개됨` : tile.failed.length ? ` 제외 ${tile.failed.join(', ')}` : ''}`);
        const value = document.createElement('b'); value.textContent = tile.num === null ? '?' : String(tile.num);
        button.append(value);
        if (tile.failed.length && !tile.revealed) {
          const hints = document.createElement('small'); hints.textContent = tile.failed.join(' ');
          hints.setAttribute('aria-hidden', 'true'); button.append(hints);
        }
        button.disabled = !acting || game.stage !== 'guess' || seat === room!.me || tile.revealed;
        button.onclick = () => {
          davinciPick = { target: seat, tile: index, num: null };
          board.querySelectorAll('.pending').forEach(cell => cell.classList.remove('pending'));
          button.classList.add('pending');
          $('t-choice').textContent = `${playerName(seat)} ${DAVINCI_COLOR_NAME[tile.color]} 타일 · 숫자를 골라 주세요`;
          $<HTMLButtonElement>('t-confirm').disabled = true;
          toolbar.querySelectorAll<HTMLButtonElement>('.t-num').forEach(b => { b.disabled = tile.failed.includes(Number(b.dataset.num)) || mine.has(`${tile.color}${b.dataset.num}`); });
        };
        tiles.append(button);
      });
      rack.append(tiles); board.append(rack);
    }
  }

  function drawCoup(game: CoupView) {
    const board = $('t-board'); board.className = 'coup-board';
    const interactive = ws?.readyState === WebSocket.OPEN && room?.phase === 'playing' && room.players.every(p => p.connected) && !finishedTable();
    coupTargeting = coupTargeting && interactive ? coupTargeting : null;
    const toolbar = $('t-toolbar'); toolbar.hidden = false; toolbar.replaceChildren();
    const stage = game.stage;
    const turnLabel = $('t-turn');
    const act = (action: Record<string, unknown>) => send({ type: 'action', action });
    const actButton = (label: string, className: string, disabled: boolean, onclick: () => void) => {
      const button = document.createElement('button'); button.className = className; button.textContent = label; button.disabled = disabled; button.onclick = onclick; toolbar.append(button); return button;
    };
    if (stage.kind === 'reveal') {
      if (interactive) turnLabel.textContent = `${playerName(stage.seat)} · 공개할 카드 선택${stage.seat === room!.me ? ' · 나!' : ''}`;
      const cause = document.createElement('span'); cause.textContent = stage.cause; toolbar.append(cause);
      if (stage.seat !== room!.me || !interactive) {
        const wait = document.createElement('span'); wait.textContent = `${playerName(stage.seat)} 공개 선택 중…`; toolbar.append(wait);
      }
    } else if (stage.kind === 'exchange') {
      if (interactive) turnLabel.textContent = `${playerName(stage.seat)} · 카드 교환 중${stage.seat === room!.me && interactive ? ' · 나!' : ''}`;
      if (stage.seat === room!.me && interactive && stage.options) {
        coupKeep = coupKeep.filter(id => stage.options!.some(card => card.id === id));
        const need = game.players[room!.me].influence.filter(card => !card.revealed).length;
        const hint = document.createElement('span');
        hint.textContent = `내 카드 ${need}장 + 새로 뽑은 2장에서 ${need}장 유지`;
        toolbar.append(hint);
        for (const card of stage.options) {
          const button = document.createElement('button');
          button.className = `coup-keep-card${coupKeep.includes(card.id) ? ' selected' : ''}${card.mine ? '' : ' coup-drawn'}`;
          button.dataset.id = String(card.id);
          button.textContent = COUP_ROLE_NAME[card.role];
          button.title = card.mine ? '원래 내 카드' : '더미에서 새로 뽑은 카드';
          button.onclick = () => {
            coupKeep = coupKeep.includes(card.id) ? coupKeep.filter(id => id !== card.id) : [...coupKeep, card.id];
            render();
          };
          toolbar.append(button);
        }
        const confirm = document.createElement('button'); confirm.id = 't-coup-keep'; confirm.className = 'primary'; confirm.textContent = `유지 ${coupKeep.length}/${need}장 확정`;
        confirm.disabled = coupKeep.length !== need;
        confirm.onclick = () => act({ type: 'keep', cards: coupKeep });
        toolbar.append(confirm);
      } else if (interactive) {
        const wait = document.createElement('span'); wait.textContent = `${playerName(stage.seat)} 교환 중…`; toolbar.append(wait);
      }
    } else if (stage.kind === 'react') {
      const mine = stage.reactor === room!.me && interactive;
      if (interactive) turnLabel.textContent = `${playerName(stage.reactor)}의 반응${mine ? ' · 나!' : ''}`;
      const target = stage.action.target !== undefined ? ` → ${playerName(stage.action.target)}` : '';
      const info = document.createElement('span');
      info.textContent = `${playerName(stage.action.actor)}이(가) ${COUP_ACTION_NAME[stage.action.kind]}${target} 선언 · ${playerName(stage.reactor)} 반응 차례`;
      toolbar.append(info);
      if (mine) {
        const claim = COUP_CLAIM[stage.action.kind];
        if (claim) actButton(`챌린지 (${COUP_ROLE_NAME[claim]} 주장 의심)`, 'coup-challenge', false, () => act({ type: 'challenge' }));
        for (const role of coupBlockRoles(stage.action.kind)) actButton(`${COUP_ROLE_NAME[role]} 주장으로 저지`, 'coup-block', false, () => act({ type: 'block', role }));
        actButton('그냥 보기', 'coup-pass', false, () => act({ type: 'pass' }));
      }
    } else if (stage.kind === 'blockReact') {
      const mine = stage.reactor === room!.me && interactive;
      if (interactive) turnLabel.textContent = `${playerName(stage.reactor)}의 반응${mine ? ' · 나!' : ''}`;
      const info = document.createElement('span');
      info.textContent = `${playerName(stage.blocker)}이(가) ${COUP_ROLE_NAME[stage.role]} 주장으로 저지 · ${playerName(stage.reactor)} 반응 차례`;
      toolbar.append(info);
      if (mine) {
        actButton('저지 챌린지', 'coup-challenge', false, () => act({ type: 'challenge' }));
        actButton('수락', 'coup-accept', false, () => act({ type: 'accept' }));
      }
    } else if (game.turn === room!.me && interactive) {
      if (interactive) turnLabel.textContent = `${playerName(game.turn)} 차례 · 내 차례!`;
      if (coupTargeting) {
        const rule = document.createElement('span');
        rule.textContent = `${COUP_ACTION_NAME[coupTargeting]} · ${COUP_ACTION_RULE[coupTargeting]}`;
        toolbar.append(rule);
        const back = actButton('← 대상 다시 고르기', 'coup-cancel-target', false, () => { coupTargeting = null; render(); });
        back.classList.add('coup-cancel-target');
        for (const seat of game.players.map((_, index) => index)) {
          if (seat === room!.me || game.players[seat].influence.every(card => card.revealed)) continue;
          actButton(`${playerName(seat)}(${game.players[seat].coins}코인)에게 ${COUP_ACTION_NAME[coupTargeting]}(${COUP_ACTION_COST[coupTargeting]}코인)`, 'coup-target', false, () => {
            const kind = coupTargeting!;
            coupTargeting = null;
            act({ type: 'act', kind, target: seat });
          });
        }
      } else {
        const me = game.players[room!.me];
        if (me.coins >= 10) {
          const force = document.createElement('span'); force.textContent = '10코인 이상 — 쿠만 가능해요'; toolbar.append(force);
        }
        for (const kind of Object.keys(COUP_ACTION_NAME) as CoupActionKind[]) {
          const cost = COUP_ACTION_COST[kind];
          const needsTarget = kind === 'coup' || kind === 'steal' || kind === 'assassinate';
          const disabled = me.coins < cost || (me.coins >= 10 && kind !== 'coup');
          const label = `${COUP_ACTION_NAME[kind]}${cost ? ` ${cost}코인` : ''}`;
          const button = actButton(label, `coup-act coup-${kind}`, disabled, () => {
            if (needsTarget) { coupTargeting = kind; render(); return; }
            act({ type: 'act', kind });
          });
          button.dataset.kind = kind;
          button.title = COUP_ACTION_RULE[kind];
        }
        const deck = document.createElement('span'); deck.textContent = `더미 ${game.deckCount}장`; toolbar.append(deck);
      }
    }
    for (let seat = 0; seat < game.players.length; seat++) {
      const row = document.createElement('section');
      const reacting = (stage.kind === 'react' && stage.reactor === seat) || (stage.kind === 'blockReact' && (stage.reactor === seat || stage.blocker === seat));
      row.className = `coup-player${game.turn === seat && stage.kind === 'action' && !finishedTable() ? ' coup-turn' : ''}${stage.kind === 'reveal' && stage.seat === seat ? ' coup-revealing' : ''}${reacting ? ' coup-turn' : ''}`;
      row.dataset.seat = String(seat);
      const heading = document.createElement('header');
      const title = document.createElement('strong');
      title.textContent = `${playerName(seat)}${seat === room!.me ? ' (나)' : ''}`;
      const coins = document.createElement('span');
      coins.textContent = `${game.players[seat].coins}코인`;
      heading.append(title, coins);
      const revealedNames = game.players[seat].influence.filter(card => card.revealed && card.role).map(card => COUP_ROLE_NAME[card.role!]);
      if (revealedNames.length) {
        const names = document.createElement('small');
        names.className = 'coup-revealed-names';
        names.textContent = `공개: ${revealedNames.join('·')}`;
        heading.append(names);
      }
      row.append(heading);
      const cards = document.createElement('div'); cards.className = 'coup-cards';
      game.players[seat].influence.forEach((card, index) => {
        const face = document.createElement('button');
        face.className = `coup-card${card.revealed ? ' revealed' : ''}`;
        face.dataset.id = String(card.id);
        face.textContent = card.role ? COUP_ROLE_NAME[card.role] : '?';
        face.setAttribute('aria-label', `${playerName(seat)}의 ${card.revealed ? `공개된 ${card.role ? COUP_ROLE_NAME[card.role] : ''}` : '숨은 카드'}`);
        if (stage.kind === 'reveal' && stage.seat === seat && seat === room!.me && !card.revealed && interactive) {
          if (coupReveal === index) {
            face.classList.add('pending');
            face.onclick = () => { coupReveal = null; act({ type: 'reveal', index }); };
          } else {
            face.onclick = () => {
              coupReveal = index;
              render();
              $('t-choice').textContent = `${card.role ? COUP_ROLE_NAME[card.role] : '카드'} 공개 — 같은 카드를 다시 눌러 확정`;
            };
          }
        } else face.disabled = true;
        cards.append(face);
      });
      row.append(cards);
      board.append(row);
    }
    const status = document.createElement('p'); status.className = 'coup-log'; status.textContent = game.log.split(/(?<=[.!])\s+/).slice(-2).join(' ');
    board.append(status);
  }

  function finishedTable() {
    return room?.game ? room.game.winner !== null || room.game.draw : false;
  }

  function cell(label: string, index: number) {
    const button = document.createElement('button'); button.className = 'board-cell'; button.setAttribute('aria-label', label);
    button.dataset.cell = String(index); button.disabled = !canAct(); return button;
  }
  function drawGomoku(game: GomokuState) {
    const board = $('t-board'); board.className = 'gomoku-board';
    game.board.forEach((owner, i) => {
      const r = Math.floor(i / 15), c = i % 15;
      const button = cell(`${r + 1}행 ${c + 1}열 ${owner === null ? '빈칸' : owner === 0 ? '흑돌' : '백돌'}`, i);
      if (owner !== null) { const stone = document.createElement('span'); stone.className = `stone stone-${owner}`; button.append(stone); button.disabled = true; }
      if (i === game.last) button.classList.add('last-move');
      button.onclick = () => choose({ type: 'place', r, c }, `${r + 1}행 ${c + 1}열에 두기`, button);
      board.append(button);
    });
  }
  function drawQuoridor(game: QuoridorState) {
    const toolbar = $('t-toolbar'); toolbar.hidden = false; toolbar.replaceChildren();
    for (const [mode, label, hint] of [['move', '말 이동', '초록 칸으로 한 칸 이동 · 상대와 마주 보면 뛰어넘어요'], ['h', '가로 벽', '칸 아래에 가로 벽 · 길을 완전히 막는 벽은 안 돼요'], ['v', '세로 벽', '칸 오른쪽에 세로 벽 · 길을 완전히 막는 벽은 안 돼요']] as const) {
      const button = document.createElement('button'); button.textContent = label; button.title = hint;
      button.classList.toggle('selected', wallMode === mode); button.disabled = !canAct();
      button.onclick = () => { wallMode = mode; pending = null; render(); }; toolbar.append(button);
    }
    const counts = document.createElement('span'); counts.textContent = wallMode === 'move' ? `남은 벽 · 나 ${game.remaining[room!.me]} / 상대 ${game.remaining[1 - room!.me]}` : `나 ${game.remaining[room!.me]} · 상대 ${game.remaining[1 - room!.me]}`; toolbar.append(counts);
    const board = $('t-board'); board.className = 'quoridor-board';
    // Moving: only legal targets stay clickable, and jumps or side-steps around the opponent are labelled.
    const moving = wallMode === 'move' && canAct();
    const mine = game.pawns[room!.me];
    const legal = moving ? quoridorMoves(game, room!.me) : [];
    const facing = legal.some(t => Math.abs(t.r - mine.r) + Math.abs(t.c - mine.c) === 2);
    if (moving) $('t-choice').textContent = facing ? '상대와 마주 보고 있어요 · 점프 칸을 누르면 뛰어넘어요' : '초록 칸을 눌러 한 칸 이동해요 · 상대와 마주 보면 뛰어넘어요';
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const button = cell(`${r + 1}행 ${c + 1}열`, r * 9 + c);
      if (wallMode !== 'move' && (r === 8 || c === 8)) { button.disabled = true; button.title = '벽의 시작점은 마지막 행·열을 제외한 칸을 골라 주세요.'; }
      if (moving) {
        const target = legal.find(t => t.r === r && t.c === c);
        if (target) {
          button.classList.add('legal-move');
          const distance = Math.abs(r - mine.r) + Math.abs(c - mine.c);
          if (distance === 2) { const straight = r === mine.r || c === mine.c; button.classList.add(straight ? 'legal-jump' : 'legal-side'); button.setAttribute('aria-label', `${r + 1}행 ${c + 1}열 · ${straight ? '상대를 뛰어넘기' : '상대 옆으로 비켜 가기'}`); }
        } else { button.disabled = true; button.classList.add('no-move'); button.title = '이 칸으로는 갈 수 없어요. 초록 칸을 골라 주세요.'; }
      }
      const owner = game.pawns.findIndex(p => p.r === r && p.c === c);
      if (owner >= 0) { const pawn = document.createElement('span'); pawn.className = `pawn seat-${owner}`; pawn.textContent = owner === room!.me ? '나' : '상대'; button.append(pawn); }
      button.onclick = () => {
        if (wallMode === 'move') choose({ type: 'move', r, c }, `${r + 1}행 ${c + 1}열로 이동`, button);
        else {
          if (r === 8 || c === 8) { $('t-error').textContent = '벽의 시작점은 마지막 행·열을 제외한 칸을 골라 주세요.'; return; }
          choose({ type: 'wall', r, c, dir: wallMode }, `${r + 1}행 ${c + 1}열 ${wallMode === 'h' ? '아래에 가로' : '오른쪽에 세로'} 벽`, button);
          drawWall(r, c, wallMode, true);
        }
      }; board.append(button);
    }
    for (const wall of game.walls) drawWall(wall.r, wall.c, wall.dir);
  }
  function drawWall(r: number, c: number, dir: 'h' | 'v', preview = false) {
    if (preview) $('t-board').querySelectorAll('.wall-preview').forEach(wall => wall.remove());
    const wall = document.createElement('div'); wall.className = `q-wall wall-${dir}${preview ? ' wall-preview' : ''}`;
    wall.style.left = `${(c + (dir === 'v' ? 1 : 0)) / 9 * 100}%`;
    wall.style.top = `${(r + (dir === 'h' ? 1 : 0)) / 9 * 100}%`;
    wall.setAttribute('aria-label', `${r + 1}행 ${c + 1}열 ${dir === 'h' ? '가로' : '세로'} 벽`);
    $('t-board').append(wall);
  }
  function drawJanggi(game: JanggiState) {
    const board = $('t-board'); board.className = 'janggi-board';
    game.board.forEach((piece, i) => {
      const button = cell(`${Math.floor(i / 3) + 1}행 ${i % 3 + 1}열${piece ? ' ' + PIECES[piece.kind] : ' 빈칸'}`, i);
      if (piece) {
        const token = document.createElement('span'); token.className = `janggi-piece seat-${piece.owner}`;
        const title = document.createElement('strong'); title.textContent = PIECES[piece.kind];
        const direction = document.createElement('small'); direction.textContent = piece.owner === 0 ? '위로 전진' : '아래로 전진';
        token.append(title, direction); button.append(token);
      }
      button.onclick = () => {
        if (drop && piece) {
          if (piece.owner === room!.me) drop = null;
          else { $('t-error').textContent = '비어 있는 칸에 투입해 주세요.'; return; }
        }
        if (drop) { choose({ type: 'drop', piece: drop, to: i }, `${PIECES[drop]} 투입`, button); }
        else if (piece?.owner === room!.me) {
          selectedPiece = i; pending = null;
          board.querySelectorAll('.pending,.legal-move').forEach(b => b.classList.remove('pending', 'legal-move')); button.classList.add('pending');
          for (const target of janggiTargets(game.board, game.hands, game.variant, room!.me as 0 | 1, i, null)) board.querySelector(`[data-cell="${target}"]`)?.classList.add('legal-move');
          $('t-choice').textContent = `${PIECES[piece.kind]} 선택 · 도착 칸을 고르세요`; $<HTMLButtonElement>('t-confirm').disabled = true;
        } else if (selectedPiece !== null) choose({ type: 'move', from: selectedPiece, to: i }, '선택한 말 이동', button);
      }; board.append(button);
    });
    for (let seat = 0; seat < 2; seat++) {
      const hand = document.createElement('div'); hand.className = 'hand-row';
      const label = document.createElement('span'); label.textContent = `${playerName(seat)} 보유 말`; hand.append(label);
      if (!game.hands[seat].length) { const empty = document.createElement('small'); empty.textContent = '없음'; hand.append(empty); }
      game.hands[seat].forEach(piece => {
        const button = document.createElement('button'); button.textContent = PIECES[piece]; button.disabled = !canAct() || seat !== room!.me;
        button.onclick = () => { drop = piece; selectedPiece = null; pending = null; $('t-choice').textContent = `${PIECES[piece]} 투입 · 빈칸을 고르세요`; $<HTMLButtonElement>('t-confirm').disabled = true;
          board.querySelectorAll('.legal-move').forEach(b => b.classList.remove('legal-move'));
          for (const target of janggiTargets(game.board, game.hands, game.variant, room!.me as 0 | 1, null, piece)) board.querySelector(`[data-cell="${target}"]`)?.classList.add('legal-move'); }; hand.append(button);
      }); $('t-hands').append(hand);
    }
    $('t-hands').hidden = game.hands.every(hand => !hand.length);
  }
  function drawPoker(game: PublicPoker) {
    const board = $('t-board'); board.className = 'poker-table poker-3d-table';
    board.append(pokerScene);
    if (pokerWorld) pokerWorld.update(game, room!.me, room!.players, room!.round);
    else if (!pokerLoading && !pokerFailed) {
      pokerLoading = true;
      const version = ++pokerLoadVersion;
      void import('./poker-world.ts').then(async ({ PokerWorld }) => {
        if (version !== pokerLoadVersion || !room || room.game?.kind !== 'poker') return;
        const world = new PokerWorld(pokerCanvas);
        pokerWorld = world;
        await world.ready;
        if (version !== pokerLoadVersion || pokerWorld !== world || !room || room.game?.kind !== 'poker') return;
        world.update(room.game, room.me, room.players, room.round);
        pokerHint.textContent = '좌우로 둘러보기 · 내 카드는 공개 전까지 비밀';
      }).catch(() => {
        if (version !== pokerLoadVersion) return;
        pokerWorld?.dispose(); pokerWorld = null;
        pokerFailed = true;
        pokerHint.textContent = '3D 화면을 열지 못해 아래에 카드를 표시해요. 새로고침하면 다시 시도해요.';
        board.querySelectorAll('.poker-card-value').forEach(face => face.classList.remove('sr-only'));
      }).finally(() => { if (version === pokerLoadVersion) pokerLoading = false; });
    }
    const pot = document.createElement('div'); pot.className = 'pot';
    pot.textContent = `모인 칩 ${game.pot} · 현재 베팅 ${game.bet}`; board.append(pot);
    const seats = document.createElement('div'); seats.className = 'poker-seats'; board.append(seats);
    for (const p of room!.players) {
      const card = document.createElement('article'); card.className = `poker-player${game.folded[p.seat] ? ' folded' : ''}`;
      card.dataset.seat = String(p.seat);
      const title = document.createElement('strong'); title.textContent = `${p.name}${p.seat === room!.me ? ' (나)' : ''}`;
      const face = document.createElement('span'); face.className = `poker-card-value${room!.phase === 'playing' && game.stage === 'betting' && !pokerFailed ? ' sr-only' : ''}`;
      face.textContent = game.cards[p.seat] === null ? '비공개' : `카드 ${game.cards[p.seat]}`;
      face.setAttribute('aria-label', game.cards[p.seat] === null ? '내 카드는 공개 전까지 볼 수 없어요' : `${p.name}의 카드 ${game.cards[p.seat]}`);
      const chips = document.createElement('p'); chips.textContent = `${game.chips[p.seat]}칩 · ${game.folded[p.seat] ? '포기' : `${game.bets[p.seat]}칩 냄`}`;
      card.append(title, face, chips); seats.append(card);
    }
    if (game.variant === 'duel') {
      $('t-round').textContent = `${config.title} · ${room!.round}번째 경기 · ${game.hand}판`;
      if (room!.phase === 'playing' && game.stage === 'reveal') {
        $('t-turn').textContent = game.handWinner === null ? '이번 판 동점 · 칩 이월' : `${playerName(game.handWinner)} 이번 판 승리`;
        const next = document.createElement('button'); next.className = 'primary poker-next';
        next.textContent = game.nextReady[room!.me] ? '상대 준비 기다리는 중' : '다음 판 준비';
        next.disabled = game.nextReady[room!.me] || room!.players.some(player => !player.connected);
        next.onclick = () => { next.disabled = true; send({ type: 'action', action: { type: 'next' } }); };
        board.append(next);
      }
      const decks = document.createElement('p'); decks.className = 'poker-decks';
      decks.textContent = `개인 덱 · ${room!.players.map(player => `${player.name} ${game.remaining[player.seat]}장 남음`).join(' · ')}`;
      board.append(decks);
    }
    if (canAct() && game.stage === 'betting') {
      const actions = document.createElement('div'); actions.className = 'poker-actions';
      const cost = game.bet - game.bets[room!.me];
      const summary = document.createElement('span'); summary.className = 'poker-summary';
      summary.textContent = `내 칩 ${game.chips[room!.me]} · ${cost ? `콜 ${cost}칩 → ${game.chips[room!.me] - cost}칩 남음` : '추가 없이 체크 가능'}`;
      actions.append(summary);
      const raiseMax = Math.min(...game.chips.map((chips, i) => game.folded[i] ? Infinity : chips + game.bets[i])) - game.bet;
      let amount: HTMLInputElement | undefined;
      if (game.variant === 'duel') {
        const sizing = document.createElement('div'); sizing.className = 'poker-bet-size';
        const label = document.createElement('label'); label.htmlFor = 'poker-raise'; label.textContent = '추가로 올릴 칩';
        amount = document.createElement('input'); amount.id = 'poker-raise'; amount.type = 'number'; amount.min = '1'; amount.max = String(Math.max(1, raiseMax)); amount.step = '1'; amount.value = '1'; amount.required = true; amount.disabled = raiseMax < 1;
        const max = document.createElement('button'); max.textContent = '최대로'; max.disabled = raiseMax < 1;
        max.onclick = () => { amount!.value = String(raiseMax); };
        sizing.append(label, amount, max); board.append(sizing);
      }
      for (const [type, text] of [['call', cost ? `${cost}칩 콜` : '체크'], ['raise', game.variant === 'duel' ? '올리기' : '1칩 올리기'], ['fold', '이번 판 포기']]) {
        const button = document.createElement('button'); button.textContent = text; button.className = type === 'call' ? 'primary' : '';
        button.onclick = () => {
          if (type === 'raise' && amount && !amount.reportValidity()) return;
          actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
          send({ type: 'action', action: { type, ...(type === 'raise' && amount ? { amount: amount.valueAsNumber } : {}) } });
        };
        if (type === 'raise') {
          button.disabled = raiseMax < 1;
          button.title = raiseMax < 1 ? '모두가 맞출 수 있는 금액이 없어 올릴 수 없어요' : '두 사람이 모두 맞출 수 있는 만큼만 올릴 수 있어요';
        }
        actions.append(button);
      }
      board.append(actions);
    }
  }

  function drawChess(game: ChessState) {
    const board = $('t-board'); board.className = 'chess-board';
    const names = { k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰' };
    const paths = {
      k: 'M20 5v10M15 10h10M12 19Q20 12 28 19L25 29H15Z M13 30h14l3 5H10Z',
      q: 'M9 13l5 7 6-13 6 13 5-7-5 17H14Z M13 30h14l3 5H10Z',
      r: 'M11 8h5v5h3V8h3v5h3V8h5v12H11Z M15 20h11v10H15Z M12 30h16l3 5H9Z',
      b: 'M20 6Q7 17 14 23h12Q33 17 20 6Z M21 12l-5 8M16 23h8l2 7H14Z M12 30h16l3 5H9Z',
      n: 'M13 9l5 3 7-5 4 13-5 4 1 6H13l3-10-7 2-3-5Z M12 30h16l3 5H9Z M22 15h1',
      p: 'M26 12a6 6 0 1 1-12 0a6 6 0 1 1 12 0Z M17 19h6l3 11H14Z M12 30h16l3 5H9Z',
    };
    const toolbar = $('t-toolbar'); toolbar.hidden = !game.legal.some(move => move.promotion); toolbar.replaceChildren();
    const label = document.createElement('label'); label.htmlFor = 't-promotion'; label.textContent = '폰 승격';
    const select = document.createElement('select'); select.id = 't-promotion'; select.setAttribute('aria-label', '폰 승격 기물');
    for (const [value, name] of [['q', '퀸'], ['r', '룩'], ['b', '비숍'], ['n', '나이트']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option);
    }
    select.value = promotion;
    select.disabled = !canAct();
    select.onchange = () => { promotion = select.value; if (pending?.promotion) pending.promotion = promotion; };
    toolbar.append(label, select);
    if (game.check) $('t-turn').textContent += ' · 체크 — 왕을 피하세요';
    for (let rendered = 0; rendered < 64; rendered++) {
      const i = room!.me === 1 ? 63 - rendered : rendered;
      const piece = game.board[i];
      const r = Math.floor(i / 8), c = i % 8;
      const square = String.fromCharCode(97 + c) + String(8 - r);
      const button = cell(`${square} ${piece ? (piece.color === 'w' ? '백 ' : '흑 ') + names[piece.type] : '빈칸'}`, i);
      button.dataset.square = square;
      button.classList.add((r + c) % 2 === 0 ? 'light-square' : 'dark-square');
      if (piece) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add(`chess-${piece.color}`);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', paths[piece.type]); svg.append(path); button.append(svg);
      }
      const coordinate = document.createElement('small'); coordinate.textContent = square; button.append(coordinate);
      if (game.last?.from === square || game.last?.to === square) button.classList.add('chess-last');
      button.onclick = () => {
        if (piece?.color === (room!.me === 0 ? 'w' : 'b')) {
          selectedPiece = i; pending = null;
          board.querySelectorAll('.pending,.legal-move').forEach(element => element.classList.remove('pending', 'legal-move'));
          button.classList.add('pending');
          for (const legal of game.legal.filter(move => move.from === square)) board.querySelector(`[data-square="${legal.to}"]`)?.classList.add('legal-move');
          $('t-choice').textContent = `${square} ${names[piece.type]} · 도착 칸을 고르세요`; $<HTMLButtonElement>('t-confirm').disabled = true;
        } else if (selectedPiece !== null) {
          const from = String.fromCharCode(97 + selectedPiece % 8) + String(8 - Math.floor(selectedPiece / 8));
          const legal = game.legal.filter(move => move.from === from && move.to === square);
          if (!legal.length) { $('t-error').textContent = '이 기물은 그 칸으로 이동할 수 없어요.'; return; }
          choose({ type: 'move', from, to: square, ...(legal.some(move => move.promotion) ? { promotion } : {}) }, `${from} → ${square}`, button);
        }
      }; board.append(button);
    }
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (saved?.code && saved?.token && (!invitation || invitation.toUpperCase() === saved.code)) {
      session = saved; connect({ type: 'resume', game: kind, ...saved });
    }
  } catch { sessionStorage.removeItem(key); }
}
