import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const errors: string[] = [];
try {
  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]] as const) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/?game=gomoku`);
    await page.locator('#t-name').fill('혼자');
    await page.locator('#t-entry button[type=submit]').click();
    await expect(page.locator('#t-bot')).toBeVisible();
    await page.locator('#t-bot').click();
    await expect(page.locator('#t-players li')).toHaveCount(2);
    await expect(page.locator('#t-bot')).toBeHidden();
    await expect(page.locator('#t-turn')).toContainText('내 차례!');
    await page.locator('[data-cell="112"]').click();
    await page.locator('#t-confirm').click();
    await expect(page.locator('.stone')).toHaveCount(2);
    await expect(page.locator('#t-turn')).toContainText('내 차례!');
    await page.screenshot({ path: `${output}gomoku-bot-${name}.png` });
    await context.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS bot: a lone player starts gomoku with the bot and gets a reply on desktop and mobile.');
} finally {
  await browser.close();
}
