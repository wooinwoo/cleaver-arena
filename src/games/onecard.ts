import './onecard.css';
import type { TableRenderContext, TableCover } from './types.ts';
import {
  type OneCardView, type OneCardSuit, ONECARD_SUITS, ONECARD_SUIT_SYMBOL, ONECARD_SUIT_NAME,
  oneCardInfo, oneCardName, oneCardPlayable,
} from '../../shared/onecard.ts';
import { centre, cue, delay, gap, motion, soundToggle, track, turnCues } from './fx.ts';

/** A 7 tapped in my hand, waiting for a suit choice in the toolbar. */
let pendingSeven: string | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Fills a card face (span or button) for `id`. */
function face(node: HTMLElement, id: string) {
  const info = oneCardInfo(id);
  node.classList.add('oc-card', info?.red ? 'oc-red' : 'oc-black');
  if (!info) return node;
  if (info.joker) {
    node.classList.add('oc-joker');
    node.append(el('b', 'oc-rank', '조커'), el('span', 'oc-suit', id === 'JC' ? '컬러' : '흑백'));
  } else {
    node.append(el('b', 'oc-rank', info.rank), el('span', 'oc-suit', ONECARD_SUIT_SYMBOL[info.suit!]));
  }
  node.setAttribute('aria-label', oneCardName(id));
  return node;
}

const oneBadge = () => el('span', 'oc-one', '원카드!');

/** Slides the played card from its owner to the pile, or fans drawn cards in from the deck. Returns ms taken. */
function playFx(game: OneCardView, prev: OneCardView, board: HTMLElement, me: number) {
  const play = game.lastPlay!;
  const owner = board.querySelector<HTMLElement>(play.seat === me ? '.oc-mine .oc-hand' : `.oc-opp[data-seat="${play.seat}"]`);
  const deck = board.querySelector<HTMLElement>('.oc-deck');
  const offset = (from: HTMLElement | null, to: Element) => {
    if (!from) return null;
    const a = centre(from, board), b = centre(to, board);
    return { x: a.x - b.x, y: a.y - b.y };
  };
  if (play.card) {
    const top = board.querySelector<HTMLElement>('.oc-top');
    const d = top && offset(owner, top);
    if (top && d) motion(top, [
      { transform: `translate(${d.x}px, ${d.y}px) rotate(${play.seat === me ? -10 : 10}deg) scale(.7)`, opacity: 0.4 },
      { transform: 'none', opacity: 1 },
    ], { duration: 300, easing: 'cubic-bezier(.2, .8, .3, 1)' });
    cue('card');
    let end = 300;
    if (game.attack > prev.attack) {
      const attack = board.querySelector<HTMLElement>('.oc-attack');
      if (attack) delay(attack, 280).classList.add('oc-shake');
      deck?.classList.add('oc-warn');
      cue('attack', 280);
      end = 620;
    }
    if (game.direction !== prev.direction) board.querySelector<HTMLElement>('.oc-dir')?.classList.add('oc-punch');
    if (play.seat === me && game.turn === me && prev.turn === me && game.winner === null) cue('extra', end);
    return end;
  }
  // Drawn cards are appended to the end of the hand (or of the opponent's row of backs).
  const drawn = play.drew;
  if (!drawn || !deck) return 0;
  const cards = [...board.querySelectorAll<HTMLElement>(play.seat === me ? '.oc-hand .oc-card' : `.oc-opp[data-seat="${play.seat}"] .oc-back`)].slice(-drawn);
  const beat = gap(cards.length, 360, 90);
  cards.forEach((card, i) => {
    const d = offset(deck, card);
    if (d) motion(card, [
      { transform: `translate(${d.x}px, ${d.y}px) rotate(${(i - cards.length / 2) * 8}deg) scale(.6)`, opacity: 0 },
      { opacity: 1, offset: 0.3 },
      { transform: 'none', opacity: 1 },
    ], { duration: 280, delay: i * beat, easing: 'cubic-bezier(.2, .8, .3, 1)', fill: 'backwards' });
  });
  for (let i = 0; i < Math.min(drawn, 8); i++) cue('draw', i * beat);
  return 280 + cards.length * beat;
}

export function render(ctx: TableRenderContext<OneCardView>): void {
  const { board, toolbar, game, me } = ctx;
  board.replaceChildren();
  board.className = 'onecard-board';
  const live = ctx.canAct && !ctx.preview;
  const playable = new Set(live ? oneCardPlayable(game, me) : []);
  if (!live || !pendingSeven || !playable.has(pendingSeven)) pendingSeven = null;
  const seats = game.counts.length;
  const step = track('onecard', ctx, g => Number(g.lastPlay !== null));
  const prev = step?.prev ?? null;

  // Opponents, in play order starting after me.
  const others = el('section', 'oc-others');
  for (let offset = 1; offset < seats; offset++) {
    const seat = (me + offset) % seats;
    const row = el('div', 'oc-opp');
    row.dataset.seat = String(seat);
    if (ctx.playing && game.turn === seat) row.classList.add('oc-turn');
    const head = el('div', 'oc-opp-head');
    head.append(el('strong', '', ctx.playerName(seat)), el('span', 'oc-count', `${game.counts[seat]}장`));
    if (game.counts[seat] === 1) head.append(oneBadge());
    if (game.winner === seat) head.append(el('span', 'oc-win', '승리'));
    row.append(head);
    const cards = el('div', 'oc-backs');
    const shown = game.finalHands?.[seat];
    if (shown) for (const id of shown) cards.append(face(el('span', 'oc-mini'), id));
    else for (let i = 0; i < Math.min(game.counts[seat], 12); i++) cards.append(el('span', 'oc-back'));
    if (!shown && game.counts[seat] > 12) cards.append(el('span', 'oc-more', `+${game.counts[seat] - 12}`));
    row.append(cards);
    others.append(row);
  }

  // Centre: deck, top card, declared suit, attack.
  const centre = el('section', 'oc-centre');
  const deck = el('button', 'oc-deck');
  deck.type = 'button';
  deck.append(el('span', 'oc-deck-label', game.attack > 0 ? `공격 ${game.attack}장 받기` : '한 장 받기'), el('small', '', `더미 ${game.deckCount}장`));
  deck.disabled = !live;
  if (game.attack > 0) deck.classList.add('oc-deck-attack');
  if (live) deck.onclick = () => { pendingSeven = null; ctx.act({ type: 'draw' }); };
  const pile = el('div', 'oc-pile');
  pile.append(face(el('span', 'oc-top'), game.top));
  const marks = el('div', 'oc-marks');
  if (game.declaredSuit) {
    const suit = el('span', `oc-declared ${game.declaredSuit === 'H' || game.declaredSuit === 'D' ? 'oc-red' : 'oc-black'}`,
      `${ONECARD_SUIT_SYMBOL[game.declaredSuit]} ${ONECARD_SUIT_NAME[game.declaredSuit]}`);
    marks.append(suit);
  }
  if (game.attack > 0) marks.append(el('span', 'oc-attack', `공격 ${game.attack}장`));
  marks.append(el('span', 'oc-dir', game.direction === 1 ? '진행 →' : '← 진행'));
  pile.append(marks);
  centre.append(deck, pile);
  const log = el('p', 'oc-log', game.log);

  // My hand.
  const mine = el('section', 'oc-mine');
  if (ctx.playing && game.turn === me) mine.classList.add('oc-turn');
  const head = el('div', 'oc-opp-head');
  head.append(el('strong', '', `${ctx.playerName(me)} (나)`), el('span', 'oc-count', `${game.hand.length}장`));
  if (game.hand.length === 1) head.append(oneBadge());
  if (game.winner === me) head.append(el('span', 'oc-win', '승리'));
  const hand = el('div', 'oc-hand');
  for (const id of game.hand) {
    const button = face(el('button'), id) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.card = id;
    const ok = playable.has(id);
    if (ok) button.classList.add('oc-playable');
    if (id === pendingSeven) button.classList.add('oc-pending');
    button.disabled = !ok;
    if (ok) button.onclick = () => {
      if (oneCardInfo(id)?.rank === '7') { pendingSeven = id; render(ctx); return; }
      pendingSeven = null;
      ctx.act({ type: 'play', card: id });
    };
    hand.append(button);
  }
  mine.append(head, hand);
  board.append(others, centre, log, mine);
  const settle = prev && game.lastPlay ? playFx(game, prev, board, me) : 0;

  if (pendingSeven) {
    const seven = pendingSeven;
    toolbar.hidden = false;
    toolbar.replaceChildren();
    toolbar.append(el('span', 'oc-ask', `${oneCardName(seven)} · 다음 무늬`));
    for (const suit of ONECARD_SUITS) {
      const button = el('button', `oc-suit-pick ${suit === 'H' || suit === 'D' ? 'oc-red' : 'oc-black'}`, `${ONECARD_SUIT_SYMBOL[suit]} ${ONECARD_SUIT_NAME[suit]}`);
      button.type = 'button';
      button.dataset.suit = suit;
      button.onclick = () => { pendingSeven = null; ctx.act({ type: 'play', card: seven, suit: suit as OneCardSuit }); };
      toolbar.append(button);
    }
    const cancel = el('button', 'oc-cancel', '취소');
    cancel.type = 'button';
    cancel.onclick = () => { pendingSeven = null; render(ctx); };
    toolbar.append(cancel);
  } else {
    toolbar.replaceChildren();
    toolbar.hidden = true;
  }
  if (!ctx.preview) { toolbar.hidden = false; toolbar.append(soundToggle()); }
  turnCues(ctx, step, settle);

  if (ctx.playing && !ctx.preview && game.winner === null) {
    const who = game.turn === me ? '내 차례' : `${ctx.playerName(game.turn)} 차례`;
    const hint = game.turn !== me ? '' : game.attack > 0
      ? (playable.size ? ` · 공격 카드로 막거나 ${game.attack}장 받기` : ` · ${game.attack}장 받기`)
      : playable.size ? ' · 카드를 내거나 한 장 받기' : ' · 낼 카드가 없어요';
    ctx.setTurn(who + hint);
  }
}


export const COVER: TableCover = {
  colors: ['#16344a', '#8fd0f0', '#e2574c'],
  // Key art: a fanned hand with the ace of hearts played to the front, the last card.
  art: (() => {
    const card = (rank: string, suit: string, red: boolean, big: number) => {
      const c = red ? '#d93a3a' : '#1b2a36';
      return `<rect x="-23" y="-32" width="46" height="64" rx="5" fill="url(#@cf)" stroke="#0d1b26" stroke-opacity=".3"/>`
        + `<text x="-15.5" y="-16" font-family="system-ui,sans-serif" font-size="11" font-weight="800" fill="${c}" text-anchor="middle">${rank}</text>`
        + `<use href="#@${suit}" transform="translate(-15.5 -7) scale(.55)" fill="${c}"/><use href="#@${suit}" transform="translate(1 6) scale(${big})" fill="${c}"/>`;
    };
    const fan = ([angle, rank, suit]: (number | string)[]) => `<g transform="rotate(${angle} 196 150) translate(196 62)" filter="url(#@sh)">${card(String(rank), String(suit), suit === 'D' || suit === 'H', 1.5)}</g>`;
    return `<defs><linearGradient id="@cf" x2="1" y2="1"><stop stop-color="#ffffff"/><stop offset=".7" stop-color="#f1efe8"/><stop offset="1" stop-color="#d6d2c6"/></linearGradient>`
      + `<path id="@H" d="M0 6C-5 2-8-1-8-4A4.1 4.1 0 0 1 0-5.5 4.1 4.1 0 0 1 8-4C8-1 5 2 0 6Z"/><path id="@D" d="M0-7 5 0 0 7-5 0Z"/>`
      + `<path id="@S" d="M0-7C-5-3-8 0-8 3A4 4 0 0 0-1 4.6L-2.6 8H2.6L1 4.6A4 4 0 0 0 8 3C8 0 5-3 0-7Z"/>`
      + `<g id="@C"><circle cy="-3.4" r="3.3"/><circle cx="-3.5" cy="1.6" r="3.3"/><circle cx="3.5" cy="1.6" r="3.3"/><path d="M0 0 2.4 8H-2.4Z"/></g></defs>`
      + `<ellipse cx="196" cy="124" rx="70" ry="9" fill="#000" opacity=".5" filter="url(#@bl)"/>`
      + [[-36, '7', 'S'], [-19, '9', 'D'], [19, '4', 'C'], [36, '2', 'S']].map(fan).join('')
      + `<circle cx="198" cy="60" r="38" fill="#ffd0c4" opacity=".4" filter="url(#@gw)"/>`
      + `<g transform="translate(198 64) rotate(4) scale(1.18)" filter="url(#@sh)">${card('A', 'H', true, 2.7)}<rect x="-21" y="-30" width="42" height="60" rx="4" stroke="#d93a3a" stroke-opacity=".25"/></g>`
      + `<path d="M234 22l2-6 2 6 6 2-6 2-2 6-2-6-6-2zM158 30l1.5-4 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5z" fill="#fff"/>`;
  })(),
};
