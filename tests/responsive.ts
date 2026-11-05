import { chromium, expect, type Page } from '@playwright/test';
import { WebSocket } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3186';
const audit = process.env.LAYOUT_AUDIT === '1';
const output = fileURLToPath(new URL(`../artifacts/responsive-${audit ? 'before' : 'after'}/`, import.meta.url));
await mkdir(output, { recursive: true });
const sizes = [[320, 300], [390, 300], [320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [568, 320], [667, 375], [844, 390], [1024, 600], [768, 1024], [820, 1180], [1024, 768], [1440, 900]];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const failures: string[] = [], errors: string[] = [];
const peers: WebSocket[] = [];
async function peer(path: string, request: object) {
  const ws = new WebSocket(base.replace('http', 'ws') + path);
  peers.push(ws);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify(request));
  return ws;
}
async function check(page: Page, surface: string, hud = false) {
  // Installed-app eligibility adds a real header control absent in headless Chrome.
  if (!hud) await page.evaluate(() => { document.getElementById('install-app')!.hidden = false; });
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const issues = await page.evaluate(({ hud, fitPage }) => {
      const found: string[] = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) found.push('page horizontal overflow');
      if (fitPage && document.documentElement.scrollHeight > innerHeight + 1) found.push(`page vertical overflow ${document.documentElement.scrollHeight} > ${innerHeight}`);
      const hub = document.querySelector<HTMLElement>('#hub');
      if (fitPage && document.body.classList.contains('in-hub') && hub && hub.scrollHeight > hub.clientHeight + 1) found.push('game finder vertical overflow');
      const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      for (const selector of ['header', '#hub', '#lobby', '#t-board-wrap', '#t-players', '.table-status', '.poker-table', '#t-toolbar', '#t-action-bar', '.coup-board', '.davinci-board', '.poker-bet-size', '.table-invite', '.spell-settings']) {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el || !visible(el)) continue;
        if (el.scrollWidth > el.clientWidth + 2) found.push(`${selector} clipped content`);
        const rect = el.getBoundingClientRect();
        if (rect.left < -1 || rect.right > innerWidth + 1) found.push(`${selector} outside viewport`);
      }
      const overlaps = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const selectors = hud ? ['.health-panel', '#view-note', '#spell-controls', '#fire', '#move-pad', '#aim-pad', '#match-leave', '.match-bar', '.header-actions', '#announcement'] : ['.brand', '.header-actions'];
      const elements = selectors.map(selector => [selector, document.querySelector(selector)] as const).filter((entry): entry is readonly [string, Element] => !!entry[1] && visible(entry[1]) && (entry[0] !== '#announcement' || !!entry[1].textContent));
      for (let i = 0; i < elements.length; i++) {
        const [name, element] = elements[i], rect = element.getBoundingClientRect();
        if (rect.left < -1 || rect.right > innerWidth + 1 || (hud && (rect.top < 0 || rect.bottom > innerHeight + 1))) found.push(`${name} outside viewport`);
        for (let j = i + 1; j < elements.length; j++) if (overlaps(rect, elements[j][1].getBoundingClientRect())) found.push(`${name} overlaps ${elements[j][0]}`);
      }
      if (hud) {
        for (const selector of ['#flash', '#ghost', '#fire', '#move-pad', '#aim-pad', '#match-leave']) {
          const element = document.querySelector(selector)!;
          if (!visible(element)) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 44 || rect.height < 44) found.push(`${selector} touch target below 44px`);
          if (!element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))) found.push(`${selector} covered by another element`);
        }
        const fire = document.querySelector('#fire')!;
        if (visible(fire)) {
          const range = document.createRange(); range.selectNodeContents(fire);
          if (range.getClientRects().length > 1) found.push('fire label wraps');
        }
      }
      for (const input of document.querySelectorAll('input, select')) if (visible(input) && parseFloat(getComputedStyle(input).fontSize) < 16) found.push(`${input.id} triggers mobile focus zoom`);
      for (const button of document.querySelectorAll('button')) {
        if (!visible(button)) continue;
        const rect = button.getBoundingClientRect();
        if (rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1)) found.push(`button outside viewport: ${(button.textContent ?? '').trim().slice(0, 24)}`);
      }
      return found;
    }, { hud, fitPage: width <= 480 && height >= 568 && (surface === 'hub' || /entry|room|result/.test(surface)) });
    failures.push(...issues.map(issue => `${surface} ${width}x${height}: ${issue}`));
    if ([320, 667, 768, 1440].includes(width)) await page.screenshot({ path: `${output}${surface}-${width}x${height}.png`, fullPage: !hud });
  }
}
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript('window.__name = (fn) => fn; localStorage.setItem("cleaver-name", "테스트친구");');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const kind of (process.env.CLEAVER_ONLY === '1' ? [] : ['gomoku', 'quoridor', 'janggi', 'poker', 'chess', 'davinci', 'coup', 'splendor'])) {
    await page.goto(`${base}/?game=${kind}`);
    await check(page, `${kind}-entry`);
    await page.locator('#t-name').fill('가나다라마바사아자차카타');
    if (kind === 'poker') await page.locator('#t-variant').selectOption('party');
    await page.locator('#t-entry button[type=submit]').click();
    await expect(page.locator('#t-room')).toBeVisible();
    const code = await page.locator('#t-code').innerText();
    const rivals: WebSocket[] = [];
    for (let i = 1; i < (kind === 'poker' ? 6 : 2); i++) rivals.push(await peer('/table-ws', { type: 'join', game: kind, code, name: `abcdefghijkl`.slice(0, 11) + i }));
    await expect(page.locator('#t-players li')).toHaveCount(kind === 'poker' ? 6 : 2);
    if (kind === 'poker') await check(page, 'poker-room');
    for (const rival of rivals) rival.send(JSON.stringify({ type: 'ready' }));
    await page.locator('#t-ready').click();
    await expect(page.locator('#t-turn')).toContainText('내 차례');
    if (kind === 'poker') {
      await expect(page.locator('#poker-canvas')).toHaveAttribute('data-models', 'blender', { timeout: 60_000 });
      await expect(page.locator('#poker-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    }
    await check(page, `${kind}-playing`);
    if (kind === 'gomoku') {
      await page.locator('[data-cell="112"]').click();
      await expect(page.locator('#t-confirm')).toBeEnabled();
      await page.locator('#t-confirm').click();
      await expect(page.locator('#t-turn')).toContainText('abcdefghijk1');
    }
    for (const rival of rivals) { rival.send(JSON.stringify({ type: 'leave' })); rival.close(); }
    await page.locator('#games-menu').click();
  }
  for (const view of ['top', 'fps']) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.game-cell[data-game="cleaver"] .game-option')).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('#nickname-gate')).toBeHidden();
    if (view === 'top') {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.game-list .game-cell:not([hidden])')).toHaveCount(6);
      await page.setViewportSize({ width: 667, height: 375 });
      await expect(page.locator('.game-list .game-cell:not([hidden])')).toHaveCount(6);
      await page.locator('#game-next').click();
      await expect(page.locator('.game-list .game-cell:not([hidden])')).toHaveCount(3);
      await page.locator('#game-previous').click();
      await check(page, 'hub');
      await page.locator('#game-search').fill('숫자');
      await expect(page.locator('.game-list .game-cell:not([hidden])')).toHaveCount(1);
      await page.locator('#game-search').fill('');
      await page.locator('.game-filters [data-filter="mind"]').click();
      await expect(page.locator('.game-list .game-cell:not([hidden])')).toHaveCount(3);
      await page.locator('#game-search').fill('없는게임');
      await expect(page.locator('#game-empty')).toBeVisible();
      await page.locator('#game-reset').click();
      await expect(page.locator('.game-list .game-cell:not([hidden])')).toHaveCount(9);
      await page.screenshot({ path: `${output}hub-with-open-rooms-390x844.png`, fullPage: true });
    }
    await page.locator('.game-cell[data-game="cleaver"] .game-option').click();
    await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60_000 });
    if (view === 'top') await check(page, 'cleaver-entry');
    await page.locator('#nickname').fill('가나다라마바사아자차카타');
    await page.locator(`#${view}-view`).click();
    await page.locator('#create').click();
    await expect(page.locator('#room')).toBeVisible();
    const code = await page.locator('#code').innerText();
    const rival = await peer('/ws', { type: 'join', code, name: 'abcdefghijk1' });
    await expect(page.locator('#players li')).toHaveCount(2);
    if (view === 'top') await check(page, 'cleaver-room');
    rival.send(JSON.stringify({ type: 'ready' }));
    await page.locator('#ready').click();
    await expect(page.locator('#hud')).toBeVisible();
    if (view === 'fps') await expect(page.locator('#crosshair')).toBeVisible();
    await check(page, `cleaver-${view}`, true);
    rival.send(JSON.stringify({ type: 'leave' })); rival.close();
    await expect(page.locator('#room')).toBeVisible({ timeout: 30_000 });
    if (view === 'top') await check(page, 'cleaver-result');
    await page.locator('#leave').click();
  }
  failures.push(...errors.map(error => `browser: ${error}`));
  await writeFile(`${output}issues.json`, JSON.stringify(failures, null, 2));
  console.log(`${failures.length} responsive issues. Evidence: ${output}`);
  if (!audit) expect(failures).toEqual([]);
} finally { peers.forEach(ws => ws.terminate()); await browser.close(); }
