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
  colors: ['#14305c', '#6aa0ff', '#f5c638'],
  // Key art: the upright grid seen at an angle, a yellow disc dropping into the fourth column.
  art: (() => {
    const layout = ['.......', '.......', '...1...', '..00...', '..110..', '.10010.'];
    let discs = '';
    layout.forEach((row, r) => [...row].forEach((v, c) => {
      if (v !== '.') discs += `<circle cx="${16.5 + c * 17}" cy="${16.5 + r * 17}" r="7.8" fill="url(#@${v === '0' ? 'red' : 'yel'})"/>`;
    }));
    const disc = (id: string, a: string, b: string, c: string) => `<radialGradient id="@${id}" fx=".38" fy=".3"><stop stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`;
    return `<defs>${disc('red', '#ffa190', '#e0483e', '#8a1d18')}${disc('yel', '#fff4b8', '#f5c638', '#a5770e')}`
      + `<linearGradient id="@fr" x2="1" y2="1"><stop stop-color="#5d95f0"/><stop offset=".5" stop-color="#2d63c0"/><stop offset="1" stop-color="#173b80"/></linearGradient>`
      + `<pattern id="@hp" x="8" y="8" width="17" height="17" patternUnits="userSpaceOnUse"><rect width="17" height="17" fill="#fff"/><circle cx="8.5" cy="8.5" r="6.6" fill="#000"/></pattern>`
      + `<pattern id="@rm" x="8" y="8" width="17" height="17" patternUnits="userSpaceOnUse"><circle cx="8.5" cy="8.5" r="6.9" stroke="#0b2252" stroke-width="1.6"/><path d="M13.3 4.5a6.6 6.6 0 0 1 1.6 5" stroke="#bcd6ff" stroke-opacity=".7"/></pattern>`
      + `<mask id="@mk"><rect width="135" height="118" fill="#fff"/><rect x="8" y="8" width="119" height="102" fill="url(#@hp)"/></mask></defs>`
      + `<ellipse cx="180" cy="128" rx="80" ry="8" fill="#000" opacity=".55" filter="url(#@bl)"/>`
      + `<circle cx="186" cy="20" r="34" fill="#fff3b8" opacity=".3" filter="url(#@gw)"/>`
      + `<g transform="translate(122 34) scale(.82) skewY(-6)">`
      + `<path d="M2 128 12 114H26L32 128ZM103 128 109 114H123L133 128Z" fill="#163a7a"/>`
      + `<rect x="3" y="3" width="135" height="112" fill="#071431"/>${discs}`
      + `<path d="M135 0 143-6V112L135 118Z" fill="#0f2c63"/><path d="M0 0 8-6H143L135 0Z" fill="#7fb0ff"/>`
      + `<rect width="135" height="118" rx="3" fill="url(#@fr)" mask="url(#@mk)"/><rect x="8" y="8" width="119" height="102" fill="url(#@rm)"/>`
      + `<path d="M2 2H133" stroke="#d6e6ff" stroke-opacity=".7" stroke-width="1.5"/>`
      + `<path d="M77-34V-24M84.5-38V-24M92-34V-24" stroke="#fff3b8" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>`
      + `<circle cx="84.5" cy="-11" r="8.6" fill="url(#@yel)"/><path d="M79-15a7 7 0 0 1 7-3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></g>`
      + `<path d="M236 26l2-6 2 6 6 2-6 2-2 6-2-6-6-2z" fill="#fff"/>`;
  })(),
};
