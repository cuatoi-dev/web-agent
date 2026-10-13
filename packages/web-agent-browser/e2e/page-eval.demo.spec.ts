import { test, expect, ask, expectCall } from "./demo-helpers";

test.describe("Page eval tool live proof", () => {
  test("the in-page bubble answers from a hidden page value with page_eval", async ({
    demoExtension,
  }) => {
    test.setTimeout(150_000);
    const page = await demoExtension.context.newPage();
    await page.goto("http://localhost:10040/page-eval.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible({ timeout: 15_000 });
    await launcher.click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({
      timeout: 10_000,
    });

    const prompt1 =
      "How many pending orders does this console have, and what shipping estimate does it give for the APAC region? The page does not show either number. Use page_eval to find out.";
    const { trace, reply } = await ask(page, prompt1, { model: demoExtension.model });

    expectCall(trace, "page_eval");
    expect(reply).toMatch(/\b7\b/);
    expect(reply).toMatch(/\b3\b/);

    await page.close();
  });
});
