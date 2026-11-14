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
  colors: ['#3a1c12', '#ff9a6a', '#c4472f'],
  // Key art: a leather cup lifted off a hidden roll, light spilling out, two dice on the table.
  art: (() => {
    const pips: Record<number, number[][]> = {
      1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.25, .25], [.5, .5], [.75, .75]],
      4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]], 5: [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]],
      6: [[.27, .22], [.27, .5], [.27, .78], [.73, .22], [.73, .5], [.73, .78]],
    };
    const face = (o: number[], a: number[], b: number[], fill: string, n: number) => `<path d="M${o[0]} ${o[1]}l${a[0]} ${a[1]}l${b[0]} ${b[1]}l${-a[0]} ${-a[1]}Z" fill="${fill}" stroke="${fill}" stroke-width="1.5" stroke-linejoin="round"/>`
      + `<g transform="matrix(${a.join(' ')} ${b.join(' ')} ${o.join(' ')})" fill="${n === 1 ? '#c4472f' : '#2c1d14'}">${pips[n].map(([u, v]) => `<circle cx="${u}" cy="${v}" r="${n === 1 ? .15 : .1}"/>`).join('')}</g>`;
    const die = (x: number, y: number, s: number, rot: number, [top, left, right]: number[]) => {
      const k = (n: number) => +(n * s).toFixed(1), T3 = [x - k(.87), y - k(.65)], T2 = [x, y - k(.15)];
      return `<ellipse cx="${x}" cy="${y + k(.8)}" rx="${k(1.2)}" ry="${k(.3)}" fill="#000" opacity=".55" filter="url(#@bl)"/><g transform="rotate(${rot} ${x} ${y})">`
        + face(T3, [k(.87), k(.5)], [k(.87), k(-.5)], '#fffaf0', top) + face(T3, [k(.87), k(.5)], [0, k(1)], '#d8cbb4', left)
        + face(T2, [k(.87), k(-.5)], [0, k(1)], '#f2e8d6', right) + '</g>';
    };
    return `<defs><radialGradient id="@tb" cx=".55" cy=".3" r=".75"><stop stop-color="#9a5530"/><stop offset=".55" stop-color="#4f2614"/><stop offset="1" stop-color="#1e0c06"/></radialGradient>`
      + `<linearGradient id="@cp" x2="1" y2="0"><stop stop-color="#4a160c"/><stop offset=".55" stop-color="#a8392a"/><stop offset=".8" stop-color="#d9634a"/><stop offset="1" stop-color="#7a2418"/></linearGradient></defs>`
      + `<ellipse cx="180" cy="120" rx="130" ry="24" fill="#120603"/><ellipse cx="180" cy="114" rx="130" ry="24" fill="url(#@tb)"/><ellipse cx="180" cy="114" rx="129" ry="23.4" stroke="#ffb98a" stroke-opacity=".35"/>`
      + `<ellipse cx="204" cy="102" rx="44" ry="11" fill="#ffc46a" opacity=".55" filter="url(#@gw)"/>` + die(206, 98, 10, 4, [4, 1, 2])
      + `<g transform="translate(200 46) rotate(12)"><ellipse cy="37" rx="28" ry="6" fill="#ffd68a" opacity=".7" filter="url(#@bl)"/>`
      + `<path d="M-30 32-21-30Q0-37 21-30L30 32A30 9 0 0 1-30 32Z" fill="url(#@cp)"/><ellipse cy="-31" rx="21" ry="5" fill="#c9503b"/><ellipse cy="-31" rx="16" ry="3.4" stroke="#ffd2a8" stroke-opacity=".5"/>`
      + `<path d="M-25.5-4Q0 4 25.5-4M-28.5 18Q0 27 28.5 18" stroke="#f6c27a" stroke-width="1.4" stroke-dasharray="3 2.5"/><path d="M-30 32A30 9 0 0 0 30 32" stroke="#e7a85a" stroke-width="3"/><path d="M12-26 18 26" stroke="#fff" stroke-opacity=".28" stroke-width="5" stroke-linecap="round"/></g>`
      + die(146, 112, 15, -8, [5, 3, 1]) + die(246, 116, 12, 10, [2, 3, 1])
      + `<path d="M246 28l2-6 2 6 6 2-6 2-2 6-2-6-6-2z" fill="#fff"/><path d="M164 86l-6-4M172 76l-4-6" stroke="#ffd68a" stroke-width="2" stroke-linecap="round" opacity=".7"/>`;
  })(),
};
