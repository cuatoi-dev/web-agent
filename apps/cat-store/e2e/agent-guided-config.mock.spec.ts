import { test, expect } from './fixtures';
import { chooseTheme, gotoAgentPage, reloadAgentPage, waitForAgentPageSettled } from './helpers';
import path from 'path';
import fs from 'fs';

import type { AgentPageProbe } from './dom-types';
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../../temp/artifacts/2026-08-15-002512-003-guided-config-view',
);

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

const MOCK_REPLY = 'CONFIG-MOCK-reply';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((reply) => {
    window.__WA_MOCK_SCRIPT__ = { text: reply, finishReason: 'stop' };
  }, MOCK_REPLY);
});

test('1. Config view opens and displays five fields in order with preset buttons', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .config-btn').click();
  await expect(page.locator('agent-page .config-view')).toBeVisible();

  const fields = page.locator('agent-page .config-field');
  await expect(fields).toHaveCount(5);

  const roleField = page.locator('agent-page .config-field[data-field="role"]');
  const toneField = page.locator('agent-page .config-field[data-field="tone"]');
  const lengthField = page.locator('agent-page .config-field[data-field="length"]');
  const langField = page.locator('agent-page .config-field[data-field="language"]');
  const extraField = page.locator('agent-page .config-field[data-field="extra"]');

  await expect(roleField).toBeVisible();
  await expect(toneField).toBeVisible();
  await expect(lengthField).toBeVisible();
  await expect(langField).toBeVisible();
  await expect(extraField).toBeVisible();

  await expect(roleField.locator('.preset-btn')).toHaveCount(4);
  await expect(toneField.locator('.preset-btn')).toHaveCount(4);
  await expect(lengthField.locator('.preset-btn')).toHaveCount(3);
  await expect(langField.locator('.preset-btn')).toHaveCount(3);
  await expect(extraField.locator('.preset-btn')).toHaveCount(0);

  await expect(page.locator('agent-page .config-reset-btn')).toBeVisible();
  await expect(page.locator('agent-page .config-note')).toBeVisible();
});

test('2. Clicking a preset button populates the field and updates instructions', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .config-btn').click();
  const roleField = page.locator('agent-page .config-field[data-field="role"]');
  const salesPreset = roleField.locator('.preset-btn', { hasText: 'Sales assistant' });
  await salesPreset.click();

  const textarea = roleField.locator('.field-textarea');
  await expect(textarea).toHaveValue(/sales assistant/i);

  const instructions = await page.evaluate(() => {
    const el = document.querySelector('app-root')?.shadowRoot?.querySelector('agent-page') as AgentPageProbe | null;
    return el?._panel?.appContext?.appInstructions;
  });
  expect(instructions).toContain('sales assistant');
  expect(instructions).toContain('Before every add_to_cart call');
});

test('3. Clicking a second preset replaces the field value without duplicating', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .config-btn').click();
  const roleField = page.locator('agent-page .config-field[data-field="role"]');

  await roleField.locator('.preset-btn', { hasText: 'Sales assistant' }).click();
  await roleField.locator('.preset-btn', { hasText: 'Nutrition adviser' }).click();

  const textarea = roleField.locator('.field-textarea');
  await expect(textarea).toHaveValue(/nutrition specialist/i);
  await expect(textarea).not.toHaveValue(/sales assistant/i);
});

test('4. Typing into Extra field updates panel appContext instructions', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .config-btn').click();
  const extraField = page.locator('agent-page .config-field[data-field="extra"]');
  const textarea = extraField.locator('.field-textarea');

  await textarea.fill('Always mention free cat toy promotion.');

  const instructions = await page.evaluate(() => {
    const el = document.querySelector('app-root')?.shadowRoot?.querySelector('agent-page') as AgentPageProbe | null;
    return el?._panel?.appContext?.appInstructions;
  });
  expect(instructions).toContain('Always mention free cat toy promotion.');
});

test('5. Customizations persist across page reload', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .config-btn').click();
  const toneField = page.locator('agent-page .config-field[data-field="tone"]');
  await toneField.locator('.preset-btn', { hasText: 'Playful' }).click();

  await waitForAgentPageSettled(page);
  await reloadAgentPage(page);

  await page.locator('agent-page .config-btn').click();
  const toneTextarea = page.locator('agent-page .config-field[data-field="tone"] .field-textarea');
  await expect(toneTextarea).toHaveValue(/cheerful, playful tone/i);
});

test('6. Reset button clears all fields and restores base instructions', async ({ page }) => {
  await gotoAgentPage(page);

  await page.locator('agent-page .config-btn').click();
  const roleField = page.locator('agent-page .config-field[data-field="role"]');
  await roleField.locator('.preset-btn', { hasText: 'Support agent' }).click();

  await page.locator('agent-page .config-reset-btn').click();

  const textareas = page.locator('agent-page .field-textarea');
  const count = await textareas.count();
  for (let i = 0; i < count; i++) {
    await expect(textareas.nth(i)).toHaveValue('');
  }

  const instructions = await page.evaluate(() => {
    const el = document.querySelector('app-root')?.shadowRoot?.querySelector('agent-page') as AgentPageProbe | null;
    return el?._panel?.appContext?.appInstructions;
  });
  expect(instructions!.trim()).not.toContain('Support agent');
});

test('7. Screenshots across themes and states', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  await gotoAgentPage(page);

  // Dark theme: config view with empty fields
  await page.locator('agent-page .config-btn').click();
  await expect(page.locator('agent-page .config-view')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'config-view-dark.png'), fullPage: true });

  // Dark theme: Role preset selected
  const roleField = page.locator('agent-page .config-field[data-field="role"]');
  await roleField.locator('.preset-btn', { hasText: 'Sales assistant' }).click();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'config-preset-filled-dark.png'), fullPage: true });

  // Dark theme: Reset clicked
  await page.locator('agent-page .config-reset-btn').click();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'config-reset-dark.png'), fullPage: true });

  // Switch to Light theme
  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'wa2-light');

  // Light theme: config view empty
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'config-view-light.png'), fullPage: true });

  // Light theme: Role preset selected
  await roleField.locator('.preset-btn', { hasText: 'Sales assistant' }).click();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'config-preset-filled-light.png'), fullPage: true });
});
