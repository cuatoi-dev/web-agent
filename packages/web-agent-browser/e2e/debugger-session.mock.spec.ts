import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-09-17-194017-001-debugger-session-and-real-click-fill");

async function enableOrigin(worker: Worker, origins: string[]): Promise<void> {
  await worker.evaluate(async (o: string[]) => {
    await chrome.storage.local.set({ enabledOrigins: o });
  }, origins);
}

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
        return { text: "Debugger session" };
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
      function refFor(label: string): string {
        const snap = [...results].reverse().find((r) => r.tool === "page_snapshot");
        const m = snap?.text.match(new RegExp(`"${label}"[^\\n]*\\[ref=(\\d+)\\]`));
        return m ? m[1] : "missing";
      }
      function resolveRefs(input: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = { ...input };
        if (typeof out.ref === "string" && out.ref.startsWith("@")) out.ref = refFor(out.ref.slice(1));
        if (Array.isArray(out.fields)) {
          out.fields = (out.fields as { ref: string; value: string }[]).map((f) =>
            f.ref.startsWith("@") ? { ...f, ref: refFor(f.ref.slice(1)) } : f,
          );
        }
        return out;
      }
      if (results.length < queue.length) {
        const next = queue[results.length];
        return {
          toolCalls: [{ id: `tc_${results.length}`, name: next.name, input: { tabId: id, ...resolveRefs(next.input) } }],
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

test.describe("Debugger session mock e2e (124/001)", () => {
  test("M1 gate before start; every page tool needs start_debugging", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Trusted check" } },
      { name: "page_verify", input: { kind: "text_visible", text: "Cart" } },
      { name: "page_eval", input: { code: "return document.title" } },
    ];

    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Check gate and ungated tools.", 4);

    // 131/001 and 131/002 — page_eval and page_snapshot/page_verify all run
    // through the debugger now, so every one of these four is gated exactly
    // like page_click; none is "ungated" any more.
    const gate = `Debugging is not started on tab #${tabId}. Call start_debugging first.`;
    expect(results[0].isError).toBe(true);
    expect(results[0].text).toBe(gate);
    expect(results[1].isError).toBe(true);
    expect(results[1].text).toBe(gate);
    expect(results[2].isError).toBe(true);
    expect(results[2].text).toBe(gate);
    expect(results[3].isError).toBe(true);
    expect(results[3].text).toBe(gate);
    expect(await sitePage.locator("#trusted-status").textContent()).toBe("");

    await context.close();
  });

  test("M2 start and already", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [{ name: "page_click", input: { ref: "1" } }]);
    const initialResults = await runPlan(panelPage, "Click it.", 1);
    expect(initialResults[0].text).toBe(`Debugging is not started on tab #${tabId}. Call start_debugging first.`);

    await panelPage.evaluate(() => {
      window.__PLAN__ = [
        { name: "start_debugging", input: {} },
        { name: "start_debugging", input: {} },
      ];
      window.__TOOL_RESULTS__ = [];
    });

    const results = await runPlan(panelPage, "Start debugging twice.", 2);
    expect(results[0].isError).toBe(false);
    expect(results[0].text).toBe(`Debugging tab #${tabId} (localhost:10040).`);
    expect(results[1].isError).toBe(false);
    expect(results[1].text).toBe(`Tab #${tabId} is already being debugged.`);

    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-debugger-gate-light.png") });

    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-debugger-gate-dark.png") });

    await context.close();
  });

  test("M3 start_debugging attaches to a tab whose site is NOT enabled", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    // Do NOT enable origin — that is the point of this test.

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [{ name: "start_debugging", input: {} }];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging.", 1);

    expect(results[0].isError).toBe(false);
    expect(results[0].text).toBe(`Debugging tab #${tabId} (localhost:10040).`);

    await context.close();
  });

  test("M4 recover our own attach", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const pre = await worker.evaluate(async (id: number) => {
      try {
        await chrome.debugger.attach({ tabId: id }, "1.3");
        return "ok";
      } catch (e) {
        return String(e);
      }
    }, tabId);
    expect(pre).toBe("ok");

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Trusted check" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start and click.", 3);

    expect(results[0].text).toBe(`Debugging tab #${tabId} (localhost:10040).`);
    expect(results[2].isError).toBe(false);
    await expect(sitePage.locator("#trusted-status")).toHaveText("true");

    await context.close();
  });

  test("M5 trusted click", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Trusted check" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start and click Trusted check.", 3);

    expect(results[2].text).toMatch(/^Clicked \[\d+\] button "Trusted check"\.$/);
    await expect(sitePage.locator("#trusted-status")).toHaveText("true");

    await context.close();
  });

  test("M6 trusted fill replaces text", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    await sitePage.evaluate(() => {
      (document.getElementById("coupon") as HTMLInputElement).value = "OLDCODE";
    });

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_fill_form", input: { fields: [{ ref: "@Coupon", value: "SAVE10" }] } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Fill coupon.", 3);

    expect(results[2].text).toMatch(/^Filled 1 field: \[\d+\] textbox "Coupon"\.$/);
    expect(await sitePage.locator("#coupon").inputValue()).toBe("SAVE10");
    await expect(sitePage.locator("#coupon-trusted")).toHaveText("true");

    await context.close();
  });

  test("M8 confirm dismissed", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    let dialogs = 0;
    sitePage.on("dialog", () => {
      dialogs += 1;
    });
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    await sitePage.evaluate(() => {
      document.getElementById("coupon-status")!.textContent = "Discount: kept";
    });

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Remove coupon" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Click Remove coupon.", 3);

    expect(results[2].isError).toBe(false);
    expect(dialogs).toBe(1);
    await expect(sitePage.locator("#coupon-status")).toHaveText("Discount: kept");

    await context.close();
  });

  test("M9 stop", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "stop_debugging", input: {} },
      { name: "page_click", input: { ref: "1" } },
      { name: "stop_debugging", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start, stop, click, stop.", 4);

    expect(results[0].text).toBe(`Debugging tab #${tabId} (localhost:10040).`);
    expect(results[1].text).toBe(`Stopped debugging tab #${tabId}. Emulation was reset.`);
    expect(results[2].isError).toBe(true);
    expect(results[2].text).toBe(`Debugging is not started on tab #${tabId}. Call start_debugging first.`);
    expect(results[3].isError).toBe(false);
    expect(results[3].text).toBe(`Tab #${tabId} is not being debugged.`);

    await context.close();
  });

  test("M10 closing the panel detaches", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [{ name: "start_debugging", input: {} }];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging.", 1);
    expect(results[0].text).toBe(`Debugging tab #${tabId} (localhost:10040).`);

    await panelPage.close();
    await sitePage.waitForTimeout(500);

    const post = await worker.evaluate(async (id: number) => {
      try {
        await chrome.debugger.attach({ tabId: id }, "1.3");
        return "ok";
      } catch (e) {
        return String(e);
      }
    }, tabId);
    expect(post).toBe("ok");

    await worker.evaluate((id: number) => chrome.debugger.detach({ tabId: id }), tabId);
    await context.close();
  });
});
