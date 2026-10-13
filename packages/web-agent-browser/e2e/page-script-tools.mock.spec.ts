// 131/001 — page_eval, page_fetch and page_console on the Chrome debugger.
// `enabledOrigins` is never set in this spec: that is what proves the site
// check is gone. The CSP page proves page_eval is not blocked by a page's own
// policy; the timeout case proves a stuck script is stopped and the tab
// recovers.
import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CDP_URL = `${ORIGIN}/page-eval-cdp.html`;

async function getWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const inputArea = page.locator("agent-chat-panel:not([hidden]) #input");
  await inputArea.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

async function openPanel(context: BrowserContext, extensionId: string, tabId: number, plan: PlannedCall[]): Promise<Page> {
  const panelPage = await context.newPage();
  await panelPage.addInitScript((id: number) => {
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Page script tools" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      if (Array.isArray(lastMsg?.content)) {
        for (const part of lastMsg.content) {
          if (part && typeof part === "object" && part.type === "tool-result") {
            const output = part.output;
            const text =
              typeof output === "string"
                ? output
                : typeof output === "object" && output !== null && typeof output.content === "string"
                  ? output.content
                  : JSON.stringify(output);
            results.push({ tool: part.toolName, text, isError: !!part.isError });
          }
        }
        window.__TOOL_RESULTS__ = results;
      }
      if (results.length < queue.length) {
        const next = queue[results.length];
        return {
          toolCalls: [{ id: `tc_${results.length}`, name: next.name, input: { tabId: id, ...next.input } }],
        };
      }
      return { text: results.map((r) => r.text).join("\n") };
    };
  }, tabId);
  await panelPage.setViewportSize({ width: 400, height: 700 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panelPage.locator("#agent-row")).toBeVisible();
  await chooseAgent(panelPage, "tesagent");
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
  }, plan);
  return panelPage;
}

async function runPlan(panelPage: Page, prompt: string, count: number): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await sendMessage(panelPage, prompt);
  await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, count, { timeout: 30_000 });
  return panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

test.describe("page_eval, page_fetch and page_console on the debugger (131/001)", () => {
  test("C1 the page's own CSP does not block page_eval", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    // enabledOrigins is never set — proves the site check is gone.

    const sitePage = await context.newPage();
    await sitePage.goto(CDP_URL);
    const tabId = await getTabId(worker, CDP_URL);
    expect(await sitePage.evaluate(() => window.__NEW_FUNCTION_BLOCKED__)).toBe(true);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_eval", input: { code: "return new Function('return 7')()" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, then run a script.", 2);

    expect(results[0].isError).toBe(false);
    expect(results[1].isError).toBe(false);
    expect(results[1].text).toContain("Result type: number");
    expect(results[1].text).toContain("7");

    await context.close();
  });

  test("C2 page_console returns a load-time log written before start_debugging", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CDP_URL);
    const tabId = await getTabId(worker, CDP_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_console", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, then read the console.", 2);

    expect(results[1].isError).toBe(false);
    expect(results[1].text).toContain("early");

    await context.close();
  });

  test("C3, C4 a script past its timeout is stopped and the tab recovers", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CDP_URL);
    const tabId = await getTabId(worker, CDP_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_eval", input: { code: "while (true) {}", timeoutMs: 2000 } },
      { name: "page_eval", input: { code: "return document.title" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const start = Date.now();
    const results = await runPlan(panelPage, "Start debugging, run a stuck loop with a 2s timeout, then read the title.", 3);
    const elapsedMs = Date.now() - start;

    expect(results[1].isError).toBe(true);
    expect(results[1].text).toContain("page_eval stopped the script after 2000 ms");
    expect(elapsedMs).toBeLessThan(4000);

    expect(results[2].isError).toBe(false);
    expect(results[2].text).toContain("CDP Eval Fixture");

    await context.close();
  });

  test("C5 page_fetch reaches the fixture's API without the site enabled", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CDP_URL);
    const tabId = await getTabId(worker, CDP_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_fetch", input: { url: "/api/inventory" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, then fetch the inventory.", 2);

    expect(results[1].isError).toBe(false);
    expect(results[1].text).toContain("Status: 200");

    await context.close();
  });
});
