import { chromium, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Game } from '../shared/game.ts';

const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/home/rst010/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const errors: string[] = [];
async function page(mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 1 : 2 });
  await context.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', event => {
          const data = JSON.parse(event.data);
          if (data.type === 'state') (window as unknown as { arenaState: unknown }).arenaState = data.game;
        });
      }
    };
  });
  const tab = await context.newPage();
  tab.on('pageerror', error => { errors.push(error.message); console.error('BROWSER:', error.message); });
  await tab.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(tab.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await tab.locator('#choose-cleaver').click();
  return tab;
}
async function finishDuel(a: Page, b: Page, label: string) {
  const target = await a.evaluate(() => {
    const opponent = (window as unknown as { arenaState: Game }).arenaState.players[1];
    const rect = document.getElementById('game')!.getBoundingClientRect();
    const aspect = rect.width / rect.height, distance = Math.max(29, 21 / Math.max(.35, aspect));
    const depth = 1.25 * distance - 1.45 * .8 + opponent.z * .6;
    return { x: rect.left + rect.width / 2 * (1 + opponent.x / (depth * Math.tan(.85 / 2) * aspect)),
      y: rect.top + rect.height / 2 * (1 - (1.45 * .6 + opponent.z * .8) / (depth * Math.tan(.85 / 2))) };
  });
  await expect.poll(async () => {
    await a.mouse.move(target.x + 1, target.y); await a.mouse.move(target.x, target.y);
    return a.evaluate(() => {
      const [me, opponent] = (window as unknown as { arenaState: Game }).arenaState.players;
      return Math.abs(me.yaw - Math.atan2(opponent.x - me.x, opponent.z - me.z));
    });
  }, { timeout: 15_000 }).toBeLessThan(.03);
  await a.locator('#game').focus();
  await a.keyboard.down('Space');
  await a.waitForFunction(() => (window as unknown as { arenaState: Game }).arenaState?.phase === 'finished', undefined, { timeout: 20_000 });
  await a.keyboard.up('Space');
  for (const tab of [a, b]) {
    await expect(tab.locator('.room-title')).toHaveText('민트친구 승리');
    await expect(tab.locator('#hud')).toBeHidden();
    await expect(tab.locator('#ready')).toBeVisible();
  }
  await a.screenshot({ path: output + `${label}-finished-desktop.png` });
}
try {
  const a = await page(), b = await page();
  const onlyArena = process.argv.includes('--arena-only');
  if (!onlyArena) {
  await a.locator('#map').selectOption('ward');
  await a.screenshot({ path: output + 'desktop-lobby.png' });
  await a.locator('#nickname').fill('민트친구');
  await a.locator('#create').click();
  await expect(a.locator('#room')).toBeVisible();
  const code = await a.locator('#code').innerText();
  await b.goto(`${base}/?game=cleaver&room=${code}`);
  await expect(b.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await b.locator('#nickname').fill('코랄친구');
  await b.locator('#join').click();
  await expect(a.locator('#players li')).toHaveCount(2);
  await a.locator('#ready').click();
  await b.locator('#ready').click();
  await a.bringToFront();
  await a.waitForFunction(() => (window as unknown as { arenaState: Game }).arenaState?.phase === 'playing');
  await expect(a.locator('#hud')).toBeVisible();
  await a.mouse.move(720, 450);
  await expect.poll(() => a.evaluate(() => {
    const p = (window as unknown as { arenaState: Game }).arenaState.players[0];
    return Math.abs(p.yaw - Math.atan2(-p.x, -1.45 * .75 - p.z));
  })).toBeLessThan(.08);
  const startX = await a.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.players[0].x);
  await a.locator('#game').focus();
  await a.keyboard.down('KeyD');
  await a.waitForTimeout(350);
  await a.keyboard.up('KeyD');
  await expect.poll(() => b.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.players[0].x)).toBeGreaterThan(startX + .3);
  await a.screenshot({ path: output + 'desktop-top.png' });
  await expect(a.locator('#fps-view')).toBeDisabled();
  await a.keyboard.press('KeyV');
  await expect(a.locator('#top-view')).toHaveAttribute('aria-pressed', 'true');
  const shotBefore = await a.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.nextShot);
  await a.locator('#game').focus();
  await a.keyboard.down('Space');
  await a.waitForTimeout(160);
  await a.keyboard.up('Space');
  await expect.poll(() => b.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.nextShot)).toBeGreaterThan(shotBefore);
  await a.keyboard.press('KeyV');
  await expect(a.locator('#top-view')).toHaveAttribute('aria-pressed', 'true');
  await finishDuel(a, b, 'cleaver');
  await a.locator('#ready').click(); await b.locator('#ready').click();
  await a.waitForFunction(() => {
    const state = (window as unknown as { arenaState: Game }).arenaState;
    return state?.round === 2 && state.phase === 'playing' && state.players.every(p => p.hp === 100);
  });
  await a.bringToFront(); await a.locator('#game').focus();
  await a.keyboard.down('KeyD'); await a.waitForTimeout(1400); await a.keyboard.up('KeyD');
  await expect.poll(() => a.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.players[0].x)).toBeCloseTo(-.5, 2);
  await a.screenshot({ path: output + 'cleaver-ward-boundary.png' });
  console.log('PASS ward: four-hit win, result, rematch and center movement boundary.');
  }
  for (const tab of onlyArena ? [] : [a, b]) {
    await tab.locator('#match-leave:visible, #leave:visible').click();
    await expect(tab.locator('#loading')).toBeHidden({ timeout: 60_000 });
    await tab.locator('#choose-cleaver').click();
  }
  await a.locator('#nickname').fill('민트친구'); await b.locator('#nickname').fill('코랄친구');
  await a.locator('#map').selectOption('arena');
  await expect(a.locator('#mode')).toHaveValue('ffa');
  await a.screenshot({ path: output + 'arena-map-selection-desktop.png' });
  await a.locator('#create').click();
  await expect(a.locator('#room')).toBeVisible();
  const arenaCode = await a.locator('#code').innerText();
  await b.locator('#room-code').fill(arenaCode); await b.locator('#join').click();
  for (const tab of [a, b]) await expect(tab.locator('#room-mode')).toContainText('기존 장애물');
  await a.locator('#ready').click(); await b.locator('#ready').click();
  await a.waitForFunction(() => {
    const state = (window as unknown as { arenaState: Game }).arenaState;
    return state?.map === 'arena' && state.phase === 'playing';
  });
  await a.bringToFront();
  await a.locator('#game').focus(); await a.keyboard.down('KeyW');
  await a.waitForTimeout(950); await a.keyboard.up('KeyW');
  await expect.poll(() => a.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.players[0].z)).toBeGreaterThan(4);
  await a.screenshot({ path: output + 'arena-desktop-top.png' });
  await finishDuel(a, b, 'arena');
  await a.locator('#ready').click(); await b.locator('#ready').click();
  await a.waitForFunction(() => {
    const state = (window as unknown as { arenaState: Game }).arenaState;
    return state?.map === 'arena' && state.round === 2 && state.phase === 'playing';
  });
  console.log('PASS arena: host map shared with guest, four-hit win, result and map-preserving rematch.');
  await a.context().close();
  await b.context().close();
  const mobile = await page(true);
  await mobile.locator('#map').selectOption('arena');
  await mobile.locator('#map').selectOption('ward');
  await mobile.locator('#fps-view').tap();
  await expect(mobile.locator('#mode')).toHaveValue('duel');
  await mobile.screenshot({ path: output + 'map-selection-mobile.png' });
  await mobile.locator('#practice').click();
  await expect(mobile.locator('#players li')).toHaveCount(2);
  await mobile.locator('#ready').click();
  await mobile.waitForFunction(() => (window as unknown as { arenaState: Game }).arenaState?.phase === 'playing');
  await expect(mobile.locator('#touch-controls')).toBeVisible();
  const initial = await mobile.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.players[0].z);
  const pad = await mobile.locator('#move-pad').boundingBox();
  const cdp = await mobile.context().newCDPSession(mobile);
  const point = { x: pad!.x + pad!.width / 2, y: pad!.y + 18 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await mobile.waitForTimeout(400);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => mobile.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.players[0].z)).toBeGreaterThan(initial + .4);
  await mobile.screenshot({ path: output + 'mobile-fps-moving.png' });
  await expect(mobile.locator('#top-view')).toBeDisabled();
  await expect(mobile.locator('#crosshair')).toBeVisible();
  const yaw = await mobile.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.players[0].yaw);
  const aim = await mobile.locator('#aim-pad').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: aim!.x + 30, y: aim!.y + 50, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: aim!.x + 80, y: aim!.y + 50, id: 1 }] });
  await mobile.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => mobile.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.players[0].yaw)).not.toBe(yaw);
  await mobile.screenshot({ path: output + 'mobile-fps.png' });
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.screenshot({ path: output + 'mobile-portrait.png' });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  console.log('PASS: Full duel, winner and rematch, ward boundary, both cameras, mobile touch movement/aim, portrait layout, no page errors.');
} finally { await browser.close(); }
