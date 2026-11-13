import { chromium, expect, type WebSocketRoute } from '@playwright/test';
import { actSplendor, createSplendor, splendorView, type SplendorState } from '../shared/splendor.ts';
import { splendorScore } from '../shared/splendor-data.ts';
import type { Action } from '../shared/tabletop-types.ts';

// Controlled late-game snapshots exercise rare UI decisions against the real rule engine.
// The separate splendor-browser.ts plays complete games through the actual WebSocket server.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const browser = await chromium.launch({ channel: 'chromium', executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const errors: string[] = [];

// Keep each of the ninety cards in exactly one location when arranging a boundary position.
function placeOwned(state: SplendorState) {
  const owned = new Set(state.players.flatMap(p => [...p.cards, ...p.reserved]));
  state.decks = state.decks.map(deck => deck.filter(id => !owned.has(id)));
  state.market = state.market.map((row, tier) => row.map(id => id !== null && owned.has(id) ? state.decks[tier].pop() ?? null : id));
  const all = [...state.decks.flat(), ...state.market.flat().filter(id => id !== null), ...owned];
  expect(all.length).toBe(90); expect(new Set(all).size).toBe(90);
}

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: true, isMobile: width === 390 });
    await context.addInitScript('window.__name = fn => fn; localStorage.setItem("cleaver-name", "경계검사");');
    let state = createSplendor(2), me = 0, wire: WebSocketRoute;
    const sent: Action[] = [];
    let rejectNext = false;
    function publish() {
      const done = state.winner !== null || state.draw;
      wire.send(JSON.stringify({ type: 'table-state', room: {
        code: 'ABCDEF', kind: 'splendor', phase: done ? 'finished' : 'playing', round: 1,
        result: done ? state.draw ? '무승부' : `참가자${state.winner! + 1} 승리` : '', me,
        players: state.players.map((_, seat) => ({ id: `p${seat}`, name: `참가자${seat + 1}`, seat, ready: false, connected: true })),
        game: splendorView(state, me),
      } }));
    }
    await context.routeWebSocket('**/table-ws', route => {
      wire = route;
      route.onMessage(raw => {
        const data = JSON.parse(String(raw));
        if (data.type === 'create' || data.type === 'resume') {
          route.send(JSON.stringify({ type: 'joined', code: 'ABCDEF', token: 'fixture' })); publish();
        } else if (data.type === 'action') {
          sent.push(data.action);
          const problem = rejectNext ? '다시 선택해 주세요.' : actSplendor(state, me, data.action);
          rejectNext = false;
          if (problem) route.send(JSON.stringify({ type: 'error', message: problem })); else publish();
        }
      });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const press = async (selector: string) => { const target = page.locator(selector); if (width === 390) await target.tap(); else await target.click(); };
    const hand = (id: number) => `.sp-hand .sp-card[data-card="${id}"]`;
    async function refresh() { publish(); await expect(page.locator('#t-board')).toHaveAttribute('data-revision', `1:${state.revision}`); }
    async function settled() { await expect(page.locator('#t-board')).toHaveAttribute('data-revision', `1:${state.revision}`); await expect(page.locator('#t-error')).toBeEmpty(); }

    // Gold can replace a colored gem even when that colored gem is already held.
    state.players[0].reserved = [0]; state.players[0].tokens = [1, 1, 1, 1, 0, 1];
    state.bank = state.bank.map((n, color) => n - state.players[0].tokens[color]); placeOwned(state);
    await page.goto(`${base}/?game=splendor`); await page.locator('#t-name').fill('경계검사'); await press('#t-entry button[type=submit]');
    await press(hand(0));
    const payment = page.getByRole('spinbutton', { name: '다이아 지불 개수', exact: true });
    for (const invalid of ['', '0.5', '-1', '2']) { await payment.fill(invalid); await expect(page.locator('#sp-buy')).toBeDisabled(); }
    await payment.fill('0'); await expect(page.locator('.sp-payment-total')).toContainText('황금 1개 사용');
    rejectNext = true; await press('#sp-buy');
    await expect(page.locator('#t-error')).toHaveText('다시 선택해 주세요.');
    expect(state.revision).toBe(0); await expect(page.locator(hand(0))).toBeEnabled();
    await press(hand(0)); await page.getByRole('spinbutton', { name: '다이아 지불 개수', exact: true }).fill('0');
    await press('#sp-buy'); await settled();
    expect(sent.at(-1)).toEqual({ type: 'buy', card: 0, payment: [0, 1, 1, 1, 0, 1] });
    expect(state.players[0].tokens).toEqual([1, 0, 0, 0, 0, 0]); expect(state.players[0].cards).toEqual([0]);

    // Reserving with ten pieces must pause for a return, including returning the gold just taken.
    state = createSplendor(2); state.revision = 20;
    state.players[0].tokens = [2, 2, 2, 2, 2, 0]; state.bank = [2, 2, 2, 2, 2, 5]; await refresh();
    await press('label[for="sp-tier-2"]');
    await press('.sp-tier-pane:not([hidden]) .sp-tier-heading button'); await page.getByRole('button', { name: '더미에서 예약', exact: true }).click(); await settled();
    expect(state.stage).toBe('return'); expect(state.turn).toBe(0);
    await expect(page.locator('[data-bank]:enabled')).toHaveCount(0);
    await expect(page.locator('.sp-tier-pane:not([hidden]) .sp-card:enabled')).toHaveCount(0);
    await page.reload(); await expect(page.locator('#sp-return')).toBeVisible();
    const returning = page.getByRole('spinbutton', { name: '황금 반환 개수', exact: true });
    for (const invalid of ['', '0.5', '-1', '2']) { await returning.fill(invalid); await expect(page.locator('#sp-return')).toBeDisabled(); }
    await returning.fill('1'); await press('#sp-return'); await settled();
    expect(state.players[0].tokens).toEqual([2, 2, 2, 2, 2, 0]); expect(state.bank[5]).toBe(5); expect(state.turn).toBe(1);

    // A free reserved purchase simultaneously qualifies for two nobles and ends the final seat's turn.
    state = createSplendor(4); state.revision = 40; me = state.turn = 3;
    state.nobles = [5, 6, 0, 2, 4];
    state.players[3].cards = [16, 17, 18, 8, 9, 24, 25, 26, 32, 33, 34, 71, 72, 79];
    state.players[3].reserved = [10]; placeOwned(state); await refresh();
    expect(splendorScore(state.players[3])).toBe(12);
    await press(hand(10)); await expect(page.locator('.sp-payment')).toContainText('무료'); await press('#sp-buy'); await settled();
    expect(state.stage).toBe('noble'); expect(state.finalRound).toBe(false); expect(state.winner).toBeNull();
    await expect(page.locator('.sp-noble:enabled')).toHaveCount(2);
    await expect(page.locator('[data-bank]:enabled, .sp-tier-pane:not([hidden]) .sp-card:enabled')).toHaveCount(0);
    await page.reload(); await expect(page.locator('.sp-noble:enabled')).toHaveCount(2);
    await press('label[for="sp-pane-info"]');
    await press('[data-noble="6"]'); await page.getByRole('button', { name: '이 귀족 초대', exact: true }).click(); await settled();
    expect(state.players[3].nobles).toEqual([6]); expect(state.nobles).toContain(5);
    expect(splendorScore(state.players[3])).toBe(15); expect(state.winner).toBe(3);
    await expect(page.locator('#t-turn')).toHaveText('참가자4 승리'); await expect(page.locator('#t-board button:enabled')).toHaveCount(0);

    // A final-round forfeit has a winner but no score-based winners array.
    state.winners = []; state.revision++; await refresh();
    await expect(page.locator('.sp-final')).toContainText('경기 종료');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    console.log(`PASS Splendor ${width}px edge UI: manual gold, invalid input/recovery, reserve/return/reload, free buy, two nobles/reload, noble-triggered win, forfeit banner.`);
    await context.close();
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
