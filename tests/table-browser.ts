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
  const cases: { kind: TableId; variant?: 'animal' | 'genius' }[] = ['gomoku', 'quoridor', 'janggi', 'poker', 'chess'].map(kind => ({ kind: kind as TableId }));
  cases.push({ kind: 'janggi', variant: 'genius' });
  for (const { kind, variant } of cases) {
    const ca = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const cb = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const a = await ca.newPage(), b = await cb.newPage();
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    await a.goto(`${base}/?game=${kind}`);
    await a.locator('#t-name').fill('민트친구');
    if (variant) await a.locator('#t-variant').selectOption(variant);
    if (variant) await a.screenshot({ path: output + 'janggi-rules-desktop.png', fullPage: true });
    await a.locator('#t-entry button[type=submit]').click();
    await expect(a.locator('#t-room')).toBeVisible();
    const code = await a.locator('#t-code').innerText();
    await b.goto(`${base}/?game=${kind}&room=${code}`);
    await b.locator('#t-name').fill('코랄친구');
    if (variant) {
      await b.locator('#t-variant').selectOption(variant);
      await b.screenshot({ path: output + 'janggi-rules-mobile.png', fullPage: true });
      await b.locator('#t-variant').selectOption('animal');
    }
    await b.locator('#t-code-input').press('Enter');
    await expect(a.locator('#t-players li')).toHaveCount(2);
    await expect(b.locator('#t-code')).toHaveText(code);
    if (kind === 'janggi') {
      for (const page of [a, b]) {
        await expect(page.locator('#t-rules-title')).toContainText(variant === 'genius' ? '더 지니어스 기본룰' : '동물장기');
        await expect(page.locator('#t-rules-text')).toContainText(variant === 'genius' ? '상대 끝줄에는 어떤 포로도 투입할 수 없어요' : '끝줄 투입을 허용');
      }
    }
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
    const label = variant ? `${kind}-${variant}` : kind;
    await a.screenshot({ path: output + `${label}-desktop.png`, fullPage: true });
    await b.screenshot({ path: output + `${label}-mobile.png`, fullPage: true });
    expect(await b.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    console.log(`PASS ${label}: desktop/mobile room, ready, action synchronization.`);
    await ca.close(); await cb.close();
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
