import { test, expect } from "@playwright/test";
import { openPanel, sendChat, getCartBadge } from "./helpers";
import { catAddToCartScript } from "../src/web/e2e-mock/mock-scripts";

const MOCK_REPLY = "MOCKED-REPLY-7f3a";

test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test("deterministic agent reply with zero network (mock provider proof)", async ({ page }) => {
  await page.addInitScript((reply) => {
    window.__WA_MOCK_SCRIPT__ = { text: reply, finishReason: "stop" };
  }, MOCK_REPLY);

  let apiCallCount = 0;
  await page.route("**/api/anthropic/**", (route) => {
    apiCallCount++;
    void route.abort();
  });

  await openPanel(page);
  await sendChat(page, "hi");

  await expect(page.locator("agent-message-view .assistant .content")).toContainText(MOCK_REPLY, {
    timeout: 10_000,
  });
  expect(apiCallCount).toBe(0);
});

test("mock tool loop: add_to_cart → cart badge 3, zero network", async ({ page }) => {
  await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${catAddToCartScript.toString()};`);

  let apiCallCount = 0;
  await page.route("**/api/anthropic/**", (route) => {
    apiCallCount++;
    void route.abort();
  });

  await openPanel(page);
  await sendChat(page, "add 3 p01 to cart");

  // Wait for cart badge to reach 3 (tool executed and Redux updated)
  await expect.poll(() => getCartBadge(page), { timeout: 30_000 }).toBe(3);

  // Zero real model calls (leak guard)
  expect(apiCallCount).toBe(0);

  // add_to_cart tool-step shows the custom renderer's bold HTML
  const toolPhrase = page.locator("agent-message-view .tool-step-phrase").first();
  await expect(toolPhrase).toBeVisible({ timeout: 10_000 });
  await expect(toolPhrase).toContainText("3×", { timeout: 10_000 });
  // Verify renderer HTML is applied (bold element exists)
  await expect(toolPhrase.locator("b")).toBeVisible({ timeout: 5_000 });

  // Final mock text rendered
  await expect(
    page.locator("agent-message-view .assistant .content").last()
  ).toContainText("Added 3", { timeout: 10_000 });
});
