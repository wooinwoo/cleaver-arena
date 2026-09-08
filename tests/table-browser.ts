import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TableId } from '../shared/catalog.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/home/rst010/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--no-sandbox'] });
const errors: string[] = [];
try {
  for (const kind of ['gomoku', 'quoridor', 'janggi', 'poker', 'chess'] as TableId[]) {
    const ca = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const cb = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const a = await ca.newPage(), b = await cb.newPage();
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    await a.goto(`${base}/?game=${kind}`);
    await a.locator('#t-name').fill('민트친구');
    await a.locator('#t-entry button[type=submit]').click();
    await expect(a.locator('#t-room')).toBeVisible();
    const code = await a.locator('#t-code').innerText();
    await b.goto(`${base}/?game=${kind}&room=${code}`);
    await b.locator('#t-name').fill('코랄친구');
    await b.locator('#t-join').click();
    await expect(a.locator('#t-players li')).toHaveCount(2);
    await a.locator('#t-ready').click(); await b.locator('#t-ready').click();
    await expect(a.locator('#t-turn')).toContainText('내 차례!');
    if (kind === 'chess') {
      await a.locator('[data-square="e2"]').click();
      await a.locator('[data-square="e4"]').click();
      await a.locator('#t-confirm').click();
      await expect(b.locator('[data-square="e4"] svg')).toHaveCount(1);
      await b.locator('[data-square="e7"]').tap();
      await b.locator('[data-square="e5"]').tap();
      await b.locator('#t-confirm').tap();
      await expect(a.locator('[data-square="e5"] svg')).toHaveCount(1);
    } else if (kind === 'gomoku') {
      await a.locator('[data-cell="112"]').click();
      await a.locator('#t-confirm').click();
      await expect(b.locator('.stone-0')).toHaveCount(1);
      await b.locator('[data-cell="113"]').tap();
      await b.locator('#t-confirm').tap();
      await expect(a.locator('.stone-1')).toHaveCount(1);
    } else if (kind === 'quoridor') {
      await a.getByRole('button', { name: '가로 벽', exact: true }).click();
      await a.locator('[data-cell="10"]').click();
      await a.locator('#t-confirm').click();
      await expect(b.locator('.q-wall')).toHaveCount(1);
      await b.locator('[data-cell="13"]').tap();
      await b.locator('#t-confirm').tap();
      await expect(a.locator('#t-turn')).toContainText('내 차례!');
    } else if (kind === 'janggi') {
      await a.locator('[data-cell="7"]').click();
      await a.locator('[data-cell="4"]').click();
      await a.locator('#t-confirm').click();
      await expect(b.locator('[data-cell="4"] .janggi-piece')).toHaveClass(/seat-0/);
      await expect(a.locator('.hand-row button')).toHaveCount(1);
    } else {
      await expect(a.locator('.playing-card').nth(0)).toHaveText('?');
      await expect(b.locator('.playing-card').nth(1)).toHaveText('?');
      await expect(a.locator('.playing-card').nth(1)).not.toHaveText('?');
      await a.screenshot({ path: output + 'poker-private.png', fullPage: true });
      await a.getByRole('button', { name: '체크', exact: true }).click();
      await b.getByRole('button', { name: '체크', exact: true }).tap();
      await expect(a.locator('#t-turn')).toContainText('승리');
      await expect(a.locator('.card-back')).toHaveCount(0);
      await a.locator('#t-ready').click(); await b.locator('#t-ready').tap();
      await expect(a.locator('.card-back')).toHaveCount(1);
      await expect(a.locator('#t-round')).toContainText('2번째');
    }
    await a.screenshot({ path: output + `${kind}-desktop.png`, fullPage: true });
    await b.screenshot({ path: output + `${kind}-mobile.png`, fullPage: true });
    expect(await b.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    console.log(`PASS ${kind}: desktop/mobile room, ready, action synchronization.`);
    await ca.close(); await cb.close();
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
