import { test, expect, ask, expectCall } from "./demo-helpers";

const FIXTURE_URL = "http://localhost:10040/checkout.html";

test.describe("Watch me export — live proof", () => {
  test("export: turn a recording into a Playwright test", async ({ demoExtension }) => {
    test.setTimeout(150_000);

    const sitePage = await demoExtension.context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(FIXTURE_URL);

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await panelPage.locator("#agent-combo").click();
    await expect(panelPage.locator("#agent-list")).toBeVisible();
    await panelPage.locator("#agent-option-tesagent").click();
    await expect(panelPage.locator("#agent-combo .name")).toHaveText("Tesagent");
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await sitePage.bringToFront();

    const pickWatchMe = () => panelPage.evaluate(async () => {
      const panel = document.querySelector("agent-chat-panel:not([hidden])");
      const provider = panel?.attachmentProviders?.find((p) => p.id === "watch-me");
      if (!provider) throw new Error("no watch-me provider on the visible panel");
      await provider.pick();
    });
    const recordedSteps = panelPage.locator('agent-chat-panel:not([hidden]) [data-attachment-slot="watch-me"] li');

    await pickWatchMe();
    await sitePage.locator("#coupon").fill("SAVE10");
    await sitePage.locator("#apply-btn").click();
    await expect(recordedSteps).toHaveCount(2);
    await pickWatchMe();

    const prompt = "Turn what I just did into a Playwright test";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });
    expectCall(trace, "export_test");

    await panelPage.close();
    await sitePage.close();
  });
});
