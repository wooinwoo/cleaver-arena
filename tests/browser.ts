import { chromium, expect } from '@playwright/test';
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
try {
  const a = await page();
  await a.screenshot({ path: output + 'desktop-lobby.png' });
  await a.locator('#nickname').fill('민트친구');
  await a.locator('#create').click();
  await expect(a.locator('#room')).toBeVisible();
  const code = await a.locator('#code').innerText();
  const b = await page();
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
  await a.locator('#fps-view').click();
  await expect(a.locator('#fps-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(a.locator('#crosshair')).toBeVisible();
  await a.screenshot({ path: output + 'desktop-fps.png' });
  const shotBefore = await a.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.nextShot);
  await a.locator('#game').focus();
  await a.keyboard.down('Space');
  await a.waitForTimeout(160);
  await a.keyboard.up('Space');
  await expect.poll(() => b.evaluate(() => (window as unknown as { arenaState: Game }).arenaState.nextShot)).toBeGreaterThan(shotBefore);
  await a.keyboard.press('KeyV');
  await expect(a.locator('#top-view')).toHaveAttribute('aria-pressed', 'true');
  await a.context().close();
  await b.context().close();
  const mobile = await page(true);
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
  await mobile.screenshot({ path: output + 'mobile-top.png' });
  await mobile.locator('#fps-view').tap();
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
  console.log('PASS: Two-browser room/movement/shots, both cameras, mobile touch movement/aim, portrait layout, no page errors.');
} finally { await browser.close(); }
