import { chromium, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TableId } from '../shared/catalog.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/home/rst010/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors: string[] = [];
try {
  const cases: { kind: TableId; variant?: 'animal' | 'genius' }[] = ['gomoku', 'quoridor', 'janggi', 'poker', 'chess'].map(kind => ({ kind: kind as TableId }));
  cases.push({ kind: 'janggi', variant: 'genius' });
  for (const { kind, variant } of cases) {
    if (process.argv.includes('--poker-only') && kind !== 'poker') continue;
    const ca = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const cb = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const a = await ca.newPage(), b = await cb.newPage();
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    if (kind === 'poker') {
      for (const model of ['poker-lounge', 'poker-person']) {
        const asset = await a.request.get(`${base}/models/${model}.glb`);
        expect(asset.status()).toBe(200); expect(asset.headers()['content-type']).toContain('model/gltf-binary');
        expect((await asset.body()).subarray(0, 4).toString()).toBe('glTF');
      }
    }
    await a.goto(`${base}/?game=${kind}`);
    await a.locator('#t-name').fill('민트친구');
    if (kind === 'poker') await a.locator('#t-variant').selectOption('party');
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
    async function move(page: Page, cells: (string | number)[]) {
      await expect(page.locator('#t-turn')).toContainText('내 차례!');
      for (const cell of cells) await page.locator(`[data-${kind === 'chess' ? 'square' : 'cell'}="${cell}"]`).click();
      await page.locator('#t-confirm').click();
    }
    if (kind === 'chess') {
      for (const [i, cells] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']].entries()) await move(i % 2 ? b : a, cells);
      await expect(a.locator('#t-log')).toContainText('체크메이트');
    } else if (kind === 'gomoku') {
      for (let c = 3; c <= 7; c++) {
        await move(a, [7 * 15 + c]);
        if (c < 7) await move(b, [8 * 15 + c]);
      }
      await expect(b.locator('.stone-0')).toHaveCount(5);
    } else if (kind === 'quoridor') {
      await a.getByRole('button', { name: '가로 벽', exact: true }).click();
      await move(a, [10]);
      await expect(b.locator('.q-wall')).toHaveCount(1);
      await move(b, [13]);
      await expect(a.locator('#t-turn')).toContainText('내 차례!');
      await a.getByRole('button', { name: '말 이동', exact: true }).click();
      for (let r = 7; r >= 0; r--) {
        await move(a, [r * 9 + 4]);
        if (r > 0) await move(b, [r % 2 ? 12 : 3]);
      }
      await expect(b.locator('[data-cell="4"] .seat-0')).toHaveCount(1);
    } else if (kind === 'janggi') {
      const moves = variant === 'genius' ? [[7, 4], [0, 3], [4, 1]] : [[7, 4], [1, 5], [10, 6], [0, 1], [9, 7]];
      for (const [i, cells] of moves.entries()) await move(i % 2 ? b : a, cells);
      await expect(a.locator('#t-log')).toContainText(variant === 'genius' ? '왕 포획 승리' : '상대가 둘 수 없어 승리');
    } else {
      for (const page of [a, b]) await expect(page.locator('#poker-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      for (const page of [a, b]) await expect(page.locator('#poker-canvas')).toHaveAttribute('data-models', 'blender');
      // Read the middle of the opponent's forehead card, not the DOM fallback.
      for (const page of [a, b]) await expect.poll(() => page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => {
        const source = document.getElementById('poker-canvas') as HTMLCanvasElement;
        const capture = document.createElement('canvas'); capture.width = source.width; capture.height = source.height;
        const context = capture.getContext('2d')!; context.drawImage(source, 0, 0);
        const depth = 5.7 * Math.cos(.17) - .43 * Math.sin(.17);
        const scale = source.height / (2 * depth * Math.tan(.82 / 2));
        const y = source.height / 2 - (.43 * Math.cos(.17) + 5.7 * Math.sin(.17)) * scale;
        const pixels = context.getImageData(Math.floor(source.width / 2 - .14 * scale), Math.floor(y - .17 * scale), Math.max(1, Math.floor(.28 * scale)), Math.max(1, Math.floor(.34 * scale))).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 200 && pixels[i] + pixels[i + 1] + pixels[i + 2] < 400) ink++;
        resolve(ink);
      }))), { timeout: 15_000 }).toBeGreaterThan(3);
      await expect(a.locator('[data-seat="0"] .poker-card-value')).toHaveText('비공개');
      await expect(b.locator('[data-seat="1"] .poker-card-value')).toHaveText('비공개');
      await expect(a.locator('[data-seat="1"] .poker-card-value')).toHaveText(/카드 \d+/);
      await a.screenshot({ path: output + 'poker-private.png', fullPage: true });
      await b.screenshot({ path: output + 'poker-private-mobile.png', fullPage: true });
      await a.getByRole('button', { name: '1칩 올리기', exact: true }).click();
      await expect(b.locator('.pot')).toContainText('모인 칩 3');
      for (const page of [a, b]) await expect(page.locator('#poker-canvas')).toHaveAttribute('data-bet-animations', '1');
      await expect(b.locator('[data-seat="1"] .poker-card-value')).toHaveText('비공개');
      await a.screenshot({ path: output + 'poker-bet-desktop.png', fullPage: true });
      await b.getByRole('button', { name: '1칩 콜', exact: true }).tap();
      await expect(a.locator('.poker-card-value')).not.toContainText(['비공개']);
    }
    for (const page of [a, b]) {
      await expect(page.locator('#t-turn')).toContainText(kind === 'poker' ? '승리' : `${kind === 'chess' ? '코랄' : '민트'}친구 승리`);
      await expect(page.locator('#t-ready')).toHaveText('다시 준비하기');
      await expect(page.locator('#t-board .board-cell:enabled')).toHaveCount(0);
      await expect(page.locator('#t-action-bar')).toBeHidden();
      await expect(page.locator('#t-error')).toBeEmpty();
    }
    const resultLabel = variant ? `${kind}-${variant}` : kind;
    await a.screenshot({ path: output + `${resultLabel}-finished-desktop.png`, fullPage: true });
    await b.screenshot({ path: output + `${resultLabel}-finished-mobile.png`, fullPage: true });
    await a.locator('#t-ready').click(); await b.locator('#t-ready').tap();
    for (const page of [a, b]) await expect(page.locator('#t-round')).toContainText('2번째');
    await expect(a.locator('#t-turn')).toContainText('내 차례!');
    if (kind === 'gomoku') await expect(a.locator('.stone')).toHaveCount(0);
    if (kind === 'quoridor') {
      await expect(a.locator('.q-wall')).toHaveCount(0);
      await expect(a.locator('[data-cell="76"] .seat-0')).toHaveCount(1);
    }
    if (kind === 'janggi') {
      await expect(a.locator('.janggi-piece')).toHaveCount(8);
      await expect(a.locator('.hand-row button')).toHaveCount(0);
    }
    if (kind === 'chess') await expect(a.locator('#t-board svg')).toHaveCount(32);
    if (kind === 'poker') {
      await expect(a.locator('[data-seat="0"] .poker-card-value')).toHaveText('비공개');
      await expect(a.locator('.pot')).toContainText('모인 칩 2');
    }
    const label = variant ? `${kind}-${variant}` : kind;
    await a.screenshot({ path: output + `${label}-desktop.png`, fullPage: true });
    await b.screenshot({ path: output + `${label}-mobile.png`, fullPage: true });
    expect(await b.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    console.log(`PASS ${label}: desktop/mobile full game, result, disabled board and clean rematch.`);
    await ca.close(); await cb.close();
  }
  expect(errors).toEqual([]);
} finally { await browser.close(); }
