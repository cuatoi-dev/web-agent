import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-09-17-194017-004-action-journal-export-and-test-skills");

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
        return { text: "Action journal 004" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
      let imageInjections = window.__IMAGE_INJECTIONS__ ?? 0;
      // A page_screenshot success stashes its image as a PENDING image the core
      // loop injects as its own user message on the NEXT call — that pushes the
      // tool-result one position back from the end, so every message is scanned
      // (deduped by toolCallId) rather than only the last one.
      for (const msg of opts.messages) {
        if (!Array.isArray(msg?.content)) continue;
        for (const part of msg.content) {
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
          if (part && typeof part === "object" && part.type === "image") imageInjections += 1;
        }
      }
      window.__SEEN_TOOL_IDS__ = seen;
      window.__TOOL_RESULTS__ = results;
      window.__IMAGE_INJECTIONS__ = imageInjections;
      function refFor(label: string): string {
        const snap = [...results].reverse().find((r) => r.tool === "page_snapshot");
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = snap?.text.match(new RegExp(`"${escaped}"[^\\n]*\\[ref=(\\d+)\\]`));
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
    window.__IMAGE_INJECTIONS__ = 0;
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

/** Starts a new chat in the visible panel and loads a new plan. */
async function newChat(panelPage: Page, plan: PlannedCall[]): Promise<void> {
  await panelPage.evaluate(async (p: PlannedCall[]) => {
    const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>("agent-chat-panel:not([hidden])");
    if (!panel) throw new Error("expected agent-chat-panel");
    await panel.createSession();
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
  }, plan);
}

test.describe("action journal and export_test mock e2e (124/004)", () => {
  test("J1 journal ids, password, checks and FAIL", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const exportInput = {
      suite: "Checkout coupon",
      url: "http://localhost:10040/checkout.html",
      cases: [
        {
          id: "TC-01",
          title: "Apply a valid code",
          steps: [
            { text: "Fill the coupon and password", journal: [1, 2] },
            { text: "Click Apply", journal: [3] },
            { text: "The discount is shown", journal: [4] },
          ],
        },
        {
          id: "TC-02",
          title: "Apply again",
          steps: [
            { text: "Click Apply", journal: [3] },
            { text: "The discount is shown", journal: [4] },
          ],
        },
      ],
    };

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      {
        name: "page_fill_form",
        input: { fields: [{ ref: "@Coupon", value: "SAVE10" }, { ref: "@Password", value: "secret123" }] },
      },
      { name: "page_click", input: { ref: "@Apply" } },
      { name: "page_verify", input: { kind: "text_visible", text: "Discount: -$4.20" } },
      { name: "page_verify", input: { kind: "text_visible", text: "Enter a code" } },
      { name: "export_test", input: { format: "playwright", ...exportInput } },
      { name: "export_test", input: { format: "bdd", ...exportInput } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Journal and export.", 8);

    expect(results[2].text).toMatch(
      /^Filled 2 fields: \[\d+\] textbox "Coupon", \[\d+\] [^\n]*"Password"\. \(journal #1–#2\)$/,
    );
    expect(results[3].text).toMatch(/^Clicked \[\d+\] button "Apply"\. \(journal #3\)$/);
    expect(results[4].text).toBe('PASS text "Discount: -$4.20" is visible. (journal #4)');
    expect(results[5].text).toBe('FAIL expected text "Enter a code" to be visible; found no matching text.');
    expect(results[5].text).not.toContain("(journal #");

    expect(results[6].isError).toBe(false);
    expect(results[6].text).toContain("test.describe('Checkout coupon'");
    expect(results[6].text).toContain("test('TC-01 Apply a valid code'");
    expect(results[6].text).toContain("test('TC-02 Apply again'");
    expect(results[6].text).toContain("await page.getByRole('button', { name: 'Apply' }).click();");
    expect(results[6].text).toContain("await expect(page.getByText('Discount: -$4.20')).toBeVisible();");
    expect(results[6].text).toContain("process.env.TEST_PASSWORD");
    expect(results[6].text).not.toContain("secret123");

    const lines = results[6].text.split("\n");
    for (const [comment] of [["    // 1. Fill the coupon and password"], ["    // 1. Click Apply"]]) {
      const idx = lines.indexOf(comment);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(lines[idx + 1]).toBe("    await page.goto('http://localhost:10040/checkout.html');");
    }

    expect(results[7].text.startsWith("# Checkout coupon")).toBe(true);
    expect(results[7].text).toContain("### Scenario: TC-01 Apply a valid code");
    expect(results[7].text).toContain("**Given** Fill the coupon and password");
    expect(results[7].text).toContain("**When** Click Apply");
    expect(results[7].text).toContain("**Then** The discount is shown");
    expect(results[7].text).not.toContain("secret123");

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-journal-export-light.png") });

    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-journal-export-dark.png") });

    await context.close();
  });

  test("J2 hover, key press, upload and emulation", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);
    const baselineWidth = await sitePage.locator("#viewport-status").textContent();

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_emulate", input: { preset: "iPhone 15" } },
      { name: "page_hover", input: { ref: "@Cart (2)" } },
      { name: "page_press_key", input: { key: "Enter", modifiers: ["Control"] } },
      {
        name: "page_upload_file",
        input: { ref: "@Attachments", files: [{ name: "big.bin", mimeType: "application/octet-stream", size: 5242880, fill: "A" }] },
      },
      { name: "page_emulate", input: { reset: true } },
      {
        name: "export_test",
        input: {
          format: "playwright",
          suite: "Devices",
          cases: [
            {
              id: "TC-01",
              title: "Phone",
              steps: [
                { text: "Hover the cart", journal: [2] },
                { text: "Press Control+Enter", journal: [3] },
                { text: "Upload a big file", journal: [4] },
              ],
            },
            { id: "TC-02", title: "After reset", steps: [{ text: "Hover the cart", journal: [2] }] },
          ],
        },
      },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Emulate, hover, press and upload.", 8);

    for (let i = 0; i < 5; i++) {
      expect(results[2 + i].text).toMatch(new RegExp(`\\(journal #${i + 1}\\)$`));
    }

    expect(results[7].text).toContain("import { test, expect, devices } from '@playwright/test';");
    expect(results[7].text).toContain("test.describe('TC-01 device', () => {");
    expect(results[7].text).toContain("const { defaultBrowserType, ...iPhone15 } = devices['iPhone 15'];");
    expect(results[7].text).toContain("test.use(iPhone15);");
    expect(results[7].text).toContain(".hover();");
    expect(results[7].text).toContain("page.keyboard.press('Control+Enter');");
    expect(results[7].text).toContain("Buffer.alloc(5242880, 'A')");
    expect(results[7].text).toContain("test.describe('TC-02 device', () => {");

    await expect(sitePage.locator("#viewport-status")).toHaveText(baselineWidth ?? "");

    await context.close();
  });

  test("J3 unknown id and new chat", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_press_key", input: { key: "Enter" } },
      {
        name: "export_test",
        input: { format: "bdd", suite: "S", cases: [{ id: "TC-01", title: "T", steps: [{ text: "x", journal: [9] }] }] },
      },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Press Enter then export.", 3);

    expect(results[2]).toEqual({
      tool: "export_test",
      text: "Journal entry #9 does not exist in this chat.",
      isError: true,
    });

    await newChat(panelPage, [
      {
        name: "export_test",
        input: { format: "bdd", suite: "S", cases: [{ id: "TC-01", title: "T", steps: [{ text: "x", journal: [1] }] }] },
      },
    ]);
    await sendMessage(panelPage, "Export again.");
    await panelPage.waitForFunction(() => (window.__TOOL_RESULTS__?.length ?? 0) >= 1, { timeout: 30_000 });
    const results2 = await panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);
    expect(results2[0]).toEqual({
      tool: "export_test",
      text: "Journal entry #1 does not exist in this chat.",
      isError: true,
    });

    await context.close();
  });
});
