import './dots.css';
import type { TableCover, TableRenderContext } from './types.ts';
import { SIZE, lineIndex, type DotsState, type LineDir } from '../../shared/dots.ts';

/** Per-seat colours, readable on a light background. Keep in sync with dots.css. */
const COLORS = ['#2563eb', '#dc2626', '#15803d', '#c2410c'];

function place(element: HTMLElement, row: number, col: number) {
  element.style.gridRow = String(row + 1);
  element.style.gridColumn = String(col + 1);
}

export function render(ctx: TableRenderContext<DotsState>) {
  const game = ctx.game;
  const board = ctx.board;
  board.className = 'dots-board';
  const interactive = ctx.canAct && !ctx.preview;
  const last = game.last;

  for (let r = 0; r <= SIZE; r++) for (let c = 0; c <= SIZE; c++) {
    const dot = document.createElement('span');
    dot.className = 'dots-dot';
    place(dot, 2 * r, 2 * c);
    board.append(dot);
  }

  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const owner = game.boxes[r * SIZE + c];
    const box = document.createElement('span');
    box.className = 'dots-box';
    place(box, 2 * r + 1, 2 * c + 1);
    if (owner !== null) {
      box.classList.add(`seat-${owner}`);
      if (game.claimed.includes(r * SIZE + c)) box.classList.add('fresh');
      box.textContent = ctx.playerName(owner).trim().slice(0, 1) || String(owner + 1);
      box.setAttribute('aria-label', `${r + 1}행 ${c + 1}열 상자 · ${ctx.playerName(owner)}`);
    }
    board.append(box);
  }

  const addLine = (dir: LineDir, r: number, c: number) => {
    const owner = (dir === 'h' ? game.h : game.v)[lineIndex(dir, r, c)];
    const label = `${r + 1}행 ${c + 1}열 ${dir === 'h' ? '가로' : '세로'} 선`;
    const open = owner === null && interactive;
    const element = document.createElement(open ? 'button' : 'span');
    element.className = `dots-line line-${dir}`;
    place(element, dir === 'h' ? 2 * r : 2 * r + 1, dir === 'h' ? 2 * c + 1 : 2 * c);
    if (owner !== null) {
      element.classList.add('drawn', `seat-${owner}`);
      if (last && last.dir === dir && last.r === r && last.c === c) element.classList.add('last');
      element.setAttribute('aria-label', `${label} · ${ctx.playerName(owner)}`);
    } else if (open) {
      const button = element as HTMLButtonElement;
      button.type = 'button';
      button.classList.add('open', `seat-${ctx.me}`);
      button.setAttribute('aria-label', `${label} 긋기`);
      button.onclick = () => ctx.choose({ type: 'line', dir, r, c }, `${label} 긋기`, button);
    }
    board.append(element);
  };
  for (let r = 0; r <= SIZE; r++) for (let c = 0; c < SIZE; c++) addLine('h', r, c);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c <= SIZE; c++) addLine('v', r, c);

  const toolbar = ctx.toolbar;
  toolbar.hidden = false;
  toolbar.replaceChildren();
  const scores = document.createElement('div');
  scores.className = 'dots-scores';
  game.scores.forEach((score, seat) => {
    const chip = document.createElement('span');
    chip.className = `dots-score seat-${seat}`;
    if (seat === game.turn && game.winner === null && !game.draw) chip.classList.add('turn');
    if (seat === game.winner) chip.classList.add('winner');
    const swatch = document.createElement('i');
    swatch.className = 'dots-swatch';
    const name = document.createElement('span');
    name.className = 'dots-name';
    name.textContent = ctx.playerName(seat) + (seat === ctx.me && !ctx.preview ? ' (나)' : '');
    const value = document.createElement('strong');
    value.textContent = String(score);
    chip.append(swatch, name, value);
    chip.setAttribute('aria-label', `${ctx.playerName(seat)} 상자 ${score}개`);
    scores.append(chip);
  });
  toolbar.append(scores);
}

const coverArt = (() => {
  const step = 24, x0 = 102, y0 = 10;
  const parts: string[] = [];
  const boxes: [number, number, number][] = [[0, 0, 0], [0, 1, 0], [1, 3, 1], [2, 2, 2], [3, 0, 3], [3, 1, 3]];
  for (const [r, c, seat] of boxes) {
    parts.push(`<rect x="${x0 + c * step + 2}" y="${y0 + r * step + 2}" width="${step - 4}" height="${step - 4}" rx="3" fill="${COLORS[seat]}" opacity="0.35"/>`);
  }
  const lines: [LineDir, number, number, number][] = [
    ['h', 0, 0, 0], ['h', 0, 1, 0], ['h', 1, 0, 0], ['h', 1, 1, 0], ['v', 0, 0, 0], ['v', 0, 1, 0], ['v', 0, 2, 0],
    ['h', 1, 3, 1], ['h', 2, 3, 1], ['v', 1, 3, 1], ['v', 1, 4, 1],
    ['h', 2, 2, 2], ['h', 3, 2, 2], ['v', 2, 2, 2], ['v', 2, 3, 2],
    ['h', 3, 0, 3], ['h', 3, 1, 3], ['h', 4, 0, 3], ['h', 4, 1, 3], ['v', 3, 0, 3], ['v', 3, 1, 3], ['v', 3, 2, 3],
    ['h', 0, 3, 1], ['v', 1, 0, 2], ['h', 2, 0, 0], ['v', 0, 4, 3],
  ];
  for (const [dir, r, c, seat] of lines) {
    const x1 = x0 + c * step, y1 = y0 + r * step;
    const [x2, y2] = dir === 'h' ? [x1 + step, y1] : [x1, y1 + step];
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS[seat]}" stroke-width="4" stroke-linecap="round"/>`);
  }
  for (let r = 0; r <= 5; r++) for (let c = 0; c <= 4; c++) {
    parts.push(`<circle cx="${x0 + c * step}" cy="${y0 + r * step}" r="3.2" fill="#1f2937"/>`);
  }
  return parts.join('');
})();

export const COVER: TableCover = {
  colors: ['#1e2f52', '#9cc0ff', '#2563eb'],
  // Key art: a sheet of paper in perspective, a pencil closing the last side of a box.
  art: (() => {
    const M = [1.45, .12, -.56, .52, 135, 50];
    const [tx, ty] = [M[4] + M[0] * 54 + M[2] * 31, M[5] + M[1] * 54 + M[3] * 31].map(n => n.toFixed(1));
    const [blue, red] = COLORS;
    return `<defs><linearGradient id="@pp" x2="1" y2="1"><stop stop-color="#ffffff"/><stop offset=".6" stop-color="#eef2f7"/><stop offset="1" stop-color="#c9d2de"/></linearGradient>`
      + `<pattern id="@dt" x="-9" y="-9" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="2" fill="#1f2937"/></pattern>`
      + `<linearGradient id="@pc" x2="0" y2="1"><stop stop-color="#ffe17a"/><stop offset=".45" stop-color="#f5b82e"/><stop offset=".5" stop-color="#e09a12"/><stop offset="1" stop-color="#b8740a"/></linearGradient></defs>`
      + `<ellipse cx="180" cy="112" rx="104" ry="14" fill="#000" opacity=".55" filter="url(#@bl)"/>`
      + `<g transform="matrix(${M.join(' ')})"><rect x="-10" y="-8" width="112" height="94" fill="#aeb8c6" transform="rotate(-4 45 36)"/><rect x="-12" y="-12" width="114" height="96" fill="url(#@pp)"/>`
      + `<path d="M-12 0H102M-12 18H102M-12 36H102M-12 54H102M-12 72H102" stroke="#8fb3e8" stroke-opacity=".35" stroke-width=".6" transform="translate(0 9)"/>`
      + `<path d="M1 1h34v16H1zM1 19h16v16H1z" fill="${blue}" opacity=".2"/><path d="M55 37h34v16H55zM73 55h16v16H73z" fill="${red}" opacity=".2"/>`
      + `<rect x="37" y="19" width="16" height="16" fill="${blue}" opacity=".45"/><rect x="36" y="18" width="18" height="18" fill="#7fb0ff" opacity=".6" filter="url(#@bl)"/>`
      + `<path d="M0 0H36M0 0V36M18 0V36M36 0V36M0 18H54M0 36H54M72 0H90" stroke="${blue}" stroke-width="2.4" stroke-linecap="round"/>`
      + `<path d="M54 36H90M54 36V54M72 36V72M90 36V72M54 54H90M72 72H90M18 54V72M0 72H18" stroke="${red}" stroke-width="2.4" stroke-linecap="round"/>`
      + `<path d="M54 18V31" stroke="#5b9bff" stroke-width="5" opacity=".7" filter="url(#@bl)"/><path d="M54 18V31" stroke="${blue}" stroke-width="2.6" stroke-linecap="round"/>`
      + `<rect x="-4" y="-4" width="98" height="80" fill="url(#@dt)"/></g>`
      + `<ellipse cx="${(+tx + 30).toFixed(1)}" cy="${(+ty + 3).toFixed(1)}" rx="34" ry="4" fill="#000" opacity=".35" filter="url(#@bl)" transform="rotate(-12 ${tx} ${ty})"/>`
      + `<g transform="translate(${tx} ${ty}) rotate(-56)"><path d="M0 0 13-5.2V5.2Z" fill="#f1d3a4"/><path d="M0 0 4.4-1.8V1.8Z" fill="#2b2f36"/>`
      + `<rect x="13" y="-5.2" width="50" height="10.4" fill="url(#@pc)"/><path d="M13-1.8H63M13 1.8H63" stroke="#a96a08" stroke-opacity=".35"/>`
      + `<rect x="63" y="-5.4" width="9" height="10.8" fill="#c3cad3"/><path d="M66-5.4v10.8M69-5.4v10.8" stroke="#8b939e"/><rect x="72" y="-5.2" width="9" height="10.4" rx="3" fill="#f08aa0"/><path d="M14-4.4H62" stroke="#fff" stroke-opacity=".6"/></g>`
      + `<path d="M${tx} ${ty}m-12-10l2-5 2 5 5 2-5 2-2 5-2-5-5-2z" fill="#fff"/>`;
  })(),
};
