import { test, expect } from './fixtures';
import {
  openPanel,
  sendChat,
  waitForAssistantReply,
  waitForToolCall,
  getCartBadge,
  gotoStore,
  shot,
} from './helpers';

import type { ProviderCallOptions } from '@cuatoi/web-agent-core';

/** The one content-part shape read back out of `opts.messages` here — the
 *  real ContentPart union carries several other variants. */
interface ToolResultPartLike {
  type: 'tool-result';
  toolName: string;
}

const functionalMockScript = function (opts: ProviderCallOptions) {
  const seenTool = (name: string) => {
    for (const msg of opts.messages) {
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        for (const part of msg.content as ToolResultPartLike[]) {
          if (part.type === "tool-result" && part.toolName === name) return true;
        }
      }
    }
    return false;
  };

  let prompt = "";
  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const m = opts.messages[i];
    if (m.role === "user") {
      prompt = (typeof m.content === "string" ? m.content : "").toLowerCase();
      break;
    }
  }

  if (prompt.includes("help")) {
    return { text: "I can help you browse, search, and manage your cart.", finishReason: "stop" };
  }

  if (prompt.includes("snapshot")) {
    if (!seenTool("snapshot_page")) {
      return { toolCalls: [{ id: "call_snap", name: "snapshot_page", input: {} }] };
    }
    if (!seenTool("click")) {
      return { toolCalls: [{ id: "call_click", name: "click", input: { ref: "2" } }] };
    }
    return { text: "Navigated to store.", finishReason: "stop" };
  }

  if (prompt.includes("salmon") && !prompt.includes("add")) {
    if (!seenTool("click")) {
      return { toolCalls: [{ id: "call_click", name: "click", input: { ref: "2" } }] };
    }
    return { text: "I found Salmon Pâté.", finishReason: "stop" };
  }

  if (prompt.includes("category")) {
    if (!seenTool("query_data")) {
      return { toolCalls: [{ id: "call_qd", name: "query_data", input: { source: "products" } }] };
    }
    return { text: "Here is the category breakdown.", finishReason: "stop" };
  }

  if (prompt.includes("bar chart")) {
    if (!seenTool("show_chart")) {
      return {
        toolCalls: [{
          id: "call_chart",
          name: "show_chart",
          input: {
            title: "Products by Price",
            config: {
              type: "bar",
              data: {
                labels: ["Salmon", "Tuna"],
                datasets: [{ label: "Price", data: [3.99, 4.49] }]
              }
            }
          }
        }]
      };
    }
    return { text: "Here is the chart of products by price.", finishReason: "stop" };
  }

  if (prompt.includes("add the first salmon")) {
    if (!seenTool("add_to_cart")) {
      return {
        toolCalls: [{
          id: "call_add",
          name: "add_to_cart",
          input: { productId: "p01", qty: 1 }
        }]
      };
    }
    return { text: "Added Salmon Pâté to your cart.", finishReason: "stop" };
  }

  return { text: "Unknown prompt.", finishReason: "stop" };
};

test.describe.configure({ mode: 'serial' });
test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${functionalMockScript.toString()};`);
  await openPanel(page);
});

test('chat: relevant reply', async ({ page }) => {
  test.setTimeout(180_000);
  await sendChat(page, 'What can you help me with?');
  const reply = await waitForAssistantReply(page);
  expect(reply.length).toBeGreaterThan(5);
  const errCount = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').count();
  if (errCount > 0) {
    const errText = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').innerText();
    expect(errText).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
  }
  await shot(page, 'func-01-chat.png');
});

test('tools: snapshot + navigate', async ({ page }) => {
  test.setTimeout(180_000);
  await sendChat(page, 'Take a snapshot of this page and then take me to the store page.');
  await waitForToolCall(page);
  await waitForAssistantReply(page);
  await expect.poll(async () => {
    const productCount = await page.locator('[class*="product"], .product-card, .products').count();
    const urlMatch = page.url().includes('store');
    return productCount > 0 || urlMatch;
  }, { timeout: 10_000 }).toBe(true);
  await shot(page, 'func-02-navigate.png');
});

test('tools: click + fill + select_option + wait_for', async ({ page }) => {
  test.setTimeout(180_000);
  await sendChat(page, 'Go to the store, filter/search for salmon, and tell me the first product you see.');
  await waitForToolCall(page);
  const reply = await waitForAssistantReply(page);
  expect(reply.length).toBeGreaterThan(0);
  const errCount = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').count();
  if (errCount > 0) {
    const errText = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').innerText();
    expect(errText).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
  }
  await shot(page, 'func-03-tools.png');
});

test('query_data / query_state', async ({ page }) => {
  test.setTimeout(180_000);
  await sendChat(page, 'How many products are in each category? Show me the breakdown.');
  await waitForToolCall(page);
  const reply = await waitForAssistantReply(page);
  expect(reply.length).toBeGreaterThan(0);
  const errCount = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').count();
  if (errCount > 0) {
    const errText = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').innerText();
    expect(errText).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
  }
  await shot(page, 'func-04-query.png');
});

test('ui blocks + chart', async ({ page }) => {
  test.setTimeout(180_000);
  await sendChat(page, 'Show me a bar chart of products sorted by price.');
  await waitForAssistantReply(page, 120_000);
  const chartNodes = await page.locator(
    'agent-message-view canvas, agent-message-view .blocks-container *'
  ).count();
  expect(chartNodes).toBeGreaterThan(0);
  await shot(page, 'func-05-chart.png');
});

test('cart: add to cart updates badge', async ({ page }) => {
  test.setTimeout(180_000);
  await gotoStore(page);
  const before = await getCartBadge(page);
  await openPanel(page);
  await sendChat(page, 'Add the first salmon product to my cart.');
  await waitForAssistantReply(page);
  await expect.poll(() => getCartBadge(page), { timeout: 15_000 }).toBeGreaterThan(before);
  const errCount = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').count();
  if (errCount > 0) {
    const errText = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').innerText();
    expect(errText).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
  }
  await shot(page, 'func-06-cart.png');
});
