import { test, expect, ask, expectCall } from "./demo-helpers";

const FIXTURE_URL = "http://localhost:10040/plain.html";

test.describe("Page agent — live proof", () => {
  test("page agent: ask the in-page agent for the page title", async ({ demoExtension }) => {
    test.setTimeout(330_000);

    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto(FIXTURE_URL);
    await expect(sitePage.locator("web-agent-bubble #launcher")).toBeVisible({ timeout: 15_000 });

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await sitePage.bringToFront();

    const prompt = "Ask the agent on this page what the page title is";
    const { trace, reply } = await ask(panelPage, prompt, { model: demoExtension.model, timeoutMs: 300_000 });
    expectCall(trace, "send_to_page_agent");
    expect(reply.toLowerCase()).toContain("plain page");

    await panelPage.close();
    await sitePage.close();
  });
});
