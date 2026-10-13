import { test, expect } from './fixtures';
import { openPanel, sendChat, waitForTurnComplete } from './helpers';

import type { ChatPanelProbe } from './dom-types';
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

// Deterministic mock-tier e2e for turn-level error recovery (044). Scripts are
// arrays of MockResponse consumed one per model call (retries included), so
// `maxRetries` set via `panel.config` before the first send controls exactly
// how many scripted entries a turn consumes. Small maxRetries (0-2) keeps the
// suite fast: withRetry's backoff is 1s/1s for the first two retries.

// `persist: false` also disables autoTitle (guarded on `sessionStore` in
// controller-sessions.ts) — autoTitle calls `providerRegistry.get()` independently of
// the main turn, which allocates a FRESH mock-provider closure (call-index
// reset to 0). Left enabled, it can re-consume our scripted error entries and
// log a `console.error`, which the fixtures.ts console-guard turns into a
// test failure. Disabling persistence sidesteps it entirely.
async function setMaxRetries(page: import('@playwright/test').Page, maxRetries: number) {
  await page.evaluate((n) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    panel!.config = { ...panel!.config, maxRetries: n, persist: false };
  }, maxRetries);
}

test('manual retry: fail then Retry click succeeds', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { error: { message: 'Retryable', status: 429 } },
      { text: 'Success', finishReason: 'stop' },
    ];
  });

  await openPanel(page);
  await setMaxRetries(page, 0);
  await sendChat(page, 'hi');
  await waitForTurnComplete(page);

  const notice = page.locator('agent-chat-panel .wa-notice[data-tone="error"]');
  await expect(notice).toBeVisible();
  await expect(page.locator('agent-chat-panel .wa-notice-msg')).toContainText('HTTP 429');
  const retryBtn = notice.locator('.wa-notice-retry');
  await expect(retryBtn).toBeEnabled();

  await retryBtn.click();
  await waitForTurnComplete(page);

  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="error"]')).toHaveCount(0);
  await expect(
    page.locator('agent-message-view .assistant .content').last(),
  ).toContainText('Success');
});

test('auto-retry then success: no manual click needed', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { text: 'Success', finishReason: 'stop' },
    ];
  });

  await openPanel(page);
  await setMaxRetries(page, 2);
  await sendChat(page, 'hi');

  const progress = page.locator('agent-chat-panel .wa-notice[data-tone="progress"]');
  await expect(progress).toContainText('Retryable. Retrying attempt 1 of 2.', { timeout: 10_000 });
  await expect(progress).toHaveAttribute('role', 'status');
  await expect(progress).toHaveAttribute('aria-live', 'polite');
  await expect(progress.locator('.wa-notice-dot[data-filled]')).toHaveCount(1);
  await expect(progress).toContainText('Retryable. Retrying attempt 2 of 2.', { timeout: 10_000 });

  await waitForTurnComplete(page);

  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="error"]')).toHaveCount(0);
  await expect(
    page.locator('agent-message-view .assistant .content').last(),
  ).toContainText('Success');
});

test('auto-retry exhausted: retries then failed notice', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
    ];
  });

  await openPanel(page);
  await setMaxRetries(page, 2);
  await sendChat(page, 'hi');

  const progress = page.locator('agent-chat-panel .wa-notice[data-tone="progress"]');
  await expect(progress).toContainText('Retryable. Retrying attempt 2 of 2.', { timeout: 10_000 });
  const topWhileRetrying = (await progress.boundingBox())!.y;

  await waitForTurnComplete(page);

  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="progress"]')).toHaveCount(0);
  const notice = page.locator('agent-chat-panel .wa-notice[data-tone="error"]');
  await expect(notice).toBeVisible();
  // 008 criterion 2: the SAME element changed state; it did not move.
  expect(Math.abs((await notice.boundingBox())!.y - topWhileRetrying)).toBeLessThanOrEqual(1);
  await expect(notice).toHaveAttribute('role', 'alert');
  expect(await notice.getAttribute('aria-live')).toBeNull();
  await expect(page.locator('agent-chat-panel .wa-notice-msg')).toContainText('HTTP 429');
  await expect(notice.locator('.wa-notice-retry')).toBeEnabled();
});

test('terminal 400: failed notice immediately, no progress notice, no Retry', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [{ error: { message: 'Bad input', status: 400 } }];
  });

  await openPanel(page);
  await setMaxRetries(page, 2);
  await sendChat(page, 'hi');
  await waitForTurnComplete(page);

  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="progress"]')).toHaveCount(0);
  const notice = page.locator('agent-chat-panel .wa-notice[data-tone="error"]');
  await expect(notice).toBeVisible();
  await expect(page.locator('agent-chat-panel .wa-notice-msg')).toContainText('HTTP 400');
  await expect(notice.locator('.wa-notice-retry')).toHaveCount(0);
  await expect(notice.locator('.wa-notice-dismiss')).toBeEnabled();
});

// 006: the path no existing case covered. The four cases above all end their
// transcript on the failed turn, or clear `failed` by rewriting that same turn
// through retryLast(). None sends a NEW, different message after a failure,
// which is exactly where the stale notice lived.
test('new message after failure: notice clears and does not come back', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      // 400 is terminal, so it consumes exactly one scripted entry regardless
      // of maxRetries — same reasoning as the 'terminal 400' case above.
      { error: { message: 'Bad input', status: 400 } },
      { text: 'Second reply', finishReason: 'stop' },
    ];
  });

  await openPanel(page);
  await setMaxRetries(page, 0);

  await sendChat(page, 'first');
  await waitForTurnComplete(page);
  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="error"]')).toBeVisible();

  await sendChat(page, 'second');
  await waitForTurnComplete(page);

  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="error"]')).toHaveCount(0);
  await expect(
    page.locator('agent-message-view .assistant .content').last(),
  ).toContainText('Second reply');
});

test('no host notify: the panel renders the warning itself, and Dismiss clears it', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [{ text: 'ok', finishReason: 'stop' }];
  });
  await openPanel(page);

  // Prove the event still fires on this branch, and only on this branch.
  await page.evaluate(() => {
    window.__toasts = [];
    document.addEventListener('agent-toast', (e: Event) => {
      window.__toasts!.push((e as CustomEvent<{ message?: string }>).detail?.message ?? '');
    });
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot
      ?.querySelector('agent-chat-panel') as ChatPanelProbe;
    panel.notify = undefined;
    (panel as unknown as { _showToast(m: string, t: 'error' | 'info'): void })
      ._showToast('Image resized to fit size limits', 'info');
  });

  const warning = page.locator('agent-chat-panel .wa-notice[data-tone="progress"]');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Image resized to fit size limits');
  await expect(warning.locator('.wa-notice-retry')).toHaveCount(0);
  await expect(warning.locator('.wa-notice-dismiss')).toBeVisible();
  expect(await page.evaluate(() => window.__toasts)).toContain('Image resized to fit size limits');

  await warning.locator('.wa-notice-dismiss').click();
  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="progress"]')).toHaveCount(0);
});

test('host notify set: host renders it, panel shows nothing, no agent-toast event', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [{ text: 'ok', finishReason: 'stop' }];
  });
  await openPanel(page);

  await page.evaluate(() => {
    window.__toasts = [];
    document.addEventListener('agent-toast', (e: Event) => {
      window.__toasts!.push((e as CustomEvent<{ message?: string }>).detail?.message ?? '');
    });
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot
      ?.querySelector('agent-chat-panel') as ChatPanelProbe;
    // cat-store already sets notify; assert that, then use it.
    window.__hadNotify = typeof panel.notify === 'function';
    (panel as unknown as { _showToast(m: string, t: 'error' | 'info'): void })
      ._showToast('Image resized to fit size limits', 'info');
  });

  expect(await page.evaluate(() => window.__hadNotify)).toBe(true);
  await expect(page.locator('agent-chat-panel .wa-notice')).toHaveCount(0);
  // The corrected contract: no event on the notify branch.
  expect(await page.evaluate(() => window.__toasts)).toEqual([]);
});

