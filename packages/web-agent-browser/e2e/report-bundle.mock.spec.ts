import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}
interface ToolResult {
  tool: string;
  text: string;
  isError: boolean;
}

async function getWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator("agent-chat-panel:not([hidden]) #input");
  await input.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** A panel on tesagent with a scripted model. Every planned call is given the
 *  tab id, so a plan reads as the agent's own steps. */
async function openPanel(context: BrowserContext, extensionId: string, tabId: number, plan: PlannedCall[]): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript((id: number) => {
    window.__WA_ENABLE_VFS_PROOF__ = true;
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "VFS report bundle" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
      let imageInjections = window.__IMAGE_INJECTIONS__ ?? 0;
      for (const msg of opts.messages) {
        if (!Array.isArray(msg?.content)) continue;
        for (const part of msg.content) {
          if (!part || typeof part !== "object") continue;
          if (part.type === "tool-result" && !seen.has(part.toolCallId)) {
            seen.add(part.toolCallId);
            const output = part.output;
            results.push({
              tool: part.toolName ?? "",
              text:
                typeof output === "string"
                  ? output
                  : typeof output === "object" && output !== null && typeof output.content === "string"
                    ? output.content
                    : JSON.stringify(output),
              isError: !!part.isError,
            });
          }
          if (part.type === "image") imageInjections += 1;
        }
      }
      window.__SEEN_TOOL_IDS__ = seen;
      window.__TOOL_RESULTS__ = results;
      window.__IMAGE_INJECTIONS__ = imageInjections;
      if (results.length < queue.length) {
        const next = queue[results.length];
        return { toolCalls: [{ id: `tc_${results.length}`, name: next.name, input: { tabId: id, ...next.input } }] };
      }
      return { text: results.map((r) => r.text).join("\n") };
    };
  }, tabId);
  page.on("pageerror", (err) => console.error("PANEL ERROR:", err));
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#agent-row")).toBeVisible();
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator("#agent-option-tesagent").click();
  await page.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);
  await page.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
    window.__IMAGE_INJECTIONS__ = 0;
  }, plan);
  // Start every case from an empty /tmp and /home/agent.
  await page.evaluate(async () => {
    const hook = window.__WA_VFS_PROOF__!.tesagent;
    for (const p of ["/tmp", "/home/agent"]) {
      for (const e of await hook.provider.vfs.list(p)) await hook.provider.vfs.delete(e.abs);
    }
  });
  return page;
}

async function runPlan(page: Page, prompt: string, count: number): Promise<ToolResult[]> {
  await sendMessage(page, prompt);
  await page.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, count, { timeout: 30_000 });
  return page.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

/** The stored bytes at an absolute path, as the vfs really holds them. */
async function storedFile(page: Page, absPath: string): Promise<{ content: string; encoding: string; mimeType: string } | null> {
  return page.evaluate(async (p: string) => {
    const f = await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p);
    return f ? { content: f.content, encoding: f.encoding, mimeType: f.mimeType } : null;
  }, absPath);
}

async function openFiles(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu options" }).click();
  await page.getByRole("menuitem", { name: "Files" }).click();
  await expect(page.locator("agent-files-screen")).toBeVisible();
}

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
/** A real 1 × 1 PNG, 69 bytes, as base64. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNgYGAAAAAEAAHI6uv5AAAAAElFTkSuQmCC";
const RUN = "/tmp/runs/2026-10-19-101500";

test.describe("VFS report bundle", () => {
  test("1 inlines every file-system image and reports the count", async ({ context, extensionId }, testInfo) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(await getWorker(context), CHECKOUT_URL);

    // Two real files: one named twice, so the count proves de-duplication.
    const html = [
      "<html><body>",
      `<p>one</p><img src="${RUN}/TC-01.png" width="480">`,
      `<p>two</p><img src="${RUN}/TC-02.png" width="480">`,
      `<p>again</p><img src="${RUN}/TC-01.png" width="480">`,
      `<p>remote</p><img src="http://example.com/x.png">`,
      `<p>inline</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`,
      "</body></html>",
    ].join("\n");

    const plan: PlannedCall[] = [
      { name: "write_file", input: { file_path: `${RUN}/TC-01.png`, content: TINY_PNG, encoding: "base64", mime_type: "image/png" } },
      { name: "write_file", input: { file_path: `${RUN}/TC-02.png`, content: TINY_PNG, encoding: "base64", mime_type: "image/png" } },
      { name: "write_file", input: { file_path: `${RUN}/report.src.html`, content: html } },
      { name: "bundle_html", input: { src: `${RUN}/report.src.html`, out: `${RUN}/report.html` } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);

    const results = await runPlan(page, "Build the report.", 4);
    for (const r of results) expect(r.isError).toBe(false);
    expect(results[3].text).toMatch(/^Saved \/tmp\/runs\/2026-10-19-101500\/report\.html \(2 images inlined, \d+ KB\)$/);

    const out = (await storedFile(page, `${RUN}/report.html`))!;
    expect(out.encoding).toBe("utf8");
    expect(out.mimeType).toBe("text/html");
    expect(out.content).not.toContain('src="/');
    expect(out.content).toContain(`src="data:image/png;base64,${TINY_PNG}"`);
    expect(out.content).toContain('src="http://example.com/x.png"');
    expect(out.content).toContain('src="data:image/gif;base64,R0lGODlhAQABAAAAACw="');
    expect(out.content).toContain('width="480"');

    await page.screenshot({ path: testInfo.outputPath("mock-01-bundle-result.png") });

    await openFiles(page);
    const rowNamed = (name: string) =>
      page.locator("agent-files-screen .wa-ftree-row")
        .filter({ has: page.locator(`.wa-ftree-row-name:text-is("${name}")`) });
    await rowNamed("runs").first().click();
    await rowNamed("2026-10-19-101500").first().click();
    await expect(rowNamed("report.html").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mock-01-files-screen.png") });
  });

  test("2 a missing image fails the call and writes no report", async ({ context, extensionId }, testInfo) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(await getWorker(context), CHECKOUT_URL);

    const html = `<html><body><img src="${RUN}/TC-01.png"><img src="${RUN}/TC-09.png"></body></html>`;
    const plan: PlannedCall[] = [
      { name: "write_file", input: { file_path: `${RUN}/TC-01.png`, content: TINY_PNG, encoding: "base64", mime_type: "image/png" } },
      { name: "write_file", input: { file_path: `${RUN}/report.src.html`, content: html } },
      { name: "bundle_html", input: { src: `${RUN}/report.src.html`, out: `${RUN}/report.html` } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);

    const results = await runPlan(page, "Build the report.", 3);
    expect(results[2].isError).toBe(true);
    expect(results[2].text).toBe(`Error: Images not found: ${RUN}/TC-09.png`);
    expect(await storedFile(page, `${RUN}/report.html`)).toBeNull();

    await page.screenshot({ path: testInfo.outputPath("mock-02-missing-image.png") });
  });
});
