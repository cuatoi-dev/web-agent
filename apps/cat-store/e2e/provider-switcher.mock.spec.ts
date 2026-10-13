import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { chooseTheme, gotoAgentPage } from './helpers';
import path from 'path';
import fs from 'fs';

import type { AgentPageProbe } from './dom-types';
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../../temp/artifacts/2026-08-15-002512-002-four-entry-provider-model-mode-switcher',
);

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

const MOCK_REPLY = 'SWITCHER-MOCK-2f8c';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((reply) => {
    window.__WA_MOCK_SCRIPT__ = { text: reply, finishReason: 'stop' };
  }, MOCK_REPLY);
});

/** The entry list, read from the running page — never duplicated in the spec.
 *  `agent-page` is always mounted by the time a spec calls this (after
 *  gotoAgentPage), so `index` is asserted non-null once here instead of at
 *  every call site. */
const entries = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('app-root')?.shadowRoot
      ?.querySelector('agent-page') as AgentPageProbe | null;
    return { list: el?._entries ?? [], index: el!._entryIndex! };
  });

const rowCount = (page: Page) => page.locator('agent-page .session-row').count();

test('1. The provider trigger and the config button sit side by side in the footer', async ({ page }) => {
  await gotoAgentPage(page);

  const trigger = page.locator('agent-page .provider-trigger');
  const configBtn = page.locator('agent-page .config-btn');
  const sessions = page.locator('agent-page .col-sessions');

  await expect(trigger).toBeVisible();
  await expect(configBtn).toBeVisible();

  const triggerBox = (await trigger.boundingBox())!;
  const configBox = (await configBtn.boundingBox())!;
  const sessionsBox = (await sessions.boundingBox())!;

  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(configBox.x + 1);
  expect(triggerBox.x).toBeGreaterThanOrEqual(sessionsBox.x - 1);
  expect(configBox.x + configBox.width).toBeLessThanOrEqual(sessionsBox.x + sessionsBox.width + 1);
});

test('2. The trigger shows the active combination on load', async ({ page }) => {
  await gotoAgentPage(page);

  const { list, index } = await entries(page);
  const trigger = page.locator('agent-page .provider-trigger .provider-current');
  await expect(trigger).toHaveText(list[index].label);
});

test('3. Opening the trigger lists every entry, with the selected one checked', async ({ page }) => {
  await gotoAgentPage(page);

  const { list, index } = await entries(page);
  await page.locator('agent-page .provider-trigger').click();

  const options = page.locator('agent-page [role="option"]');
  await expect(options).toHaveCount(list.length);

  const labels = await page.locator('agent-page .option-label').allTextContents();
  expect(labels.map((l) => l.trim())).toEqual(list.map((e) => e.label));

  const selected = page.locator('agent-page [role="option"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute('data-entry-id', list[index].id);
  await expect(selected.locator('svg')).toHaveCount(1);
});

test('4. Picking the already-selected entry does nothing', async ({ page }) => {
  await gotoAgentPage(page);

  const { list, index } = await entries(page);
  const before = await rowCount(page);

  await page.locator('agent-page .provider-trigger').click();
  await page.locator(`agent-page [data-entry-id="${list[index].id}"]`).click();

  await expect(page.locator('agent-page .provider-list')).toHaveCount(0);
  await expect(page.locator('agent-page .confirm-scrim')).toHaveCount(0);
  expect(await rowCount(page)).toBe(before);
  expect((await entries(page)).index).toBe(index);
});

test('5. Picking a different entry opens the confirmation and writes nothing yet', async ({ page }) => {
  await gotoAgentPage(page);

  const { list, index } = await entries(page);
  const targetIndex = (index + 1) % list.length;
  const before = await rowCount(page);

  await page.locator('agent-page .provider-trigger').click();
  await page.locator(`agent-page [data-entry-id="${list[targetIndex].id}"]`).click();

  const scrim = page.locator('agent-page .confirm-scrim');
  await expect(scrim).toBeVisible();
  await expect(page.locator('agent-page .confirm-card')).toHaveAttribute('role', 'dialog');
  await expect(scrim).toContainText('replaces the current chat with a new one');
  await expect(scrim).toContainText(list[targetIndex].label);
  const text = (await scrim.textContent()) ?? '';
  expect(text).not.toContain('lost');

  expect(await rowCount(page)).toBe(before);
  expect((await entries(page)).index).toBe(index);
});

test('6. Cancel closes the dialog and writes nothing', async ({ page }) => {
  await gotoAgentPage(page);

  const { list, index } = await entries(page);
  const targetIndex = (index + 1) % list.length;
  const before = await rowCount(page);

  await page.locator('agent-page .provider-trigger').click();
  await page.locator(`agent-page [data-entry-id="${list[targetIndex].id}"]`).click();
  await page.locator('agent-page .confirm-cancel').click();

  await expect(page.locator('agent-page .confirm-scrim')).toHaveCount(0);
  await expect(page.locator('agent-page .provider-current')).toHaveText(list[index].label);
  expect(await rowCount(page)).toBe(before);

  const type = await page.evaluate(() => {
    const el = document.querySelector('app-root')?.shadowRoot
      ?.querySelector('agent-page') as AgentPageProbe | null;
    return el?._panel?.type;
  });
  expect(type).toBe('mock');
});

test('7. Confirm applies the entry and starts a new session', async ({ page }) => {
  await gotoAgentPage(page);

  const { list, index } = await entries(page);
  const targetIndex = (index + 1) % list.length;
  const target = list[targetIndex];
  const before = await rowCount(page);

  await page.locator('agent-page .provider-trigger').click();
  await page.locator(`agent-page [data-entry-id="${target.id}"]`).click();
  await page.locator('agent-page .confirm-ok').click();

  await expect(page.locator('agent-page .confirm-scrim')).toHaveCount(0);
  // A new session's row lands asynchronously after confirm; a one-shot
  // rowCount() read races it. Assert on the locator directly so Playwright
  // retries until the row appears (or the assertion's own timeout expires).
  await expect(page.locator('agent-page .session-row')).toHaveCount(before + 1);
  await expect(page.locator('agent-page .provider-current')).toHaveText(target.label);

  const values = await page.evaluate(() => {
    const el = document.querySelector('app-root')?.shadowRoot
      ?.querySelector('agent-page') as AgentPageProbe | null;
    return {
      type: el?._panel?.type,
      path: el?._panel?.path,
      model: el?._panel?.model,
      streaming: el?._panel?.streaming,
    };
  });
  expect(values.type).toBe(target.endpointType);
  expect(values.path).toBe(target.path);
  expect(values.model).toBe(target.model);
  expect(values.streaming).toBe(target.streaming);
  // No message sent from here — confirming replaces the mock transport with a
  // real provider, and the mock tier has no network.
});

test('8. Escape cancels the dialog with the same result as Cancel', async ({ page }) => {
  await gotoAgentPage(page);

  const { list, index } = await entries(page);
  const targetIndex = (index + 1) % list.length;
  const before = await rowCount(page);

  await page.locator('agent-page .provider-trigger').click();
  await page.locator(`agent-page [data-entry-id="${list[targetIndex].id}"]`).click();
  await page.keyboard.press('Escape');

  await expect(page.locator('agent-page .confirm-scrim')).toHaveCount(0);
  await expect(page.locator('agent-page .provider-current')).toHaveText(list[index].label);
  expect(await rowCount(page)).toBe(before);

  const type = await page.evaluate(() => {
    const el = document.querySelector('app-root')?.shadowRoot
      ?.querySelector('agent-page') as AgentPageProbe | null;
    return el?._panel?.type;
  });
  expect(type).toBe('mock');
});

test('9. The config view has no model radios', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .config-btn').click();

  await expect(page.locator('agent-page .config-view')).toBeVisible();
  await expect(page.locator('agent-page .model-option')).toHaveCount(0);
  await expect(page.locator('agent-page .config-note')).toBeVisible();
});

test('10. Screenshots, both themes', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  await gotoAgentPage(page);

  // Dark theme: footer.
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'footer-dark.png'), fullPage: true });

  // Dark theme: list open.
  await page.locator('agent-page .provider-trigger').click();
  await expect(page.locator('agent-page .provider-list')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'list-open-dark.png'), fullPage: true });

  // Dark theme: confirmation dialog.
  const { list, index } = await entries(page);
  const targetIndex = (index + 1) % list.length;
  await page.locator(`agent-page [data-entry-id="${list[targetIndex].id}"]`).click();
  await expect(page.locator('agent-page .confirm-scrim')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'confirm-dark.png'), fullPage: true });
  await page.locator('agent-page .confirm-cancel').click();

  // Dark theme: config view.
  await page.locator('agent-page .config-btn').click();
  await expect(page.locator('agent-page .config-view')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'config-view-dark.png'), fullPage: true });
  await page.locator('agent-page .config-btn').click();
  await expect(page.locator('agent-page .config-view')).toHaveCount(0);

  // Switch theme.
  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'wa2-light');

  // Light theme: footer.
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'footer-light.png'), fullPage: true });

  // Light theme: list open.
  await page.locator('agent-page .provider-trigger').click();
  await expect(page.locator('agent-page .provider-list')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'list-open-light.png'), fullPage: true });

  // Light theme: confirmation dialog.
  await page.locator(`agent-page [data-entry-id="${list[targetIndex].id}"]`).click();
  await expect(page.locator('agent-page .confirm-scrim')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'confirm-light.png'), fullPage: true });
  await page.locator('agent-page .confirm-cancel').click();

  // Light theme: config view.
  await page.locator('agent-page .config-btn').click();
  await expect(page.locator('agent-page .config-view')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'config-view-light.png'), fullPage: true });
});
