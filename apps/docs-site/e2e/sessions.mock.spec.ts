/**
 * Deterministic gate for session history UI on the docs-site.
 * No LLM calls — all session management via panel JS API + direct UI buttons.
 * Screenshots saved to e2e-screenshots/.
 *
 * Docs-site uses web-agent-lit's default registry (no `md-*` web components):
 * - buttons are <button class="wa-btn">
 * - the title-edit input is <input class="wa-input">; the composer is <textarea class="wa-textarea">
 * - title edit input lives in .wa-title-edit-row .wa-input-container input.wa-input
 */
import { test, expect } from './fixtures';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { openBubble } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'e2e-screenshots');

function mkshot(page: import('@playwright/test').Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(SCREENSHOT_DIR, name) });
}

test('sessions: create 2 → list shows both → delete one → list shows one → New Session resets', async ({ page }) => {
  test.setTimeout(60_000);

  // Auto-accept all browser confirm() dialogs (required for delete confirmation)
  page.on('dialog', d => d.accept());

  await openBubble(page);

  // History button (#history-anchor) only appears once _sessionStore is initialized.
  // This is our signal that persist:true took effect and IDB is ready.
  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });

  // Create a 2nd session via the panel's public JS API (bypasses UI confirms).
  // Page load auto-created the 1st session via core's openOrCreateActiveSession().
  await page.evaluate(async () => {
    const panel = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    await panel!.createSession();
  });

  // Open the history dropdown
  await page.locator('#history-anchor').click();
  await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 5_000 });

  // Assert 2 session rows are visible
  await expect(page.locator('.wa-history-row')).toHaveCount(2, { timeout: 5_000 });
  await mkshot(page, 'sessions-docs-01-two-sessions.png');

  // Delete the non-active session (its row lacks aria-current="true").
  // The confirm() dialog is auto-accepted by the handler registered above.
  const delBtn = page.locator('.wa-history-row:not([aria-current="true"]) [aria-label^="Delete session"]');
  await delBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await delBtn.click();

  // _handleHistoryDelete fires deleteSession() without
  // await — IDB delete is async. Wait for it to settle, then force a fresh list
  // by closing and reopening the history panel.
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#history-anchor').click();
  await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 5_000 });

  // Assert exactly 1 session remains
  await expect(page.locator('.wa-history-row')).toHaveCount(1, { timeout: 5_000 });
  await mkshot(page, 'sessions-docs-02-one-session.png');

  // Click "+ New Session" — creates a blank session and closes the panel
  // Docs-site uses wa-btn (not md-filled-button) in vanilla registry
  await page.locator('[role="dialog"] button.wa-btn').filter({ hasText: '+ New Session' }).click();

  // Panel closes; new blank session has no messages
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-message-view')).toHaveCount(0, { timeout: 5_000 });
});

test('sessions: manual title-edit persists and shows in history list', async ({ page }) => {
  test.setTimeout(60_000);

  await openBubble(page);
  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });

  // Open inline title-edit by clicking the pencil icon button
  // The pencil is pointer-events:none until the header is hovered (task 001),
  // and Playwright's "Receives Events" check is a hit test, so hover first.
  await page.locator('agent-chat-panel .header').hover();
  await page.locator('[aria-label="Edit session title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'visible', timeout: 5_000 });

  // Set value on the vanilla input element and dispatch 'input' event so the
  // registry's textInput component fires onInput with the new value.
  await page.evaluate(() => {
    // 003: pierce the bubble's shadow root explicitly — agent-chat-panel and
    // its descendants now live there.
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const input = root?.querySelector('.wa-title-edit-row .wa-input-container input.wa-input') as HTMLInputElement;
    input.value = 'My Test Session';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Save by dispatching Enter on the input to bypass button overlap with #history-anchor.
  // The overlap happens because the Save button and history anchor share the same
  // flex line in the narrow bubble header, and Playwright's actionability check
  // detects the history anchor intercepting the click.
  await page.evaluate(() => {
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    // Set value on the title edit input wrapper so _handleTitleEditConfirm reads it
    const input = root?.querySelector('.wa-title-edit-row .wa-input-container') as (HTMLElement & { value?: string }) | null;
    if (input) input.value = 'My Test Session';
    // Dispatch keyboard Enter which triggers _titleEditInputEl's keyup listener
    // that calls _handleTitleEditConfirm
    const nativeInput = root?.querySelector('.wa-title-edit-row .wa-input-container input.wa-input') as HTMLInputElement;
    nativeInput.value = 'My Test Session';
    nativeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    nativeInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  });

  // Edit row collapses; header shows the new title
  await page.locator('.wa-title-edit-row').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-chat-panel .header-title'))
    .toContainText('My Test Session', { timeout: 5_000 });

  // Open history panel and verify the title appears in the session row label
  await page.locator('#history-anchor').click();
  await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 5_000 });
  await expect(page.locator('.wa-history-row').first())
    .toContainText('My Test Session', { timeout: 5_000 });

  await mkshot(page, 'sessions-docs-03-title-in-history.png');
});

async function openTitleEdit(page: import('@playwright/test').Page) {
  await openBubble(page);
  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('agent-chat-panel .header').hover();
  await page.locator('[aria-label="Edit session title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'visible', timeout: 5_000 });
}

/** Type a title into the default registry's inline input. */
async function typeTitle(page: import('@playwright/test').Page, title: string) {
  await page.evaluate((t) => {
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot;
    const input = root?.querySelector('.wa-title-edit-row .wa-input-container input.wa-input') as HTMLInputElement;
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, title);
}

test('title-edit: confirm and cancel render glyphs, never their icon name', async ({ page }) => {
  test.setTimeout(60_000);
  await openTitleEdit(page);

  for (const name of ['Save title', 'Cancel title edit']) {
    const btn = page.locator(`.wa-title-edit-row [aria-label="${name}"]`);
    await expect(btn).toBeVisible();
    await expect(btn.locator('svg')).toHaveCount(1);
    await expect(btn.locator('i')).toHaveCount(0);   // the icon-name text fallback
    expect((await btn.innerText()).trim()).toBe('');
  }
  const rowText = (await page.locator('.wa-title-edit-row').innerText()).trim();
  expect(rowText).not.toContain('check');
  expect(rowText).not.toContain('close');

  await mkshot(page, 'sessions-04-title-edit-icons-light.png');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'wa2-dark'));
  await mkshot(page, 'sessions-05-title-edit-icons-dark.png');
});

test('title-edit: clicking the check saves and clicking the X discards', async ({ page }) => {
  test.setTimeout(60_000);
  await openTitleEdit(page);

  await typeTitle(page, 'Clicked Save');
  await page.locator('.wa-title-edit-row [aria-label="Save title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-chat-panel .header-title'))
    .toContainText('Clicked Save', { timeout: 5_000 });

  await page.locator('agent-chat-panel .header').hover();
  await page.locator('[aria-label="Edit session title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'visible', timeout: 5_000 });
  await typeTitle(page, 'Discarded Title');
  await page.locator('.wa-title-edit-row [aria-label="Cancel title edit"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-chat-panel .header-title'))
    .toContainText('Clicked Save', { timeout: 5_000 });
});

test('title-edit: Escape cancels the edit', async ({ page }) => {
  test.setTimeout(60_000);
  await openBubble(page);
  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });
  // Read the title before opening the editor — the .header-title span is
  // replaced by .wa-title-edit-row while the editor is active, so it cannot
  // be read once the row is open.
  const before = (await page.locator('agent-chat-panel .header-title').innerText()).trim();
  await page.locator('agent-chat-panel .header').hover();
  await page.locator('[aria-label="Edit session title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'visible', timeout: 5_000 });

  await typeTitle(page, 'Escaped Title');
  await page.evaluate(() => {
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot;
    const input = root?.querySelector('.wa-title-edit-row .wa-input-container input.wa-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
  });

  await page.locator('.wa-title-edit-row').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-chat-panel .header-title')).toHaveText(before);
});
