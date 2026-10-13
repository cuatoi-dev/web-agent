import { test, expect } from './fixtures';
import { openPanel, submitComposer } from './helpers';
import type { ProviderCallOptions } from '@cuatoi/web-agent-core';

// The mock tier runs entirely in-page via window.__WA_MOCK_SCRIPT__ (see
// mock-llm.mock.spec.ts) -- there is no real network call to intercept with
// page.route for the "anthropic" endpoint, so this spec drives the mock
// provider directly instead.
const scrollMockScript = (opts: ProviderCallOptions) => {
  const userTurns = opts.messages.filter((m) => m.role === 'user').length;
  const padding =
    'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
  return { text: `Reply ${userTurns}. ${padding}`, finishReason: 'stop' };
};

test.describe('Chat scroll behavior', () => {
  test('scrolls to bottom immediately on user send', async ({ page }) => {
    await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${scrollMockScript.toString()};`);

    await openPanel(page);

    // Send several messages to build up enough content to overflow the panel.
    for (let i = 0; i < 6; i++) {
      await submitComposer(page, `Message number ${i} with some extra padding text to take up vertical space`);
      await page.waitForFunction(
        (n) => {
          const views = [...((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelectorAll('agent-message-view') ?? [])].filter((v) => v.querySelector('.assistant'));
          return views.length >= n;
        },
        i + 1,
        { timeout: 15_000 }
      );
    }

    // Confirm the list actually overflows before testing scroll-to-bottom behavior.
    const overflowed = await page.evaluate(() => {
      const list = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel')?.querySelector('.messages-list') as HTMLElement | null;
      return list ? list.scrollHeight > list.clientHeight + 30 : false;
    });
    expect(overflowed).toBe(true);

    // Scroll away from the bottom so the next send has to actively re-pin it.
    await page.evaluate(() => {
      const list = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel')?.querySelector('.messages-list') as HTMLElement | null;
      if (list) list.scrollTop = 0;
    });

    await submitComposer(page, 'This is the final message that should trigger an immediate scroll');

    // As soon as the user's own message renders (which may well be before the
    // assistant's reply has arrived), the panel should already be pinned to
    // the bottom. Poll on rAF so any pending rAF-coalesced scrollTop write has
    // already flushed by the time we read it.
    const handle = await page.waitForFunction(
      () => {
        const views = [...((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelectorAll('agent-message-view') ?? [])];
        const found = views.some((v) => v.querySelector('.user')?.textContent?.includes('final message that should trigger'));
        if (!found) return false;
        const list = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel')?.querySelector('.messages-list') as HTMLElement | null;
        if (!list) return false;
        return { diff: list.scrollHeight - list.scrollTop - list.clientHeight };
      },
      undefined,
      { polling: 'raf', timeout: 5_000 }
    );
    const { diff } = (await handle.jsonValue()) as { diff: number };
    expect(diff).toBeLessThan(30);

    // Turn settles with the final reply visible.
    await expect(page.locator('agent-message-view .assistant').last()).toContainText('Reply 7');
  });
});
