import './liardice.css';
import type { TableCover, TableRenderContext } from './types.ts';
import type { liarDiceView } from '../../shared/liardice.ts';

type View = ReturnType<typeof liarDiceView>;

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function die(face: number | null, extra = '') {
  const element = document.createElement('span');
  element.className = `ld-die${extra ? ` ${extra}` : ''}`;
  if (face === null) {
    element.classList.add('hidden');
    element.textContent = '?';
    element.setAttribute('aria-label', '숨긴 주사위');
    return element;
  }
  element.setAttribute('aria-label', `주사위 ${face}`);
  for (let index = 0; index < 9; index++) {
    const pip = document.createElement('i');
    if (PIPS[face].includes(index)) pip.className = 'on';
    element.append(pip);
  }
  return element;
}

const bidText = (count: number, face: number) => `${face}이(가) ${count}개 이상`;
/** Smallest legal count for `face` over the standing bid. */
const minCount = (bid: View['bid'], face: number) => (!bid ? 1 : face > bid.face ? bid.count : bid.count + 1);

let draft: { key: string; count: number; face: number } | null = null;

export function render(ctx: TableRenderContext<View>) {
  const { board, toolbar, game, me } = ctx;
  board.className = 'liardice-board';
  const reveal = game.revealed && game.lastResult !== null;
  const result = game.lastResult;
  const faces = reveal && result ? result.dice : game.dice;

  const summary = document.createElement('section');
  summary.className = 'ld-summary';
  const bidLine = document.createElement('p');
  bidLine.className = 'ld-bid';
  const shown = reveal && result ? result.bid : game.bid;
  if (shown) {
    const label = document.createElement('span'); label.className = 'ld-bid-label'; label.textContent = `${ctx.playerName(shown.seat)}의 입찰`;
    const value = document.createElement('strong'); value.textContent = bidText(shown.count, shown.face);
    bidLine.append(label, value, die(shown.face, 'small'));
  } else {
    bidLine.textContent = '아직 입찰이 없어요';
  }
  const meta = document.createElement('p');
  meta.className = 'ld-meta';
  meta.textContent = `${game.round}판 · 전체 주사위 ${game.totalDice}개 · 1은 모든 눈으로 셉니다`;
  summary.append(bidLine, meta);
  if (reveal && result) {
    const outcome = document.createElement('p');
    outcome.className = 'ld-outcome';
    outcome.textContent = `실제 ${result.actual}개 / 입찰 ${result.bid.count}개 → ${ctx.playerName(result.loser)} 주사위 1개 잃음${result.eliminated ? ' · 탈락' : ''}`;
    summary.append(outcome);
  }
  board.append(summary);

  const list = document.createElement('section');
  list.className = 'ld-players';
  faces.forEach((hand, seat) => {
    const row = document.createElement('div');
    row.className = 'ld-player';
    if (seat === me) row.classList.add('me');
    if (game.counts[seat] === 0 && !(reveal && hand.length)) row.classList.add('out');
    if (!game.revealed && seat === game.turn) row.classList.add('turn');
    if (reveal && result?.loser === seat) row.classList.add('loser');
    const head = document.createElement('div');
    head.className = 'ld-player-head';
    const name = document.createElement('span'); name.className = 'ld-name';
    name.textContent = `${ctx.playerName(seat)}${seat === me ? ' (나)' : ''}`;
    const count = document.createElement('span'); count.className = 'ld-count';
    count.textContent = game.counts[seat] ? `주사위 ${game.counts[seat]}개` : '탈락';
    head.append(name, count);
    const dice = document.createElement('div'); dice.className = 'ld-dice';
    hand.forEach((face, index) => {
      let extra = '';
      if (reveal && result && face !== null) {
        if (face === result.bid.face || face === 1) extra = 'counted';
        if (seat === result.loser && index === hand.length - 1) extra += ' lost';
      }
      dice.append(die(face, extra.trim()));
    });
    row.append(head, dice);
    list.append(row);
  });
  board.append(list);

  const mine = game.dice[me];
  if (!ctx.preview && mine && mine.length && !reveal) {
    const own = document.createElement('section');
    own.className = 'ld-mine';
    const title = document.createElement('p'); title.className = 'ld-mine-title'; title.textContent = '내 주사위';
    const dice = document.createElement('div'); dice.className = 'ld-dice large';
    for (const face of mine) dice.append(die(face, game.bid && face !== null && (face === game.bid.face || face === 1) ? 'match' : ''));
    own.append(title, dice);
    board.append(own);
  }

  if (ctx.preview) return;

  if (reveal && result) {
    const tail = game.winner !== null
      ? `${ctx.playerName(game.winner)} 승리`
      : `${ctx.playerName(game.turn)}이(가) 다음 판을 시작해요`;
    ctx.setTurn(`공개 · ${bidText(result.bid.count, result.bid.face)} → 실제 ${result.actual}개 · ${ctx.playerName(result.loser)} 1개 잃음 · ${tail}`);
    if (ctx.canAct && game.winner === null) {
      toolbar.hidden = false;
      toolbar.replaceChildren();
      const next = document.createElement('button');
      next.className = 'primary ld-next';
      next.textContent = '다음 판';
      next.onclick = () => ctx.act({ type: 'next' });
      toolbar.append(next);
    }
    return;
  }

  if (!ctx.playing) return;
  ctx.setTurn(ctx.canAct ? '내 차례 · 입찰을 올리거나 거짓말을 외치세요' : `${ctx.playerName(game.turn)} 차례`);
  if (!ctx.canAct || game.stage !== 'bid') return;

  const bid = game.bid;
  const key = `${game.round}:${bid ? `${bid.count}-${bid.face}-${bid.seat}` : '-'}`;
  if (!draft || draft.key !== key) {
    const start = !bid ? { count: 1, face: 2 } : bid.face < 6 ? { count: bid.count, face: bid.face + 1 } : { count: bid.count + 1, face: 2 };
    draft = { key, ...start };
  }
  const state = draft;

  const button = (label: string, className: string, onclick: () => void, disabled = false) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    element.disabled = disabled;
    element.onclick = onclick;
    return element;
  };

  const build = () => {
    toolbar.hidden = false;
    toolbar.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'ld-builder';
    const low = minCount(bid, state.face);
    const stepper = document.createElement('div'); stepper.className = 'ld-stepper';
    const value = document.createElement('span'); value.className = 'ld-step-value'; value.textContent = `${state.count}개`;
    stepper.append(
      button('−', 'ld-step', () => { state.count--; build(); }, state.count - 1 < low),
      value,
      button('+', 'ld-step', () => { state.count++; build(); }, state.count + 1 > game.totalDice),
    );
    const facesRow = document.createElement('div'); facesRow.className = 'ld-faces';
    for (let face = 2; face <= 6; face++) {
      const pick = button('', `ld-face${face === state.face ? ' selected' : ''}`, () => {
        state.face = face;
        state.count = Math.max(state.count, minCount(bid, face));
        build();
      }, minCount(bid, face) > game.totalDice);
      pick.setAttribute('aria-label', `눈 ${face}`);
      pick.setAttribute('aria-pressed', String(face === state.face));
      pick.append(die(face, 'small'));
      facesRow.append(pick);
    }
    const legal = state.count >= low && state.count <= game.totalDice;
    const actions = document.createElement('div'); actions.className = 'ld-actions';
    actions.append(
      button(`입찰 · ${bidText(state.count, state.face)}`, 'primary ld-submit', () => ctx.act({ type: 'bid', count: state.count, face: state.face }), !legal),
      button('거짓말!', 'ld-call', () => ctx.act({ type: 'call' }), !bid),
    );
    wrap.append(stepper, facesRow, actions);
    toolbar.append(wrap);
  };
  build();
}

export const COVER: TableCover = {
  colors: ['#2c1d14', '#efe2c8', '#c4472f'],
  art: `
  <ellipse cx="150" cy="122" rx="120" ry="12" fill="#000" opacity="0.18"/>
  <g transform="rotate(-14 96 70)">
    <path d="M58 28 L134 28 L124 112 L68 112 Z" fill="#c4472f"/>
    <path d="M58 28 L134 28 L131 42 L61 42 Z" fill="#9c3524"/>
    <path d="M68 112 L124 112 L123 104 L69 104 Z" fill="#7d2a1d"/>
    <path d="M78 48 L84 100" stroke="#fff" stroke-opacity="0.25" stroke-width="5" stroke-linecap="round"/>
  </g>
  <g transform="rotate(8 178 92)">
    <rect x="152" y="66" width="50" height="50" rx="9" fill="#f7f1e4" stroke="#2c1d14" stroke-width="2"/>
    <circle cx="165" cy="79" r="4.5" fill="#2c1d14"/><circle cx="189" cy="79" r="4.5" fill="#2c1d14"/>
    <circle cx="177" cy="91" r="4.5" fill="#2c1d14"/>
    <circle cx="165" cy="103" r="4.5" fill="#2c1d14"/><circle cx="189" cy="103" r="4.5" fill="#2c1d14"/>
  </g>
  <g transform="rotate(-10 240 96)">
    <rect x="218" y="76" width="42" height="42" rx="8" fill="#f7f1e4" stroke="#2c1d14" stroke-width="2"/>
    <circle cx="239" cy="97" r="5.5" fill="#c4472f"/>
  </g>
  <g transform="rotate(20 212 40)">
    <rect x="194" y="22" width="34" height="34" rx="7" fill="#f7f1e4" stroke="#2c1d14" stroke-width="2"/>
    <circle cx="203" cy="31" r="3.5" fill="#2c1d14"/><circle cx="211" cy="39" r="3.5" fill="#2c1d14"/>
    <circle cx="219" cy="47" r="3.5" fill="#2c1d14"/>
  </g>`,
};
