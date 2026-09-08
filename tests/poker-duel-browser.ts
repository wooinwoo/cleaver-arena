import { chromium, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { pokerView } from '../shared/poker.ts';

type Room = { phase: string; round: number; variant: string; me: number; game: ReturnType<typeof pokerView> };
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3187';
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/home/rst010/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const errors: string[] = [];
try {
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 900 } }),
    browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
  ]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [a, b] = pages;
  const rooms = new Map<Page, Room>();
  for (const page of pages) {
    page.setDefaultTimeout(20_000);
    page.on('pageerror', error => errors.push(error.message));
    // Observe the same public frames the browser receives; all actions use visible controls.
    page.on('websocket', socket => socket.on('framereceived', frame => {
      const message = JSON.parse(frame.payload.toString());
      if (message.type === 'table-state') rooms.set(page, message.room);
    }));
  }
  const game = () => rooms.get(a)!.game;
  const own = (page: Page) => page.locator('.poker-player').filter({ hasText: '(나)' }).locator('.poker-card-value');
  async function press(page: Page, name: string | RegExp) {
    const button = page.getByRole('button', { name, exact: typeof name === 'string' });
    if (page === b) await button.tap(); else await button.click();
  }
  async function synced(predicate: (room: Room) => boolean) {
    await expect.poll(() => pages.every(page => rooms.has(page) && predicate(rooms.get(page)!))).toBe(true);
    for (const page of pages) {
      const room = rooms.get(page)!;
      expect(room.variant).toBe('duel'); expect(room.game.variant).toBe('duel');
      expect(room.game.chips.reduce((sum, chips) => sum + chips, room.game.pot)).toBe(40);
      expect(room.game).not.toHaveProperty('decks');
      await expect(page.locator('#t-error')).toBeEmpty();
    }
  }
  async function privateHand(hand: number) {
    await synced(room => room.phase === 'playing' && room.game.hand === hand && room.game.stage === 'betting');
    for (const [seat, page] of pages.entries()) {
      expect(rooms.get(page)!.game.cards[seat]).toBeNull();
      expect(rooms.get(page)!.game.turn).toBe((hand - 1) % 2);
      await expect(own(page)).toHaveText('비공개');
      await expect(page.locator(`[data-seat="${1 - seat}"] .poker-card-value`)).toHaveText(/카드 \d+/);
      await expect(page.locator('.poker-decks')).toContainText(`${9 - (hand - 1) % 10}장 남음`);
      await expect(page.locator('#t-ready')).toBeHidden();
    }
  }
  async function revealed() {
    await synced(room => room.game.stage === 'reveal');
    for (const page of pages) {
      await expect(own(page)).toHaveText(/카드 \d+/);
      await expect(own(page)).toBeVisible();
    }
  }
  async function next() {
    const before = structuredClone(game());
    await press(a, '다음 판 준비');
    await synced(room => room.game.nextReady[0]);
    await expect(a.locator('.poker-next')).toBeDisabled();
    expect(game().stage).toBe('reveal'); expect(game().hand).toBe(before.hand);
    expect(game().chips).toEqual(before.chips); expect(game().cards).toEqual(before.cards);
    await expect(b.locator('.poker-next')).toBeEnabled();
    await press(b, '다음 판 준비');
    await privateHand(before.hand + 1);
    const ante = Math.min(1, ...before.chips);
    expect(game().chips).toEqual(before.chips.map(chips => chips - ante));
    expect(game().pot).toBe(before.pot + 2 * ante);
  }

  await a.goto(`${base}/?game=poker`);
  await expect(a.locator('#t-variant')).toHaveValue('duel');
  await expect(a.locator('#t-rules-title')).toContainText('1:1 승부룰');
  await a.locator('#t-name').fill('민트친구');
  await a.screenshot({ path: output + 'poker-duel-entry.png', fullPage: true });
  await a.locator('#t-entry button[type=submit]').click();
  await expect(a.locator('#t-code')).toBeVisible();
  const code = await a.locator('#t-code').innerText();
  await b.goto(`${base}/?game=poker&room=${code}`);
  await b.locator('#t-name').fill('코랄친구');
  await b.locator('#t-variant').selectOption('party');
  await b.locator('#t-join').tap();
  await expect(a.locator('#t-players li')).toHaveCount(2);
  for (const page of pages) {
    await expect(page.locator('#t-rules-title')).toContainText('1:1 승부룰');
    await expect(page.locator('#t-ready-note')).toContainText('2 / 2명');
  }
  await press(a, '준비하기'); await press(b, '준비하기');
  await privateHand(1);
  for (const page of pages) {
    await expect(page.locator('#poker-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
    await expect(page.locator('#poker-canvas')).toHaveAttribute('data-models', 'blender');
  }
  await a.screenshot({ path: output + 'poker-duel-private.png', fullPage: true });
  await b.screenshot({ path: output + 'poker-duel-mobile.png', fullPage: true });
  await a.locator('#poker-raise').fill('3');
  await press(a, '올리기');
  await synced(room => room.game.bet === 4 && room.game.turn === 1);
  for (const page of pages) {
    await expect(page.locator('.pot')).toContainText('모인 칩 5');
    await expect(page.locator('#poker-canvas')).toHaveAttribute('data-bet-animations', '1');
    await expect(own(page)).toHaveText('비공개');
  }
  await press(b, '3칩 콜'); await revealed();
  expect(rooms.get(a)!.phase).toBe('playing');
  await a.screenshot({ path: output + 'poker-duel-hand-reveal.png', fullPage: true });
  await next();
  await expect(b.locator('#t-turn')).toContainText('내 차례!');
  await b.setViewportSize({ width: 320, height: 667 });
  await expect.poll(() => b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await b.locator('.poker-bet-size').scrollIntoViewIfNeeded();
  await expect(b.locator('#poker-raise')).toBeInViewport();
  await expect(b.getByRole('button', { name: '최대로', exact: true })).toBeInViewport();
  await b.screenshot({ path: output + 'poker-duel-mobile-betting.png', fullPage: true });

  let allIns = 0;
  for (let hands = 0; rooms.get(a)!.phase !== 'finished' && hands < 40; hands++) {
    const loser = game().chips[0] <= game().chips[1] ? 0 : 1;
    const cards = [rooms.get(b)!.game.cards[0]!, rooms.get(a)!.game.cards[1]!];
    const limit = Math.min(...game().chips.map((chips, seat) => chips + game().bets[seat])) - game().bet;
    // After the first all-in, only repeat it when the smaller stack cannot win.
    // Otherwise a fold shrinks that stack, giving every shuffled deck a bounded finish.
    if (limit > 0 && (!allIns || cards[loser] < cards[1 - loser])) {
      const raiser = pages[game().turn];
      await press(raiser, '최대로');
      await expect(raiser.locator('#poker-raise')).toHaveValue(String(limit));
      const target = game().bet + limit;
      await press(raiser, '올리기');
      await synced(room => room.game.bet === target && room.game.turn !== pages.indexOf(raiser));
      await press(pages[game().turn], /칩 콜$/);
      allIns++;
    } else {
      if (game().turn !== loser) {
        await press(pages[game().turn], '체크');
        await synced(room => room.game.turn === loser);
      }
      await press(pages[loser], '이번 판 포기');
    }
    await revealed();
    if (rooms.get(a)!.phase !== 'finished') await next();
  }
  expect(allIns).toBeGreaterThan(0);
  expect(rooms.get(a)!.phase).toBe('finished');
  expect([...game().chips].sort((x, y) => x - y)).toEqual([0, 40]);
  for (const page of pages) {
    await expect(page.locator('#t-turn')).toContainText('승리');
    await expect(page.locator('#t-ready')).toHaveText('다시 준비하기');
    await expect(page.locator('.poker-next')).toHaveCount(0);
  }
  await a.screenshot({ path: output + 'poker-duel-finished.png', fullPage: true });
  await press(a, '다시 준비하기');
  await expect(a.locator('#t-ready')).toHaveText('준비 취소');
  expect(rooms.get(a)!.phase).toBe('finished');
  await press(b, '다시 준비하기');
  await synced(room => room.round === 2);
  await privateHand(1);
  expect(game().chips).toEqual([19, 19]); expect(game().pot).toBe(2);
  expect(errors).toEqual([]);
  console.log('PASS poker duel desktop/mobile: room rules, Blender, privacy, amount raise, both-next, carried chips, bankruptcy and rematch.');
} finally { await browser.close(); }
