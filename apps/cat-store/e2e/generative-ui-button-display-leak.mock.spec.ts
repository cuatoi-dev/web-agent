import { test, expect } from './fixtures';
import { openPanel, sendChat, waitForTurnComplete } from './helpers';
import { waitForBlock } from './demo-helpers';

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

// 011 (B-7): clicking a generative-UI button used to leak the internal
// `[ui_action:button] <prompt>` marker into the visible transcript. The
// marker still has to reach the model — only the DISPLAYED bubble changes.
test('generative-ui button click: model sees the tagged marker, transcript shows only the clean label', async ({ page }) => {
  test.setTimeout(45_000);

  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [{
          id: 'call_show_generative_ui',
          name: 'show_generative_ui',
          input: {
            type: 'buttons',
            options: [
              { label: 'View All Products', prompt: 'Show me all products available in the store' },
            ],
          },
        }],
      },
      {
        text: 'Sure — here is the full catalog.',
        finishReason: 'stop',
      },
    ];
  });

  // Zero real model network calls — this turn is scripted end to end.
  await page.route('**/api/anthropic/**', (route) => route.abort());

  await openPanel(page);
  await sendChat(page, 'show me some quick actions');
  await waitForTurnComplete(page);
  await waitForBlock(page, 'agent-buttons-block');

  const bubble = page.locator('cat-agent-widget web-agent-bubble');
  const button = bubble.locator('agent-buttons-block button, agent-buttons-block md-outlined-button')
    .filter({ hasText: 'View All Products' });
  await button.click();
  await waitForTurnComplete(page);

  // The model-bound text still carries the marker. Asserting that via the mock
  // transport's captured request would duplicate controller.test.ts, so this
  // spec asserts the USER-VISIBLE side only, which is what B-7 broke.
  const userBubbles = bubble.locator('.message-row.user .content');
  const lastUserText = await userBubbles.last().innerText();
  expect(lastUserText).toBe('Show me all products available in the store');
  expect(lastUserText).not.toContain('[ui_action:button]');
});
