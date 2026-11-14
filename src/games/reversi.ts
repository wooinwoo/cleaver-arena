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
  colors: ['#13482d', '#8ff0b0', '#7fe0a0'],
  // Key art: a tilted board in mid-game with one disc flipping in the air above its landing square.
  art: (() => {
    const at = (u: number, v: number) => [178 + (u - v) * .98, 42 + (u + v) * .38];
    const d = (p: number[][]) => 'M' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
    const [T, R, B, L] = [at(0, 0), at(100, 0), at(100, 100), at(0, 100)];
    const down = ([x, y]: number[]) => [x, y + 8];
    const grid = [1, 2, 3, 4, 5, 6, 7].map(k => `M${k * 12.5} 0V100M0 ${k * 12.5}H100`).join('');
    const disc = ([i, j, white]: number[]) => {
      const [x, y] = at((i + .5) * 12.5, (j + .5) * 12.5);
      return `<ellipse cx="${x.toFixed(1)}" cy="${(y + 1.8).toFixed(1)}" rx="6.2" ry="3.3" fill="${white ? '#15191a' : '#d9d5c8'}"/>`
        + `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="6.2" ry="3.3" fill="url(#@${white ? 'dw' : 'db'})"/>`;
    };
    const [lx, ly] = at(5.5 * 12.5, 2.5 * 12.5);
    return `<defs><linearGradient id="@rv" x2="1" y2="1"><stop stop-color="#4fbf7f"/><stop offset=".55" stop-color="#23824f"/><stop offset="1" stop-color="#145a35"/></linearGradient>`
      + `<radialGradient id="@dw" fx=".62" fy=".25"><stop stop-color="#fff"/><stop offset=".6" stop-color="#eeeadf"/><stop offset="1" stop-color="#b3ae9e"/></radialGradient>`
      + `<radialGradient id="@db" fx=".62" fy=".25"><stop stop-color="#66706d"/><stop offset=".55" stop-color="#1c2120"/><stop offset="1" stop-color="#060807"/></radialGradient></defs>`
      + `<ellipse cx="178" cy="122" rx="112" ry="13" fill="#000" opacity=".55" filter="url(#@bl)"/>`
      + `<path d="${d([L, B, down(B), down(L)])}" fill="#06190f"/><path d="${d([B, R, down(R), down(B)])}" fill="#0f3a24"/><path d="${d([T, R, B, L])}" fill="url(#@rv)"/>`
      + `<g transform="matrix(.98 .38 -.98 .38 178 42)"><path d="${grid}" stroke="#0b3a22" stroke-width="1.1"/><rect x="1" y="1" width="98" height="98" stroke="#b6f7cf" stroke-opacity=".45"/></g>`
      + [[3, 3, 1], [4, 3, 0], [3, 4, 0], [4, 4, 1], [5, 3, 0], [2, 4, 1], [5, 5, 0], [3, 5, 0], [4, 5, 1], [2, 2, 0], [5, 4, 1], [4, 2, 0], [6, 4, 0], [2, 5, 1]].map(disc).join('')
      + `<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="9" ry="4.4" fill="#000" opacity=".5" filter="url(#@bl)"/><ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="8" ry="4" stroke="#d8ffe6" stroke-opacity=".8" stroke-width="1.2"/>`
      + `<circle cx="214" cy="36" r="30" fill="#e6fff0" opacity=".35" filter="url(#@gw)"/><path d="M178 58Q176 30 196 20M244 52Q252 34 238 22" stroke="#e6fff0" stroke-opacity=".5" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>`
      + `<g transform="translate(214 36) rotate(-24)"><ellipse cy="3.5" rx="22" ry="8.5" fill="#0d1010"/><path d="M-22 0v3.5a22 8.5 0 0 0 44 0V0Z" fill="#202625"/><ellipse rx="22" ry="8.5" fill="url(#@dw)"/><path d="M-14-4.5Q0-9 14-5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></g>`
      + `<path d="M246 22l2-6 2 6 6 2-6 2-2 6-2-6-6-2z" fill="#fff"/>`;
  })(),
};
