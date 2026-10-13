import { test, expect, ask, expectOrder, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

test.describe("page_eval from the side panel — live proof", () => {
  test("tesagent starts debugging then evaluates document.title on plain.html", async ({
    demoExtension,
  }) => {
    test.setTimeout(150_000);
    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");

    const prompt = "Start debugging the plain tab, then run page_eval with: return document.title";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectOrder(trace, ["start_debugging", "page_eval"]);
    expectCall(trace, "page_eval", (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      typeof (input as { code?: unknown }).code === "string" &&
      (input as { code: string }).code.includes("document.title"));

    const evalCall = trace.find(
      (t) => t.name === "page_eval" && t.outcomeSummary.includes("Plain page"),
    );
    expect(evalCall, "expected a successful page_eval result containing Plain page").toBeTruthy();

    await panelPage.close();
    await sitePage.close();
  });
});
