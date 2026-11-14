import './mancala.css';
import type { TableCover, TableRenderContext } from './types.ts';
import { type MancalaState, PITS, STORE, opposite, pitIndex } from '../../shared/mancala.ts';
import { calm, centre, cue, delay, gap, motion, soundToggle, track, turnCues } from './fx.ts';

const SEED_COLORS = ['#e2574c', '#f2b134', '#4fa3d9', '#6fbf73', '#b67ad9', '#f0efe9'];
const MAX_DOTS = 10;

function seeds(count: number, offset: number) {
  const wrap = document.createElement('span');
  wrap.className = 'mc-seeds';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < Math.min(count, MAX_DOTS); i++) {
    const dot = document.createElement('i');
    dot.style.background = SEED_COLORS[(i + offset) % SEED_COLORS.length];
    wrap.append(dot);
  }
  return wrap;
}

function fill(cell: HTMLElement, count: number, index: number) {
  const number = document.createElement('b');
  number.className = 'mc-count';
  number.textContent = String(count);
  cell.append(seeds(count, index), number);
}

/**
 * Replays the last sowing: a seed hops from the emptied pit through each sown pit (a tick and a bump per seed),
 * then a capture flash and an extra-turn badge. Returns how long it takes in ms.
 */
function sowFx(game: MancalaState, cells: Map<number, HTMLElement>, wood: HTMLElement, origin: number) {
  const path = game.lastSow;
  const beat = Math.max(40, gap(path.length, 600, 110));
  path.forEach((index, i) => {
    const cell = cells.get(index);
    if (cell) delay(cell, (i + 1) * beat - 40).classList.add('mc-hit');
    if (i < 24) cue('sow', (i + 1) * beat);
  });
  let end = path.length * beat;
  const from = cells.get(origin);
  if (from && !calm()) {
    const flyer = document.createElement('i');
    flyer.className = 'mc-flyer';
    flyer.setAttribute('aria-hidden', 'true');
    wood.append(flyer);
    const at = (element: HTMLElement) => centre(element, wood);
    const start = at(from);
    const frames: Keyframe[] = [{ transform: `translate(${start.x}px, ${start.y}px) scale(1)`, offset: 0 }];
    let prev = start;
    path.forEach((index, i) => {
      const cell = cells.get(index);
      if (!cell) return;
      const next = at(cell);
      frames.push({ transform: `translate(${(prev.x + next.x) / 2}px, ${(prev.y + next.y) / 2 - 10}px) scale(1.45)`, offset: (i + 0.5) / path.length });
      frames.push({ transform: `translate(${next.x}px, ${next.y}px) scale(1)`, offset: (i + 1) / path.length });
      prev = next;
    });
    const run = motion(flyer, frames, { duration: end, easing: 'linear' });
    if (run) run.onfinish = () => flyer.remove(); else flyer.remove();
  }
  if (game.captured) {
    const last = path[path.length - 1];
    for (const index of [last, opposite(last), STORE[game.last!.seat]]) {
      const cell = cells.get(index);
      if (cell) delay(cell, end + 40).classList.add('mc-capture');
    }
    cue('capture', end + 40);
    end += 380;
  }
  if (game.extraTurn) {
    const badge = delay(document.createElement('span'), end);
    badge.className = 'mc-extra';
    badge.textContent = '한 번 더!';
    badge.setAttribute('aria-hidden', 'true');
    badge.addEventListener('animationend', () => badge.remove());
    wood.append(badge);
    cue('extra', end);
    end += 250;
  }
  return end;
}

export function render(ctx: TableRenderContext<MancalaState>) {
  const { game, me } = ctx;
  const them = 1 - me;
  const sown = new Set(game.lastSow);
  const origin = game.last ? pitIndex(game.last.seat, game.last.pit) : -1;
  const live = !ctx.preview && ctx.playing && ctx.canAct && game.turn === me;
  const step = track('mancala', ctx, g => g.moves, 1);
  const fresh = !!step?.prev && !!game.last && game.lastSow.length > 0;
  const cells = new Map<number, HTMLElement>();

  ctx.board.className = 'mancala-board';
  const wood = document.createElement('div');
  wood.className = 'mc-wood';

  const store = (seat: number, side: 'me' | 'them') => {
    const cell = document.createElement('div');
    const index = STORE[seat];
    cell.className = `mc-store mc-store-${side}${sown.has(index) ? ' mc-sown' : ''}`;
    cell.setAttribute('aria-label', `${ctx.playerName(seat)} 창고, 씨앗 ${game.pits[index]}개`);
    fill(cell, game.pits[index], index);
    cells.set(index, cell);
    wood.append(cell);
  };

  const pit = (seat: number, relative: number, row: 'top' | 'bottom', column: number) => {
    const index = pitIndex(seat, relative);
    const count = game.pits[index];
    const mine = seat === me;
    const button = mine && live && count > 0;
    const cell = document.createElement(button ? 'button' : 'div');
    cell.className = `mc-pit mc-${row}`;
    if (sown.has(index)) cell.classList.add('mc-sown');
    if (index === origin) cell.classList.add('mc-origin');
    cell.style.setProperty('--c', String(column));
    const label = `${mine ? '내' : '상대'} ${relative + 1}번 칸, 씨앗 ${count}개`;
    cell.setAttribute('aria-label', label);
    if (mine) {
      const tag = document.createElement('small');
      tag.className = 'mc-tag';
      tag.textContent = String(relative + 1);
      cell.append(tag);
    }
    fill(cell, count, index);
    cells.set(index, cell);
    if (button) {
      const element = cell as HTMLButtonElement;
      element.type = 'button';
      element.addEventListener('click', () =>
        ctx.choose({ type: 'sow', pit: relative }, `${relative + 1}번 칸 뿌리기`, element));
    }
    wood.append(cell);
  };

  store(them, 'them');
  // Opponent row runs right to left so sowing goes counter-clockwise on screen.
  for (let column = 1; column <= PITS; column++) pit(them, PITS - column, 'top', column);
  for (let column = 1; column <= PITS; column++) pit(me, column - 1, 'bottom', column);
  store(me, 'me');
  ctx.board.append(wood);
  const settle = fresh ? sowFx(game, cells, wood, origin) : 0;

  // Toolbar: store totals and feedback on the last move.
  ctx.toolbar.hidden = false;
  const bar = document.createElement('div');
  bar.className = 'mc-toolbar';
  for (const seat of [me, them]) {
    const score = document.createElement('span');
    score.className = `mc-score${!ctx.preview && ctx.playing && game.turn === seat ? ' mc-active' : ''}`;
    const name = document.createElement('span');
    name.textContent = `${ctx.playerName(seat)}${seat === me ? ' (나)' : ''}`;
    const value = document.createElement('b');
    value.textContent = String(game.pits[STORE[seat]]);
    score.append(name, value);
    bar.append(score);
  }
  if (!ctx.preview && game.last) {
    const note = document.createElement('span');
    note.className = 'mc-note';
    const who = ctx.playerName(game.last.seat);
    const parts = [`${who}: ${game.last.pit + 1}번 칸`];
    if (game.captured) parts.push(`${game.captured}개 가져옴`);
    if (game.extraTurn) parts.push('한 번 더');
    note.textContent = parts.join(' · ');
    bar.append(note);
  }
  if (!ctx.preview) bar.append(soundToggle());
  ctx.toolbar.append(bar);

  if (!ctx.preview && ctx.playing && game.winner === null && !game.draw && game.extraTurn) {
    const name = ctx.playerName(game.turn);
    ctx.setTurn(game.turn === me
      ? `${name} 차례 · 창고에 끝나 한 번 더 둡니다`
      : `${name} 차례 · 한 번 더 둡니다`);
  }
  turnCues(ctx, step, settle);
}

export const COVER: TableCover = {
  colors: ['#4a2812', '#ffbe68', '#f2b134'],
  // Key art: a carved board in perspective, glass seeds in the pits and three seeds dropping into one.
  art: (() => {
    const M = [.99, -.085, .14, .6, 176, 80];
    const at = (x: number, y: number) => [M[4] + M[0] * x + M[2] * y, M[5] + M[1] * x + M[3] * y];
    const f = (n: number) => n.toFixed(1);
    const seed = (x: number, y: number, k: number, r = 3.3) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="url(#@s${k % 4})"/>`;
    const board = (dy: number, fill: string) => `<rect x="-92" y="-44" width="184" height="88" rx="40" fill="${fill}" transform="matrix(${M.slice(0, 5).join(' ')} ${M[5] + dy})"/>`;
    let pits = '', seeds = '';
    for (let i = 0; i < 6; i++) for (const y of [-19, 19]) {
      const x = -58.75 + i * 23.5, n = i === 4 && y > 0 ? 1 : (i * 5 + (y > 0 ? 2 : 0)) % 4 % 2 + 1 + (i === 1 && y < 0 ? 1 : 0);
      pits += `<circle cx="${x}" cy="${y}" r="11.5" fill="url(#@pt)"/>`;
      const [cx, cy] = at(x, y + 2);
      for (let s = 0; s < n; s++) seeds += seed(cx + [-3.2, 3.2, 0][s], cy + [0, .6, -2.2][s], i + s + (y > 0 ? 2 : 0));
    }
    for (const x of [-78, 78]) {
      pits += `<rect x="${x - 9}" y="-32" width="18" height="64" rx="9" fill="url(#@pt)"/>`;
      for (let s = 0; s < 3; s++) { const [cx, cy] = at(x + (s % 2 ? 2.6 : -2.6), -14 + s * 13); seeds += seed(cx, cy, (x > 0 ? 2 : 0) + s); }
    }
    const [hx, hy] = at(35.25, 21);
    const glass = SEED_COLORS.slice(0, 4).map((c, k) => `<radialGradient id="@s${k}" fx=".35" fy=".3"><stop stop-color="#fff"/><stop offset=".35" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".8"/></radialGradient>`).join('');
    return `<defs>${glass}<linearGradient id="@wd" x2="1" y2="1"><stop stop-color="#e8ab68"/><stop offset=".5" stop-color="#b06b34"/><stop offset="1" stop-color="#6e3a17"/></linearGradient>`
      + `<radialGradient id="@pt" fy=".3"><stop stop-color="#1c0c03"/><stop offset=".75" stop-color="#3e1f0c"/><stop offset="1" stop-color="#8a5226"/></radialGradient></defs>`
      + `<ellipse cx="176" cy="118" rx="104" ry="14" fill="#000" opacity=".6" filter="url(#@bl)"/>`
      + board(9, '#2a1406') + board(4.5, '#53290f') + board(0, 'url(#@wd)')
      + `<g transform="matrix(${M.join(' ')})">${pits}<path d="M-64-38Q0-42 64-38" stroke="#ffd29a" stroke-opacity=".4"/></g>${seeds}`
      + `<circle cx="${f(hx)}" cy="${f(hy - 30)}" r="22" fill="#ffd27a" opacity=".4" filter="url(#@gw)"/>`
      + `<path d="M${f(hx - 3)} ${f(hy - 60)}v10M${f(hx + 4)} ${f(hy - 47)}v9M${f(hx - 1)} ${f(hy - 33)}v7" stroke="#fff2d0" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>`
      + seed(hx - 3, hy - 45, 1, 4) + seed(hx + 4, hy - 33, 2, 4) + seed(hx - 1, hy - 21, 3, 4)
      + `<path d="M${f(hx + 16)} ${f(hy - 52)}l2-6 2 6 6 2-6 2-2 6-2-6-6-2z" fill="#fff"/>`;
  })(),
};
