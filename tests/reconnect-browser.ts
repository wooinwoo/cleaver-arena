import assert from 'node:assert/strict';
import { createServer, connect, type Socket } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { createArenaServer } from '../server/index.ts';

const arena = createArenaServer();
await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
const port = (arena.server.address() as { port: number }).port;
const tunnels: { front: Socket; back: Socket; dropped: boolean; path: string }[] = [];
const proxy = createServer(front => {
  const back = connect(port, '127.0.0.1');
  const tunnel = { front, back, dropped: false, path: '' };
  tunnels.push(tunnel);
  front.on('data', data => {
    const path = /^GET (\/ws|\/table-ws) /.exec(data.toString())?.[1];
    if (path) tunnel.path = path;
    if (!tunnel.dropped) back.write(data);
  });
  back.on('data', data => { if (!tunnel.dropped) front.write(data); });
  front.on('end', () => { if (!tunnel.dropped) back.end(); });
  back.on('end', () => { if (!tunnel.dropped) front.end(); });
  front.on('error', () => { if (!tunnel.dropped) back.destroy(); });
  back.on('error', () => front.destroy());
});
await new Promise<void>(done => proxy.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/home/rst010/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors: string[] = [];
try {
  for (const kind of ['gomoku', 'cleaver']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const messages: { type: string }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', ws => ws.on('framereceived', event => {
      messages.push(JSON.parse(String(event.payload)));
    }));
    await page.goto(`${base}/?game=${kind}`);
    await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
    await page.locator(kind === 'cleaver' ? '#nickname' : '#t-name').fill('복귀 확인');
    await page.locator(kind === 'cleaver' ? '#create' : '#t-entry button[type=submit]').click();
    const code = page.locator(kind === 'cleaver' ? '#code' : '#t-code');
    await expect(code).toBeVisible();
    const originalCode = await code.innerText();
    const sessionKey = kind === 'cleaver' ? 'cleaver-session' : 'table-session-gomoku';
    const originalSession = await page.evaluate(key => sessionStorage.getItem(key), sessionKey);
    assert.ok(originalSession);
    const path = kind === 'cleaver' ? '/ws' : '/table-ws';
    const old = tunnels.find(tunnel => tunnel.path === path && !tunnel.dropped);
    assert.ok(old);
    // A lost mobile route delivers neither packets nor FIN to the old server socket.
    old.dropped = true;
    const joinedBefore = messages.filter(message => message.type === 'joined').length;
    await page.reload();
    await expect.poll(() => messages.filter(message => message.type === 'joined').length, { timeout: 45_000 }).toBe(joinedBefore + 1);
    await expect(code).toHaveText(originalCode);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), sessionKey), originalSession);
    assert.ok(messages.some(message => message.type === 'error'), 'The new connection must retry while the old connection is still alive.');
    assert.equal(messages.some(message => message.type === 'expired'), false);
    console.log(`PASS ${kind}: lost TCP route recovers the same room and token without false expiration.`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  for (const { front, back } of tunnels) { front.destroy(); back.destroy(); }
  await new Promise<void>(done => proxy.close(() => done()));
  await arena.close();
}
