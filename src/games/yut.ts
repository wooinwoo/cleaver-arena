import type { TableCover, TableRenderContext } from './types.ts';
import {
  type YutState, YUT_COLORS, YUT_COLOR_NAMES, YUT_DONE, YUT_HOME, YUT_LINES, YUT_NAMES, YUT_POINTS, yutTargets,
} from '../../shared/yut.ts';
import './yut.css';

export const COVER: TableCover = {
  colors: ['#5a1e16', '#ffc27a', '#c0392b'],
  // Key art: four sticks tumbling in the air over a red mat printed with the yut board.
  art: (() => {
    const stick = ([x, y, rot, flat, mark]: number[]) => `<ellipse cx="${x + 4}" cy="${110 + (x - 196) * .04}" rx="18" ry="3.2" fill="#000" opacity=".45" filter="url(#@bl)"/>`
      + `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-6" y="-31" width="12" height="62" rx="6" fill="url(#@${flat ? 'sf' : 'sr'})"/>`
      + (flat ? `<path d="M-1.5-23V23" stroke="#c99a5a" stroke-opacity=".5"/>` : `<path d="M2.4-25V25" stroke="#fff" stroke-opacity=".3" stroke-width="1.5"/>`)
      + (mark ? `<path d="M-3.2-20l6.4 5.5m0-5.5-6.4 5.5M-3.2 14.5l6.4 5.5m0-5.5-6.4 5.5" stroke="#3b2414" stroke-width="2" stroke-linecap="round"/>` : '') + '</g>';
    return `<defs><linearGradient id="@sf" x2="1" y2="0"><stop stop-color="#d9bb85"/><stop offset=".45" stop-color="#f6e6c2"/><stop offset="1" stop-color="#fffaea"/></linearGradient>`
      + `<linearGradient id="@sr" x2="1" y2="0"><stop stop-color="#4a230b"/><stop offset=".55" stop-color="#a8622c"/><stop offset=".8" stop-color="#dc9a5a"/><stop offset="1" stop-color="#8a4a1c"/></linearGradient>`
      + `<radialGradient id="@mt" cx=".55" cy=".35" r=".7"><stop stop-color="#e2533f"/><stop offset=".6" stop-color="#a8281e"/><stop offset="1" stop-color="#5e110c"/></radialGradient></defs>`
      + `<ellipse cx="178" cy="122" rx="120" ry="14" fill="#000" opacity=".55" filter="url(#@bl)"/><ellipse cx="178" cy="114" rx="118" ry="25" fill="#3a0a06"/>`
      + `<g transform="translate(178 109) scale(1 .21)"><circle r="118" fill="url(#@mt)"/><circle r="108" stroke="#f2d9a2" stroke-opacity=".5" stroke-width="4" stroke-dasharray="9 7"/>`
      + `<g stroke="#f6d48e" stroke-opacity=".55"><circle r="64" stroke-width="6"/><circle r="64" stroke-width="20" stroke-dasharray="0 20.1" stroke-linecap="round"/><path d="M-45-45 45 45M45-45-45 45" stroke-width="5"/></g></g>`
      + `<path d="M118 82Q120 54 138 40M204 26Q218 18 232 22M262 60Q270 48 266 34" stroke="#ffe2b0" stroke-opacity=".5" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>`
      + `<circle cx="196" cy="50" r="40" fill="#ffd9a0" opacity=".3" filter="url(#@gw)"/>`
      + [[146, 60, -38, 1, 1], [182, 46, 10, 0, 0], [214, 66, 50, 1, 0], [246, 46, -16, 0, 0]].map(stick).join('')
      + `<path d="M226 22l2-5 2 5 5 2-5 2-2 5-2-5-5-2z" fill="#fff"/>`;
  })(),
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
