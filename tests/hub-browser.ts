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
    await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(width <= 480 || (width > height && height <= 650) ? 6 : 9);
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
    if (measured.horizontal || measured.outside.length || (width <= 480 && measured.vertical)) issues.push(`${width}x${height}: ${JSON.stringify(measured)}`);
    assert.equal(measured.background, 'rgb(246, 244, 237)');
    if (capture && (width === 390 || width === 1440)) await page.screenshot({ path: `artifacts/sideplay/hub-${width}.png`, animations: 'disabled' });
    console.log(`HUB ${width}x${height}: ${JSON.stringify(measured)}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(6);
  await activate('#game-next');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(3);
  await activate('#game-previous');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(6);
  await page.locator('#game-search').fill('숫자');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.game-cell[data-game="davinci"]')).toBeVisible();
  await page.locator('#game-search').fill('없는게임입니다');
  await expect(page.locator('#game-empty')).toBeVisible();
  await activate('#game-reset');
  await expect(page.locator('#game-search')).toBeFocused();
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(6);
  await activate('[data-filter="mind"]');
  await expect(page.locator('.game-cell:not([hidden])')).toHaveCount(3);
  await expect(page.locator('[data-filter="mind"]')).toHaveAttribute('aria-pressed', 'true');
  await activate('[data-filter="all"]');
  await activate('.game-cell[data-game="chess"] .game-option');
  await expect(page.locator('#t-room')).toBeVisible();
  await expect(page).toHaveTitle(/체스 · SIDEPLAY$/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--app-bg').trim()), '#0b0d14', 'game surfaces keep the existing palette');
  await activate('#games-menu');
  await expect(page.locator('#hub')).toBeVisible();
  const manifest = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.short_name, 'SIDEPLAY');
  assert.equal((await page.request.get(`${base}/icons/sideplay.svg`)).status(), 200);
  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(issues, [], 'The game library must fit phone screens without horizontal clipping or hidden pagination');
  console.log(`PASS hub (${process.env.KEYBOARD_ONLY === '1' ? 'keyboard' : 'pointer'}): first visit, name edit/persistence, responsive shelf, pagination, filters, search/empty/reset, room creation, return and branding.`);
  await context.close();
} finally {
  await browser.close();
}
