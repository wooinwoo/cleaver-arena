import { TABLE_GAMES, type TableId } from '../shared/catalog.ts';
import type { Action } from '../shared/tabletop-types.ts';
import type { GomokuState } from '../shared/gomoku.ts';
import type { QuoridorState } from '../shared/quoridor.ts';
import { JANGGI_VARIANTS, type JanggiState, type JanggiVariant, type PieceKind } from '../shared/janggi.ts';
import type { PokerState } from '../shared/poker.ts';
import type { ChessState } from '../shared/chess.ts';

type PublicPoker = Omit<PokerState, 'cards'> & { cards: (number | null)[] };
type GameState = GomokuState | QuoridorState | JanggiState | PublicPoker | ChessState;
type RoomState = { code: string; kind: TableId; variant?: JanggiVariant; phase: 'lobby' | 'playing' | 'finished'; round: number; result: string;
  players: { id: string; name: string; seat: number; ready: boolean; connected: boolean }[]; me: number; game: GameState | null };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PIECES: Record<PieceKind, string> = { king: '왕', rook: '장', bishop: '상', pawn: '자', hen: '후' };

export function initTabletop(kind: TableId) {
  const config = TABLE_GAMES[kind];
  document.body.classList.add('in-table');
  $('hub').hidden = true; $('lobby').hidden = true; $('loading').hidden = true;
  $('game').hidden = true;
  document.querySelector<HTMLElement>('.view-dock')!.hidden = true;
  $('games-menu').hidden = false;
  document.title = `${config.title} · 친구네 오락실`;
  const section = document.createElement('section'); section.id = 'table-page';
  section.innerHTML = `
    <aside class="table-sidebar">
      <h1>${config.title}</h1><p class="table-description">${config.description}</p>
      <form id="t-entry"><label for="t-name">내 닉네임</label><input id="t-name" maxlength="12" autocomplete="nickname" placeholder="친구들이 알아볼 이름" required />
        ${kind === 'janggi' ? '<label for="t-variant">새 방의 룰</label><select id="t-variant" aria-describedby="t-variant-note"><option value="animal">동물장기</option><option value="genius">더 지니어스 기본룰</option></select><p id="t-variant-note" class="help">입장할 때는 해당 방의 룰을 따라요.</p>' : ''}
        <button class="primary" type="submit">방 만들기</button><div class="join-row"><label class="sr-only" for="t-code-input">방 코드</label><input id="t-code-input" maxlength="6" placeholder="방 코드 6자리"/><button type="button" id="t-join">입장</button></div></form>
      <details id="t-room" open hidden><summary>방 정보 · 참가자</summary><div class="table-invite"><span>우리 방 <strong id="t-code"></strong></span><button id="t-copy">초대 링크 복사</button></div>
        <ul id="t-players"></ul><button id="t-ready" class="primary">준비하기</button><p id="t-ready-note">모두 준비하면 시작해요.</p></details>
      <p id="t-error" role="alert"></p><details class="table-rules" open><summary id="t-rules-title">이 게임의 규칙</summary><p id="t-rules-text">${config.rules}</p></details>
      <button id="t-leave" class="text-button">다른 게임 고르기</button>
    </aside>
    <div class="table-stage"><div class="table-status"><span id="t-round">친구를 기다리는 중</span><strong id="t-turn" role="status">방을 만들거나 입장해 주세요</strong></div>
      <div id="t-toolbar" hidden></div><div id="t-hands"></div><div id="t-board-wrap"><div id="t-board" class="empty-board"><strong>같이 하면 더 재밌으니까.</strong><p>친구에게 초대 링크를 보내고<br />모두 준비를 눌러 주세요.</p></div></div>
      <div id="t-action-bar" hidden><span id="t-choice">칸을 선택하세요</span><button id="t-confirm" class="primary" disabled>선택한 수 확정</button><button id="t-cancel">취소</button></div>
      <p id="t-log" role="status"></p>
    </div>`;
  document.body.append(section);
  let ws: WebSocket | null = null, room: RoomState | null = null;
  let session: { code: string; token: string } | null = null;
  let intentional = false, connecting = false, retries = 0, timer: ReturnType<typeof setTimeout>;
  let pending: Action | null = null, selectedPiece: number | null = null, drop: PieceKind | null = null;
  let wallMode: 'move' | 'h' | 'v' = 'move';
  let promotion = 'q';
  const compact = matchMedia('(max-width: 760px)');
  const roomDetails = $<HTMLDetailsElement>('t-room');
  const rules = document.querySelector<HTMLDetailsElement>('.table-rules')!;
  const variant = $<HTMLSelectElement>('t-variant');
  function renderRules() {
    if (kind !== 'janggi') return;
    const selected = JANGGI_VARIANTS[room?.variant ?? variant.value as JanggiVariant];
    $('t-rules-title').textContent = `규칙 · ${selected.title}`;
    $('t-rules-text').textContent = selected.rules;
  }
  if (variant) variant.onchange = renderRules;
  renderRules();
  rules.open = !compact.matches;
  compact.addEventListener('change', () => {
    roomDetails.open = room?.phase !== 'playing' || !compact.matches;
    if (room?.phase === 'playing' && compact.matches) rules.open = false;
  });
  const key = `table-session-${kind}`;
  const name = $<HTMLInputElement>('t-name');
  name.value = localStorage.getItem('cleaver-name') ?? '';
  const invitation = new URLSearchParams(location.search).get('room');
  if (invitation) $<HTMLInputElement>('t-code-input').value = invitation.toUpperCase().slice(0, 6);
  const send = (data: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  function busy(value: boolean) {
    connecting = value;
    for (const element of $('t-entry').querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')) element.disabled = value;
  }
  function resetEntry(message: string) {
    session = null; sessionStorage.removeItem(key); room = null;
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
      if (data.type === 'joined') {
        busy(false); retries = 0;
        session = { code: data.code, token: data.token };
        sessionStorage.setItem(key, JSON.stringify(session));
        history.replaceState(null, '', `/?game=${kind}&room=${data.code}`);
        $('t-entry').hidden = true; $('t-room').hidden = false;
        $('t-code').textContent = data.code; $('connection').textContent = '연결됨';
      } else if (data.type === 'table-state') {
        room = data.room; pending = null; selectedPiece = null; drop = null;
        $('t-error').textContent = ''; render();
      } else if (data.type === 'error' || data.type === 'expired') {
        busy(false); $('t-error').textContent = data.message;
        if (data.type === 'expired') resetEntry(data.message);
      }
    };
    ws.onclose = () => {
      clearTimeout(timeout); busy(false);
      if (intentional || current !== ws) return;
      $('connection').textContent = '연결 끊김';
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
  $('t-confirm').onclick = () => { if (pending) { send({ type: 'action', action: pending }); pending = null; $<HTMLButtonElement>('t-confirm').disabled = true; } };
  $('t-cancel').onclick = () => { pending = null; selectedPiece = null; drop = null; render(); };
  function canAct() { return room?.phase === 'playing' && room.game?.turn === room.me && room.players.every(p => p.connected); }
  function choose(action: Action, text: string, button?: HTMLElement) {
    pending = action; $('t-choice').textContent = text; $<HTMLButtonElement>('t-confirm').disabled = false;
    $('t-board').querySelectorAll('.pending').forEach(cell => cell.classList.remove('pending'));
    button?.classList.add('pending');
  }
  function playerName(seat: number) { return room?.players.find(p => p.seat === seat)?.name ?? `${seat + 1}번`; }
  function render() {
    if (!room) return;
    renderRules();
    if (document.body.dataset.tablePhase !== room.phase) {
      document.body.dataset.tablePhase = room.phase;
      roomDetails.open = room.phase !== 'playing' || !compact.matches;
      if (room.phase === 'playing' && compact.matches) rules.open = false;
    }
    const me = room.players.find(p => p.seat === room!.me)!;
    $('t-ready').hidden = room.phase === 'playing';
    $('t-ready').textContent = me.ready ? '준비 취소' : room.phase === 'finished' ? '다시 준비하기' : '준비하기';
    $('t-ready-note').textContent = room.phase === 'playing' ? '진행 중 · 상대가 끊기면 최대 20초 기다려요.' : `${room.players.length} / ${config.max}명 · 모두 준비하면 시작해요.`;
    $('t-round').textContent = room.round ? `${config.title} · ${room.round}번째 판` : `${config.min}–${config.max}명 게임`;
    $('t-turn').textContent = room.phase === 'finished' ? room.result : room.phase === 'lobby' ? '친구와 함께 준비를 눌러 주세요' :
      room.players.some(p => !p.connected) ? '상대의 재접속을 기다리는 중…' : `${playerName(room.game!.turn)} 차례${canAct() ? ' · 내 차례!' : ''}`;
    $('t-players').replaceChildren(...room.players.map(p => {
      const li = document.createElement('li'); const dot = document.createElement('i'); dot.className = `seat-${p.seat % 2}`;
      const label = document.createElement('span'); label.textContent = `${p.name}${p.seat === room!.me ? ' (나)' : ''}`;
      const status = document.createElement('small'); status.textContent = !p.connected ? '재접속 대기' : room!.phase === 'playing' ? `${p.seat + 1}번` : p.ready ? '준비 완료' : '준비 중';
      li.append(dot, label, status); return li;
    }));
    if (!room.game) {
      $('t-board').className = 'empty-board';
      $('t-board').textContent = '친구가 모이면 모두 준비를 눌러 주세요.';
      $('t-hands').replaceChildren(); $('t-log').textContent = '';
      $('t-toolbar').hidden = true; $('t-action-bar').hidden = true;
      return;
    }
    $('t-log').textContent = room.game.log;
    $('t-board').replaceChildren(); $('t-hands').replaceChildren();
    $('t-toolbar').hidden = true;
    $('t-action-bar').hidden = !canAct() || kind === 'poker';
    $('t-choice').textContent = kind === 'janggi' ? '움직일 말 또는 보유 말을 선택하세요' : '칸을 선택한 뒤 확정하세요';
    $<HTMLButtonElement>('t-confirm').disabled = true;
    switch (room.game.kind) {
      case 'gomoku': drawGomoku(room.game); break;
      case 'quoridor': drawQuoridor(room.game); break;
      case 'janggi': drawJanggi(room.game); break;
      case 'poker': drawPoker(room.game); break;
      case 'chess': drawChess(room.game); break;
    }
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
    for (const [mode, label] of [['move', '말 이동'], ['h', '가로 벽'], ['v', '세로 벽']] as const) {
      const button = document.createElement('button'); button.textContent = label;
      button.classList.toggle('selected', wallMode === mode); button.disabled = !canAct();
      button.onclick = () => { wallMode = mode; pending = null; render(); }; toolbar.append(button);
    }
    const counts = document.createElement('span'); counts.textContent = `남은 벽 · 나 ${game.remaining[room!.me]} / 상대 ${game.remaining[1 - room!.me]}`; toolbar.append(counts);
    const board = $('t-board'); board.className = 'quoridor-board';
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const button = cell(`${r + 1}행 ${c + 1}열`, r * 9 + c);
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
        if (drop) { choose({ type: 'drop', piece: drop, to: i }, `${PIECES[drop]} 투입`, button); }
        else if (piece?.owner === room!.me) {
          selectedPiece = i; pending = null;
          board.querySelectorAll('.pending').forEach(b => b.classList.remove('pending')); button.classList.add('pending');
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
        button.onclick = () => { drop = piece; selectedPiece = null; pending = null; $('t-choice').textContent = `${PIECES[piece]} 투입 · 빈칸을 고르세요`; $<HTMLButtonElement>('t-confirm').disabled = true; }; hand.append(button);
      }); $('t-hands').append(hand);
    }
  }
  function drawPoker(game: PublicPoker) {
    const board = $('t-board'); board.className = 'poker-table';
    const pot = document.createElement('div'); pot.className = 'pot';
    pot.textContent = `모인 칩 ${game.pot} · 현재 베팅 ${game.bet}`; board.append(pot);
    for (const p of room!.players) {
      const card = document.createElement('article'); card.className = `poker-player${game.folded[p.seat] ? ' folded' : ''}`;
      const title = document.createElement('strong'); title.textContent = `${p.name}${p.seat === room!.me ? ' (나)' : ''}`;
      const face = document.createElement('div'); face.className = `playing-card${game.cards[p.seat] === null ? ' card-back' : ''}`;
      face.textContent = game.cards[p.seat] === null ? '?' : String(game.cards[p.seat]);
      face.setAttribute('aria-label', game.cards[p.seat] === null ? '내 카드는 공개 전까지 볼 수 없어요' : `${p.name}의 카드 ${game.cards[p.seat]}`);
      const chips = document.createElement('p'); chips.textContent = `${game.chips[p.seat]}칩 · ${game.folded[p.seat] ? '포기' : `${game.bets[p.seat]}칩 냄`}`;
      card.append(title, face, chips); board.append(card);
    }
    if (canAct()) {
      const actions = document.createElement('div'); actions.className = 'poker-actions';
      const cost = game.bet - game.bets[room!.me];
      for (const [type, text] of [['call', cost ? `${cost}칩 콜` : '체크'], ['raise', '1칩 올리기'], ['fold', '이번 판 포기']]) {
        const button = document.createElement('button'); button.textContent = text; button.className = type === 'call' ? 'primary' : '';
        button.onclick = () => { actions.querySelectorAll('button').forEach(b => { b.disabled = true; }); send({ type: 'action', action: { type } }); };
        if (type === 'raise') button.disabled = game.bet >= Math.min(...game.chips.map((chips, i) => game.folded[i] ? Infinity : chips + game.bets[i]));
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
    const toolbar = $('t-toolbar'); toolbar.hidden = false; toolbar.replaceChildren();
    const label = document.createElement('label'); label.htmlFor = 't-promotion'; label.textContent = '폰 승격';
    const select = document.createElement('select'); select.id = 't-promotion'; select.setAttribute('aria-label', '폰 승격 기물');
    for (const [value, name] of [['q', '퀸'], ['r', '룩'], ['b', '비숍'], ['n', '나이트']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option);
    }
    select.value = promotion;
    select.onchange = () => { promotion = select.value; if (pending?.promotion) pending.promotion = promotion; };
    toolbar.append(label, select);
    if (game.check) $('t-turn').textContent += ' · 체크!';
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
