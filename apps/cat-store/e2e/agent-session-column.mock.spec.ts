import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { chooseTheme, sendChat, gotoAgentPage, reloadAgentPage } from './helpers';
import path from 'path';
import fs from 'fs';

const MOCK_REPLY = 'SESSION-COL-MOCK-4b71';
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../../temp/artifacts/2026-08-12-093300-004-agent-page-session-column',
);

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test.beforeEach(async ({ page }) => {
  await page.addInitScript((reply) => {
    window.__WA_MOCK_SCRIPT__ = { text: reply, finishReason: 'stop' };
  }, MOCK_REPLY);
});

const rows = (page: Page) => page.locator('agent-page .session-row');
const activeRow = (page: Page) => page.locator('agent-page .session-row[aria-current="true"]');

test('1. Left column controls exist', async ({ page }) => {
  await gotoAgentPage(page);

  const newChat = page.locator('agent-page .new-chat');
  const configBtn = page.locator('agent-page .config-btn');
  const sessionList = page.locator('agent-page .session-list');

  await expect(newChat).toHaveText('+ New chat');
  await expect(configBtn).toHaveAttribute('aria-label', 'Config');
  await expect(sessionList).toBeVisible();

  const newChatBox = await newChat.boundingBox();
  const listBox = await sessionList.boundingBox();
  const configBox = await configBtn.boundingBox();

  expect(newChatBox!.y).toBeLessThan(listBox!.y);
  expect(listBox!.y).toBeLessThan(configBox!.y);
});

test('2. New chat creates a session and makes it active', async ({ page }) => {
  await gotoAgentPage(page);

  const initialCount = await rows(page).count();
  await page.locator('agent-page .new-chat').click();

  await expect(rows(page)).toHaveCount(initialCount + 1);
  await expect(activeRow(page)).toHaveCount(1);
  await expect(activeRow(page).locator('.session-title')).toHaveText('New chat');
});

test('3. The active row is distinguishable without colour', async ({ page }) => {
  await gotoAgentPage(page);

  const active = activeRow(page);
  await expect(active.locator('.active-bar')).toHaveCount(1);

  const nonActive = page.locator('agent-page .session-row[aria-current="false"]').first();
  if (await nonActive.count() > 0) {
    await expect(nonActive.locator('.active-bar')).toHaveCount(0);
  }

  const activeWeight = await active.locator('.session-title').evaluate((el: HTMLElement) => {
    return window.getComputedStyle(el).fontWeight;
  });
  expect(activeWeight).toBe('700');
});

test('4. Clicking a row switches to it and the chat shows that session\'s messages', async ({ page }) => {
  await gotoAgentPage(page);

  await sendChat(page, 'first');
  await expect(page.locator('agent-chat-panel agent-message-view').last()).toContainText(MOCK_REPLY);

  await page.waitForTimeout(800);
  const firstId = await activeRow(page).getAttribute('data-session-id');

  await page.locator('agent-page .new-chat').click();
  await expect(page.locator('agent-chat-panel agent-message-view')).toHaveCount(0);

  const firstRowTitle = page.locator(`agent-page .session-row[data-session-id="${firstId}"] .session-title`);
  await firstRowTitle.click();
  await expect(page.locator('agent-chat-panel agent-message-view').last()).toContainText(MOCK_REPLY);
});

test('5. Rename changes the title in the list', async ({ page }) => {
  await gotoAgentPage(page);

  const active = activeRow(page);
  await active.locator('.rename-btn').click();

  const input = active.locator('.rename-input');
  await expect(input).toBeFocused();

  await input.fill('Renamed-9f2a');
  await input.press('Enter');

  await expect(input).toHaveCount(0);
  await expect(active.locator('.session-title')).toHaveText('Renamed-9f2a');
});

test('6. A renamed title survives a reload', async ({ page }) => {
  await gotoAgentPage(page);

  const active = activeRow(page);
  await active.locator('.rename-btn').click();
  const input = active.locator('.rename-input');
  await input.fill('Renamed-9f2a');
  await input.press('Enter');
  await page.waitForTimeout(800);

  await reloadAgentPage(page);

  const renamedRow = page.locator('agent-page .session-title', { hasText: 'Renamed-9f2a' });
  await expect(renamedRow).toHaveCount(1);
});

test('7. Escape cancels a rename', async ({ page }) => {
  await gotoAgentPage(page);

  const active = activeRow(page);
  const beforeTitle = await active.locator('.session-title').textContent();

  await active.locator('.rename-btn').click();
  const input = active.locator('.rename-input');
  await input.fill('zzz');
  await input.press('Escape');

  await expect(input).toHaveCount(0);
  await expect(active.locator('.session-title')).toHaveText(beforeTitle!);
});

test('8. Deleting a non-active session removes only that row', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .new-chat').click();
  await expect(rows(page)).toHaveCount(2);

  const activeId = await activeRow(page).getAttribute('data-session-id');
  const otherRow = page.locator('agent-page .session-row[aria-current="false"]').first();
  const otherId = await otherRow.getAttribute('data-session-id');

  await otherRow.locator('.delete-btn').click();

  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator(`agent-page .session-row[data-session-id="${otherId}"]`)).toHaveCount(0);
  await expect(page.locator(`agent-page .session-row[data-session-id="${activeId}"]`)).toHaveAttribute('aria-current', 'true');
});

test('9. Deleting the ACTIVE session leaves a working page on a brand-new empty session', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .new-chat').click();
  await expect(rows(page)).toHaveCount(2);

  const beforeIds = await page.locator('agent-page .session-row').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-session-id'))
  );

  const deletedId = await activeRow(page).getAttribute('data-session-id');
  await activeRow(page).locator('.delete-btn').click();

  // (a) deleted row gone
  await expect(page.locator(`agent-page .session-row[data-session-id="${deletedId}"]`)).toHaveCount(0);

  // (b) exactly one new session active
  const afterActiveId = await activeRow(page).getAttribute('data-session-id');
  expect(beforeIds).not.toContain(afterActiveId);

  // (c) chat empty
  await expect(page.locator('agent-chat-panel agent-message-view')).toHaveCount(0);

  // (d) send & receive works
  await sendChat(page, 'after delete');
  await expect(page.locator('agent-chat-panel agent-message-view').last()).toContainText(MOCK_REPLY);
});

test('10. Config replaces the middle column and returns to the same conversation', async ({ page }) => {
  await gotoAgentPage(page);

  await sendChat(page, 'keep me');
  await expect(page.locator('agent-chat-panel agent-message-view').last()).toContainText(MOCK_REPLY);

  const configBtn = page.locator('agent-page .config-btn');
  await configBtn.click();

  const configView = page.locator('agent-page .config-view');
  await expect(configView).toBeVisible();
  await expect(page.locator('agent-chat-panel')).not.toBeVisible();
  await expect(configBtn).toHaveAttribute('aria-pressed', 'true');

  await configBtn.click();
  await expect(configView).toHaveCount(0);
  await expect(page.locator('agent-chat-panel')).toBeVisible();
  await expect(page.locator('agent-chat-panel agent-message-view').last()).toContainText(MOCK_REPLY);
});

test('13. The left column stays 200px and scrolls a long list', async ({ page }) => {
  await gotoAgentPage(page);

  for (let i = 0; i < 20; i++) {
    await page.locator('agent-page .new-chat').click();
    await page.waitForTimeout(100);
  }

  const colSessionsBox = await page.locator('agent-page .col-sessions').boundingBox();
  const colSideBox = await page.locator('agent-page .col-side').boundingBox();
  const colChatBox = await page.locator('agent-page .col-chat').boundingBox();

  expect(Math.abs(colSessionsBox!.width - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(colSideBox!.width - 320)).toBeLessThanOrEqual(1);
  expect(Math.abs(colChatBox!.width - (1280 - 200 - 320))).toBeLessThanOrEqual(1);

  const metrics = await page.locator('agent-page .session-list').evaluate((el) => {
    const col = el.closest('.col-sessions') as HTMLElement;
    const row = el.querySelector('.session-row') as HTMLElement;
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      colHeight: col?.getBoundingClientRect().height ?? 0,
      rowHeight: row?.getBoundingClientRect().height ?? 0,
    };
  });
  console.log('[SCENARIO 13 METRICS]', JSON.stringify(metrics));

  const isScrollable = await page.locator('agent-page .session-list').evaluate((el) => {
    return el.scrollHeight > el.clientHeight;
  });
  expect(isScrollable).toBe(true);

  const hasHorizScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  expect(hasHorizScroll).toBe(false);
});

test('14. Screenshots, chat state and config state, both themes', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  await gotoAgentPage(page);
  await page.locator('agent-page .new-chat').click();
  await sendChat(page, 'artifact test');
  await expect(page.locator('agent-chat-panel agent-message-view').last()).toContainText(MOCK_REPLY);

  // 1. Dark theme - chat
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'sessions-chat-dark.png'), fullPage: true });

  // 2. Dark theme - config
  await page.locator('agent-page .config-btn').click();
  await expect(page.locator('agent-page .config-view')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'sessions-config-dark.png'), fullPage: true });

  // Switch theme
  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'wa2-light');

  // 3. Light theme - config
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'sessions-config-light.png'), fullPage: true });

  // 4. Light theme - chat
  await page.locator('agent-page .config-btn').click();
  await expect(page.locator('agent-page .config-view')).toHaveCount(0);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'sessions-chat-light.png'), fullPage: true });
});
