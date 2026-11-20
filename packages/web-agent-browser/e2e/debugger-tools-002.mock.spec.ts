import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import { captionOf, expectSavedPng } from "./saved-files";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/hover-key-screenshot-and-emulation");

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
        return { text: "Debugger tools 002" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
      let imageInjections = window.__IMAGE_INJECTIONS__ ?? 0;
      // A page_screenshot success returns its image on the tool outcome; the
      // core loop sends it in its own user message on the NEXT call — that
      // pushes the tool-result one position back from the end, so every
      // message is scanned (deduped by toolCallId) rather than only the last one.
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

async function imageInjectionCount(panelPage: Page): Promise<number> {
  return panelPage.evaluate(() => window.__IMAGE_INJECTIONS__ ?? 0);
}

test.describe("Debugger tools mock e2e", () => {
  test("T1 gate error on all four tools before start_debugging", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "page_hover", input: { ref: "1" } },
      { name: "page_press_key", input: { key: "Enter" } },
      { name: "page_emulate", input: { preset: "iPhone 15" } },
      { name: "page_screenshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Try all four debugger tools.", 4);

    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(r.text).toBe(`Debugging is not started on tab #${tabId}. Call start_debugging first.`);
    }
    expect(await imageInjectionCount(panelPage)).toBe(0);

    await context.close();
  });

  test("T2 page_hover changes the link's computed colour", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_hover", input: { ref: "@Cart (2)" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and hover the Cart link.", 3);

    expect(results[2].isError).toBe(false);
    expect(results[2].text).toMatch(/^Hovered \[\d+\] link "Cart \(2\)"\.$/);
    await expect(sitePage.locator("#cart-link")).toHaveCSS("color", "rgb(255, 0, 0)");

    await context.close();
  });

  test("T3 page_press_key Enter submits the coupon form", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);
    await sitePage.fill("#coupon", "SAVE10");
    await sitePage.locator("#coupon").focus();

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_press_key", input: { key: "Enter" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and press Enter.", 2);

    expect(results[1].tool).toBe("page_press_key");
    expect(results[1].isError).toBe(false);
    expect(results[1].text).toMatch(/^Pressed Enter\.$/);
    await expect(sitePage.locator("#coupon-status")).toHaveText("Discount: -$4.20", { timeout: 15_000 });

    await context.close();
  });

  test("T4 page_press_key Control+a selects the field's text", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);
    await sitePage.fill("#coupon", "SAVE10");
    await sitePage.locator("#coupon").focus();

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_press_key", input: { key: "a", modifiers: ["Control"] } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and select all coupon text.", 2);

    expect(results[1].text).toMatch(/^Pressed Control\+a\.$/);
    const selection = await sitePage.evaluate(() => {
      const el = document.getElementById("coupon") as HTMLInputElement;
      return { start: el.selectionStart, end: el.selectionEnd, length: el.value.length };
    });
    expect(selection).toEqual({ start: 0, end: selection.length, length: 6 });

    await context.close();
  });

  test("T5 page_press_key unknown key returns the unknown-key error", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_press_key", input: { key: "Nope" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and press an unknown key.", 2);

    expect(results[1]).toEqual({
      tool: "page_press_key",
      text: 'Unknown key "Nope". Use a Playwright key name such as Enter, Escape, Tab, ArrowDown, or one character.',
      isError: true,
    });

    await context.close();
  });

  test("T6 page_screenshot: not both, fullPage taller than viewport, ref sized to the element", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: { fullPage: true, ref: "1" } },
      { name: "page_snapshot", input: {} },
      { name: "page_screenshot", input: { ref: "@Apply" } },
      { name: "page_screenshot", input: { fullPage: true } },
      { name: "page_screenshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Take several screenshots.", 6);

    expect(results[1]).toEqual({ tool: "page_screenshot", text: "Use only one of ref, css, xpath or fullPage.", isError: true });

    expect(results[3].isError).toBe(false);
    // Element bounds come straight from getBoundingClientRect, which is not
    // guaranteed to be a whole number of CSS pixels.
    expect(captionOf(results[3].text)).toMatch(/^Screenshot of \[\d+\] button "Apply", [\d.]+ × [\d.]+\.$/);
    expectSavedPng(results[3].text);

    expect(results[4].isError).toBe(false);
    const fullMatch = captionOf(results[4].text).match(/^Full-page screenshot, (\d+) × (\d+)\.$/);
    expect(fullMatch).not.toBeNull();
    expectSavedPng(results[4].text);
    const fullHeight = Number(fullMatch![2]);

    expect(results[5].isError).toBe(false);
    const viewportMatch = captionOf(results[5].text).match(/^Viewport screenshot, (\d+) × (\d+)\.$/);
    expect(viewportMatch).not.toBeNull();
    expectSavedPng(results[5].text);
    const viewportHeight = Number(viewportMatch![2]);

    expect(fullHeight).toBeGreaterThan(viewportHeight);

    // Each of the three successful screenshots (ref, fullPage, viewport)
    // returned its image on `images`, sent in a user message on the model's
    // next call — proof the image actually reached the model, not just that
    // the tool's text caption looked right.
    expect(await imageInjectionCount(panelPage)).toBe(3);

    await context.close();
  });

  // Before a fix on 2026-09-17, page_emulate sent
  // Emulation.setDeviceMetricsOverride BEFORE Emulation.setTouchEmulationEnabled.
  // The device-metrics call is what fires the page's "resize" event; the
  // checkout fixture's one resize listener reads BOTH #viewport-status and
  // #pointer-status in that single firing, so touch state had to already be
  // in place before the width changed, or the listener captured pointer as
  // stale (there is no second resize to correct it — confirmed by probe:
  // stayed stale for 3s). Swapping the call order
  // (panel-page-tools-debugger.ts, and resetEmulation in debugger-session.ts)
  // fixes it: #viewport-status and #pointer-status now update in the same
  // tick page_emulate resolves in, verified via sitePage.locator directly
  // below — no CDP-session proxy needed.
  test("T7 page_emulate: iPhone 15 preset, reset, unknown preset", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);
    const baselineWidth = await sitePage.locator("#viewport-status").textContent();

    const planStep1: PlannedCall[] = [{ name: "start_debugging", input: {} }, { name: "page_emulate", input: { preset: "iPhone 15" } }];
    const panelPage = await openPanel(context, extensionId, tabId, planStep1);
    const results1 = await runPlan(panelPage, "Start debugging and emulate an iPhone 15.", 2);

    expect(results1[1].tool).toBe("page_emulate");
    expect(results1[1].isError).toBe(false);
    expect(results1[1].text).toMatch(/^Emulating iPhone 15 \(393 × 659, scale 3, mobile, touch\)\.$/);
    await expect(sitePage.locator("#viewport-status")).toHaveText("393");
    await expect(sitePage.locator("#pointer-status")).toHaveText("true");

    await panelPage.evaluate((extra: PlannedCall[]) => {
      window.__PLAN__ = [...(window.__PLAN__ ?? []), ...extra];
    }, [{ name: "page_emulate", input: { reset: true } }] as PlannedCall[]);
    await sendMessage(panelPage, "Now reset the emulation.");
    await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, 3, { timeout: 30_000 });
    const results2 = await panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);

    expect(results2[2].tool).toBe("page_emulate");
    expect(results2[2].isError).toBe(false);
    expect(results2[2].text).toMatch(/^Emulation was reset\.$/);
    await expect(sitePage.locator("#viewport-status")).toHaveText(baselineWidth ?? "");
    await expect(sitePage.locator("#pointer-status")).toHaveText("false");

    await panelPage.evaluate((extra: PlannedCall[]) => {
      window.__PLAN__ = [...(window.__PLAN__ ?? []), ...extra];
    }, [{ name: "page_emulate", input: { preset: "UnknownDevice" } }] as PlannedCall[]);
    await sendMessage(panelPage, "Now try to emulate an UnknownDevice.");
    await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, 4, { timeout: 30_000 });
    const results3 = await panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);

    expect(results3[3]).toEqual({
      tool: "page_emulate",
      text: 'Unknown preset "UnknownDevice". Use iPhone 15, iPad Mini landscape or Desktop Chrome.',
      isError: true,
    });

    await context.close();
  });

  test("T8 stop_debugging resets emulation back to the desktop width", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);
    const baselineWidth = await sitePage.locator("#viewport-status").textContent();

    // Run in three stages, checking the fixture's own DOM between each: the
    // mock's plan queue resolves every step back-to-back, so reading
    // #viewport-status only after all 7 results exist would see the FINAL
    // state, not the mid-sequence one.
    const planStage1: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_screenshot", input: {} },
      { name: "page_emulate", input: { preset: "iPhone 15" } },
      { name: "page_screenshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, planStage1);
    const results1 = await runPlan(panelPage, "Screenshot, emulate, then screenshot again.", 4);

    const baselineMatch = captionOf(results1[1].text).match(/^Viewport screenshot, (\d+) × \d+\.$/);
    expect(baselineMatch).not.toBeNull();
    expectSavedPng(results1[1].text);
    expect(captionOf(results1[3].text)).toBe("Viewport screenshot, 393 × 659.");
    expectSavedPng(results1[3].text);
    await expect(sitePage.locator("#viewport-status")).toHaveText("393");
    await expect(sitePage.locator("#pointer-status")).toHaveText("true");

    await panelPage.evaluate((extra: PlannedCall[]) => {
      window.__PLAN__ = [...(window.__PLAN__ ?? []), ...extra];
    }, [{ name: "stop_debugging", input: {} }] as PlannedCall[]);
    await sendMessage(panelPage, "Now stop debugging.");
    await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, 5, { timeout: 30_000 });
    const results2 = await panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);

    expect(results2[4].text).toBe(`Stopped debugging tab #${tabId}. Emulation was reset.`);
    await expect(sitePage.locator("#viewport-status")).toHaveText(baselineWidth ?? "");
    await expect(sitePage.locator("#pointer-status")).toHaveText("false");

    // stop_debugging resets emulation (debugger-session.ts) even though the
    // debugger detaches — confirmed here by re-attaching and reading the
    // viewport back through the CDP session, which is unaffected by
    // Playwright's own competing viewport session.
    await panelPage.evaluate((extra: PlannedCall[]) => {
      window.__PLAN__ = [...(window.__PLAN__ ?? []), ...extra];
    }, [{ name: "start_debugging", input: {} }, { name: "page_screenshot", input: {} }] as PlannedCall[]);
    await sendMessage(panelPage, "Now start debugging again and take a screenshot.");
    await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, 7, { timeout: 30_000 });
    const results3 = await panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);

    expect(captionOf(results3[6].text)).toMatch(new RegExp(`^Viewport screenshot, ${baselineMatch![1]} × \\d+\\.$`));
    expectSavedPng(results3[6].text);

    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-debugger-tools-002-light.png") });

    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-debugger-tools-002-dark.png") });

    await context.close();
  });
});
