import { test, expect, ask, expectCall } from "./demo-helpers";

test.describe("Page fetch tool live proof", () => {
  test("queries same-origin inventory endpoint using page_fetch", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const page = await demoExtension.context.newPage();
    await page.goto("http://localhost:10040/page-api.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible({ timeout: 15_000 });
    await launcher.click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({ timeout: 10_000 });

    const prompt = "Query our inventory endpoint at /api/inventory using page_fetch and tell me how many Cat Bed Deluxe items we have in stock.";
    const { trace, reply } = await ask(page, prompt, { model: demoExtension.model });

    expectCall(trace, "page_fetch", (input: unknown) => {
      if (typeof input !== "object" || input === null) return false;
      const url = (input as Record<string, unknown>).url;
      return typeof url === "string" && url.endsWith("/api/inventory");
    });
    expect(reply).toContain("14");

    await page.close();
  });
});
