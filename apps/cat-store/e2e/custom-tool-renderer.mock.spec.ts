import { test, expect } from "./fixtures";
import { openPanel, sendChat } from "./helpers";
import { catAddToCartScript } from "../src/web/e2e-mock/mock-scripts";

test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test("add_to_cart tool-step shows the custom renderer bold HTML", async ({ page }) => {
  await page.addInitScript(
    `window.__WA_MOCK_SCRIPT__ = ${catAddToCartScript.toString()};`
  );

  let apiCallCount = 0;
  await page.route("**/api/anthropic/**", (route) => {
    apiCallCount++;
    void route.abort();
  });

  await openPanel(page);
  await sendChat(page, "add 3 p01 to cart");

  // Wait for the tool-step to appear
  await page.locator("agent-message-view .tool-step").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });

  // The add_to_cart renderer produces HTML with <b> tags
  const boldEl = page.locator("agent-message-view .tool-step-phrase b").first();
  await expect(boldEl).toBeVisible({ timeout: 15_000 });
  const boldText = await boldEl.textContent();
  expect(boldText).toContain("3");

  // Zero real model calls (leak guard)
  expect(apiCallCount).toBe(0);
});
