import { test, expect, ask, expectCall } from "./demo-helpers";

test.describe("page_console from the side panel — live proof", () => {
  test("load-time errors are captured and reported (Case A)", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const fixturePage = await demoExtension.context.newPage();
    await fixturePage.goto("http://localhost:10040/page-console-errors.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel")).toBeAttached();

    const prompt = "Use read_tabs, then start_debugging on the localhost:10040 tab, then run page_console on it with level error, and report exactly what each error entry says.";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectCall(trace, "page_console", { level: "error" });

    await panelPage.close();
    await fixturePage.close();
  });
});
