import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

test.describe("Full-page screenshot live proof", () => {
  test("tesagent takes a full-page screenshot of checkout.html", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto("http://localhost:10040/checkout.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");

    const prompt = "Take a full-page screenshot of this checkout page.";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectCall(trace, "page_screenshot", { fullPage: true });

    await panelPage.close();
    await sitePage.close();
  });
});
