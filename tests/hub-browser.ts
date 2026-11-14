import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const capture = process.env.SCREENSHOTS === '1';
const browser = await chromium.launch({ channel: 'chromium',
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
if (capture) await mkdir('artifacts/sideplay', { recursive: true });
const errors: string[] = [];
const issues: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript('window.__name = (fn) => fn;');
  const page = await context.newPage();
  async function activate(selector: string) {
    const control = page.locator(selector);
    if (process.env.KEYBOARD_ONLY === '1') await control.press('Enter');
    else await control.click();
  }
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator('#nickname-gate')).toBeVisible();
  await expect(page).toHaveTitle(/SIDEPLAY/);
  await expect(page.locator('#gate-name')).toBeFocused();
  if (capture) await page.screenshot({ path: 'artifacts/sideplay/gate-mobile.png', animations: 'disabled' });
  await page.locator('#gate-name').fill('가나다라마바사아자차카타');
  await page.locator('#gate-name').press('Enter');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#open-rooms')).toBeVisible();
  await expect(page.locator('#me-name')).toHaveText('가나다라마바사아자차카타');
  await activate('#me-edit');
  await page.locator('#me-input').fill('우인우');
  await page.locator('#me-input').press('Enter');
  await expect(page.locator('#me-name')).toHaveText('우인우');
  await page.reload();
  await expect(page.locator('#nickname-gate')).toBeHidden();
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#me-name')).toHaveText('우인우');
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [412, 915], [667, 375], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(page.locator('#hub')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // The shelf scrolls instead of paging: every game is on it at every size.
    await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(17);
    await expect(page.locator('.game-pagination')).toBeHidden();
    const measured = await page.evaluate(() => {
      const hub = document.getElementById('hub')!;
      const targets = [...document.querySelectorAll<HTMLElement>('.game-option, .game-filters button, #me-edit')].filter(el => el.getClientRects().length);
      return {
        horizontal: document.documentElement.scrollWidth > innerWidth + 1 || hub.scrollWidth > hub.clientWidth + 1,
        vertical: hub.scrollHeight > hub.clientHeight + 1,
        outside: targets.filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map(el => el.textContent?.trim()),
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
    if (measured.horizontal || measured.outside.length) issues.push(`${width}x${height}: ${JSON.stringify(measured)}`);
    assert.equal(measured.background, 'rgb(12, 19, 16)', 'the hub uses the dark client palette');
    if (capture && (width === 390 || width === 1440)) await page.screenshot({ path: `artifacts/sideplay/hub-${width}.png`, animations: 'disabled' });
    console.log(`HUB ${width}x${height}: ${JSON.stringify(measured)}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(17);
  // Bot-capable games offer a second door straight into a solo game.
  // Picking a game in the library shows its page; bot-capable games offer a second door straight into a solo game.
  await activate('.game-cell[data-game="gomoku"] .game-option');
  await expect(page.locator('#hd-title')).toHaveText('오목');
  await expect(page.locator('#hub-solo')).toHaveText('봇이랑 하기');
  await activate('.game-cell[data-game="chess"] .game-option');
  await expect(page.locator('#hd-title')).toHaveText('체스');
  await expect(page.locator('#hub-solo')).toBeHidden();
  await activate('.game-cell[data-game="bumper"] .game-option');
  await expect(page.locator('#hub-solo')).toBeVisible();
  await page.locator('#game-search').fill('숫자');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.game-cell[data-game="davinci"]')).toBeVisible();
  await page.locator('#game-search').fill('없는게임입니다');
  await expect(page.locator('#game-empty')).toBeVisible();
  await activate('#game-reset');
  await expect(page.locator('#game-search')).toBeFocused();
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(17);
  await activate('[data-filter="mind"]');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(5);
  await expect(page.locator('[data-filter="mind"]')).toHaveAttribute('aria-pressed', 'true');
  await activate('[data-filter="all"]');
  await expect(page.locator('.game-cell[data-game="cleaver"] .game-players')).toHaveText('1–6인');
  await expect(page.locator('.game-cell[data-game="chess"] .game-players')).toHaveText('2인');
  await expect(page.locator('.game-cell[data-game="gomoku"] .game-players')).toHaveText('1–2인');
  await page.locator('#game-players').selectOption('1');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(10);
  await expect(page.locator('.game-cell[data-game="gomoku"]')).toBeVisible();
  await page.locator('#game-players').selectOption('3');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(10);
  await expect(page.locator('.game-cell[data-game="chess"]')).toBeHidden();
  await activate('[data-filter="mind"]');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(5);
  await page.locator('#game-players').selectOption('5');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(4);
  await page.locator('#game-search').fill('없는게임입니다');
  await activate('#game-reset');
  await expect(page.locator('#game-players')).toHaveValue('');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(17);
  await activate('.game-cell[data-game="chess"] .game-option');
  await activate('#hub-play');
  await expect(page.locator('#t-room')).toBeVisible();
  await expect(page).toHaveTitle(/체스 · SIDEPLAY$/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--app-bg').trim()), '#0c1310', 'a room opens as the dark client window until the match starts');
  await activate('#games-menu');
  await expect(page.locator('#hub')).toBeVisible();
  // Rooms tab: every open room in one table, plus joining by code.
  await activate('.client-nav [data-view="rooms"]');
  await expect(page.locator('#hub-rooms')).toBeVisible();
  await expect(page.locator('#hub-detail')).toBeHidden();
  await page.locator('#code-join-input').fill('zz');
  await page.locator('#code-join-input').press('Enter');
  await expect(page.locator('#code-join-error')).toContainText('6자리');
  await page.locator('#code-join-input').fill('ABCDEF');
  await page.locator('#code-join-input').press('Enter');
  await expect(page.locator('#code-join-error')).toContainText('열린 방 목록에 없는');
  await activate('.client-nav [data-view="library"]');
  // On a desktop the library opens on its home: every game as a cover grid; a tile opens that game's page.
  // (Phones browse the list itself as a grid, so they have no separate home.)
  await expect(page.locator('#hub-home')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#hub-home')).toBeVisible();
  await expect(page.locator('#hub-home .home-tile:not([hidden])')).toHaveCount(await page.locator('.game-cell').count() + (await page.locator('#home-recent .home-tile').count()));
  await activate('#hub-home .home-shelf:not(#home-recent) .home-tile[data-game="chess"]');
  await expect(page.locator('#hub-detail')).toBeVisible();
  await expect(page.locator('#hd-title')).toHaveText('체스');
  await activate('#hd-back');
  await expect(page.locator('#hub-home')).toBeVisible();
  const manifest = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.short_name, 'SIDEPLAY');
  assert.equal((await page.request.get(`${base}/icons/sideplay.svg`)).status(), 200);
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(issues, [], 'The game shelf must fit phone screens without horizontal clipping');
  console.log(`PASS hub (${process.env.KEYBOARD_ONLY === '1' ? 'keyboard' : 'pointer'}): first visit, name edit/persistence, library at every size, filters, search/empty/reset, game page, room creation, return, rooms tab and branding.`);
  await context.close();
} finally {
  await browser.close();
}
