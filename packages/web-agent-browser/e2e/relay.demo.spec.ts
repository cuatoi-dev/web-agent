import { test, expect, ask, expectCall } from "./demo-helpers";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

test.describe("Relay — live proof", () => {
  test("click and fill bubble tools drive the page", async ({ demoExtension }) => {
    test.setTimeout(240_000);
    const page = await demoExtension.context.newPage();
    await page.goto("http://localhost:10040/page-tools.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    await launcher.click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({ timeout: 10_000 });

    const { trace } = await ask(page, "Click the Search button, then type hooks into the search box", { model: demoExtension.model });

    expectCall(trace, "click");
    expectCall(trace, "fill", (i) => /hooks/.test(isRecord(i) && typeof i.value === "string" ? i.value : ""));

    await page.close();
  });
});
