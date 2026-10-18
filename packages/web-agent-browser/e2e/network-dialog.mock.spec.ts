import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const SW_URL = `${ORIGIN}/sw.html`;
const IFRAME_URL = `${ORIGIN}/dialog-iframe.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(
  HERE,
  "../../../temp/artifacts/2026-09-17-194017-003-debugger-network-dialogs-and-upload",
);

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
        return { text: "Network, dialogs and upload" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
      if (Array.isArray(lastMsg?.content)) {
        for (const part of lastMsg.content) {
          if (part && typeof part === "object" && part.type === "tool-result" && !seen.has(part.toolCallId)) {
            seen.add(part.toolCallId);
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
        window.__SEEN_TOOL_IDS__ = seen;
        window.__TOOL_RESULTS__ = results;
      }
      function refFor(label: string): string {
        const snap = [...results].reverse().find((r) => r.tool === "page_snapshot");
        if (snap) {
          const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const m = snap.text.match(new RegExp(`"${escaped}"[^\\n]*\\[ref=(\\d+)\\]`));
          if (m) return m[1];
        }
        for (let i = opts.messages.length - 1; i >= 0; i--) {
          const m = opts.messages[i];
          if (!Array.isArray(m?.content)) continue;
          for (const part of m.content) {
            if (part && typeof part === "object" && part.type === "tool-result" && part.toolName === "page_snapshot") {
              const text = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
              const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const match = text.match(new RegExp(`"${escaped}"[^\\n]*\\[ref=(\\d+)\\]`));
              if (match) return match[1];
            }
          }
        }
        return "missing";
      }
      function resolveRefs(input: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = { ...input };
        if (typeof out.ref === "string" && out.ref.startsWith("@")) out.ref = refFor(out.ref.slice(1));
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
  panelPage.on("console", (m) => console.log("PANEL LOG:", m.text()));
  panelPage.on("pageerror", (err) => console.error("PANEL ERROR:", err));
  await panelPage.setViewportSize({ width: 400, height: 700 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panelPage.locator("#agent-row")).toBeVisible();
  await chooseAgent(panelPage, "tesagent");
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
  }, plan);
  return panelPage;
}

async function runPlan(
  panelPage: Page,
  prompt: string,
  count: number,
): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await sendMessage(panelPage, prompt);
  await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, count, { timeout: 30_000 });
  return panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

async function rerun(
  panelPage: Page,
  plan: PlannedCall[],
  prompt: string,
): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
  }, plan);
  return runPlan(panelPage, prompt, plan.length);
}

test.describe("page_network, page_dialog and page_upload_file mock e2e (124/003)", () => {
  test("N1 gate on all three tools before start_debugging", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "page_network", input: {} },
      { name: "page_dialog", input: { accept: false } },
      {
        name: "page_upload_file",
        input: { ref: "1", files: [{ name: "a.txt", mimeType: "text/plain", text: "a" }] },
      },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Try all three tools.", 3);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(r.text).toBe(`Debugging is not started on tab #${tabId}. Call start_debugging first.`);
    }

    await context.close();
  });

  test("N2 page load, script, and the panel screenshots", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "refresh_tab", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and reload tab.", 2);

    expect(results[1].text).toBe(`Reloaded tab #${tabId}.`);
    await sitePage.waitForLoadState("load");
    await sitePage.evaluate(() => {
      document.getElementById("coupon-status")!.textContent = "Discount: kept";
    });
    await sitePage.click("#remove-coupon-btn");
    await expect(sitePage.locator("#coupon-status")).toHaveText("Discount: kept");

    const results2 = await rerun(panelPage, [{ name: "page_network", input: {} }], "Show network log.");
    expect(results2[0].text).toMatch(/^Requests since debugging started \(\d+\):\n/);
    expect(results2[0].text).toMatch(/#\d+ GET \/checkout\.html → 200 document \(\d+ ms\)/);
    expect(results2[0].text).toMatch(/#\d+ GET \/checkout-extra\.js → 200 script/);
    expect(results2[0].text).toContain('\nDialogs:\nconfirm "Remove the coupon?" → dismissed (no answer was set)');

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

    async function scrollEvidenceIntoView(): Promise<void> {
      await panelPage.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel:not([hidden])");
        if (!panel) return;
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        let targetEl: Element | null = null;
        while ((node = walker.nextNode() as Text | null)) {
          const text = node.nodeValue ?? "";
          if (text.includes("Requests since debugging started")) {
            targetEl = node.parentElement;
            break;
          }
        }
        targetEl?.scrollIntoView({ block: "center" });
      });
    }

    await scrollEvidenceIntoView();
    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-network-dialogs-light.png") });

    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await scrollEvidenceIntoView();
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-network-dialogs-dark.png") });

    await context.close();
  });

  test("N3 coupon 500 with bodies", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [{ name: "start_debugging", input: {} }];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    await runPlan(panelPage, "Start debugging.", 1);

    await sitePage.fill("#coupon", "x".repeat(150));
    await sitePage.click("#apply-btn");
    await expect(sitePage.locator("#coupon-status")).toHaveText("Error: 500");

    const results2 = await rerun(panelPage, [{ name: "page_network", input: { filter: "coupon" } }], "Filter coupon.");
    const match = results2[0].text.match(
      /^Requests since debugging started \(1 matching "coupon"\):\n#(\d+) POST \/api\/coupon → 500 fetch \(\d+ ms\)$/,
    );
    expect(match).not.toBeNull();
    const n = Number(match![1]);

    const results3 = await rerun(panelPage, [{ name: "page_network", input: { index: n } }], "Index detail.");
    const text = results3[0].text;
    expect(text.startsWith(`#${n} POST /api/coupon → 500 fetch (`)).toBe(true);
    expect(text).toContain("\nRequest headers\n");
    expect(text).toContain("content-type: application/json");
    expect(text).toContain(`\nRequest body\n{"code":"${"x".repeat(150)}"}`);
    expect(text).toContain("\nResponse headers\n");
    expect(text).toContain('\nResponse body\n{"error":"Coupon code exceeds maximum length"}');

    await context.close();
  });

  test("N4 filter and unknown index", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [{ name: "start_debugging", input: {} }];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    await runPlan(panelPage, "Start debugging.", 1);

    await sitePage.fill("#coupon", "x".repeat(150));
    await sitePage.click("#apply-btn");
    await expect(sitePage.locator("#coupon-status")).toHaveText("Error: 500");

    const results2 = await rerun(
      panelPage,
      [
        { name: "page_network", input: { filter: "zzz" } },
        { name: "page_network", input: { index: 9999 } },
      ],
      "Filter and unknown index.",
    );

    expect(results2[0].text).toBe('No requests captured since debugging started matching "zzz".');
    expect(results2[1].text).toBe("Request #9999 was not seen, or it fell out of the 200-entry buffer.");

    await context.close();
  });

  test("N5 service worker answers a page fetch", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(SW_URL);
    await expect(sitePage.locator("#sw-status")).toHaveText("controlled", { timeout: 15_000 });
    const tabId = await getTabId(worker, SW_URL);

    const plan: PlannedCall[] = [{ name: "start_debugging", input: {} }];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    await runPlan(panelPage, "Start debugging.", 1);

    await sitePage.click("#load-totals-btn");
    await expect(sitePage.locator("#totals-status")).toContainText("service-worker");

    const results2 = await rerun(panelPage, [{ name: "page_network", input: {} }], "Show network log.");
    expect(results2[0].text).toMatch(/#\d+ GET \/api\/totals → 200 fetch/);

    await context.close();
  });

  test("N6 iframe confirm dismissed, then reported", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(IFRAME_URL);
    const tabId = await getTabId(worker, IFRAME_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_dialog", input: { accept: false } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and dismiss next dialog.", 2);

    expect(results[1].text).toMatch(/^The next dialog will be dismissed\.$/);

    await sitePage.frameLocator("#dialog-frame").locator("#ask-btn").click();
    await expect(sitePage.frameLocator("#dialog-frame").locator("#result")).toHaveText("false");

    const results2 = await rerun(panelPage, [{ name: "page_dialog", input: { accept: true } }], "Configure next dialog.");
    expect(results2[0].text).toMatch(/^The next dialog will be accepted\. Last dialog: confirm "Continue\?" → dismissed$/);

    await context.close();
  });

  test("N7 prompt accepted with text", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_dialog", input: { accept: true, promptText: "hi" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and accept prompt with text.", 2);

    expect(results[1].text).toMatch(/^The next dialog will be accepted\. A prompt will receive "hi"\.$/);

    await sitePage.click("#gift-message-btn");
    await expect(sitePage.locator("#gift-status")).toHaveText("hi");

    await context.close();
  });

  test('N8 "Leave site?" accepted, reload completes', async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    let pendingDialog: { dismiss(): Promise<void> } | null = null;
    sitePage.on("dialog", (dialog) => {
      pendingDialog = dialog;
    });
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [{ name: "start_debugging", input: {} }];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    await runPlan(panelPage, "Start debugging.", 1);

    await sitePage.click("#leave-guard-btn");
    await expect(sitePage.locator("#leave-status")).toHaveText("guarded");

    const results2 = await rerun(
      panelPage,
      [
        { name: "page_dialog", input: { accept: true } },
        { name: "refresh_tab", input: {} },
      ],
      "Accept next dialog and reload.",
    );

    expect(results2[1].isError).toBe(false);
    expect(results2[1].text).toBe(`Reloaded tab #${tabId}.`);
    await expect(sitePage.locator("#leave-status")).toHaveText("");

    const results3 = await rerun(panelPage, [{ name: "page_network", input: {} }], "Show network log.");
    expect(results3[0].text).toContain('beforeunload "" → accepted');

    if (pendingDialog) {
      await (pendingDialog as { dismiss(): Promise<void> }).dismiss().catch(() => {});
    }

    await context.close();
  });

  test("N9 upload text and generated files", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      {
        name: "page_upload_file",
        input: {
          ref: "@Attachments",
          files: [{ name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" }],
        },
      },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, snapshot, and upload text file.", 3);

    expect(results[2].text).toMatch(/^Uploaded 1 file to \[\d+\] .+: orders\.csv \(8 B\)\.$/);
    await expect(sitePage.locator("#upload-status")).toHaveText("orders.csv|text/csv|8");

    const results2 = await rerun(
      panelPage,
      [
        { name: "page_snapshot", input: {} },
        {
          name: "page_upload_file",
          input: {
            ref: "@Attachments",
            files: [{ name: "big.bin", mimeType: "application/octet-stream", size: 5242880, fill: "A" }],
          },
        },
      ],
      "Upload big.bin.",
    );

    expect(results2[1].text).toMatch(/big\.bin \(5\.0 MB\)\.$/);
    await expect(sitePage.locator("#upload-status")).toHaveText("big.bin|application/octet-stream|5242880");

    await context.close();
  });

  test("N10 upload errors", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      {
        name: "page_upload_file",
        input: {
          ref: "@Attachments",
          files: [{ name: "huge.bin", mimeType: "application/octet-stream", size: 11534336, fill: "A" }],
        },
      },
      {
        name: "page_upload_file",
        input: {
          ref: "@Apply",
          files: [{ name: "a.txt", mimeType: "text/plain", text: "a" }],
        },
      },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and test upload errors.", 4);

    expect(results[2].isError).toBe(true);
    expect(results[2].text).toBe("Uploads are limited to 10 MB in total.");

    expect(results[3].isError).toBe(true);
    expect(results[3].text).toMatch(/^Element \[\d+\] .+ is not a file input\.$/);

    await expect(sitePage.locator("#upload-status")).toHaveText("");

    await context.close();
  });

  test("N11 page_fetch still works and the page's own fetch is not broken", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_fetch", input: { url: "/api/inventory" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and fetch inventory.", 2);

    expect(results[1].text).toContain("Cat Bed Deluxe");

    await sitePage.fill("#coupon", "SAVE10");
    await sitePage.click("#apply-btn");
    await expect(sitePage.locator("#coupon-status")).toHaveText("Discount: -$4.20");

    const results2 = await rerun(panelPage, [{ name: "page_network", input: { filter: "coupon" } }], "Filter coupon.");
    expect(results2[0].text).toMatch(/POST \/api\/coupon → 200 fetch/);

    await context.close();
  });
});
