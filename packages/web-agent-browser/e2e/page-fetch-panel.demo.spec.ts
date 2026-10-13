import { test, expect, ask, expectOrder, expectCall } from "./demo-helpers";

test.describe("page_fetch from the side panel — live proof", () => {
  test("same-origin fetch through the tab's session (Case A)", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const fixturePage = await demoExtension.context.newPage();
    await fixturePage.goto("http://localhost:10040/plain.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel")).toBeAttached();

    const prompt = "Use read_tabs, then start_debugging on the localhost:10040 tab, then run page_fetch on it with url /api/inventory, and report the status and the item names.";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectOrder(trace, ["read_tabs", "start_debugging", "page_fetch"]);
    expectCall(trace, "page_fetch", (input: unknown) => {
      if (typeof input !== "object" || input === null) return false;
      const url = (input as Record<string, unknown>).url;
      return typeof url === "string" && url.endsWith("/api/inventory");
    });

    await panelPage.close();
    await fixturePage.close();
  });
});
