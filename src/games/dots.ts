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
  colors: ['#1e293b', '#f1f5f9', '#2563eb'],
  art: coverArt,
};
