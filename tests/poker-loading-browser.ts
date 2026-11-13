import { chromium, expect, type Page, type Route } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3187';
const models = '**/models/*.glb';
const errors: string[] = [];
const browser = await chromium.launch({ channel: 'chromium',
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

async function pair() {
  const contexts = await Promise.all([
    // The PWA service worker fetches models itself, which page.route cannot hold back; this test needs to.
    browser.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'block' }),
    browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }),
  ]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  pages.forEach(page => {
    page.setDefaultTimeout(20_000);
    page.on('pageerror', error => errors.push(error.message));
  });
  return { contexts, pages };
}

async function join(page: Page, code: string, name: string) {
  await page.goto(`${base}/?game=poker&room=${code}`);
  await page.locator('#t-name').fill(name);
  await page.locator('#t-join').click();
  await expect(page.locator('#t-code')).toHaveText(code);
}

async function create(a: Page, b: Page) {
  await a.goto(`${base}/?game=poker`);
  await a.locator('#t-name').fill('로딩확인');
  await a.locator('#t-variant').selectOption('party');
  await a.locator('#t-entry button[type=submit]').click();
  await expect(a.locator('#t-code')).toBeVisible();
  const code = await a.locator('#t-code').innerText();
  await join(b, code, '상대확인');
  await expect(a.locator('#t-players li')).toHaveCount(2);
  return code;
}

async function start(a: Page, b: Page) {
  await a.locator('#t-ready').click();
  await b.locator('#t-ready').click();
  for (const page of [a, b]) await expect(page.locator('body')).toHaveAttribute('data-table-phase', 'playing');
}

function ownCard(page: Page) {
  return page.locator('.poker-player').filter({ hasText: '(나)' }).locator('.poker-card-value');
}

try {
  const first = await pair();
  const [a, b] = first.pages;
  const held: { page: Page; route: Route }[] = [];
  let released = false;
  for (const page of first.pages) await page.route(models, async route => {
    if (released) await route.continue();
    else held.push({ page, route });
  });
  const code = await create(a, b);
  await start(a, b);
  for (const page of first.pages) {
    await expect.poll(() => new Set(held.filter(request => request.page === page)
      .map(request => new URL(request.route.request().url()).pathname)).size, { timeout: 30_000 }).toBe(2);
    await expect(page.locator('#poker-canvas')).not.toHaveAttribute('data-ready', 'true');
  }
  await a.locator('#t-leave').click();
  await a.waitForURL(new URL('/', base).href);
  await expect(b.locator('#t-turn')).toContainText('접속 종료로 이번 판 취소');
  // Joining clears the survivor's finished match while both old GLB requests remain held.
  // Releasing first could let the old world finish loading and miss the cancellation race.
  await join(a, code, '다시입장');
  await expect(b.locator('body')).toHaveAttribute('data-table-phase', 'lobby');
  await expect(b.locator('#poker-canvas')).toHaveCount(0);
  released = true;
  const releaseResults = await Promise.allSettled(held.map(({ route }) => route.continue()));
  for (const result of releaseResults) if (result.status === 'rejected') {
    // Navigation and the disposed world's AbortController may have already cancelled these requests.
    expect(String(result.reason)).toMatch(/already handled|closed|aborted|cancelled|Invalid InterceptionId/i);
  }
  await Promise.all(first.pages.map(page => page.unroute(models)));
  await start(a, b);
  for (const page of first.pages) {
    await expect(page.locator('#poker-canvas[data-models="blender"][data-ready="true"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('#t-round')).toContainText('2번째');
    await expect(ownCard(page)).toHaveText('비공개');
    await expect(page.locator('.poker-scene-hint')).not.toContainText('열지 못해');
    await expect(page.locator('#t-error')).toBeEmpty();
  }
  await b.setViewportSize({ width: 667, height: 375 });
  await b.locator('#poker-canvas').evaluate(canvas => canvas.scrollIntoView({ block: 'start' }));
  const beforeSwipe = await b.evaluate(() => window.scrollY);
  await expect(b.locator('#poker-canvas')).toHaveCSS('touch-action', 'pan-y');
  const touch = await b.context().newCDPSession(b);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y: 260 }] });
  for (const y of [220, 180, 140, 100, 60]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330, y }] });
    await b.waitForTimeout(40);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await expect.poll(() => b.evaluate(() => window.scrollY)).toBeGreaterThan(beforeSwipe + 60);
  await expect(b.locator('.poker-actions')).toBeInViewport();
  await Promise.all(first.contexts.map(context => context.close()));
  console.log('PASS poker loading cancellation: leave and same-room reentry restore both Blender scenes without exposing own cards.');

  const second = await pair();
  const [fallbackA, fallbackB] = second.pages;
  const blocked = new Set<string>();
  for (const [index, page] of second.pages.entries()) await page.route(models, async route => {
    blocked.add(`${index}:${new URL(route.request().url()).pathname}`);
    await route.abort('failed');
  });
  await create(fallbackA, fallbackB);
  await start(fallbackA, fallbackB);
  await expect.poll(() => blocked.size, { timeout: 30_000 }).toBe(4);
  for (const page of second.pages) {
    await expect(page.locator('.poker-scene-hint')).toContainText('아래에 카드를 표시해요', { timeout: 45_000 });
    await expect(ownCard(page)).toHaveText('비공개');
    await expect(page.locator('.poker-player').filter({ hasNotText: '(나)' }).locator('.poker-card-value')).toHaveText(/^카드 (10|[1-9])$/);
    for (const face of await page.locator('.poker-card-value').all()) {
      await expect(face).not.toHaveClass(/\bsr-only\b/);
      await expect(face).toBeVisible();
      expect((await face.boundingBox())?.width ?? 0).toBeGreaterThan(20);
    }
    await expect(page.locator('#poker-canvas')).not.toHaveAttribute('data-ready', 'true');
  }
  await expect(fallbackA.getByRole('button', { name: '1칩 올리기', exact: true })).toBeEnabled();
  await fallbackA.getByRole('button', { name: '1칩 올리기', exact: true }).click();
  await expect(fallbackB.locator('.pot')).toContainText('모인 칩 3');
  await expect(ownCard(fallbackB)).toHaveText('비공개');
  await expect(ownCard(fallbackB)).not.toHaveClass(/\bsr-only\b/);
  await fallbackB.getByRole('button', { name: '1칩 콜', exact: true }).click();
  for (const page of second.pages) {
    await expect(page.locator('#t-turn')).toContainText('승리');
    await expect(page.locator('.poker-card-value')).toHaveText([/^카드 (10|[1-9])$/, /^카드 (10|[1-9])$/]);
    await expect(page.locator('.poker-actions')).toHaveCount(0);
    await expect(page.locator('#t-error')).toBeEmpty();
  }
  await Promise.all(second.contexts.map(context => context.close()));
  expect(errors).toEqual([]);
  console.log('PASS poker loading failure: readable private-card fallback supports raise, call and completed showdown without page errors.');
} finally {
  await browser.close();
}
