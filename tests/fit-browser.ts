import { chromium } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { WebSocket } from 'ws';
import { mkdir } from 'node:fs/promises';
import type { TableId } from '../shared/catalog.ts';

// Playing state must fit the viewport without scrolling on phones or desktop.
// Requires a running server (same as test:tables). Override with BASE_URL.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const viewports: [number, number][] = [[320, 568], [360, 640], [390, 844], [1280, 900]];
const cases: { kind: TableId; seats: number }[] = [
  { kind: 'gomoku', seats: 2 }, { kind: 'quoridor', seats: 2 }, { kind: 'janggi', seats: 2 },
  { kind: 'poker', seats: 2 }, { kind: 'chess', seats: 2 },
  { kind: 'davinci', seats: 2 }, { kind: 'davinci', seats: 4 },
  { kind: 'coup', seats: 2 }, { kind: 'coup', seats: 6 },
  { kind: 'splendor', seats: 2 }, { kind: 'splendor', seats: 4 },
];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox'],
});
await mkdir('artifacts', { recursive: true });
const layoutIssues: string[] = [];
try {
  for (const [width, height] of viewports) {
    for (const { kind, seats } of cases) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 760, hasTouch: width < 760 });
      await context.addInitScript(() => localStorage.setItem('cleaver-name', '맞춤검사'));
      const page = await context.newPage();
      try {
        await page.goto(`${base}/?game=${kind}`);
        await page.locator('#t-name').fill('맞춤검사');
        await page.locator('#t-entry button[type=submit]').click();
        await page.locator('#t-room').waitFor();
        const code = await page.locator('#t-code').innerText();
        const rivals: WebSocket[] = [];
        for (let i = 1; i < seats; i++) {
          const ws = new WebSocket(base.replace('http', 'ws') + '/table-ws');
          rivals.push(ws);
          await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
          ws.send(JSON.stringify({ type: 'join', game: kind, code, name: 'rival' + i }));
        }
        for (const ws of rivals) ws.send(JSON.stringify({ type: 'ready' }));
        await page.locator('#t-ready').click();
        await page.waitForFunction(() => document.body.dataset.tablePhase === 'playing');
        await page.waitForTimeout(200);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const measured = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));
        if (measured.scrollWidth > measured.innerWidth + 1) layoutIssues.push(`${width}x${height} ${kind}x${seats}: horizontal overflow ${measured.scrollWidth} > ${measured.innerWidth}`);
        if (measured.scrollHeight > measured.innerHeight + 1) layoutIssues.push(`${width}x${height} ${kind}x${seats}: vertical scroll ${measured.scrollHeight} > ${measured.innerHeight}`);
        if (kind === 'coup' || kind === 'davinci') {
          const namesVisible = await page.locator(kind === 'coup' ? '.coup-player > header' : '.davinci-rack > header').evaluateAll(headers => headers.length > 0 && headers.every(header => header.getBoundingClientRect().height > 0));
          assert.ok(namesVisible, `${kind}: player identities must remain visible during play`);
        }
        if (width === 320) await page.screenshot({ path: `artifacts/fit-${kind}-${seats}.png` });
        console.log(`FIT ${width}x${height} ${kind}x${seats}`);
        for (const ws of rivals) { try { ws.send(JSON.stringify({ type: 'leave' })); ws.close(); } catch { /* noop */ } }
      } finally {
        await context.close();
      }
    }
  }
  assert.deepEqual(layoutIssues, [], 'All game layouts must fit.');
  console.log('PASS fit: every game fits its viewport while playing.');
} finally {
  await browser.close();
}
