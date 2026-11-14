import type { TableCover, TableRenderContext } from './types.ts';
import { COLOR_NAMES, COLS, ROWS, landingRow, type ConnectFourState } from '../../shared/connect4.ts';
import './connect4.css';

export function render(ctx: TableRenderContext<ConnectFourState>) {
  const { board, toolbar, game } = ctx;
  board.className = 'connect4-board';
  const line = new Set(game.line ?? []);
  const active = ctx.canAct && !ctx.preview;
  for (let c = 0; c < COLS; c++) {
    const column = document.createElement('button');
    column.type = 'button';
    column.className = 'c4-col';
    column.setAttribute('aria-label', `${c + 1}열에 떨어뜨리기`);
    const landing = landingRow(game.board, c);
    column.disabled = !active || landing < 0;
    for (let r = 0; r < ROWS; r++) {
      const index = r * COLS + c;
      const cell = document.createElement('span');
      cell.className = 'c4-cell';
      const value = game.board[index];
      if (value !== null) cell.classList.add(`c4-disc-${value}`);
      if (index === game.last) cell.classList.add('c4-last');
      if (line.has(index)) cell.classList.add('c4-win');
      if (r === landing && active) cell.classList.add('c4-landing', `c4-ghost-${game.turn}`);
      column.append(cell);
    }
    if (active && landing >= 0) {
      column.addEventListener('click', () => ctx.choose({ type: 'drop', c }, `${c + 1}열에 놓기`, column));
    }
    board.append(column);
  }

  toolbar.hidden = false;
  for (const seat of [0, 1]) {
    const tag = document.createElement('span');
    tag.className = `c4-player${game.turn === seat && !game.draw && game.winner === null ? ' c4-turn' : ''}`;
    const dot = document.createElement('i');
    dot.className = `c4-dot c4-disc-${seat}`;
    tag.append(dot, `${COLOR_NAMES[seat]} · ${ctx.playerName(seat)}`);
    toolbar.append(tag);
  }
}

const discs = (() => {
  // Fixed mid-game position on the cover grid (rows top to bottom).
  const layout = [
    '.......',
    '.......',
    '...1...',
    '..00...',
    '..110..',
    '.10010.',
  ];
  let svg = '';
  layout.forEach((row, r) => [...row].forEach((v, c) => {
    const fill = v === '0' ? '#e0483e' : v === '1' ? '#f5c638' : '#13284a';
    svg += `<circle cx="${102 + c * 16}" cy="${27 + r * 16}" r="6" fill="${fill}"/>`;
  }));
  return svg;
})();

export const COVER: TableCover = {
  colors: ['#14305c', '#5b8ad6', '#f5c638'],
  art: `<rect x="90" y="15" width="120" height="104" rx="8" fill="#2d5fb3"/>`
    + `<rect x="84" y="117" width="14" height="10" rx="2" fill="#244e94"/><rect x="202" y="117" width="14" height="10" rx="2" fill="#244e94"/>`
    + discs
    + `<circle cx="150" cy="7" r="6" fill="#f5c638"/>`,
};
