import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

async function openCheckout(
  demoExtension: { context: import("@playwright/test").BrowserContext; extensionId: string; model: string },
): Promise<{ sitePage: Page; panelPage: Page }> {
  const sitePage = await demoExtension.context.newPage();
  await sitePage.goto("http://localhost:10040/checkout.html");

  const panelPage = await demoExtension.context.newPage();
  await panelPage.setViewportSize({ width: 400, height: 700 });
  await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
  await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
  await chooseAgent(panelPage, "tesagent");
  return { sitePage, panelPage };
}

test.describe("Network, dialogs and upload live proof (124/003)", () => {
  test("tesagent lists the checkout tab's requests with page_network", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const { sitePage, panelPage } = await openCheckout(demoExtension);

    const prompt =
      "Start debugging the checkout tab, reload it, then list its requests with page_network.";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectCall(trace, "page_network");

    await panelPage.close();
    await sitePage.close();
  });

  test("tesagent uploads a 5 MB big.bin to the Attachments input", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const { sitePage, panelPage } = await openCheckout(demoExtension);

    const prompt =
      "Start debugging the checkout tab and upload a 5 MB file named big.bin to Attachments.";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectCall(trace, "page_upload_file", (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      Array.isArray((input as { files?: unknown }).files) &&
      (input as { files: Array<{ name?: unknown }> }).files.some((file) => file.name === "big.bin"));

    await panelPage.close();
    await sitePage.close();
  });
});
