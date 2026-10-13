import { test, expect } from './fixtures';
import { openPanel, sendChat, waitForTurnComplete } from './helpers';

import type { ChatPanelProbe } from './dom-types';
import type { ProviderCallOptions } from '@cuatoi/web-agent-core';

/** The one content-part shape read back out of `opts.messages` here — the
 *  real ContentPart union carries several other variants. */
interface ToolResultPartLike {
  type: 'tool-result';
  toolName: string;
}

const multiTurnMockScript = function (opts: ProviderCallOptions) {
  const userMessages = opts.messages.filter((m) => m.role === "user");
  const turnIndex = userMessages.length;

  const lastUserMsgIdx = opts.messages.map((m) => m.role).lastIndexOf("user");
  const currentTurnMessages = opts.messages.slice(lastUserMsgIdx);

  const seenTool = (name: string) => {
    for (const msg of currentTurnMessages) {
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        for (const part of msg.content as ToolResultPartLike[]) {
          if (part.type === "tool-result" && part.toolName === name) return true;
        }
      }
    }
    return false;
  };

  if (turnIndex === 1) {
    if (!seenTool("snapshot_page")) {
      return { toolCalls: [{ id: "call_snap_1", name: "snapshot_page", input: {} }] };
    }
    return { text: "I see the landing page of Cat Bodega.", finishReason: "stop" };
  }

  if (turnIndex === 2) {
    if (!seenTool("click")) {
      return { toolCalls: [{ id: "call_click_2", name: "click", input: { ref: "2" } }] };
    }
    return { text: "We are on the store page. I see Salmon Pâté and Tuna Crunchies.", finishReason: "stop" };
  }

  if (turnIndex === 3) {
    if (!seenTool("add_to_cart")) {
      return { toolCalls: [{ id: "call_add_3", name: "add_to_cart", input: { productId: "p01", qty: 1 } }] };
    }
    return { text: "Added 1 Salmon Pâté to cart.", finishReason: "stop" };
  }

  if (turnIndex === 4) {
    if (!seenTool("query_state")) {
      return { toolCalls: [{ id: "call_qs_4", name: "query_state", input: { path: "$.cart.items" } }] };
    }
    return { text: "You have 1 item in your cart.", finishReason: "stop" };
  }

  if (turnIndex === 5) {
    if (!seenTool("query_data")) {
      return { toolCalls: [{ id: "call_qd_5", name: "query_data", input: { source: "products" } }] };
    }
    return { text: "There are 4 Food products and 4 Toy products.", finishReason: "stop" };
  }

  return { text: "Unknown turn.", finishReason: "stop" };
};

test.describe.configure({ retries: 1 });
test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test('multi-turn: 5 tool-driven turns in one session surface no error', async ({ page }) => {
  test.setTimeout(600_000);

  await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${multiTurnMockScript.toString()};`);
  await openPanel(page);

  const PROMPTS = [
    'Take a snapshot of this page and tell me what you see.',
    'Go to the store page and list a couple of the products you see.',
    'Add the first salmon product to my cart.',
    'How many items are in my cart right now?',
    'How many products are in each category? Give me the breakdown.',
  ];

  for (const prompt of PROMPTS) {
    await sendChat(page, prompt);
    await waitForTurnComplete(page, 150_000);

    const errCount = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').count();
    if (errCount > 0) {
      const errText = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').innerText();
      expect(errText).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
    }
  }

  const panelError = await page.evaluate(
    () => ((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null)?.error ?? null,
  );
  expect(panelError).toBeNull();

  // Scan raw tool outcomes from panel state (audit log retired to the debug screen).
  const outcomes = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    return (panel?.messages ?? [])
      .flatMap((m) => m.trace ?? [])
      .map((t) => t.outcomeSummary ?? '')
      .join(' ');
  });
  expect(outcomes).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
});
