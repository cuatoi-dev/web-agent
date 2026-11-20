import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import { bodyOf, captionOf, expectSavedPng, expectSavedRecording } from "./saved-files";
import type { BrowserContext, Page, Worker } from "@playwright/test";

// The saving tools. The real extension, real chrome.storage, real
// OPFS folder handles through the proof hook, real capture and debugging, a
// mock model. Nothing about the vfs or the save path is faked.

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(HERE, "../../../temp/artifacts/vfs-saving-tools");

/** The eight bytes every PNG starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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
        return { text: "VFS saving" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
      let imageInjections = window.__IMAGE_INJECTIONS__ ?? 0;
      // A successful page_screenshot returns its image on the tool outcome;
      // core sends it in its own user message on the NEXT call, so every
      // message is scanned (deduped by toolCallId), not only the last.
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

/** Mounts a real OPFS folder at `/share/<name>` through the proof hook, the
 *  same backend the composer's "Attach folder" produces. */
async function mountFolder(page: Page, dir: string, prefix: string, writable: boolean): Promise<void> {
  await page.evaluate(
    async ({ dir, prefix, writable }) => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      const root = await navigator.storage.getDirectory();
      const handle = await root.getDirectoryHandle(dir, { create: true });
      hook.provider.vfs.mount(prefix, hook.directoryBackend(handle, { writable }), { external: true });
    },
    { dir, prefix, writable },
  );
}

/** The stored bytes at an absolute path, as the vfs really holds them. */
async function storedFile(page: Page, absPath: string): Promise<{ content: string; encoding: string; mimeType: string } | null> {
  return page.evaluate(async (p: string) => {
    const f = await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p);
    return f ? { content: f.content, encoding: f.encoding, mimeType: f.mimeType } : null;
  }, absPath);
}

async function listedPaths(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate(async (p: string) => {
    const vfs = window.__WA_VFS_PROOF__!.tesagent.provider.vfs;
    return (await vfs.list(p)).map((e) => e.abs).sort();
  }, prefix);
}

/** The first eight bytes of a stored base64 file, for the PNG signature. */
function firstBytes(base64: string, n: number): number[] {
  return [...atob(base64)].slice(0, n).map((c) => c.charCodeAt(0));
}

async function openFiles(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu options" }).click();
  await page.getByRole("menuitem", { name: "Files" }).click();
  await expect(page.locator("agent-files-screen")).toBeVisible();
}

async function allowRecording(page: Page): Promise<void> {
  const scrim = page.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
  await expect(scrim).toBeVisible({ timeout: 15_000 });
  await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
  await expect(scrim).toHaveCount(0, { timeout: 5000 });
}

test.describe("VFS saving tools", () => {
  test.beforeEach(async ({ context }) => {
    const worker = await getWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
  });

  test("1 default path, explicit path, and overwrite", async ({ context, extensionId }) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(await getWorker(context), CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: {} },
      { name: "page_screenshot", input: { save_to: "/home/agent/shots/cart.png" } },
      { name: "page_screenshot", input: { save_to: "/home/agent/shots/cart.png" } },
      { name: "page_screenshot", input: {} },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    await fs.mkdir(ARTIFACTS, { recursive: true });

    const results = await runPlan(page, "Take four screenshots.", 5);

    expect(results[1].isError).toBe(false);
    const defaultPath = expectSavedPng(results[1].text);
    expect(captionOf(results[1].text)).toMatch(/^Viewport screenshot, \d+ × \d+\.$/);

    expect(results[2].isError).toBe(false);
    expect(results[2].text).toContain("\nSaved /home/agent/shots/cart.png");
    // The same explicit path twice leaves ONE file, not a second copy.
    expect(results[3].isError).toBe(false);
    expect(await listedPaths(page, "/home/agent/shots")).toEqual(["/home/agent/shots/cart.png"]);

    // The last default capture lands in its own second, so the folder holds
    // one or two timestamped PNGs, never anything else.
    expectSavedPng(results[4].text);
    const defaults = await listedPaths(page, "/tmp/screenshots");
    expect(defaults.length).toBeGreaterThanOrEqual(1);
    for (const p of defaults) expect(p).toMatch(/^\/tmp\/screenshots\/\d{4}-\d{2}-\d{2}-\d{6}-tab\d+\.png$/);

    const png = await storedFile(page, defaultPath);
    expect(png).toMatchObject({ encoding: "base64", mimeType: "image/png" });
    expect(firstBytes(png!.content, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    expect(atob(png!.content).length).toBeGreaterThan(1000);

    const explicit = await storedFile(page, "/home/agent/shots/cart.png");
    expect(firstBytes(explicit!.content, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

    // Every capture reached the model, not just the captions.
    expect(await page.evaluate(() => window.__IMAGE_INJECTIONS__ ?? 0)).toBe(4);

    await page.screenshot({ path: path.join(ARTIFACTS, "mock-01-default-and-explicit.png") });
    await openFiles(page);
    // Exact names: "shots" is a substring of /tmp/screenshots.
    const rowNamed = (name: string) =>
      page.locator("agent-files-screen .wa-ftree-row")
        .filter({ has: page.locator(`.wa-ftree-row-name:text-is("${name}")`) });
    await expect(rowNamed("shots").first()).toBeVisible();
    await rowNamed("shots").first().click();
    await expect(rowNamed("cart.png").first()).toBeVisible();
    await page.screenshot({ path: path.join(ARTIFACTS, "mock-02-files-screen.png") });
  });

  test("2 a read-only folder refuses the save and sends no image", async ({ context, extensionId }) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(await getWorker(context), CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: { save_to: "/share/photos/x.png" } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    await mountFolder(page, "photos", "/share/photos", false);

    const results = await runPlan(page, "Take a screenshot into the attached folder.", 2);

    expect(results[1].isError).toBe(true);
    expect(results[1].text).toContain("/share/photos/x.png is read-only.");
    expect(results[1].text).toContain("The user attached /share/photos read only.");
    expect(results[1].text).not.toContain("Saved ");
    expect(await listedPaths(page, "/share/photos")).toEqual([]);
    expect(await listedPaths(page, "/tmp/screenshots")).toEqual([]);
    expect(await page.evaluate(() => window.__IMAGE_INJECTIONS__ ?? 0)).toBe(0);
  });

  test("3 a path no mount covers refuses the save and sends no image", async ({ context, extensionId }) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(await getWorker(context), CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: { save_to: "/nowhere/x.png" } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);

    const results = await runPlan(page, "Take a screenshot outside every mount.", 2);

    expect(results[1].isError).toBe(true);
    expect(results[1].text).toBe("No mount for /nowhere/x.png");
    expect(await page.evaluate(() => window.__IMAGE_INJECTIONS__ ?? 0)).toBe(0);
  });

  test("4 a writable attached folder receives a real PNG on disk", async ({ context, extensionId }) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(await getWorker(context), CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: { save_to: "/share/artifacts/shots/cart.png" } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    await mountFolder(page, "artifacts", "/share/artifacts", true);

    const results = await runPlan(page, "Save a screenshot into the attached folder.", 2);

    expect(results[1].isError).toBe(false);
    expect(results[1].text).toContain("\nSaved /share/artifacts/shots/cart.png");
    expect(await listedPaths(page, "/share/artifacts")).toEqual(["/share/artifacts/shots/cart.png"]);

    // Read the bytes back through the real file handle, not the vfs record.
    const bytes = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const shots = await (await root.getDirectoryHandle("artifacts")).getDirectoryHandle("shots");
      const file = await (await shots.getFileHandle("cart.png")).getFile();
      return [...new Uint8Array(await file.arrayBuffer()).slice(0, 8)];
    });
    expect(bytes).toEqual(PNG_SIGNATURE);
  });

  test("5 stop_recording saves the report it returned", async ({ context, extensionId }) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(await getWorker(context), CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
      { name: "stop_recording", input: {} },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);

    await sendMessage(page, "Record me, then stop.");
    const scrim = page.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });
    await allowRecording(page);
    await page.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, 3, { timeout: 30_000 });
    const results = await page.evaluate(() => window.__TOOL_RESULTS__ ?? []);

    expect(results[2].isError).toBe(false);
    const saved = expectSavedRecording(results[2].text);
    const report = bodyOf(results[2].text);
    expect(report).toMatch(/^Recorded \d+ steps? on localhost:10040:$/);
    const stored = await storedFile(page, saved);
    expect(stored).toMatchObject({ content: report, encoding: "utf8", mimeType: "text/markdown" });
  });

  test("6 the open Files screen shows a file saved after it opened", async ({ context, extensionId }) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(await getWorker(context), CHECKOUT_URL);

    const page = await openPanel(context, extensionId, tabId, [{ name: "start_debugging", input: {} }]);
    await runPlan(page, "Start debugging.", 1);
    await fs.mkdir(ARTIFACTS, { recursive: true });
    await openFiles(page);
    const rows = page.locator("agent-files-screen .wa-ftree-row");
    await expect(rows.filter({ hasText: "screenshots" })).toHaveCount(0);

    // A direct write through the same handle the screen listens to.
    await page.evaluate(async () => {
      const vfs = window.__WA_VFS_PROOF__!.tesagent.provider.vfs;
      await vfs.write("/tmp/screenshots/refresh-check.md", "refresh");
    });
    await expect(rows.filter({ hasText: "screenshots" }).first()).toBeVisible({ timeout: 10_000 });
    if ((await rows.filter({ hasText: "refresh-check.md" }).count()) === 0) {
      await rows.filter({ hasText: "screenshots" }).first().click();
    }
    await expect(rows.filter({ hasText: "refresh-check.md" }).first()).toBeVisible();
    await page.screenshot({ path: path.join(ARTIFACTS, "mock-03-files-refresh.png") });
  });
});

