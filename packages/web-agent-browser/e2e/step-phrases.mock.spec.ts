import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-09-24-013526-003-step-phrases-mock-chromagent-tool");

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
        return { text: "Step phrases" };
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
        if (!snap) return "missing";
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = snap.text.match(new RegExp(`"${escaped}"[^\\n]*\\[ref=(\\d+)\\]`));
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
        const input = next.name === "get_time" ? next.input : { tabId: id, ...resolveRefs(next.input) };
        return {
          toolCalls: [{ id: `tc_${results.length}`, name: next.name, input }],
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

async function runPlan(panelPage: Page, prompt: string, count: number): Promise<void> {
  await sendMessage(panelPage, prompt);
  await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, count, { timeout: 30_000 });
}

test.describe("page tool step phrases mock e2e (124/007)", () => {
  test("a long tool step keeps its ellipsis inside the 400 px side panel", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);
    const longText = "A deliberately long verification phrase for the narrow side panel ".repeat(8);
    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_verify", input: { kind: "text_visible", text: longText } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    await runPlan(panelPage, "Check the long phrase.", plan.length);
    const phrase = panelPage.locator("agent-chat-panel:not([hidden]) .tool-step-phrase").filter({ hasText: longText });
    await expect(phrase).toBeVisible();
    const sizes = await phrase.evaluate(span => {
      const row = span.closest<HTMLElement>(".tool-step")!;
      const container = row.closest<HTMLElement>(".message-container")!;
      return {
        row: row.getBoundingClientRect(),
        container: container.getBoundingClientRect(),
        phrase: span.getBoundingClientRect(),
        clientWidth: span.clientWidth,
        scrollWidth: span.scrollWidth,
        overflow: getComputedStyle(span).overflow,
        textOverflow: getComputedStyle(span).textOverflow,
      };
    });
    expect(sizes.container.width).toBeGreaterThan(0);
    expect(sizes.row.width).toBeLessThanOrEqual(sizes.container.width);
    expect(sizes.row.right).toBeLessThanOrEqual(sizes.container.right);
    expect(sizes.phrase.right).toBeLessThanOrEqual(sizes.row.right);
    expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth);
    expect(sizes.overflow).toBe("hidden");
    expect(sizes.textOverflow).toBe("ellipsis");
    const artifacts = path.resolve(HERE, "../../../temp/artifacts/2026-10-01-022937-001-agents-md-auto-load");
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, "rework2-mock-layout.json"), JSON.stringify(sizes, null, 2));
    await panelPage.screenshot({ path: path.join(artifacts, "rework2-mock-layout.png") });
  });

  test("the side panel names the agent and each page tool writes its own step line", async ({ context, extensionId }) => {
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_fill_form", input: { fields: [{ ref: "@Coupon", value: "SAVE10" }] } },
      { name: "page_click", input: { ref: "@Apply" } },
      { name: "page_verify", input: { kind: "text_visible", text: "Discount" } },
      { name: "page_eval", input: { code: "1+1" } },
    ];

    const panelPage = await openPanel(context, extensionId, tabId, plan);
    await runPlan(panelPage, "Apply the coupon.", plan.length);

    const lines = await panelPage.locator("agent-chat-panel:not([hidden]) .tool-step-phrase").allTextContents();

    expect(lines).toContain("Tesagent started debugging localhost:10040");
    expect(lines).toContain("Tesagent read the page outline of localhost:10040");
    expect(lines).toContain("Tesagent filled 1 field");
    expect(lines).toContain('Tesagent clicked the button "Apply"');
    expect(lines.some((l) => /^Tesagent checked the text "Discount" — (PASS|FAIL)$/.test(l))).toBe(true);
    expect(lines).toContain("Tesagent used the tool page_eval");

    // One line per tool call (no merged lines).
    const fillIdx = lines.indexOf("Tesagent filled 1 field");
    const clickIdx = lines.indexOf('Tesagent clicked the button "Apply"');
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(clickIdx).toBeGreaterThanOrEqual(0);
    expect(fillIdx).not.toBe(clickIdx);

    for (const line of lines) {
      expect(line.startsWith("Agent ")).toBe(false);
    }

    // Switch agent — new lines start with the new agent's display name.
    await panelPage.evaluate(() => {
      window.__PLAN__ = [{ name: "get_time", input: {} }];
      window.__TOOL_RESULTS__ = [];
      window.__SEEN_TOOL_IDS__ = new Set();
    });
    await chooseAgent(panelPage, "chromagent");
    await sendMessage(panelPage, "What time is it?");
    await panelPage.waitForFunction(() => (window.__TOOL_RESULTS__?.length ?? 0) >= 1, undefined, { timeout: 30_000 });

    const allLines = await panelPage.locator("agent-chat-panel:not([hidden]) .tool-step-phrase").allTextContents();
    expect(allLines.some((l) => l.startsWith("Chromagent "))).toBe(true);
    expect(allLines).toContain("Chromagent checked the time");

    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-step-phrases-light.png") });
    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-step-phrases-dark.png") });

    await context.close();
  });
});
