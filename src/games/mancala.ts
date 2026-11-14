import './mancala.css';
import type { TableCover, TableRenderContext } from './types.ts';
import { type MancalaState, PITS, STORE, pitIndex } from '../../shared/mancala.ts';

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

export function render(ctx: TableRenderContext<MancalaState>) {
  const { game, me } = ctx;
  const them = 1 - me;
  const sown = new Set(game.lastSow);
  const origin = game.last ? pitIndex(game.last.seat, game.last.pit) : -1;
  const live = !ctx.preview && ctx.playing && ctx.canAct && game.turn === me;

  ctx.board.className = 'mancala-board';
  const wood = document.createElement('div');
  wood.className = 'mc-wood';

  const store = (seat: number, side: 'me' | 'them') => {
    const cell = document.createElement('div');
    const index = STORE[seat];
    cell.className = `mc-store mc-store-${side}${sown.has(index) ? ' mc-sown' : ''}`;
    cell.setAttribute('aria-label', `${ctx.playerName(seat)} 창고, 씨앗 ${game.pits[index]}개`);
    fill(cell, game.pits[index], index);
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
  ctx.toolbar.append(bar);

  if (!ctx.preview && ctx.playing && game.winner === null && !game.draw && game.extraTurn) {
    const name = ctx.playerName(game.turn);
    ctx.setTurn(game.turn === me
      ? `${name} 차례 · 창고에 끝나 한 번 더 둡니다`
      : `${name} 차례 · 한 번 더 둡니다`);
  }
}

const coverPits = (() => {
  const parts: string[] = [];
  let k = 0;
  for (const cy of [50, 92]) {
    for (let i = 0; i < 6; i++) {
      const cx = 72 + i * 31;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="13" fill="#5a3416"/><circle cx="${cx}" cy="${cy + 1.5}" r="11" fill="#3e220c"/>`);
      const n = 2 + ((i * 3 + cy) % 3);
      for (let s = 0; s < n; s++) {
        const a = (s / n) * Math.PI * 2 + i;
        const x = (cx + Math.cos(a) * 5).toFixed(1), y = (cy + 1 + Math.sin(a) * 5).toFixed(1);
        parts.push(`<circle cx="${x}" cy="${y}" r="3.2" fill="${SEED_COLORS[k++ % 5]}"/>`);
      }
    }
  }
  return parts.join('');
})();

export const COVER: TableCover = {
  colors: ['#3b2412', '#c98b4f', '#f2b134'],
  art: `<rect x="14" y="24" width="272" height="94" rx="40" fill="#8a5428"/>`
    + `<rect x="18" y="27" width="264" height="86" rx="36" fill="#a8693a"/>`
    + `<path d="M40 40 Q150 32 260 40" stroke="#c48552" stroke-width="2" fill="none" opacity=".6"/>`
    + `<path d="M36 102 Q150 110 264 100" stroke="#7a4721" stroke-width="2" fill="none" opacity=".6"/>`
    + `<rect x="26" y="38" width="28" height="66" rx="14" fill="#3e220c"/>`
    + `<rect x="246" y="38" width="28" height="66" rx="14" fill="#3e220c"/>`
    + `<circle cx="36" cy="62" r="3.4" fill="#e2574c"/><circle cx="43" cy="72" r="3.4" fill="#4fa3d9"/><circle cx="35" cy="82" r="3.4" fill="#6fbf73"/>`
    + `<circle cx="256" cy="56" r="3.4" fill="#f2b134"/><circle cx="264" cy="64" r="3.4" fill="#b67ad9"/><circle cx="255" cy="72" r="3.4" fill="#e2574c"/>`
    + `<circle cx="264" cy="80" r="3.4" fill="#4fa3d9"/><circle cx="257" cy="88" r="3.4" fill="#6fbf73"/>`
    + coverPits,
};
