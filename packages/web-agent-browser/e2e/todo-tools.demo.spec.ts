import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

test.describe("Todo tools live proof", () => {
  test("tesagent plans a multi-step job with todo_write", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 480, height: 760 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");

    const prompt =
      "Plan three steps to read this plain page's title, report it, and finish. Write the steps with todo_write before doing them.";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectCall(trace, "todo_write", (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      Array.isArray((input as { items?: unknown }).items) &&
      (input as { items: unknown[] }).items.length > 1);

    await panelPage.close();
    await sitePage.close();
  });
});
