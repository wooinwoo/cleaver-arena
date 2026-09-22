import type { Action } from '../shared/tabletop-types.ts';
import type { splendorView } from '../shared/splendor.ts';
import { GEM_NAMES, SPLENDOR_CARDS, SPLENDOR_NOBLES, splendorBonuses, splendorCanPass, splendorCost, splendorPayment, splendorScore, splendorTakeError } from '../shared/splendor-data.ts';
import './splendor.css';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const element = document.createElement(tag); element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function gem(color: number) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('sp-gem', `sp-color-${color}`);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', [
    'M3 8 7 3h10l4 5-9 13Z M3 8h18M7 3l5 18 5-18',
    'M7 3h10l5 9-5 9H7l-5-9Z M7 3l5 9 5-9M2 12h20M7 21l5-9 5 9',
    'M6 2h12l4 4v12l-4 4H6l-4-4V6Z M6 6h12v12H6ZM2 6h20M6 2v20M18 2v20M2 18h20',
    'M12 2 22 10 17 21H7L2 10Z M12 2v19M2 10h20M2 10l10 11 10-11',
    'M8 2h8l6 6v8l-6 6H8l-6-6V8Z M8 6h8l2 6-6 6-6-6Z',
    'M5 6h14l3 13H2Z M5 6l2 8h10l2-8M2 19l5-5M22 19l-5-5',
  ][color]); svg.append(path); return svg;
}
function amount(color: number, count: number, label: string) {
  const token = node('span', 'sp-amount'); token.setAttribute('aria-label', `${GEM_NAMES[color]} ${label} ${count}`);
  token.title = `${GEM_NAMES[color]} ${label} ${count}`; token.append(gem(color), node('b', '', String(count))); return token;
}

export function renderSplendor(board: HTMLElement, game: ReturnType<typeof splendorView>, me: number,
  playerName: (seat: number) => string, active: boolean, send: (action: Action) => void, round: number) {
  const revision = `${round}:${game.revision}`;
  const animate = board.dataset.revision !== undefined && board.dataset.revision !== revision && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flights: { element: HTMLElement; from: DOMRect; scale: number }[] = [];
  if (animate && game.last) {
    const sources = game.last.type === 'buy' ? [board.querySelector<HTMLElement>(`.sp-card[data-card="${game.last.card}"]`)] :
      (game.last.gems ?? []).flatMap((count, color) => count ? [board.querySelector<HTMLElement>(`[data-bank="${color}"] .sp-gem`)] : []);
    for (const source of sources) if (source) {
      let from = source.getBoundingClientRect(), scale = 1;
      const confirm = board.querySelector('#sp-buy')?.getBoundingClientRect();
      // Selecting a low card scrolls to its confirmation. Keep the approved purchase visible there.
      if (game.last.type === 'buy' && confirm && (from.bottom < 0 || from.top > innerHeight)) {
        from = new DOMRect(confirm.x + confirm.width / 2 - from.width / 2, confirm.y + confirm.height / 2 - from.height / 2, from.width, from.height);
        scale = .45;
      }
      flights.push({ element: source.cloneNode(true) as HTMLElement, from, scale });
    }
  }
  board.replaceChildren(); board.className = 'splendor-board'; board.dataset.revision = revision;
  // Extends the existing teal tabletop: public market, visible wealth, then a deliberate action.
  // Gem geometry and numbers carry identity; the mobile view keeps the same four-card market rows.
  const player = game.players[me];
  let submitting = false;
  function submit(action: Action) {
    if (!active || submitting) return;
    submitting = true;
    board.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
    send(action);
  }
  const standings = node('div', 'sp-players');
  game.players.forEach((p, seat) => {
    const row = node('article', `sp-player${seat === me ? ' sp-self' : ''}${seat === game.turn ? ' sp-turn' : ''}`);
    row.dataset.seat = String(seat);
    const heading = node('div', 'sp-player-heading');
    heading.append(node('strong', '', `${playerName(seat)}${seat === me ? ' (나)' : ''}`), node('b', 'sp-score', `${splendorScore(p)}점`));
    const tokens = node('div', 'sp-resource-row'); tokens.append(node('span', 'sp-row-label', '보석'));
    p.tokens.forEach((count, color) => tokens.append(amount(color, count, '보석')));
    const bonuses = node('div', 'sp-resource-row'); bonuses.append(node('span', 'sp-row-label', '할인'));
    splendorBonuses(p).forEach((count, color) => bonuses.append(amount(color, count, '할인')));
    const details = node('details', 'sp-collection');
    details.append(node('summary', '', `구매 ${p.cards.length}장 · 귀족 ${p.nobles.length}명 · 예약 ${p.reserved.length}/3`));
    const list = node('div', 'sp-collection-cards');
    for (const id of p.cards) list.append(cardFace(id, false));
    if (!p.cards.length) list.append(node('span', 'sp-muted', '아직 구매한 카드가 없어요.'));
    for (const id of p.nobles) {
      const noble = node('div', 'sp-owned-noble', '귀족 3점');
      SPLENDOR_NOBLES[id].forEach((need, color) => { if (need) noble.append(amount(color, need, '필요 할인')); }); list.append(noble);
    }
    details.append(list); row.append(heading, tokens, bonuses, details); standings.append(row);
  }); board.append(standings);
  if (game.finalRound) board.append(node('p', 'sp-final', game.winner !== null || game.draw ? '경기 종료 · 최종 결과를 확인해 주세요.' : '마지막 라운드 · 마지막 참가자의 차례까지 진행해요.'));

  const control = node('section', 'sp-control'); control.setAttribute('aria-label', '내 행동');
  const hint = node('p', 'sp-hint'); hint.id = 'sp-hint'; hint.setAttribute('role', 'status');
  const choice = node('div', 'sp-choice'); choice.id = 'sp-choice';
  control.append(hint, choice); board.append(control);
  const bank = node('div', 'sp-bank'); bank.setAttribute('aria-label', '공용 보석 공급처');
  const picked = [0, 0, 0, 0, 0];
  const bankButtons: HTMLButtonElement[] = [];
  game.bank.forEach((count, color) => {
    const button = node('button', 'sp-bank-token'); button.dataset.bank = String(color);
    button.append(gem(color), node('span', '', GEM_NAMES[color]), node('b', 'sp-stock', String(count)), node('small', 'sp-picked', ''));
    button.setAttribute('aria-label', `${GEM_NAMES[color]} 공급 ${count}개`); button.setAttribute('aria-pressed', 'false');
    button.disabled = !active || game.stage !== 'action' || color === 5 || count === 0;
    button.onclick = () => {
      picked[color] = (picked[color] + 1) % (count >= 4 ? 3 : 2);
      button.classList.toggle('is-picked', picked[color] > 0); button.setAttribute('aria-pressed', String(picked[color] > 0));
      button.querySelector('small')!.textContent = picked[color] ? `선택 ${picked[color]}` : '';
      chooseGems();
    }; bankButtons.push(button); bank.append(button);
  }); board.append(bank, node('p', 'sp-muted', '황금은 카드·더미 예약으로만 가져와요.'));
  function clearPick() {
    picked.fill(0);
    for (const button of bankButtons) { button.classList.remove('is-picked'); button.setAttribute('aria-pressed', 'false'); button.querySelector('small')!.textContent = ''; }
    board.querySelectorAll('.sp-card.is-picked').forEach(card => card.classList.remove('is-picked'));
  }
  function button(label: string, action: () => void, disabled = false, primary = false) {
    const b = node('button', primary ? 'primary' : '', label); b.disabled = disabled; b.onclick = action; return b;
  }
  function chooseGems() {
    choice.replaceChildren();
    board.querySelectorAll('.sp-card.is-picked').forEach(card => card.classList.remove('is-picked'));
    const total = picked.reduce((sum, count) => sum + count, 0);
    const error = splendorTakeError(game.bank, picked);
    hint.textContent = total ? error ?? `${picked.flatMap((count, color) => count ? [`${GEM_NAMES[color]} ${count}개`] : []).join(' · ')} 가져오기` : '보석을 누르거나 카드를 골라 주세요. 같은 보석을 다시 누르면 개수가 바뀌어요.';
    choice.append(button(`보석 ${total}개 가져오기`, () => submit({ type: 'take', gems: [...picked] }), !!error, true), button('선택 취소', () => { clearPick(); chooseGems(); }));
  }
  function cardFace(id: number, selectable: boolean) {
    const card = SPLENDOR_CARDS[id];
    const face = node('button', `sp-card sp-bonus-${card.bonus}`); face.dataset.card = String(id);
    face.setAttribute('aria-label', `${GEM_NAMES[card.bonus]} 할인 카드 ${card.points}점, 비용 ${card.cost.flatMap((cost, color) => cost ? [`${GEM_NAMES[color]} ${cost}`] : []).join(', ')}`);
    const top = node('span', 'sp-card-top'); top.append(node('b', 'sp-points', `${card.points}점`), node('span', 'sp-bonus', '+1'));
    const icon = gem(card.bonus); icon.classList.add('sp-card-gem');
    const cost = node('span', 'sp-cost'); card.cost.forEach((count, color) => { if (count) cost.append(amount(color, count, '비용')); });
    face.append(top, icon, node('span', 'sp-card-name', GEM_NAMES[card.bonus]), cost);
    face.disabled = !selectable;
    if (selectable) face.onclick = () => selectCard(id, face);
    return face;
  }
  function selectCard(id: number, face: HTMLElement) {
    clearPick(); face.classList.add('is-picked'); choice.replaceChildren();
    const card = SPLENDOR_CARDS[id], cost = splendorCost(player, id), initial = splendorPayment(player, id);
    const payment = initial ? [...initial] : [...cost.map((need, color) => Math.min(need, player.tokens[color])), 0];
    const reserved = player.reserved.includes(id);
    hint.textContent = `${GEM_NAMES[card.bonus]} 할인 +1 · ${card.points}점${reserved ? ' · 내 예약 카드' : ''}`;
    const paymentBox = node('div', 'sp-payment');
    paymentBox.append(node('strong', '', '할인 후 지불'));
    const inputs: HTMLInputElement[] = [];
    const total = node('span', 'sp-payment-total');
    const buy = button('카드 구매', () => submit({ type: 'buy', card: id, payment: [...payment] }), false, true); buy.id = 'sp-buy';
    function price() {
      payment[5] = cost.reduce((gold, need, color) => gold + need - payment[color], 0);
      const fieldsValid = inputs.every(input => input.checkValidity());
      const valid = fieldsValid && payment[5] <= player.tokens[5];
      total.textContent = fieldsValid ? `황금 ${payment[5]}개 사용 / 보유 ${player.tokens[5]}개${valid ? '' : ' · 보석이 부족해요'}` : '지불할 보석 개수를 범위 안의 정수로 입력해 주세요.';
      buy.disabled = !active || !valid;
    }
    cost.forEach((need, color) => {
      if (!need) return;
      const label = node('label', 'sp-payment-color'); label.append(gem(color), node('span', '', GEM_NAMES[color]));
      const input = node('input', ''); input.type = 'number'; input.min = '0'; input.max = String(Math.min(need, player.tokens[color])); input.step = '1'; input.value = String(payment[color]); input.required = true;
      input.setAttribute('aria-label', `${GEM_NAMES[color]} 지불 개수`);
      input.oninput = () => { payment[color] = input.valueAsNumber; price(); };
      inputs.push(input); label.append(input); paymentBox.append(label);
    });
    if (!cost.some(Boolean)) paymentBox.append(node('span', '', '무료로 구매할 수 있어요.'));
    paymentBox.append(total, node('small', 'sp-muted', '보석 개수를 줄이면 그만큼 황금으로 대신 내요.'));
    choice.append(paymentBox, buy);
    if (!reserved) choice.append(button(`카드 예약${game.bank[5] ? ' · 황금 +1' : ' · 황금 없음'}`, () => submit({ type: 'reserve', card: id }), player.reserved.length >= 3));
    choice.append(button('선택 취소', () => { clearPick(); chooseGems(); }));
    price();
    control.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  const nobles = node('section', 'sp-nobles'); nobles.setAttribute('aria-label', '방문 가능한 귀족');
  const bonuses = splendorBonuses(player);
  for (const id of game.nobles) {
    const eligible = SPLENDOR_NOBLES[id].every((need, color) => bonuses[color] >= need);
    const tile = node('button', `sp-noble${eligible ? ' sp-eligible' : ''}`); tile.dataset.noble = String(id);
    tile.append(node('strong', '', '귀족 · 3점'));
    const costs = node('span', 'sp-cost'); SPLENDOR_NOBLES[id].forEach((need, color) => { if (need) costs.append(amount(color, need, '필요 할인')); }); tile.append(costs);
    tile.setAttribute('aria-label', `귀족 ${id + 1}, ${SPLENDOR_NOBLES[id].flatMap((need, color) => need ? [`${GEM_NAMES[color]} 할인 ${need}`] : []).join(', ')}`);
    tile.disabled = !active || game.stage !== 'noble' || !eligible;
    tile.onclick = () => {
      choice.replaceChildren(button('이 귀족 초대', () => submit({ type: 'noble', noble: id }), false, true)); hint.textContent = '선택한 귀족에게서 3점을 받아요.';
      control.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    };
    nobles.append(tile);
  } board.append(nobles);
  const market = node('section', 'sp-market'); market.setAttribute('aria-label', '공개 카드 시장');
  for (const tier of [2, 1, 0]) {
    const header = node('div', 'sp-tier-heading'); header.append(node('h2', '', `${tier + 1}단계`), button(`더미 예약 · ${game.remaining[tier]}장`, () => {
      clearPick(); hint.textContent = `${tier + 1}단계 맨 위 카드를 나만 보이게 예약해요.${game.bank[5] ? ' 황금 1개도 가져와요.' : ' 남은 황금은 없어요.'}`;
      choice.replaceChildren(button('더미에서 예약', () => submit({ type: 'reserve', tier }), false, true), button('선택 취소', chooseGems));
      control.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, !active || game.stage !== 'action' || player.reserved.length >= 3 || !game.remaining[tier]));
    const row = node('div', 'sp-market-row'); row.dataset.tier = String(tier);
    for (const id of game.market[tier]) row.append(id === null ? node('div', 'sp-empty-slot', '소진') : cardFace(id, active && game.stage === 'action'));
    market.append(header, row);
  } board.append(market);
  const hand = node('section', 'sp-hand'); hand.setAttribute('aria-label', '내 예약 카드');
  hand.append(node('h2', '', `내 예약 카드 ${player.reserved.length}/3`), node('p', 'sp-muted', '다른 사람에게는 카드 내용이 보이지 않아요.'));
  const reservedRow = node('div', 'sp-market-row');
  for (const id of player.reserved) if (id !== null) reservedRow.append(cardFace(id, active && game.stage === 'action'));
  if (!player.reserved.length) reservedRow.append(node('p', 'sp-muted', '마음에 드는 카드를 예약하고 다음 차례에 구매할 수 있어요.'));
  hand.append(reservedRow); board.append(hand);
  if (!active) hint.textContent = game.winner !== null || game.draw ? '경기가 끝났어요. 방 정보에서 다시 준비할 수 있어요.' : '다른 참가자의 차례 또는 재접속을 기다리는 중이에요.';
  else if (game.stage === 'return') {
    const excess = player.tokens.reduce((sum, count) => sum + count, 0) - 10;
    hint.textContent = `보석은 황금 포함 10개까지. 돌려줄 ${excess}개를 골라 주세요.`;
    const returning = [0, 0, 0, 0, 0, 0];
    const returns = node('div', 'sp-returns');
    const confirm = button(`보석 ${excess}개 돌려주기`, () => submit({ type: 'return', gems: returning }), true, true); confirm.id = 'sp-return';
    player.tokens.forEach((count, color) => {
      const label = node('label', 'sp-payment-color'); label.append(gem(color), node('span', '', `${GEM_NAMES[color]} ${count}개 보유`));
      const input = node('input', ''); input.type = 'number'; input.min = '0'; input.max = String(count); input.step = '1'; input.value = '0'; input.required = true;
      input.setAttribute('aria-label', `${GEM_NAMES[color]} 반환 개수`); input.oninput = () => {
        returning[color] = input.valueAsNumber;
        confirm.disabled = !Array.from(returns.querySelectorAll('input')).every(field => field.checkValidity()) || returning.reduce((sum, n) => sum + n, 0) !== excess;
      }; label.append(input); returns.append(label);
    }); choice.append(returns, confirm);
  } else if (game.stage === 'noble') hint.textContent = '조건을 만족한 귀족 중 이번 차례에 방문할 1명을 골라 주세요.';
  else if (splendorCanPass(game.bank, game.market, game.remaining, player)) {
    hint.textContent = '가져올 보석, 살 카드, 예약할 자리가 없어 이번 차례를 넘길 수 있어요.';
    choice.append(button('가능한 행동 없음 · 패스', () => submit({ type: 'pass' }), false, true));
  }
  else chooseGems();

  const destination = board.querySelector<HTMLElement>(`.sp-player[data-seat="${game.last?.seat}"]`)?.getBoundingClientRect();
  if (destination) for (const { element, from, scale } of flights) {
    if (from.bottom < 0 || from.top > innerHeight) continue;
    element.classList.add('sp-flight'); element.setAttribute('aria-hidden', 'true'); element.removeAttribute('data-card');
    element.inert = true;
    Object.assign(element.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${from.width}px`, height: `${from.height}px` });
    document.body.append(element);
    const motion = element.animate([{ transform: `translate(0, 0) scale(${scale})`, opacity: 1 },
      { transform: `translate(${destination.x + destination.width / 2 - from.x - from.width / 2}px, ${destination.y + destination.height / 2 - from.y - from.height / 2}px) scale(.3)`, opacity: 0 }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' });
    void motion.finished.finally(() => element.remove());
  }
}
