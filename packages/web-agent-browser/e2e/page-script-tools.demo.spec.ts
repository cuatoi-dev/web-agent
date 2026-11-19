// The live proof: the real router, model `sonnet`
// (the extension's default profile, `brand/model.yml`'s first entry,
// `anthropic-sonnet`).
import { test, expect, ask, expectOrder } from "./demo-helpers";
import type { Page } from "@playwright/test";

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

test.describe("Debugger session and page_eval/page_console live proof", () => {
  test("tesagent starts debugging, evaluates the title, and reads the console in order", async ({
    demoExtension,
  }) => {
    test.setTimeout(150_000);
    const cdpPage = await demoExtension.context.newPage();
    await cdpPage.goto("http://localhost:10040/page-eval-cdp.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");

    const prompt = "Start debugging that tab, then tell me the page title using a script, and what the console logged.";
    const { trace, reply } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectOrder(trace, ["start_debugging", "page_eval", "page_console"]);
    expect(reply).toContain("CDP Eval Fixture");
    expect(reply).toContain("early");

    await panelPage.close();
    await cdpPage.close();
  });

  test("chromagent hits the debugging gate, then recovers with a successful page_eval", async ({
    demoExtension,
  }) => {
    test.setTimeout(150_000);
    const plainPage = await demoExtension.context.newPage();
    await plainPage.goto("http://localhost:10040/plain.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "chromagent");

    const prompt = "Use read_tabs, then run page_eval on the plain.html tab with code: return document.title";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectOrder(trace, ["page_eval", "start_debugging", "page_eval"]);
    const evalCalls = trace.filter((entry) => entry.name === "page_eval");
    expect(evalCalls[0]?.outcomeSummary).toContain("Call start_debugging first");
    expect(evalCalls[evalCalls.length - 1]?.outcomeSummary).toContain("Plain page");

    await panelPage.close();
    await plainPage.close();
  });
});
