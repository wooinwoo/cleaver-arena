import type { TableCover, TableRenderContext } from './types.ts';
import {
  type YutState, YUT_COLORS, YUT_COLOR_NAMES, YUT_DONE, YUT_HOME, YUT_LINES, YUT_NAMES, YUT_POINTS, yutTargets,
} from '../../shared/yut.ts';
import './yut.css';

export const COVER: TableCover = {
  colors: ['#4a2a17', '#e8cf9c', '#c0392b'],
  art: `
    <rect x="34" y="18" width="232" height="110" rx="14" fill="#b23a2e"/>
    <rect x="44" y="27" width="212" height="92" rx="9" fill="none" stroke="#f2d9a2" stroke-width="2" stroke-dasharray="6 5"/>
    <path d="M60 110 240 36M60 36l180 74" stroke="#8e2a21" stroke-width="2" opacity=".6"/>
    <g transform="rotate(-18 92 72)">
      <rect x="82" y="30" width="22" height="86" rx="11" fill="#f4e3c0" stroke="#6b3f1f" stroke-width="2.5"/>
      <path d="M86 52l14 8M100 52l-14 8M86 86l14 8M100 86l-14 8" stroke="#3b2414" stroke-width="2.5" stroke-linecap="round"/>
    </g>
    <g transform="rotate(-4 136 72)">
      <rect x="125" y="26" width="22" height="90" rx="11" fill="#f4e3c0" stroke="#6b3f1f" stroke-width="2.5"/>
      <path d="M131 44v54" stroke="#d6b98a" stroke-width="2"/>
    </g>
    <g transform="rotate(10 178 72)">
      <rect x="167" y="28" width="22" height="88" rx="11" fill="#9a5b2e" stroke="#5b3318" stroke-width="2.5"/>
      <path d="M173 40v62" stroke="#b87442" stroke-width="2"/>
    </g>
    <g transform="rotate(24 220 74)">
      <rect x="209" y="32" width="22" height="84" rx="11" fill="#f4e3c0" stroke="#6b3f1f" stroke-width="2.5"/>
      <path d="M215 46v54" stroke="#d6b98a" stroke-width="2"/>
    </g>`,
};

let picked = 0;
let pickedKey = '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function moveLabel(value: number, target: number | 'finish') {
  if (target === 'finish') return '말 내보내기';
  if (value === -1) return '빽도 · 1칸 뒤로';
  return `${YUT_NAMES[value]} · ${value}칸 이동`;
}

export function render(ctx: TableRenderContext<YutState>) {
  const { board, toolbar, game, me } = ctx;
  board.className = 'yut';
  const interactive = !ctx.preview && ctx.playing && ctx.canAct && game.turn === me && game.winner === null;
  const key = `${game.turn}:${game.stage}:${game.pending.join(',')}`;
  if (key !== pickedKey) { pickedKey = key; picked = 0; }
  if (picked >= game.pending.length) picked = 0;

  // Players: colour, name, pieces waiting / on board / finished.
  const players = el('div', 'yut-players');
  for (let seat = 0; seat < game.seats; seat++) {
    const pieces = game.pieces[seat];
    const row = el('div', 'yut-player');
    row.style.setProperty('--yut-color', YUT_COLORS[seat]);
    if (seat === game.turn && game.winner === null) row.classList.add('yut-turn');
    if (seat === game.winner) row.classList.add('yut-winner');
    const name = el('strong', '', ctx.preview ? `${YUT_COLOR_NAMES[seat]}` : ctx.playerName(seat));
    const home = pieces.filter(p => p === YUT_HOME).length, done = pieces.filter(p => p === YUT_DONE).length;
    row.append(el('span', 'yut-dot'), name,
      el('span', 'yut-counts', `대기 ${home} · 판 ${4 - home - done} · 완주 ${done}`));
    row.setAttribute('aria-label', `${YUT_COLOR_NAMES[seat]} ${name.textContent}: 대기 ${home}, 완주 ${done}`);
    players.append(row);
  }

  // Board.
  const mat = el('div', 'yut-mat');
  const field = el('div', 'yut-field');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('yut-lines');
  for (const [a, b] of YUT_LINES) {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(YUT_POINTS[a].x)); line.setAttribute('y1', String(YUT_POINTS[a].y));
    line.setAttribute('x2', String(YUT_POINTS[b].x)); line.setAttribute('y2', String(YUT_POINTS[b].y));
    svg.append(line);
  }
  field.append(svg);
  const pointEls: HTMLElement[] = [];
  const last = game.lastMove;
  YUT_POINTS.forEach((point, index) => {
    const dot = el('span', 'yut-point');
    if ([0, 5, 10, 15, 22].includes(index)) dot.classList.add('yut-major');
    if (index === 0) dot.classList.add('yut-start');
    if (last && last.to === index) dot.classList.add('yut-last-to');
    dot.style.left = `${point.x}%`; dot.style.top = `${point.y}%`;
    field.append(dot);
    pointEls.push(dot);
  });
  const startLabel = el('span', 'yut-start-label', '참먹이');
  field.append(startLabel);

  function clearDest() { pointEls.forEach(p => p.classList.remove('yut-dest')); board.querySelector('.yut-exit')?.classList.remove('yut-dest'); }
  function pick(piece: number, button: HTMLElement) {
    if (!interactive || game.stage !== 'move') return;
    const target = yutTargets(game, me, piece, picked);
    if (target === null) return;
    clearDest();
    if (target === 'finish') board.querySelector('.yut-exit')?.classList.add('yut-dest');
    else pointEls[target].classList.add('yut-dest');
    ctx.choose({ type: 'move', piece, result: picked }, moveLabel(game.pending[picked], target), button);
  }

  // Tokens: at most one seat per point (landing captures), stacked pieces show a count.
  for (let seat = 0; seat < game.seats; seat++) {
    const groups = new Map<number, number[]>();
    game.pieces[seat].forEach((position, piece) => {
      if (position >= 0 && position < YUT_DONE) groups.set(position, [...(groups.get(position) ?? []), piece]);
    });
    for (const [position, pieces] of groups) {
      const token = el('button', 'yut-token');
      token.type = 'button';
      token.style.left = `${YUT_POINTS[position].x}%`; token.style.top = `${YUT_POINTS[position].y}%`;
      token.style.setProperty('--yut-color', YUT_COLORS[seat]);
      const face = el('span', 'yut-face', pieces.length > 1 ? String(pieces.length) : '');
      token.append(face);
      token.setAttribute('aria-label', `${YUT_COLOR_NAMES[seat]} 말 ${pieces.length}개`);
      const usable = interactive && seat === me && game.stage === 'move' && yutTargets(game, me, pieces[0], picked) !== null;
      if (usable) { token.classList.add('yut-movable'); token.onclick = () => pick(pieces[0], token); }
      else token.disabled = true;
      field.append(token);
    }
  }
  mat.append(field);

  // My home and exit.
  const homeRow = el('div', 'yut-home');
  if (!ctx.preview && me >= 0 && me < game.seats) {
    const homePiece = game.pieces[me].indexOf(YUT_HOME);
    const homeCount = game.pieces[me].filter(p => p === YUT_HOME).length;
    const newPiece = el('button', 'yut-new');
    newPiece.type = 'button';
    newPiece.style.setProperty('--yut-color', YUT_COLORS[me]);
    newPiece.append(el('span', 'yut-face yut-face-small'), el('span', '', `새 말 (${homeCount})`));
    const canEnter = interactive && game.stage === 'move' && homePiece >= 0 && yutTargets(game, me, homePiece, picked) !== null;
    newPiece.disabled = !canEnter;
    if (canEnter) newPiece.onclick = () => pick(homePiece, newPiece);
    const exit = el('span', 'yut-exit', `완주 ${game.pieces[me].filter(p => p === YUT_DONE).length}/4`);
    homeRow.append(newPiece, exit);
  }

  const log = el('p', 'yut-log', game.log);
  board.append(players, mat, homeRow, log);

  // Status line.
  if (!ctx.preview) {
    if (game.winner !== null) ctx.setTurn(`${ctx.playerName(game.winner)} 승리`);
    else ctx.setTurn(`${ctx.playerName(game.turn)} 차례 · ${game.stage === 'throw' ? '윷을 던지세요' : '결과를 고르고 말을 누르세요'}`);
  }

  // Toolbar: last throw, pending chips, throw button.
  if (ctx.preview) return;
  toolbar.hidden = false;
  toolbar.replaceChildren();
  if (game.lastThrow) {
    const value = game.lastThrow.value;
    const extra = value >= 4 && game.lastThrow.seat === game.turn && game.stage === 'throw';
    toolbar.append(el('span', 'yut-last', `${YUT_COLOR_NAMES[game.lastThrow.seat]} ${YUT_NAMES[value]}${extra ? '! 한 번 더' : ''}`));
  }
  game.pending.forEach((value, index) => {
    const chip = el('button', 'yut-chip', YUT_NAMES[value]);
    chip.type = 'button';
    chip.title = value === -1 ? '1칸 뒤로' : `${value}칸`;
    const selectable = interactive && game.stage === 'move';
    if (selectable && index === picked) chip.classList.add('selected');
    chip.disabled = !selectable;
    if (selectable) chip.onclick = () => { picked = index; board.replaceChildren(); render(ctx); };
    toolbar.append(chip);
  });
  if (game.stage === 'throw' && game.winner === null) {
    const throwButton = el('button', 'yut-throw primary', '윷 던지기');
    throwButton.type = 'button';
    throwButton.disabled = !interactive;
    if (interactive) throwButton.onclick = () => { throwButton.disabled = true; ctx.act({ type: 'throw' }); };
    toolbar.append(throwButton);
  }
}
