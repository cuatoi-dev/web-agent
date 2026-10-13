import { test, expect } from "@playwright/test";
import { openBubble, sendChat, waitForTurnComplete } from "./helpers";
import { docsSearchScript } from "../src/e2e-mock/mock-scripts";

test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test("mock search_docs loop: search chip renders, final text appears", async ({ page }) => {
  await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${docsSearchScript.toString()};`);

  await openBubble(page);
  await sendChat(page, "how do I theme it?");
  await waitForTurnComplete(page, 30_000);

  // search_docs tool chip appears in audit list (friendly renderer text)
  const auditText = await page.evaluate(() => {
    const items = [...((document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelectorAll("agent-message-view .tool-step-phrase") ?? [])];
    return items.map((el) => el.textContent ?? "").join(" ");
  });
  expect(auditText).toContain("Searched the docs");

  // An assistant bubble with final text rendered
  await expect(
    page.locator("agent-message-view .message-container.assistant").last()
  ).toBeVisible({ timeout: 10_000 });

  await expect(
    page.locator("agent-message-view .message-container.assistant .content").last()
  ).toContainText("Theming", { timeout: 10_000 });
});
