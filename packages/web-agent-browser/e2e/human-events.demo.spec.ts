import { test, expect, ask, expectCall } from "./demo-helpers";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

test.describe("Human event sequence — live proof", () => {
  test("fill and select_option run the host's handlers", async ({ demoExtension }) => {
    test.setTimeout(240_000);
    const page = await demoExtension.context.newPage();
    await page.goto("http://localhost:10040/human-events.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    await launcher.click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({ timeout: 10_000 });

    const { trace } = await ask(page, "Type Ada Lovelace into the name field and choose Premium", { model: demoExtension.model });

    expectCall(trace, "fill", (i) => isRecord(i) && i.value === "Ada Lovelace");
    expectCall(trace, "select_option", (i) => isRecord(i) && i.option === "Premium");

    await page.close();
  });
});
