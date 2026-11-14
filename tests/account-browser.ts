import { chromium, expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createArenaServer } from '../server/index.ts';

// Runs against its own server with in-memory accounts, so nothing is written to ./data. Needs `npm run build` first.
const arena = createArenaServer();
await new Promise<void>(done => arena.server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${(arena.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({ channel: 'chromium', executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const errors: string[] = [];
async function visitor(width = 1280, height = 800): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript('window.__name = (fn) => fn;');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
const RESERVED = '이미 가입된 닉네임이에요. 로그인하거나 다른 닉네임을 써 주세요.';
try {
  // Sign up from the start window.
  const member = await visitor();
  await member.goto(base);
  await expect(member.locator('#gate-name')).toBeFocused();
  await member.locator('[data-gate="signup"]').click();
  await member.locator('#signup-name').fill('회원하나');
  await member.locator('#signup-password').fill('correct horse');
  await member.locator('#signup-password2').fill('different horse');
  await member.locator('#signup-form button[type=submit]').click();
  await expect(member.locator('#gate-error')).toContainText('일치하지 않아요');
  await member.locator('#signup-password2').fill('correct horse');
  await member.locator('#signup-form button[type=submit]').click();
  await expect(member.locator('#hub')).toBeVisible();
  await expect(member.locator('#me-name')).toHaveText('회원하나');
  await expect(member.locator('#me-status')).toContainText('회원');
  await expect(member.locator('#account-login')).toBeHidden();
  await expect(member.locator('#online-list')).toContainText('회원 · 로비');
  const cookies = await member.context().cookies();
  const session = cookies.find(cookie => cookie.name === 'sideplay_session');
  assert.ok(session?.httpOnly, 'the session cookie is HttpOnly');
  assert.equal(await member.evaluate(() => document.cookie.includes('sideplay_session')), false, 'scripts cannot read the session');

  // A member plays under the account nickname and is marked in the room.
  await member.locator('.game-cell[data-game="gomoku"] .game-option').click();
  await member.locator('#hub-play').click();
  await expect(member.locator('#t-room')).toBeVisible();
  await expect(member.locator('.slot.me .slot-member')).toHaveText('회원');
  const code = await member.locator('#t-code').innerText();

  // A guest cannot take the reserved nickname, in a room or at the hub, but can join under another one.
  const guest = await visitor(390, 844);
  await guest.goto(`${base}/?game=gomoku&room=${code}`);
  await guest.locator('#t-name').fill('회원하나');
  await guest.locator('#t-join').click();
  await expect(guest.locator('#t-error')).toHaveText(RESERVED);
  await guest.locator('#t-name').fill('손님');
  await guest.locator('#t-join').click();
  await expect(member.locator('#t-lobby-roster .slot:not(.empty)')).toHaveCount(2);
  await expect(member.locator('#t-lobby-roster .slot-member')).toHaveCount(1);

  const other = await visitor();
  await other.goto(base);
  await other.locator('#gate-name').fill('회원하나');
  await other.locator('#gate-name').press('Enter');
  await expect(other.locator('#login-form')).toBeVisible();
  await expect(other.locator('#gate-error')).toHaveText(RESERVED);
  await expect(other.locator('#login-name')).toHaveValue('회원하나');
  await other.locator('#login-password').fill('wrong password');
  await other.locator('#login-form button[type=submit]').click();
  await expect(other.locator('#gate-error')).toHaveText('닉네임 또는 비밀번호가 맞지 않아요.');
  await other.locator('#login-password').fill('correct horse');
  await other.locator('#login-form button[type=submit]').click();
  await expect(other.locator('#hub')).toBeVisible();
  await expect(other.locator('#me-status')).toContainText('회원');

  // The session survives a reload; signing out returns to the start window and frees nothing.
  await member.locator('#games-menu').click();
  await expect(member.locator('#hub')).toBeVisible();
  await member.reload();
  await expect(member.locator('#me-status')).toContainText('회원');
  await member.locator('#me-edit').click();
  await expect(member.locator('#member-name')).toHaveText('회원하나');
  await member.locator('#logout').click();
  await expect(member.locator('#gate-form')).toBeVisible();
  assert.equal(await member.evaluate(() => localStorage.getItem('cleaver-name')), null);
  await member.locator('#gate-name').fill('회원하나');
  await member.locator('#gate-name').press('Enter');
  await expect(member.locator('#gate-error')).toHaveText(RESERVED);

  // Guests still only need a nickname and can sign in later from the top bar.
  await member.locator('[data-gate="guest"]').click();
  await member.locator('#gate-name').fill('그냥손님');
  await member.locator('#gate-name').press('Enter');
  await expect(member.locator('#hub')).toBeVisible();
  await expect(member.locator('#me-status')).toContainText('비회원');
  await member.locator('#account-login').click();
  await expect(member.locator('#login-form')).toBeVisible();
  await member.locator('#gate-close').click();
  await expect(member.locator('#hub')).toBeVisible();

  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS accounts: sign-up, reserved nickname for guests, member badge, sign-in, reload, sign-out and guest play.');
} finally {
  await browser.close();
  await arena.close();
}
