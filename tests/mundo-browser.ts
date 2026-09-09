import { chromium, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Game } from '../shared/game.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
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
  for (const context of contexts) await context.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          if (message.type === 'state') (window as unknown as { arenaState: unknown }).arenaState = message.game;
        });
      }
    };
  });
  const [a, b] = await Promise.all(contexts.map(context => context.newPage()));
  for (const page of [a, b]) {
    page.setDefaultTimeout(30_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?game=cleaver`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loading')).toBeHidden({ timeout: 90_000 });
  }
  const state = (page: Page) => page.evaluate(() => (window as unknown as { arenaState: Game }).arenaState);
  async function spellControlsClear() {
    const [note, spells] = await Promise.all([b.locator('#view-note').boundingBox(), b.locator('#spell-controls').boundingBox()]);
    expect(!note || !!spells && (note.x + note.width <= spells.x || spells.x + spells.width <= note.x ||
      note.y + note.height <= spells.y || spells.y + spells.height <= note.y), 'The shared-view note must not cover spell cooldowns.').toBe(true);
  }
  async function playing(round: number, view: 'top' | 'fps') {
    for (const page of [a, b]) {
      await page.waitForFunction(({ round, view }) => {
        const game = (window as unknown as { arenaState: Game }).arenaState;
        return game?.phase === 'playing' && game.round === round && game.view === view;
      }, { round, view });
      await expect(page.locator('#game')).toHaveAttribute('data-models', 'mundo', { timeout: 90_000 });
      await expect(page.locator('#game')).toHaveAttribute('data-map-model', 'baron', { timeout: 90_000 });
      await expect(page.locator('#room-view')).toBeDisabled();
      await expect(page.locator('#top-view')).toBeHidden();
      await expect(page.locator('#fps-view')).toBeHidden();
      await page.locator('#game').focus(); await page.keyboard.press('KeyV');
      await expect(page.locator(`#${view}-view`)).toHaveAttribute('aria-pressed', 'true');
      expect((await state(page)).view).toBe(view);
    }
    await spellControlsClear();
  }

  await a.locator('#fps-view').click();
  await expect(a.locator('#fps-view')).toHaveAttribute('aria-pressed', 'true');
  await a.locator('#top-view').click();
  await a.locator('#map').selectOption('baron');
  await a.locator('#nickname').fill('민트친구');
  await a.locator('#create').click();
  await expect(a.locator('#code')).toBeVisible();
  const code = await a.locator('#code').innerText();
  await b.locator('#fps-view').tap();
  await b.locator('#nickname').fill('코랄친구');
  await b.locator('#room-code').fill(code); await b.locator('#join').tap();
  await expect(a.locator('#players li')).toHaveCount(2);
  for (const page of [a, b]) {
    await expect(page.locator('#top-view')).toBeDisabled();
    await expect(page.locator('#fps-view')).toBeDisabled();
    await expect(page.locator('#room-view')).toHaveValue('top');
  }
  await expect(a.locator('#room-view')).toBeEnabled();
  for (const id of ['room-view', 'flash-cooldown', 'ghost-cooldown']) await expect(b.locator(`#${id}`)).toBeDisabled();
  await b.locator('#ready').tap();
  await expect(b.locator('#ready')).toHaveText('준비 취소');
  await a.locator('#flash-cooldown').fill('3');
  await a.locator('#ghost-cooldown').fill('6');
  await a.locator('#apply-settings').click();
  for (const page of [a, b]) {
    await expect(page.locator('#flash-cooldown')).toHaveValue('3');
    await expect(page.locator('#ghost-cooldown')).toHaveValue('6');
    await expect(page.locator('#ready')).toHaveText('준비하기');
  }
  await b.locator('#room-settings').scrollIntoViewIfNeeded();
  await b.screenshot({ path: output + 'baron-mobile-settings.png', fullPage: true });
  await b.setViewportSize({ width: 844, height: 390 });
  await a.locator('#ready').click(); await b.locator('#ready').tap();
  await playing(1, 'top');
  await a.screenshot({ path: output + 'baron-top.png' });

  await a.bringToFront(); await a.locator('#game').focus();
  await a.keyboard.press('KeyF');
  await expect.poll(async () => (await state(b)).players[0].flashes).toBe(1);
  expect((await state(b)).players[0].x).toBeCloseTo(-1, 2);
  await expect.poll(async () => (await state(a)).players[0].flashes).toBe(1);
  await a.keyboard.press('KeyF');
  expect((await state(a)).players[0].flashes).toBe(1);
  await a.keyboard.press('KeyG');
  await expect(a.locator('#ghost-status')).toContainText('가속');
  await expect(a.locator('#ghost')).toBeDisabled();
  await b.locator('#flash').tap();
  await expect.poll(async () => (await state(a)).players[1].flashes).toBe(1);
  expect((await state(a)).players[1].x).toBeCloseTo(1, 2);
  await b.locator('#ghost').tap();
  await expect(b.locator('#ghost-status')).toContainText('가속');
  await expect(b.locator('#ghost')).toBeDisabled();
  await b.screenshot({ path: output + 'baron-spells.png' });
  await a.bringToFront(); await a.locator('#game').focus();
  await a.keyboard.down('KeyD');
  await a.waitForTimeout(500); await a.keyboard.up('KeyD');
  await expect.poll(async () => (await state(b)).players[0].x).toBeCloseTo(-.5, 2);

  // Project the stationary opponent onto the same top-view camera used by the existing duel test.
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
    const [me, opponent] = (await state(a)).players;
    return Math.abs(me.yaw - Math.atan2(opponent.x - me.x, opponent.z - me.z));
  }, { timeout: 15_000 }).toBeLessThan(.03);
  await a.locator('#game').focus(); await a.keyboard.down('Space');
  await a.waitForFunction(() => (window as unknown as { arenaState: Game }).arenaState.phase === 'finished', undefined, { timeout: 20_000 });
  await a.keyboard.up('Space');
  for (const page of [a, b]) {
    await expect(page.locator('.room-title')).toHaveText('민트친구 승리');
    expect((await state(page)).players[1].hp).toBe(0);
  }
  await a.locator('#room-view').selectOption('fps');
  await a.locator('#apply-settings').click();
  await expect(b.locator('#room-view')).toHaveValue('fps');
  await a.locator('#ready').click(); await b.locator('#ready').tap();
  await playing(2, 'fps');
  for (const page of [a, b]) {
    await expect(page.locator('#crosshair')).toBeVisible();
    expect((await state(page)).spellCooldowns).toEqual({ flash: 3, ghost: 6 });
    expect((await state(page)).players.every(player => player.hp === 100 && player.flashes === 0)).toBe(true);
    await expect(page.locator('#error')).toBeEmpty();
  }
  await a.screenshot({ path: output + 'baron-fps.png' });
  await b.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const id of ['flash', 'ghost', 'move-pad', 'aim-pad']) await expect(b.locator(`#${id}`)).toBeInViewport();
  await spellControlsClear();
  expect(errors).toEqual([]);
  console.log('PASS Mundo: shared host settings, fixed top/FPS views, real models, PC/mobile spells, center boundary, four-hit win and rematch.');
} finally { await browser.close(); }
