import { test, expect, ask, expectCall } from "./demo-helpers";

const FIXTURE_URL = "http://localhost:10040/page-screenshot.html";

test.describe("Page screenshot — live proof", () => {
  test("page_screenshot: screenshot and read the main heading", async ({ demoExtension }) => {
    test.setTimeout(150_000);

    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto(FIXTURE_URL);

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await sitePage.bringToFront();

    const prompt = "Take a screenshot of this page and tell me its main heading";
    const { trace, reply } = await ask(panelPage, prompt, { model: demoExtension.model });
    expectCall(trace, "page_screenshot");
    expect(reply.toUpperCase()).toContain("ABOVE THE FOLD");

    await panelPage.close();
    await sitePage.close();
  });
});
