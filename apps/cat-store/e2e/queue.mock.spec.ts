import { test, expect } from './fixtures';
import { openPanel, submitComposer, waitForTurnComplete } from './helpers';

import type { ChatPanelProbe, ComposerInputProbe } from './dom-types';
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

async function setMaxRetries(page: import('@playwright/test').Page, maxRetries: number) {
  await page.evaluate((n) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    panel!.config = { ...panel!.config, maxRetries: n, persist: false };
  }, maxRetries);
}

function queueItems(page: import('@playwright/test').Page) {
  return page.locator('agent-chat-panel .wa-queue-item');
}

async function inputValue(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    return ((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null)?.value || '';
  });
}

async function userBubbleTexts(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    return [...((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelectorAll('agent-message-view .user .content') ?? [])].map(el => (el.textContent || '').trim());
  });
}

async function assistantCount(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('agent-message-view .assistant .content').count();
}

test('enqueue -> concat-fire (ONE joined turn, in order)', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { text: 'first-done', finishReason: 'stop' },
      { text: 'drain-reply', finishReason: 'stop' },
    ];
  });

  await openPanel(page);
  await setMaxRetries(page, 4);
  await submitComposer(page, 'START');
  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="progress"]')).toBeVisible();

  await submitComposer(page, 'msg-a');
  await submitComposer(page, 'msg-b');

  await expect(queueItems(page)).toHaveCount(2);
  await expect(queueItems(page).nth(0).locator('.wa-queue-text')).toHaveText('msg-a');
  await expect(queueItems(page).nth(1).locator('.wa-queue-text')).toHaveText('msg-b');

  await waitForTurnComplete(page);

  await expect(queueItems(page)).toHaveCount(0);

  const texts = await userBubbleTexts(page);
  expect(texts).toHaveLength(2);
  expect(texts[0]).toBe('START');
  expect(texts[1]).toContain('msg-a');
  expect(texts[1]).toContain('msg-b');
  expect(texts[1].indexOf('msg-a')).toBeLessThan(texts[1].indexOf('msg-b'));

  expect(await assistantCount(page)).toBe(2);
  await expect(page.locator('agent-message-view .assistant .content').last()).toContainText('drain-reply');
});

test('cancel one: only it is removed, rest still drain', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { text: 'first-done', finishReason: 'stop' },
      { text: 'drain-reply', finishReason: 'stop' },
    ];
  });

  await openPanel(page);
  await setMaxRetries(page, 4);
  await submitComposer(page, 'START');
  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="progress"]')).toBeVisible();

  await submitComposer(page, 'q1');
  await submitComposer(page, 'q2');
  await submitComposer(page, 'q3');
  await expect(queueItems(page)).toHaveCount(3);

  await queueItems(page).nth(1).locator('.wa-queue-actions button').click();

  await expect(queueItems(page)).toHaveCount(2);
  await expect(queueItems(page).nth(0).locator('.wa-queue-text')).toHaveText('q1');
  await expect(queueItems(page).nth(1).locator('.wa-queue-text')).toHaveText('q3');

  await waitForTurnComplete(page);

  await expect(queueItems(page)).toHaveCount(0);
  const texts = await userBubbleTexts(page);
  expect(texts).toHaveLength(2);
  expect(texts[1]).toContain('q1');
  expect(texts[1]).toContain('q3');
  expect(texts[1]).not.toContain('q2');
  expect(texts[1].indexOf('q1')).toBeLessThan(texts[1].indexOf('q3'));
});

test('edit-pop-back: last item returns to composer, re-submit re-queues', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { text: 'first-done', finishReason: 'stop' },
      { text: 'drain-reply', finishReason: 'stop' },
    ];
  });

  await openPanel(page);
  await setMaxRetries(page, 4);
  await submitComposer(page, 'START');
  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="progress"]')).toBeVisible();

  await submitComposer(page, 'keep');
  await submitComposer(page, 'editme');
  await expect(queueItems(page)).toHaveCount(2);

  await queueItems(page).last().locator('.wa-queue-actions button').first().click();

  expect(await inputValue(page)).toBe('editme');
  await expect(queueItems(page)).toHaveCount(1);
  await expect(queueItems(page).nth(0).locator('.wa-queue-text')).toHaveText('keep');

  await submitComposer(page, 'editme');
  await expect(queueItems(page)).toHaveCount(2);
  await expect(queueItems(page).nth(0).locator('.wa-queue-text')).toHaveText('keep');
  await expect(queueItems(page).nth(1).locator('.wa-queue-text')).toHaveText('editme');

  await waitForTurnComplete(page);

  await expect(queueItems(page)).toHaveCount(0);
  const texts = await userBubbleTexts(page);
  expect(texts).toHaveLength(2);
  expect(texts[1]).toContain('keep');
  expect(texts[1]).toContain('editme');
  expect(texts[1].indexOf('keep')).toBeLessThan(texts[1].indexOf('editme'));
});

test('hold on failure: queue does NOT auto-fire', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
      { error: { message: 'Retryable', status: 429 } },
    ];
  });

  await openPanel(page);
  await setMaxRetries(page, 4);
  await submitComposer(page, 'START');
  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="progress"]')).toBeVisible();

  await submitComposer(page, 'held-a');
  await submitComposer(page, 'held-b');
  await expect(queueItems(page)).toHaveCount(2);

  await waitForTurnComplete(page);

  await expect(page.locator('agent-chat-panel .wa-notice[data-tone="error"]')).toBeVisible();
  await expect(page.locator('agent-chat-panel .wa-notice-msg')).toContainText('HTTP 429');

  await expect(queueItems(page)).toHaveCount(2);
  await expect(queueItems(page).nth(0).locator('.wa-queue-text')).toHaveText('held-a');
  await expect(queueItems(page).nth(1).locator('.wa-queue-text')).toHaveText('held-b');

  expect(await assistantCount(page)).toBe(0);
  await expect(queueItems(page).nth(0).locator('.wa-queue-actions button')).toHaveCount(1);
  await expect(queueItems(page).nth(1).locator('.wa-queue-actions button')).toHaveCount(2);
});
