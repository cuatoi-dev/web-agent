import fs from "node:fs/promises";
import { test, expect, getTabId } from "./extension.fixture";
import { bodyOf, captionOf, savedPathOf } from "./saved-files";
import { routeCrossSiteFrames } from "./cross-site-frames";
import type { BrowserContext, Page, Worker } from "@playwright/test";

// 127/005 — page_screenshot css and xpath targets and the red highlight. The
// real extension, real CDP capture and real VFS; only the model is scripted.

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const FRAMES_URL = `${ORIGIN}/checkout-frames.html`;

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

/** A panel on tesagent with a scripted model. `@Label` in `ref` or in a
 *  `highlight` entry becomes the snapshot ref printed for that label. */
async function openPanel(context: BrowserContext, extensionId: string, tabId: number, plan: PlannedCall[]): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript((id: number) => {
    window.__WA_ENABLE_VFS_PROOF__ = true;
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Screenshot targets 127/005" };
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
      function refFor(label: string): string {
        const snap = [...results].reverse().find((r) => r.tool === "page_snapshot");
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = snap?.text.match(new RegExp(`"${escaped}"[^\\n]*\\[ref=((?:f\\d+:)?\\d+)\\]`));
        return m ? m[1] : "missing";
      }
      const resolveRef = (value: unknown) =>
        typeof value === "string" && value.startsWith("@") ? refFor(value.slice(1)) : value;
      if (results.length < queue.length) {
        const next = queue[results.length];
        const out: Record<string, unknown> = { ...next.input };
        out.ref = resolveRef(out.ref);
        if (Array.isArray(out.highlight)) out.highlight = out.highlight.map(resolveRef);
        if (out.ref === undefined) delete out.ref;
        return { toolCalls: [{ id: `tc_${results.length}`, name: next.name, input: { tabId: id, ...out } }] };
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
  return page;
}

async function runPlan(page: Page, count: number): Promise<ToolResult[]> {
  await sendMessage(page, "Run the plan.");
  await page.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, count, { timeout: 40_000 });
  return page.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

async function storedPng(page: Page, absPath: string): Promise<Buffer> {
  const base64 = await page.evaluate(async (p: string) => {
    const f = await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p);
    return f ? f.content : "";
  }, absPath);
  expect(base64).not.toBe("");
  return Buffer.from(base64, "base64");
}

/** Width and height from the IHDR chunk, after checking the PNG signature. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Pixels with a strong red, decoded in the browser from the stored PNG. */
async function redPixels(page: Page, absPath: string): Promise<number> {
  return page.evaluate(async (p: string) => {
    const f = await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p);
    const bytes = Uint8Array.from(atob(f!.content), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const c2d = canvas.getContext("2d")!;
    c2d.drawImage(bitmap, 0, 0);
    const data = c2d.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] < 80) n++;
    return n;
  }, absPath);
}

async function savePng(testInfo: { outputPath(...s: string[]): string }, name: string, bytes: Buffer): Promise<void> {
  await fs.writeFile(testInfo.outputPath(name), bytes);
}

async function openSite(context: BrowserContext, url = CHECKOUT_URL): Promise<{ sitePage: Page; tabId: number }> {
  const worker = await getWorker(context);
  const sitePage = await context.newPage();
  await sitePage.goto(url);
  return { sitePage, tabId: await getTabId(worker, url) };
}

const addBottomButton = (sitePage: Page) =>
  sitePage.evaluate(() => {
    const b = document.createElement("button");
    b.id = "bottom-btn";
    b.textContent = "Bottom";
    b.style.cssText = "position:absolute;left:20px;top:3000px";
    document.body.append(b);
  });

const applyStyle = (sitePage: Page) =>
  sitePage.evaluate(() => {
    const el = document.getElementById("apply-btn")!;
    return { outline: el.style.outline, offset: el.style.outlineOffset, cssText: el.style.cssText };
  });

test.describe("page_screenshot css, xpath and highlight (127/005)", () => {
  test.beforeEach(async ({ context }) => {
    const worker = await getWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
  });

  test("1 css and xpath capture the first match and report the count", async ({ context, extensionId }, testInfo) => {
    const { sitePage, tabId } = await openSite(context);
    await sitePage.evaluate(() => {
      for (const [w, h] of [[120, 40], [60, 20]]) {
        const d = document.createElement("div");
        d.className = "shot-target";
        d.style.cssText = `width:${w}px;height:${h}px;margin:0;padding:0;border:0;background:#08c`;
        document.body.prepend(d);
      }
      // prepend reversed the order: the first block in the page is the 60 × 20 one.
    });
    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: { css: ".shot-target", save_to: "/tmp/screenshots/css-first.png" } },
      { name: "page_screenshot", input: { xpath: "//*[@class='shot-target']", save_to: "/tmp/screenshots/xpath-first.png" } },
      { name: "page_screenshot", input: { xpath: "//*[@id='apply-btn']", save_to: "/tmp/screenshots/apply.png" } },
      { name: "page_screenshot", input: { css: ".shot-target", fullPage: false, save_to: "/tmp/screenshots/false.png" } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(page, 5);

    expect(results[1].isError).toBe(false);
    expect(captionOf(results[1].text)).toBe("Screenshot of CSS .shot-target, 60 × 20.");
    expect(bodyOf(results[1].text)).toContain("\n2 elements match; captured the first.");
    expect(savedPathOf(results[1].text)).toBe("/tmp/screenshots/css-first.png");
    const css = await storedPng(page, "/tmp/screenshots/css-first.png");
    expect(pngSize(css)).toEqual({ width: 60, height: 20 });
    await savePng(testInfo, "css-first.png", css);

    expect(captionOf(results[2].text)).toBe("Screenshot of XPath //*[@class='shot-target'], 60 × 20.");
    expect(bodyOf(results[2].text)).toContain("2 elements match; captured the first.");
    expect(pngSize(await storedPng(page, "/tmp/screenshots/xpath-first.png"))).toEqual({ width: 60, height: 20 });

    expect(captionOf(results[3].text)).toMatch(/^Screenshot of XPath .+, [\d.]+ × [\d.]+\.$/);
    expect(bodyOf(results[3].text)).not.toContain("elements match");
    expect(results[4].isError).toBe(false);
    expect(await page.evaluate(() => window.__IMAGE_INJECTIONS__)).toBeGreaterThanOrEqual(3);
    await context.close();
  });

  test("2 css falls back to open shadow roots", async ({ context, extensionId }, testInfo) => {
    const { sitePage, tabId } = await openSite(context);
    await sitePage.evaluate(() => {
      const mk = (w: number, h: number) => {
        const d = document.createElement("div");
        d.className = "shadow-shot";
        d.style.cssText = `width:${w}px;height:${h}px;margin:0;padding:0;border:0;background:#c80;display:block`;
        return d;
      };
      const first = document.createElement("div");
      document.body.prepend(first);
      const firstRoot = first.attachShadow({ mode: "open" });
      const nestedHost = document.createElement("div");
      firstRoot.append(nestedHost);
      nestedHost.attachShadow({ mode: "open" }).append(mk(70, 30));
      const second = document.createElement("div");
      document.body.prepend(second);
      second.attachShadow({ mode: "open" }).append(mk(90, 50));
      document.body.insertBefore(first, second);
      const inner = document.createElement("section");
      inner.className = "wrap";
      const em = document.createElement("em");
      em.style.cssText = "display:block;width:40px;height:16px;background:#a0a";
      inner.append(em);
      first.shadowRoot!.append(inner);
    });
    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: { css: ".shadow-shot", save_to: "/tmp/screenshots/shadow.png" } },
      { name: "page_screenshot", input: { css: ".wrap > em", save_to: "/tmp/screenshots/complex.png" } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(page, 3);
    expect(results[1].isError).toBe(false);
    expect(bodyOf(results[1].text)).toContain("\n2 elements match; captured the first.");
    const shadow = await storedPng(page, "/tmp/screenshots/shadow.png");
    expect(pngSize(shadow)).toEqual({ width: 70, height: 30 });
    await savePng(testInfo, "shadow.png", shadow);
    expect(results[2].isError).toBe(false);
    expect(captionOf(results[2].text)).toContain("CSS .wrap > em");

    await context.close();
  });

  test("2b a light-DOM match wins over shadow matches", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openSite(context);
    await sitePage.evaluate(() => {
      const host = document.createElement("div");
      document.body.prepend(host);
      const inShadow = document.createElement("div");
      inShadow.className = "shadow-shot";
      inShadow.style.cssText = "width:70px;height:30px;margin:0;padding:0;border:0;background:#c80;display:block";
      host.attachShadow({ mode: "open" }).append(inShadow);
      const light = document.createElement("div");
      light.className = "shadow-shot";
      light.style.cssText = "width:33px;height:22px;margin:0;padding:0;border:0;background:#0a0";
      document.body.prepend(light);
    });
    const page = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: { css: ".shadow-shot", save_to: "/tmp/screenshots/light.png" } },
    ]);
    const results = await runPlan(page, 2);
    expect(results[1].text).not.toContain("elements match");
    expect(pngSize(await storedPng(page, "/tmp/screenshots/light.png"))).toEqual({ width: 33, height: 22 });
    await context.close();
  });

  test("3 errors capture nothing", async ({ context, extensionId }) => {
    const { tabId } = await openSite(context);
    const shot = (input: Record<string, unknown>): PlannedCall => ({ name: "page_screenshot", input });
    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      shot({ css: "[" }),
      shot({ css: "#does-not-exist" }),
      shot({ xpath: "//*[" }),
      shot({ xpath: "//*[@id='does-not-exist']" }),
      shot({ xpath: "//h1/text()" }),
      shot({ xpath: "count(//button)" }),
      shot({ css: "h1", xpath: "//h1" }),
      shot({ css: "h1", fullPage: true }),
      shot({ xpath: "//h1", fullPage: true }),
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(page, 10);
    expect(results.slice(1).map((r) => r.isError)).toEqual(Array(9).fill(true));
    expect(results.slice(1).map((r) => r.text)).toEqual([
      "Invalid CSS selector: [",
      "No element matches #does-not-exist.",
      "Invalid XPath: //*[",
      "No element matches //*[@id='does-not-exist'].",
      "XPath did not select an element: //h1/text()",
      "XPath did not select an element: count(//button)",
      "Use only one of ref, css, xpath or fullPage.",
      "Use only one of ref, css, xpath or fullPage.",
      "Use only one of ref, css, xpath or fullPage.",
    ]);
    expect(await page.evaluate(() => window.__IMAGE_INJECTIONS__)).toBe(0);
    expect(await page.evaluate(async () => (await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.list("/tmp")).length)).toBe(0);
    await context.close();
  });

  test("4 highlight draws a red outline and restores the page", async ({ context, extensionId }, testInfo) => {
    const { sitePage, tabId } = await openSite(context);
    await sitePage.evaluate(() => {
      const el = document.getElementById("apply-btn")!;
      el.style.setProperty("outline-offset", "9px", "important");
    });
    const before = await applyStyle(sitePage);
    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_screenshot", input: { save_to: "/tmp/screenshots/plain.png" } },
      { name: "page_screenshot", input: { highlight: ["@Apply"], save_to: "/tmp/screenshots/marked.png" } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(page, 4);
    expect(results[3].isError).toBe(false);
    const plain = await redPixels(page, "/tmp/screenshots/plain.png");
    const marked = await redPixels(page, "/tmp/screenshots/marked.png");
    expect(marked).toBeGreaterThan(plain + 100);
    await savePng(testInfo, "plain.png", await storedPng(page, "/tmp/screenshots/plain.png"));
    await savePng(testInfo, "marked.png", await storedPng(page, "/tmp/screenshots/marked.png"));
    expect(await applyStyle(sitePage)).toEqual(before);
    expect(await sitePage.evaluate(() => document.getElementById("apply-btn")!.style.getPropertyPriority("outline-offset"))).toBe("important");
    await context.close();
  });

  test("5 viewport scrolls the first highlight into view", async ({ context, extensionId }, testInfo) => {
    const { sitePage, tabId } = await openSite(context);
    await addBottomButton(sitePage);
    const page = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_screenshot", input: { highlight: ["@Bottom"], save_to: "/tmp/screenshots/scrolled.png" } },
    ]);
    const results = await runPlan(page, 3);
    expect(results[2].isError, results[2].text).toBe(false);
    expect(results[2].text).not.toContain("outside");
    expect(await sitePage.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await savePng(testInfo, "scrolled.png", await storedPng(page, "/tmp/screenshots/scrolled.png"));
    expect(await redPixels(page, "/tmp/screenshots/scrolled.png")).toBeGreaterThan(100);
    expect(await sitePage.evaluate(() => document.getElementById("bottom-btn")!.style.outline)).toBe("");
    await context.close();
  });

  test("5b full page does not scroll, and an outside highlight is reported", async ({ context, extensionId }, testInfo) => {
    const { sitePage, tabId } = await openSite(context);
    await addBottomButton(sitePage);
    const page = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_screenshot", input: { fullPage: true, highlight: ["@Bottom"], save_to: "/tmp/screenshots/full.png" } },
      { name: "page_screenshot", input: { ref: "@Apply", highlight: ["@Bottom"], save_to: "/tmp/screenshots/outside.png" } },
    ]);
    const results = await runPlan(page, 4);
    expect(await sitePage.evaluate(() => window.scrollY)).toBe(0);
    expect(results[2].isError, results[2].text).toBe(false);
    expect(results[2].text).not.toContain("outside");
    expect(await redPixels(page, "/tmp/screenshots/full.png")).toBeGreaterThan(100);
    await savePng(testInfo, "full.png", await storedPng(page, "/tmp/screenshots/full.png"));
    expect(results[3].isError, results[3].text).toBe(false);
    expect(results[3].text).toMatch(/\nHighlighted element \d+ is outside the screenshot\.\nSaved /);
    expect(await sitePage.evaluate(() => document.getElementById("bottom-btn")!.style.outline)).toBe("");
    await context.close();
  });

  test("6 a stale highlight ref fails the call and leaves no outline", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openSite(context);
    const before = await applyStyle(sitePage);
    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_eval", input: { code: "document.getElementById('email').remove(); return 1" } },
      { name: "page_screenshot", input: { highlight: ["@Apply", "@Email"], save_to: "/tmp/screenshots/stale.png" } },
      { name: "page_screenshot", input: { highlight: ["@Apply", "@Apply"], save_to: "/tmp/screenshots/twice.png" } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(page, 5);
    expect(results[3].isError).toBe(true);
    expect(results[3].text).toMatch(/^Ref \d+ is no longer on the page\. Take a new snapshot\.$/);
    expect(await page.evaluate(async () => (await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.list("/tmp/screenshots")).map((e) => e.abs))).toEqual([
      "/tmp/screenshots/twice.png",
    ]);
    expect(results[4].isError).toBe(false);
    expect(await applyStyle(sitePage)).toEqual(before);
    await context.close();
  });

  test("7 highlight on a child-frame ref captures and restores through the child session", async ({ context, extensionId }) => {
    await routeCrossSiteFrames(context);
    const { sitePage, tabId } = await openSite(context, FRAMES_URL);
    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_screenshot", input: { ref: "@Pay", highlight: ["@Pay"], save_to: "/tmp/screenshots/pay.png" } },
    ];
    const page = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(page, 3);
    expect(results[2].isError).toBe(false);
    expect(captionOf(results[2].text)).toMatch(/^Screenshot of \[f1:\d+\] .+/);
    expect(await redPixels(page, "/tmp/screenshots/pay.png")).toBeGreaterThan(50);
    expect(sitePage.frames().length).toBeGreaterThan(1);
    const outlines = await Promise.all(sitePage.frames().map((f) => f.evaluate(() => document.getElementById("pay")?.style.outline ?? "")));
    expect(outlines.every((o) => o === "")).toBe(true);
    await context.close();
  });
});
