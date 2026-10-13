import { test, expect } from './fixtures';
import {
  openPanel,
  sendChat,
  waitForAssistantReply,
  waitForToolCall,
  getCartBadge,
  gotoCart,
  clearCartViaUI,
  getLinePromoBadge,
  getPromoDiscountText,
  shot,
} from './helpers';

import type { ProviderCallOptions } from '@cuatoi/web-agent-core';

/** The one content-part shape read back out of `opts.messages` here — the
 *  real ContentPart union carries several other variants. */
interface ToolResultPartLike {
  type: 'tool-result';
  toolName: string;
}

const promoMockScript = function (opts: ProviderCallOptions) {
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

  if (prompt.includes("add 2 salmon pâté") || prompt.includes("add 2 salmon")) {
    if (!seenTool("add_to_cart")) {
      return { toolCalls: [{ id: "call_add_2", name: "add_to_cart", input: { productId: "p01", qty: 2 } }] };
    }
    return { text: "Added 2 Salmon Pâté to your cart.", finishReason: "stop" };
  }

  if (prompt.includes("add 3 salmon pâté") || prompt.includes("add 3 salmon")) {
    if (!seenTool("add_to_cart")) {
      return { toolCalls: [{ id: "call_add_3", name: "add_to_cart", input: { productId: "p01", qty: 3 } }] };
    }
    return { text: "Added 3 Salmon Pâté to your cart.", finishReason: "stop" };
  }

  if (prompt.includes("crinkle ball")) {
    if (!seenTool("add_to_cart")) {
      return { toolCalls: [{ id: "call_add_crinkle", name: "add_to_cart", input: { productId: "p07", qty: 1 } }] };
    }
    return { text: "Sorry, Crinkle Ball Set is out of stock.", finishReason: "stop" };
  }

  if (prompt.includes("promotions") || prompt.includes("running")) {
    if (!seenTool("search_skills")) {
      return { toolCalls: [{ id: "call_search", name: "search_skills", input: { query: "promotions-assistant" } }] };
    }
    if (!seenTool("load_skill")) {
      return { toolCalls: [{ id: "call_load", name: "load_skill", input: { name: "promotions-assistant" } }] };
    }
    return { text: "The store has B3G1 on Food and B5G2 on Toys.", finishReason: "stop" };
  }

  return { text: "Unknown prompt.", finishReason: "stop" };
};

test.describe.configure({ mode: 'serial' });
test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${promoMockScript.toString()};`);
  await openPanel(page);
});

test('promo skill: chat add_to_cart adds 2 Salmon Pâté and agent replies', async ({ page }) => {
  test.setTimeout(180_000);
  await clearCartViaUI(page);

  await sendChat(page, 'Please add 2 Salmon Pâté to my cart.');
  const reply = await waitForAssistantReply(page, 120_000);

  await expect.poll(() => getCartBadge(page), { timeout: 15_000 }).toBe(2);
  expect(reply.length).toBeGreaterThan(0);
  await shot(page, 'promo-skill-01-nudge.png');
});

test('promo skill: free unit and $3.99 discount in cart after adding 3 Salmon Pâté', async ({ page }) => {
  test.setTimeout(180_000);
  await clearCartViaUI(page);

  await sendChat(page, 'Add 3 Salmon Pâté (product ID p01) to my cart.');
  await waitForAssistantReply(page, 120_000);

  await expect.poll(() => getCartBadge(page), { timeout: 15_000 }).toBe(3);

  await gotoCart(page);
  const promoBadge = await getLinePromoBadge(page, 'p01');
  expect(promoBadge).toMatch(/1\s*free/i);

  const discountText = await getPromoDiscountText(page);
  expect(discountText).toMatch(/3\.99/);
  await shot(page, 'promo-skill-02-cart.png');
});

test('add_to_cart: out-of-stock product rejected with error, badge unchanged', async ({ page }) => {
  test.setTimeout(180_000);
  await clearCartViaUI(page);
  const before = await getCartBadge(page);

  await sendChat(page, 'Add 1 Crinkle Ball Set to my cart.');
  await waitForAssistantReply(page, 120_000);

  const after = await getCartBadge(page);
  expect(after).toBe(before);
  await shot(page, 'custom-03-outofstock.png');
});

test('skills: search_skills → load_skill round-trip for promotions-assistant', async ({ page }) => {
  test.setTimeout(180_000);
  await sendChat(page, 'What promotions are currently running in the store?');
  await waitForToolCall(page, 60_000);
  await waitForAssistantReply(page, 120_000);

  const errText = await page.locator('agent-chat-panel').innerText();
  expect(errText).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
  await shot(page, 'custom-04-skills.png');
});
