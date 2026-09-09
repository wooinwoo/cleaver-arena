import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { splendorView } from '../shared/splendor.ts';
import type { Action } from '../shared/tabletop-types.ts';
import { GEM_NAMES } from '../shared/splendor-data.ts';
import { chooseSplendorAction } from './splendor-helpers.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/home/rst010/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors: string[] = [];
async function press(page: Page, locator: Locator) { if (page.viewportSize()!.width < 760) await locator.tap(); else await locator.click(); }
async function game(page: Page): Promise<ReturnType<typeof splendorView>> { return page.evaluate(() => (window as any).__tableRoom.game); }
async function action(page: Page, request: Action) {
  const before = (await game(page)).revision;
  const flights = await page.evaluate(() => (window as any).__cardFlights);
  if (request.type === 'take') {
    for (const [color, count] of (request.gems as number[]).entries()) for (let i = 0; i < count; i++) await press(page, page.locator(`[data-bank="${color}"]`));
    await press(page, page.getByRole('button', { name: /^보석 \d개 가져오기$/ }));
  } else if (request.type === 'buy') {
    await press(page, page.locator(`.sp-market .sp-card[data-card="${request.card}"], .sp-hand .sp-card[data-card="${request.card}"]`));
    await press(page, page.locator('#sp-buy'));
  } else if (request.type === 'reserve') {
    if (request.tier !== undefined) {
      await press(page, page.locator('.sp-tier-heading').nth(2 - Number(request.tier)).getByRole('button'));
      await press(page, page.getByRole('button', { name: '더미에서 예약', exact: true }));
    } else {
      await press(page, page.locator(`.sp-market .sp-card[data-card="${request.card}"]`));
      await press(page, page.getByRole('button', { name: /^카드 예약/ }));
    }
  } else if (request.type === 'return') {
    for (const [color, count] of (request.gems as number[]).entries()) if (count) await page.getByRole('spinbutton', { name: `${GEM_NAMES[color]} 반환 개수`, exact: true }).fill(String(count));
    await press(page, page.locator('#sp-return'));
  } else if (request.type === 'noble') {
    await press(page, page.locator(`[data-noble="${request.noble}"]`));
    await press(page, page.getByRole('button', { name: '이 귀족 초대', exact: true }));
  } else if (request.type === 'pass') await press(page, page.getByRole('button', { name: '가능한 행동 없음 · 패스', exact: true }));
  else throw new Error(`Unsupported browser action ${request.type}`);
  await expect.poll(async () => (await game(page)).revision).toBe(before + 1);
  if (request.type === 'buy') await expect.poll(() => page.evaluate(() => (window as any).__cardFlights)).toBeGreaterThan(flights);
  await expect(page.locator('#t-error')).toBeEmpty();
}
async function layout(page: Page) {
  for (const [width, height] of [[320, 568], [390, 844], [667, 375], [768, 1024], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect(await page.locator('.sp-market-row').first().locator('.sp-card, .sp-empty-slot').count()).toBe(4);
    const issues = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sp-bank, .sp-market-row, .sp-players, .sp-payment, .sp-returns')]
      .filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2).map(el => el.className));
    expect(issues).toEqual([]);
  }
}
try {
  for (const seats of [2, 3, 4]) {
    const contexts = [], pages: Page[] = [];
    for (let seat = 0; seat < seats; seat++) {
      const mobile = seat % 2 === 1;
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: true });
      contexts.push(context);
      await context.addInitScript(`window.__name = fn => fn; window.__cardFlights = 0; new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === 1 && node.classList.contains('sp-flight') && node.classList.contains('sp-card')) window.__cardFlights++; }))).observe(document, { childList: true, subtree: true }); const Original = window.WebSocket; window.WebSocket = class extends Original { constructor(...args) { super(...args); window.__tableSocket = this; this.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.type === 'table-state') window.__tableRoom = data.room; }); } };`);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); pages.push(page);
    }
    const [a, b] = pages;
    await a.goto(base); await a.locator('[data-game="splendor"]').click();
    await a.locator('#t-name').fill('보석친구'); await a.locator('#t-entry button[type=submit]').click();
    await expect(a.locator('#t-room')).toBeVisible();
    const code = await a.locator('#t-code').innerText();
    for (let seat = 1; seat < seats; seat++) {
      await pages[seat].goto(`${base}/?game=splendor&room=${code}`);
      await pages[seat].locator('#t-name').fill(`친구${seat + 1}`); await pages[seat].locator('#t-join').click();
      await expect(pages[seat].locator('#t-code')).toHaveText(code);
    }
    for (const page of pages) await press(page, page.locator('#t-ready'));
    await expect(a.locator('.sp-market .sp-card')).toHaveCount(12);
    await expect(b.locator('.sp-player')).toHaveCount(seats);
    await a.screenshot({ path: `${output}splendor-${seats}-desktop.png`, fullPage: true });
    await b.screenshot({ path: `${output}splendor-${seats}-mobile.png`, fullPage: true });
    await layout(b); await b.setViewportSize({ width: 390, height: 844 });
    await action(a, { type: 'reserve', tier: 2 });
    const reserved = (await game(a)).players[0].reserved[0];
    expect(typeof reserved).toBe('number');
    await expect.poll(async () => (await game(b)).players[0].reserved).toEqual([null]);
    expect(await game(b)).not.toHaveProperty('decks');
    await expect(b.locator('.sp-hand .sp-card')).toHaveCount(0);
    await a.reload();
    await expect(a.locator('#connection')).toHaveText('연결됨', { timeout: 15_000 });
    await expect.poll(async () => (await game(a)).players[0].reserved).toEqual([reserved]);
    let actions = 1;
    const stages = new Set<string>();
    while (true) {
      const snapshot = await game(a);
      if (snapshot.winner !== null || snapshot.draw) break;
      expect(actions++).toBeLessThan(1000);
      const current = pages[snapshot.turn];
      await expect.poll(async () => (await game(current)).revision).toBe(snapshot.revision);
      const own = await game(current); stages.add(own.stage);
      await action(current, chooseSplendorAction(own));
      await expect.poll(async () => (await game(a)).revision).toBe(snapshot.revision + 1);
    }
    for (const page of pages) {
      await expect(page.locator('#t-turn')).toContainText(/승리|무승부/);
      await expect(page.locator('#t-ready')).toHaveText('다시 준비하기');
      await expect(page.locator('#t-board button:enabled')).toHaveCount(0);
      await expect(page.locator('#t-error')).toBeEmpty();
    }
    await a.screenshot({ path: `${output}splendor-${seats}-finished-desktop.png`, fullPage: true });
    await b.screenshot({ path: `${output}splendor-${seats}-finished-mobile.png`, fullPage: true });
    for (const page of pages) {
      const room = page.locator('#t-room'); if (!await page.locator('#t-ready').isVisible()) await room.locator('summary').click();
      await press(page, page.locator('#t-ready'));
    }
    await expect(a.locator('#t-round')).toContainText('2번째 판');
    const fresh = await game(a);
    expect(fresh.revision).toBe(0); expect(fresh.players.every(p => p.cards.length === 0 && p.reserved.length === 0 && p.tokens.every(n => n === 0))).toBe(true);
    expect(fresh.finalRound).toBe(false);
    console.log(`PASS Splendor ${seats} players: ${actions} browser actions, phases ${[...stages].join('/')}, private reservation, reconnect, result, rematch and five viewport sizes.`);
    for (const context of contexts) await context.close();
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
