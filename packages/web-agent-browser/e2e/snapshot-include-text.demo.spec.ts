import { test, expect, ask, expectCall, expectNoCall } from "./demo-helpers";

test.describe("Snapshot include_text filter — live proof", () => {
  test("finds Wikidata control using snapshot_page, no page_eval", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const page = await demoExtension.context.newPage();
    await page.goto("http://localhost:10040/wwii-article.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    await launcher.click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({ timeout: 10_000 });

    const prompt = "Find the control on this page that lets you edit this article's data at Wikidata, and tell me its exact label.";
    const { trace, reply } = await ask(page, prompt, { model: demoExtension.model });

    expectCall(trace, "snapshot_page");
    expectNoCall(trace, "page_eval");
    expect(reply.toLowerCase()).toContain("edit this at wikidata");

    await page.close();
  });
});
