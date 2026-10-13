import { test, expect, ask, expectOrder, expectNoCall } from "./demo-helpers";

test.describe("Snapshot breadth-first walk — live proof", () => {
  test("answers WWII start/end dates from snapshot_page alone, no page_eval fallback", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const page = await demoExtension.context.newPage();
    await page.goto("http://localhost:10040/wwii-article.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    await launcher.click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({ timeout: 10_000 });

    const prompt = "What are the start and end dates of the war on this page?";
    const { trace, reply } = await ask(page, prompt, { model: demoExtension.model });

    expectOrder(trace, ["snapshot_page"]);
    expectNoCall(trace, "page_eval");

    const snapshotCall = trace.find((t) => t.name === "snapshot_page");
    expect(snapshotCall?.outcomeSummary).toContain("1 September 1939");
    expect(snapshotCall?.outcomeSummary).toContain("2 September 1945");
    expect(reply).toMatch(/1 September 1939/i);
    expect(reply).toMatch(/2 September 1945/i);

    await page.close();
  });
});
