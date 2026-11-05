import { chromium, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Game } from '../shared/game.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
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
    localStorage.setItem('cleaver-name', '테스트친구');
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
  async function groundPoint(page: Page, x: number, z: number) {
    return page.evaluate(({ x, z }) => {
      const rect = document.getElementById('game')!.getBoundingClientRect(), aspect = rect.width / rect.height;
      const distance = Math.max(22, (10.6 / (Math.tan(.85 / 2) * aspect) + 10.5 * .6 + 3.645 * .8) / 1.25);
      const depth = 1.25 * distance + z * .6;
      return { x: rect.left + rect.width / 2 * (1 + x / (depth * Math.tan(.85 / 2) * aspect)),
        y: rect.top + rect.height / 2 * (1 - z * .8 / (depth * Math.tan(.85 / 2))) };
    }, { x, z });
  }
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
      await expect(page.locator('#ghost kbd')).toHaveText(view === 'top' ? 'D' : 'G');
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
  await a.locator('.settings-disclosure > summary').click();
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

  const feet = await groundPoint(a, -5, 0);
  await a.mouse.move(feet.x, feet.y);
  for (const first of ['right', 'left'] as const) {
    await a.mouse.down({ button: first });
    await a.mouse.down({ button: first === 'right' ? 'left' : 'right' });
    await expect.poll(async () => (await state(a)).players[0].input.fire).toBe(true);
    await a.mouse.up({ button: 'left' }); await a.mouse.up({ button: 'right' });
    await expect.poll(async () => (await state(a)).players[0].input.fire).toBe(false);
  }
  const flashAim = await groundPoint(a, 5, 0);
  await a.mouse.move(flashAim.x, flashAim.y);

  await a.bringToFront(); await a.locator('#game').focus();
  const beforeFlash = (await state(a)).players[0];
  await a.keyboard.press('KeyF');
  await expect.poll(async () => (await state(b)).players[0].flashes).toBe(1);
  expect((await state(b)).players[0].x - beforeFlash.x).toBeCloseTo(4, 2);
  await expect.poll(async () => (await state(a)).players[0].flashes).toBe(1);
  await a.keyboard.press('KeyF');
  expect((await state(a)).players[0].flashes).toBe(1);
  await a.keyboard.press('KeyD');
  await expect(a.locator('#ghost-status')).toContainText('가속');
  await expect(a.locator('#ghost')).toBeDisabled();
  await b.mouse.move(422, 195);
  const aimPad = (await b.locator('#aim-pad').boundingBox())!;
  const touchSession = await b.context().newCDPSession(b);
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: aimPad.x + aimPad.width / 2 - 25, y: aimPad.y + aimPad.height / 2, id: 1 }] });
  await b.waitForTimeout(200);
  await expect.poll(async () => Math.abs((await state(b)).players[1].yaw + Math.PI / 2)).toBeLessThan(.03);
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await touchSession.detach();
  await b.locator('#flash').tap();
  await expect.poll(async () => (await state(a)).players[1].flashes).toBe(1);
  expect((await state(a)).players[1].x).toBeCloseTo(1, 2);
  await b.locator('#ghost').tap();
  await expect(b.locator('#ghost-status')).toContainText('가속');
  await expect(b.locator('#ghost')).toBeDisabled();
  await b.screenshot({ path: output + 'baron-spells.png' });
  await a.bringToFront(); await a.locator('#game').focus();
  await a.mouse.click(800, 450, { button: 'right' });
  await expect.poll(async () => (await state(b)).players[0].x).toBeCloseTo(-.5, 2);

  // Project the stationary opponent onto the same top-view camera used by the existing duel test.
  const target = await a.evaluate(() => {
    const game = (window as unknown as { arenaState: Game }).arenaState, opponent = game.players[1];
    const rect = document.getElementById('game')!.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const halfWidth = game.map === 'arena' ? 12 : 10, halfDepth = game.map === 'arena' ? 9 : 10;
    const distance = Math.max(22, ((halfWidth + .6) / (Math.tan(.85 / 2) * aspect) + (halfDepth + .5) * .6 + 3.645 * .8) / 1.25);
    const depth = 1.25 * distance - 2.2 * .8 + opponent.z * .6;
    return { x: rect.left + rect.width / 2 * (1 + opponent.x / (depth * Math.tan(.85 / 2) * aspect)),
      y: rect.top + rect.height / 2 * (1 - (2.2 * .6 + opponent.z * .8) / (depth * Math.tan(.85 / 2))) };
  });
  await expect.poll(async () => {
    await a.mouse.move(target.x + 1, target.y); await a.mouse.move(target.x, target.y);
    const [me, opponent] = (await state(a)).players;
    return Math.abs(me.yaw - Math.atan2(opponent.x - me.x, opponent.z - me.z));
  }, { timeout: 15_000 }).toBeLessThan(.03);
  // Down and up in one browser task must still produce exactly one throw.
  await a.evaluate(({ x, y }) => {
    const canvas = document.getElementById('game')!;
    for (const type of ['mousedown', 'mouseup']) canvas.dispatchEvent(new MouseEvent(type, {
      button: 0, buttons: type === 'mousedown' ? 1 : 0, clientX: x, clientY: y, bubbles: true,
    }));
  }, target);
  await expect.poll(async () => (await state(b)).players[1].hp).toBe(75);
  await expect(a.locator('#hit-confirm')).toHaveText('명중 · 25');
  await expect(b.locator('#hit-confirm')).toBeEmpty();
  expect((await state(a)).hits).toHaveLength(1);
  await a.locator('#game').focus(); await a.keyboard.down('Space');
  await a.waitForFunction(() => (window as unknown as { arenaState: Game }).arenaState.phase === 'finished', undefined, { timeout: 20_000 });
  await a.keyboard.up('Space');
  for (const page of [a, b]) {
    await expect(page.locator('.room-title')).toHaveText('민트친구 승리');
    expect((await state(page)).players[1].hp).toBe(0);
    expect((await state(page)).hits).toHaveLength(4);
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
    expect((await state(page)).hits).toEqual([]);
    await expect(page.locator('#hit-confirm')).toBeEmpty();
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
