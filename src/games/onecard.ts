import './onecard.css';
import type { TableRenderContext, TableCover } from './types.ts';
import {
  type OneCardView, type OneCardSuit, ONECARD_SUITS, ONECARD_SUIT_SYMBOL, ONECARD_SUIT_NAME,
  oneCardInfo, oneCardName, oneCardPlayable,
} from '../../shared/onecard.ts';

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

export function render(ctx: TableRenderContext<OneCardView>): void {
  const { board, toolbar, game, me } = ctx;
  board.replaceChildren();
  board.className = 'onecard-board';
  const live = ctx.canAct && !ctx.preview;
  const playable = new Set(live ? oneCardPlayable(game, me) : []);
  if (!live || !pendingSeven || !playable.has(pendingSeven)) pendingSeven = null;
  const seats = game.counts.length;

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

  if (ctx.playing && !ctx.preview && game.winner === null) {
    const who = game.turn === me ? '내 차례' : `${ctx.playerName(game.turn)} 차례`;
    const hint = game.turn !== me ? '' : game.attack > 0
      ? (playable.size ? ` · 공격 카드로 막거나 ${game.attack}장 받기` : ` · ${game.attack}장 받기`)
      : playable.size ? ' · 카드를 내거나 한 장 받기' : ' · 낼 카드가 없어요';
    ctx.setTurn(who + hint);
  }
}


export const COVER: TableCover = {
  colors: ['#1f3b4d', '#e9f1f4', '#e2574c'],
  art: [
    '<g transform="translate(150 132)">',
    ...[-30, -15, 0, 15, 30].map((angle, i) =>
      `<g transform="rotate(${angle}) translate(-26 -112)"><rect width="52" height="76" rx="7" fill="#fbfaf5" stroke="#1f3b4d" stroke-width="2"/>` +
      `<text x="9" y="20" font-family="sans-serif" font-size="14" font-weight="700" fill="${i % 2 ? '#e2574c' : '#1f3b4d'}">${['♠', '♥', '♣', '♦', '♠'][i]}</text></g>`),
    '</g>',
    '<circle cx="150" cy="62" r="30" fill="#e2574c"/>',
    '<text x="150" y="78" text-anchor="middle" font-family="sans-serif" font-size="46" font-weight="800" fill="#fbfaf5">1</text>',
  ].join(''),
};
