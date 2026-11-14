import './reversi.css';
import type { TableCover, TableRenderContext } from './types.ts';
import { reversiMoves, type ReversiState } from '../../shared/reversi.ts';
import { finished } from '../../shared/tabletop-types.ts';

const COLOR = ['흑', '백'];

export function render(ctx: TableRenderContext<ReversiState>) {
  const { game, board } = ctx;
  board.className = 'reversi-board';
  const active = ctx.canAct && !ctx.preview && !finished(game) && game.turn === ctx.me;
  const legal = new Set(active ? reversiMoves(game, ctx.me) : []);
  const flipped = new Set(game.flipped);

  game.board.forEach((owner, index) => {
    const r = Math.floor(index / 8), c = index % 8;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-cell';
    button.dataset.cell = String(index);
    const what = owner === null ? (legal.has(index) ? '둘 수 있는 칸' : '빈칸') : `${COLOR[owner]}돌`;
    button.setAttribute('aria-label', `${r + 1}행 ${c + 1}열 ${what}`);
    if (owner !== null) {
      const disc = document.createElement('span');
      disc.className = `reversi-disc reversi-disc-${owner}`;
      if (flipped.has(index)) disc.classList.add('reversi-flipped');
      button.append(disc);
    } else if (legal.has(index)) {
      const hint = document.createElement('span');
      hint.className = 'reversi-hint';
      button.append(hint);
    }
    if (index === game.last) button.classList.add('reversi-last');
    button.disabled = !legal.has(index);
    if (legal.has(index)) button.onclick = () => ctx.choose({ type: 'place', r, c }, `${r + 1}행 ${c + 1}열에 두기`, button);
    board.append(button);
  });

  ctx.toolbar.hidden = false;
  ctx.toolbar.replaceChildren(...[0, 1].map(seat => {
    const item = document.createElement('span');
    item.className = `reversi-count${game.turn === seat && !finished(game) ? ' reversi-count-turn' : ''}`;
    const disc = document.createElement('i');
    disc.className = `reversi-disc reversi-disc-${seat}`;
    const label = document.createElement('span');
    label.textContent = `${ctx.playerName(seat)} (${COLOR[seat]})`;
    const count = document.createElement('strong');
    count.textContent = String(game.counts[seat]);
    item.append(disc, label, count);
    return item;
  }));

  if (ctx.playing && !finished(game) && game.passed !== null) {
    const mine = game.turn === ctx.me;
    ctx.setTurn(`${ctx.playerName(game.passed)} (${COLOR[game.passed]}) 둘 곳 없음 · ${mine ? '다시 내 차례' : `${ctx.playerName(game.turn)} 차례`}`);
  }
}

/** Disc on the tilted cover board at column `col`, row `row` (0-7). */
function disc(col: number, row: number, seat: number) {
  const bx = -54.25 + col * 15.5, by = -54.25 + row * 15.5;
  const x = (150 + (bx - by) * 0.7071).toFixed(1), y = 72 + (bx + by) * 0.7071 * 0.62;
  return `<ellipse cx="${x}" cy="${(y + 2).toFixed(1)}" rx="7.5" ry="4.6" fill="#0006"/>`
    + `<ellipse cx="${x}" cy="${y.toFixed(1)}" rx="7.5" ry="4.6" fill="${seat ? '#f3f1e6' : '#1f2a2c'}"/>`;
}

export const COVER: TableCover = {
  colors: ['#5f9e78', '#d3ead2', '#7fe0a0'],
  art: `<g transform="translate(150 79) scale(1 .62) rotate(45)"><rect x="-62" y="-62" width="124" height="124" rx="8" fill="#234c36"/></g>`
    + `<g transform="translate(150 72) scale(1 .62) rotate(45)">`
    + `<rect x="-62" y="-62" width="124" height="124" rx="8" fill="#2f7a4f"/>`
    + `<path d="M-46.5-62v124M-31-62v124M-15.5-62v124M0-62v124M15.5-62v124M31-62v124M46.5-62v124`
    + `M-62-46.5h124M-62-31h124M-62-15.5h124M-62 0h124M-62 15.5h124M-62 31h124M-62 46.5h124" stroke="#24603d" stroke-width="1.5"/></g>`
    + [[3, 3, 1], [4, 3, 0], [3, 4, 0], [4, 4, 1], [5, 3, 0], [2, 4, 1], [5, 5, 0], [3, 5, 0]]
      .map(([col, row, seat]) => disc(col, row, seat)).join('')
    + `<g transform="translate(240 40)"><ellipse cx="0" cy="5" rx="16" ry="9" fill="#0003"/><ellipse cx="0" cy="2" rx="16" ry="9" fill="#1f2a2c"/><ellipse cx="0" cy="-2" rx="16" ry="9" fill="#f3f1e6"/></g>`,
};
