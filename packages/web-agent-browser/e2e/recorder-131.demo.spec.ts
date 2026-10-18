import { test, expect, ask } from "./demo-helpers";
import { routeCrossSiteFrames } from "./cross-site-frames";

const FIXTURE_URL = "http://localhost:10040/checkout-frames.html";

test.describe("Recorder iframe steps — live proof", () => {
  test("list: a recording with an iframe step is listed", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    await routeCrossSiteFrames(demoExtension.context);

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
    await sitePage.locator("#email").fill("buyer@shop.test");
    await sitePage.frameLocator("#payment").locator("#card").fill("4242 4242 4242 4242");
    await sitePage.frameLocator("#payment").locator("#pay").click();
    await expect(async () => {
      expect(await recordedSteps.count()).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 15_000 });
    await pickWatchMe();

    const prompt = "List what I did";
    const { reply } = await ask(panelPage, prompt, { model: demoExtension.model });
    expect(reply).toContain("Pay");

    await panelPage.close();
    await sitePage.close();
  });
});
