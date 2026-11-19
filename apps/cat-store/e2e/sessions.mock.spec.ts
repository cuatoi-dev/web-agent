import type { ChatPanelProbe, ComposerInputProbe } from './dom-types';
/**
 * Deterministic gate for session history UI on the local mock-tier cat-store.
 * No LLM calls — all session management via panel JS API + direct UI buttons.
 * Screenshots saved to e2e-screenshots/.
 */
import { test, expect } from './fixtures';
import path from 'path';
import fs from 'fs';
import { openPanel } from './helpers';

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'e2e-screenshots');

function mkshot(page: import('@playwright/test').Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(SCREENSHOT_DIR, name) });
}

test('sessions: create 2 → list shows both → delete one → list shows one → New Session resets', async ({ page }) => {
  test.setTimeout(60_000);

  // Auto-accept all browser confirm() dialogs (required for delete confirmation)
  page.on('dialog', d => d.accept());

  await openPanel(page);

  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });

  // The panel is now created on first launcher click (bubbled
  // mount), not at page load, so its openOrCreateActiveSession() for the
  // 1st session is still in flight when openPanel() returns. Wait for it to
  // land (activeSessionId set) before explicitly creating a 2nd session, or
  // the two async creations race and the history list can show only 1 row.
  await page.waitForFunction(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    return !!panel?._state?.activeSessionId;
  }, undefined, { timeout: 15_000 });

  // Create a 2nd session via the panel's public JS API (bypasses UI confirms).
  await page.evaluate(async () => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    await panel!.createSession();
  });

  // Open the history dropdown
  await page.locator('#history-anchor').click();
  await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 5_000 });

  // Assert 2 session rows are visible
  await expect(page.locator('.wa-history-row')).toHaveCount(2, { timeout: 5_000 });
  await mkshot(page, 'sessions-01-two-sessions.png');

  // Delete the non-active session (its row lacks aria-current="true").
  // The confirm() dialog is auto-accepted by the handler registered above.
  const delBtn = page.locator('.wa-history-row:not([aria-current="true"]) [aria-label^="Delete session"]');
  await delBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await delBtn.click();

  // _handleHistoryDelete fires deleteSession() without await and does not
  // refresh the open list — IDB delete is async. Wait for it to settle, then force a fresh list
  // by closing and reopening the history panel.
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#history-anchor').click();
  await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 5_000 });

  // Assert exactly 1 session remains
  await expect(page.locator('.wa-history-row')).toHaveCount(1, { timeout: 5_000 });
  await mkshot(page, 'sessions-02-one-session.png');

  // Click "+ New Session" — creates a blank session and closes the panel
  await page.locator('[role="dialog"] md-filled-button').filter({ hasText: '+ New Session' }).click();

  // Panel closes; new blank session has no messages
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-message-view')).toHaveCount(0, { timeout: 5_000 });
});

test('sessions: manual title-edit persists and shows in history list', async ({ page }) => {
  test.setTimeout(60_000);

  await openPanel(page);
  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });

  // Open inline title-edit by clicking the pencil icon button
  // The pencil is pointer-events:none until the header is hovered,
  // and Playwright's "Receives Events" check is a hit test, so hover first.
  await page.locator('agent-chat-panel .header').hover();
  await page.locator('[aria-label="Edit session title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'visible', timeout: 5_000 });

  // _handleTitleEditConfirm() reads this._titleEditValue, the
  // panel's own reactive field, updated only by the <wa-text-input>'s
  // value-input event — setting .value directly on the Material field (the
  // old approach, from when the panel read the DOM element itself) never
  // reaches that field. _handleTitleEditOpen() already focuses the input
  // (see chat-panel-screens.ts), so real typing lands there directly; select
  // all first to replace the current title instead of appending to it.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('My Test Session');

  // Confirm — the check icon button inside the row. cat-store's md-icon-button
  // moves the `aria-label` attribute we set to `data-aria-label` on the host
  // shortly after it connects (Material Web's own aria delegation, via
  // ElementInternals — standard for every icon button here),
  // so `[data-aria-label=...]` is what actually lands on the host
  // element that holds our glyph <svg>; `getByRole` resolves to the button
  // INSIDE md-icon-button's shadow root instead, which has no light-DOM svg
  // child of its own (the svg is slot-projected, not a real descendant).
  await page.locator('.wa-title-edit-row [data-aria-label="Save title"]').click();

  // Edit row collapses; header shows the new title
  await page.locator('.wa-title-edit-row').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-chat-panel .header-title'))
    .toContainText('My Test Session', { timeout: 5_000 });

  // Open history panel and verify the title appears in the session row label
  await page.locator('#history-anchor').click();
  await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 5_000 });
  await expect(page.locator('.wa-history-row').first())
    .toContainText('My Test Session', { timeout: 5_000 });

  await mkshot(page, 'sessions-03-title-in-history.png');
});

/** Open the panel and enter title-edit mode. */
async function openTitleEdit(page: import('@playwright/test').Page) {
  await openPanel(page);
  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('agent-chat-panel .header').hover();
  await page.locator('[aria-label="Edit session title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'visible', timeout: 5_000 });
}

test('title-edit: confirm and cancel render glyphs, never their icon name', async ({ page }) => {
  test.setTimeout(60_000);
  await openTitleEdit(page);

  for (const name of ['Save title', 'Cancel title edit']) {
    // [data-aria-label=...], not [aria-label=...] or getByRole — see the note
    // in the click test above.
    const btn = page.locator(`.wa-title-edit-row [data-aria-label="${name}"]`);
    await expect(btn).toBeVisible();
    await expect(btn.locator('svg')).toHaveCount(1);
    expect((await btn.innerText()).trim()).toBe('');
  }
  // The whole row must not contain either icon name as text.
  const rowText = (await page.locator('.wa-title-edit-row').innerText()).trim();
  expect(rowText).not.toContain('check');
  expect(rowText).not.toContain('close');

  // Both controls are reachable by accessible name (resolves to the real
  // <button> inside md-icon-button's shadow root — see the note above).
  await expect(page.getByRole('button', { name: 'Save title' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Cancel title edit' })).toHaveCount(1);

  await mkshot(page, 'sessions-04-title-edit-icons-dark.png');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'wa2-light'));
  await mkshot(page, 'sessions-05-title-edit-icons-light.png');
});

test('title-edit: the X discards the typed title', async ({ page }) => {
  test.setTimeout(60_000);
  await openPanel(page);
  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });
  // Read the title before opening the editor — the .header-title span is
  // replaced by .wa-title-edit-row while the editor is active, so it cannot
  // be read once the row is open.
  const before = (await page.locator('agent-chat-panel .header-title').innerText()).trim();
  await page.locator('agent-chat-panel .header').hover();
  await page.locator('[aria-label="Edit session title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'visible', timeout: 5_000 });

  await page.evaluate(() => {
    const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot
      ?.querySelector<ComposerInputProbe>('.wa-title-edit-row md-outlined-text-field');
    field!.value = 'Discarded Title';
  });
  await page.locator('.wa-title-edit-row [data-aria-label="Cancel title edit"]').click();

  await page.locator('.wa-title-edit-row').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-chat-panel .header-title')).toHaveText(before);
});

test('title-edit: Escape cancels the edit', async ({ page }) => {
  test.setTimeout(60_000);
  await openPanel(page);
  await page.locator('#history-anchor').waitFor({ state: 'visible', timeout: 15_000 });
  // Read the title before opening the editor — see the note in the "the X
  // discards" test above.
  const before = (await page.locator('agent-chat-panel .header-title').innerText()).trim();
  await page.locator('agent-chat-panel .header').hover();
  await page.locator('[aria-label="Edit session title"]').click();
  await page.locator('.wa-title-edit-row').waitFor({ state: 'visible', timeout: 5_000 });

  await page.evaluate(() => {
    const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot
      ?.querySelector<ComposerInputProbe>('.wa-title-edit-row md-outlined-text-field');
    field!.value = 'Escaped Title';
    field!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    field!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
  });

  await page.locator('.wa-title-edit-row').waitFor({ state: 'hidden', timeout: 5_000 });
  await expect(page.locator('agent-chat-panel .header-title')).toHaveText(before);
});
