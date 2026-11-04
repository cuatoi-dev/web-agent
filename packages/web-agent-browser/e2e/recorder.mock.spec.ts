import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import { watchPanel } from "./panel-ready";
import { bodyOf, expectSavedRecording } from "./saved-files";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-09-19-041603-004-recording-watch-me-and-cleanup");

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

async function openPanel(
  context: BrowserContext,
  extensionId: string,
  tabId: number,
  plan: PlannedCall[],
  agent = "tesagent",
): Promise<Page> {
  const panelPage = await context.newPage();
  await panelPage.addInitScript((id: number) => {
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      window.__WA_TOOLS__ = opts.tools?.map((t) => t.name) ?? [];
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Recorder mock" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
      let imageInjections = window.__IMAGE_INJECTIONS__ ?? 0;

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
        const m = snap?.text.match(new RegExp(`\\[(\\d+)\\][^\\n]*"${escaped}"`));
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

  const panelReady = watchPanel(panelPage);
  panelPage.on("console", (m) => console.log("PANEL LOG:", m.text()));
  panelPage.on("pageerror", (err) => console.error("PANEL ERROR:", err));
  await panelPage.setViewportSize({ width: 400, height: 700 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panelReady();
  await chooseAgent(panelPage, agent);
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
    window.__IMAGE_INJECTIONS__ = 0;
  }, plan);
  return panelPage;
}

async function nextPlan(panelPage: Page, plan: PlannedCall[]): Promise<void> {
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = (window.__PLAN__ ?? []).concat(p);
  }, plan);
}

async function waitForResults(
  panelPage: Page,
  count: number,
): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, count, { timeout: 20_000 });
  return panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

/** 127/003 — the stored text of a /tmp file for this agent, read straight from
 *  the real chrome.storage.session the /tmp mount uses. The key format is
 *  `chrome-storage-backend.ts:69`; the namespace is `tmp:<agent id>` from
 *  `sidepanel.ts:169`. */
async function readTmpFile(worker: Worker, absPath: string): Promise<string | null> {
  return worker.evaluate(async (p: string) => {
    const key = `web-agent-vfs:tmp:tesagent:f:${p.replace(/^\/tmp/, "")}`;
    const got = await chrome.storage.session.get(key);
    return got[key]?.content ?? null;
  }, absPath);
}

async function allow(panelPage: Page): Promise<void> {
  const scrim = panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
  await expect(scrim).toBeVisible({ timeout: 15_000 });
  await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
  await expect(scrim).toHaveCount(0, { timeout: 5000 });
}

async function reject(panelPage: Page): Promise<void> {
  const scrim = panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
  await expect(scrim).toBeVisible({ timeout: 15_000 });
  await scrim.locator("button:has-text('Reject'), md-outlined-button:has-text('Reject')").first().click();
  await expect(scrim).toHaveCount(0, { timeout: 5000 });
}

async function userFlow(sitePage: Page): Promise<void> {
  await sitePage.mouse.move(5, 5);
  await sitePage.mouse.wheel(0, 400);
  await sitePage.waitForTimeout(500); // > REC_SCROLL_QUIET_MS

  await sitePage.locator("#cart-link").hover();
  await sitePage.waitForTimeout(600); // > REC_HOVER_REST_MS
  await sitePage.locator("#cart-link").click();

  await sitePage.locator("#coupon").fill("SAVE10");
  await sitePage.locator("#password").fill("secret123");

  await sitePage.locator("#shipping").focus();
  await sitePage.keyboard.press("ArrowDown");
  await expect(sitePage.locator("#shipping")).toHaveValue("express");

  await sitePage.locator("#gift").click();
  await sitePage.mouse.move(5, 5); // disarm hover timer
  await sitePage.keyboard.press("Enter");
  await sitePage.waitForTimeout(300);
}

test.describe("recorder and recording tools mock e2e (124/005, on the debugger since 131/004)", () => {
  test("M1 user flow, redacted password and screenshots", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage = await context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);

    await sendMessage(panelPage, "Please record my actions.");
    const scrim = panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });
    const cardText = await scrim.textContent();
    expect(cardText).toContain("Watch you on localhost:10040 and record your clicks and typing");

    // M1d: screenshots while scrim is up
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-recorder-confirm-light.png") });

    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-recorder-confirm-dark.png") });

    await allow(panelPage);

    const results2 = await waitForResults(panelPage, 2);
    const debugRes = results2[0];
    expect(debugRes.text).toBe(`Debugging tab #${tabId} (localhost:10040).`);
    const startRes = results2[1];
    expect(startRes.text).toBe("Recording on localhost:10040. Steps appear when the user stops or the page navigates.");

    // User performs actions
    await userFlow(sitePage);

    // Stop recording
    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Done recording.");
    const results3 = await waitForResults(panelPage, 3);
    const stopRes = results3[2];
    const stopText = stopRes.text;
    console.log("M1 STOP TEXT:\n" + stopText);

    // 127/002 — locator lines (two-space indent) sit under each step.
    const lines = stopText.split("\n").filter((l) => !l.startsWith("  "));
    expect(lines[0]).toBe("Recorded 9 steps on localhost:10040:");
    expect(lines[1]).toBe("1. scroll down 400 px");
    expect(lines[2]).toBe('2. hover link "Cart (2)"');
    expect(lines[3]).toBe('3. click link "Cart (2)"');
    expect(lines[4]).toBe('4. fill textbox "Coupon" "SAVE10"');
    expect(lines[5]).toBe('5. fill textbox "Password" <password>');
    // ArrowDown on the focused <select>: the keydown is a press step of its
    // own, and the selection it causes is the select step after it.
    expect(lines[6]).toBe("6. press ArrowDown");
    expect(lines[7]).toBe('7. select combobox "Shipping" "Express"');
    expect(lines[8]).toBe('8. check checkbox "Gift"');
    expect(lines[9]).toBe("9. press Enter");

    expect(stopText).toContain('4. fill textbox "Coupon" "SAVE10"\n  role+name: textbox "Coupon" (matches 1)\n  id: coupon\n');
    expect(stopText).not.toMatch(/getBy|\.nth\(/);

    // 127/003 — the report is also a real file, with the same body the tool
    // returned before its trailing "Saved <path>" line.
    const savedRecording = expectSavedRecording(stopText);
    const report = bodyOf(stopText);
    expect(lines.length).toBe(10 + 1);           // the Saved line joins the numbered ones
    expect(lines[10]).toBe(`Saved ${savedRecording}`);
    expect(lines.slice(0, 10)).toEqual(report.split("\n").filter((l) => !l.startsWith("  ")));
    const storedReport = await readTmpFile(worker, savedRecording);
    expect(storedReport).toBe(report);
    expect(storedReport).toContain('5. fill textbox "Password" <password>');
    expect(storedReport).not.toContain("secret123");

    // M1b: Verify password was never leaked
    expect(stopText).not.toContain("secret123");
    const storageDump = await worker.evaluate(() => chrome.storage.local.get(null).then(JSON.stringify));
    expect(storageDump).not.toContain("secret123");

    // M1d: screenshot of steps reply
    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-recorder-steps-light.png") });

    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-recorder-steps-dark.png") });

    await context.close();
  });

  test("M2 Reject leaves recording unstarted", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [{ name: "start_recording", input: {} }]);

    await sendMessage(panelPage, "Record.");
    await reject(panelPage);

    const results1 = await waitForResults(panelPage, 1);
    const rejectRes = results1[0];
    expect(rejectRes.isError).toBe(true);
    expect(rejectRes.text).toBe("Recording on localhost:10040 was not confirmed by the user; not started.");

    // User clicks #apply-btn while not recording
    await sitePage.locator("#apply-btn").click();

    // Debug the tab, then start recording (Allow) and stop immediately
    await nextPlan(panelPage, [{ name: "start_debugging", input: {} }, { name: "start_recording", input: {} }]);
    await sendMessage(panelPage, "Record now.");
    await allow(panelPage);
    await waitForResults(panelPage, 3);

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    const results4 = await waitForResults(panelPage, 4);
    const stopRes = results4[3];
    expect(stopRes.text).toContain("Recorded 0 steps on localhost:10040:");

    await context.close();
  });

  test("M3 start_recording twice returns already recording", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Record 1.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    await nextPlan(panelPage, [{ name: "start_recording", input: {} }]);
    await sendMessage(panelPage, "Record 2.");
    await allow(panelPage);
    const results3 = await waitForResults(panelPage, 3);
    const secondRes = results3[2];

    expect(secondRes.isError).toBe(true);
    expect(secondRes.text).toBe("Already recording on localhost:10040.");

    await context.close();
  });

  test("M4 agent actions during recording are excluded", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Start recording.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    // Agent executes plan of actions (debugging already started)
    await nextPlan(panelPage, [
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Apply" } },
      { name: "page_fill_form", input: { fields: [{ ref: "@Coupon", value: "AGENT10" }] } },
    ]);
    await sendMessage(panelPage, "Run agent actions.");
    await waitForResults(panelPage, 5);

    // User clicks #apply-btn
    await sitePage.locator("#apply-btn").click();

    // Stop recording
    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop recording.");
    const results6 = await waitForResults(panelPage, 6);
    const stopRes = results6[5];

    expect(stopRes.text).toContain("Recorded 1 step on localhost:10040:");
    expect(stopRes.text).toContain('1. click button "Apply"');

    await context.close();
  });

  test("M5 SPA pushState navigation survives and records route step", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Start.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    // User clicks #go-to-cart-btn (which triggers history.pushState({}, '', '/cart'))
    await sitePage.locator("#go-to-cart-btn").click();
    await sitePage.waitForTimeout(300);

    // User clicks #apply-btn
    await sitePage.locator("#apply-btn").click();
    await sitePage.waitForTimeout(300);

    // Stop recording
    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    const results3 = await waitForResults(panelPage, 3);
    const stopRes = results3[2];

    expect(stopRes.text).toContain("Recorded 3 steps on localhost:10040:");
    expect(stopRes.text).not.toContain("Recording stopped: the page navigated.");
    const lines = stopRes.text.split("\n").filter((l) => !l.startsWith("  "));
    expect(lines[1]).toBe('1. click button "Go to cart"');
    expect(lines[2]).toBe("2. route to /cart");
    expect(lines[3]).toBe('3. click button "Apply"');

    await context.close();
  });

  test("M6 a full navigation keeps the recording alive", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Start.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    // User clicks apply first so there is a step
    await sitePage.locator("#apply-btn").click();

    // User clicks sign out link (navigates to signed-out.html) — a FULL navigation
    await sitePage.locator("#sign-out-link").click();
    await expect(sitePage.locator("#signed-out-status")).toBeVisible({ timeout: 10_000 });

    // A click on the NEW document must still land in the same recording
    await sitePage.locator("#back-link").click();
    await sitePage.waitForTimeout(300);

    // Stop recording
    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    const results3 = await waitForResults(panelPage, 3);
    const stopRes = results3[2];

    expect(stopRes.text).not.toContain("Recording stopped: the page navigated.");
    expect(stopRes.text).toContain('click button "Apply"');
    expect(stopRes.text).toContain('click link "Sign out"');
    expect(stopRes.text).toContain('click link "Back to checkout"');

    await context.close();
  });

  test("M7 tab closed stops recording with tab closed note", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage2 = await context.newPage();
    await sitePage2.goto(CHECKOUT_URL);
    const tabId2 = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId2, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Start.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    // Close tab 2
    await sitePage2.close();
    await panelPage.waitForTimeout(500);

    // Stop recording
    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    const results3 = await waitForResults(panelPage, 3);
    const stopRes = results3[2];

    expect(stopRes.text).toContain("Recording stopped: the tab closed.");

    await context.close();
  });

  test("M8 stop_recording when idle returns nothing is being recorded", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "stop_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Stop.");
    const results2 = await waitForResults(panelPage, 2);
    const stopRes = results2[1];

    expect(stopRes.isError).toBe(true);
    expect(stopRes.text).toBe("Nothing is being recorded.");

    await context.close();
  });

  test("M9 start_recording without start_debugging returns the gate error", async ({ context, extensionId }) => {
    const worker = await getWorker(context);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_recording", input: {} },
      { name: "stop_recording", input: {} },
    ]);

    await sendMessage(panelPage, "Try to record without debugging.");
    // start_recording still shows its confirm before the gate check runs.
    await allow(panelPage);
    const results = await waitForResults(panelPage, 2);

    expect(results[0].isError).toBe(true);
    expect(results[0].text).toBe(`Debugging is not started on tab #${tabId}. Call start_debugging first.`);
    expect(results[1].isError).toBe(true);
    expect(results[1].text).toBe(`Debugging is not started on tab #${tabId}. Call start_debugging first.`);

    await context.close();
  });

  test("M10 chromagent offers every tool tesagent offers plus the three in-page agent tools (155400-001)", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);
    const panelPage = await openPanel(context, extensionId, tabId, [], "chromagent");
    await sendMessage(panelPage, "Hello chromagent");
    await panelPage.waitForFunction(
      () => (window.__WA_TOOLS__?.includes("start_recording") ?? false) && (window.__WA_TOOLS__?.includes("page_snapshot") ?? false),
      { timeout: 10_000 },
    );
    const chromagentTools = await panelPage.evaluate(() => window.__WA_TOOLS__ ?? []);
    await chooseAgent(panelPage, "tesagent");
    await panelPage.evaluate(() => { window.__WA_TOOLS__ = undefined; });
    await sendMessage(panelPage, "Hello tesagent");
    await panelPage.waitForFunction(
      () => (window.__WA_TOOLS__?.includes("start_recording") ?? false) && (window.__WA_TOOLS__?.includes("stop_recording") ?? false),
      { timeout: 10_000 },
    );
    const tesagentTools = await panelPage.evaluate(() => window.__WA_TOOLS__ ?? []);
    for (const name of tesagentTools) {
      expect(chromagentTools, `chromagent must offer tesagent's ${name}`).toContain(name);
    }
    for (const name of ["toggle_page_agent", "send_to_page_agent", "read_page_agent"]) {
      expect(chromagentTools).toContain(name);
      expect(tesagentTools).not.toContain(name);
    }
    await context.close();
  });

  test("M11 section 2 click targets, hover on combobox, pointer-cursor run and non-interactive chrome", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    const gapsUrl = `${ORIGIN}/recorder-gaps.html`;

    const sitePage = await context.newPage();
    await sitePage.goto(gapsUrl);
    const tabId = await getTabId(worker, gapsUrl);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Record section 2.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    // Heading and page background must record nothing.
    await sitePage.locator("#sec-interactive h2").click();
    await sitePage.mouse.click(2, 2);

    // Rest on Combobox past REC_HOVER_REST_MS -> one hover step, then click it.
    await sitePage.locator("#combobox").hover();
    await sitePage.waitForTimeout(600);
    await sitePage.locator("#combobox").click();

    // Click every remaining section 2 target; click #ptrchild (<b> inside #ptrspan)
    // to exercise real CSS cursor:pointer inheritance on a child of a pointer run.
    await sitePage.locator("#divclick").click();
    await sitePage.locator("#opt-red").click();
    await sitePage.locator("#slider").click();
    await sitePage.locator("#treeitem").click();
    await sitePage.locator("#gridcell").click();
    await sitePage.locator("#ptrchild").click();
    await sitePage.mouse.move(2, 2);
    await sitePage.waitForTimeout(200);

    await expect(sitePage.locator("#log")).toContainText("div clicked");

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    const results3 = await waitForResults(panelPage, 3);
    const stopText = results3[2].text;
    const lines = stopText.split("\n").filter((l) => !l.startsWith("  "));

    expect(lines.slice(0, 9)).toEqual([
      "Recorded 8 steps on localhost:10040:",
      '1. hover combobox "Combobox"',
      '2. click combobox "Combobox"',
      '3. click div "Plain div onclick"',
      '4. click option "Red option"',
      '5. click slider "Volume"',
      '6. click treeitem "Tree item A"',
      '7. click gridcell "Cell B2"',
      '8. click span "Pointer span"',
    ]);

    await context.close();
  });

  test("M12 section 3 file upload and a slow range drag record one step each", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const gapsUrl = `${ORIGIN}/recorder-gaps.html`;

    // Paths, not buffers: only a path upload fires a trusted input.
    const fileA = test.info().outputPath("a.txt");
    const fileB = test.info().outputPath("b.txt");
    await fs.writeFile(fileA, "a");
    await fs.writeFile(fileB, "b");

    const sitePage = await context.newPage();
    await sitePage.goto(gapsUrl);
    const tabId = await getTabId(worker, gapsUrl);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Record section 3.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    await sitePage.locator("#file").setInputFiles([fileA]);
    await sitePage.locator("#file").setInputFiles([fileA, fileB]);

    // A real mouse drag: locator.fill() on a range fires an untrusted input.
    // The pause runs past REC_HOVER_REST_MS while the button is down, and must
    // not split the drag into two fill steps.
    const box = await sitePage.locator("#range").boundingBox();
    if (!box) throw new Error("#range has no box");
    const x = (v: number): number => box.x + 8 + ((box.width - 16) * v) / 10;
    const y = box.y + box.height / 2;
    await sitePage.mouse.move(x(2), y);
    await sitePage.mouse.down();
    await sitePage.mouse.move(x(3), y, { steps: 3 });
    await sitePage.waitForTimeout(600);
    await sitePage.mouse.move(x(9), y, { steps: 3 });
    await sitePage.mouse.up();
    await sitePage.mouse.move(2, 2);
    await sitePage.waitForTimeout(200);
    await expect(sitePage.locator("#range")).toHaveValue("9");

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    const results3 = await waitForResults(panelPage, 3);
    const lines = results3[2].text.split("\n").filter((l) => !l.startsWith("  "));

    expect(lines.slice(0, 4)).toEqual([
      "Recorded 3 steps on localhost:10040:",
      '1. upload file "Upload" "a.txt"',
      '2. upload file "Upload" "a.txt", "b.txt"',
      '3. fill slider "Level" "9"',
    ]);

    await context.close();
  });

  test("M13 section 4 keys and shortcuts record press steps, and field typing stays one fill", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    const gapsUrl = `${ORIGIN}/recorder-gaps.html`;

    const sitePage = await context.newPage();
    await sitePage.goto(gapsUrl);
    const tabId = await getTabId(worker, gapsUrl);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Record section 4.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    // focus(), not click(): a click moves the pointer, which can arm the hover
    // timer and add a hover step. focus() moves no pointer and records nothing.
    await sitePage.locator("#keys").focus();
    await sitePage.keyboard.press("ArrowLeft");
    await sitePage.keyboard.press("Control+a");
    await sitePage.keyboard.type("x");          // replaces the selection: one fill
    await sitePage.keyboard.press("Backspace"); // empties it: the same fill, in place

    // A click on a non-interactive heading records nothing, and returns the
    // focus to the body, so the next keys have no target.
    await sitePage.locator("#sec-keys h2").click();
    await sitePage.keyboard.press("Shift");     // a modifier on its own
    await sitePage.keyboard.press("Control");   // a modifier on its own
    await sitePage.keyboard.press("j");
    await sitePage.keyboard.press("ArrowDown");

    // Space on a focused button: one press step. The activation click Chrome
    // fires on keyup is the same action and records nothing.
    await sitePage.locator("#dbl").focus();
    await sitePage.keyboard.press("Space");

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    const results3 = await waitForResults(panelPage, 3);
    const lines = results3[2].text.split("\n").filter((l) => !l.startsWith("  "));

    expect(lines.slice(0, 7)).toEqual([
      "Recorded 6 steps on localhost:10040:",
      "1. press ArrowLeft",
      "2. press Control+a",
      '3. fill textbox "Keys field" ""',
      "4. press j",
      "5. press ArrowDown",
      "6. press Space",
    ]);
    // No click step: Chrome's keyboard click is the Space press itself.
    expect(lines.filter((l) => /^\d+\. /.test(l))).toHaveLength(6);

    await context.close();
  });

  test("M14 section 5 double-click, two single clicks, right-click, cancelled drag and drag-and-drop", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    const gapsUrl = `${ORIGIN}/recorder-gaps.html`;

    const sitePage = await context.newPage();
    await sitePage.goto(gapsUrl);
    const tabId = await getTabId(worker, gapsUrl);

    const panelPage = await openPanel(context, extensionId, tabId, [
      { name: "start_debugging", input: {} },
      { name: "start_recording", input: {} },
    ]);
    await sendMessage(panelPage, "Record section 5.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    // 1. Double-click "Double me": replaces the 1st click in place, leaving one dblclick step.
    await sitePage.locator("#dbl").dblclick();
    await sitePage.mouse.move(2, 2);

    // 2-3. Two separate single clicks more than the double-click interval apart.
    await sitePage.waitForTimeout(600);
    await sitePage.locator("#dbl").click();
    await sitePage.mouse.move(2, 2);
    await sitePage.waitForTimeout(600);
    await sitePage.locator("#dbl").click();
    await sitePage.mouse.move(2, 2);

    // 4. Right-click "Right me": records right-click and no hover.
    await sitePage.locator("#ctx").click({ button: "right" });
    await sitePage.mouse.move(2, 2);

    // Cancelled drag (drag #drag across #keys onto <h1> and hold past REC_HOVER_REST_MS):
    // records neither a drag step nor a stray hover step.
    const dragBox = (await sitePage.locator("#drag").boundingBox())!;
    const h1Box = (await sitePage.locator("h1").boundingBox())!;
    await sitePage.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
    await sitePage.mouse.down();
    await sitePage.mouse.move(h1Box.x + 20, h1Box.y + h1Box.height / 2, { steps: 5 });
    await sitePage.waitForTimeout(600);
    await sitePage.mouse.up();
    await sitePage.mouse.move(2, 2);

    // 5. Completed HTML5 drag from "Drag me" onto "Drop zone".
    await sitePage.locator("#drag").dragTo(sitePage.locator("#drop"));
    await sitePage.mouse.move(2, 2);

    await expect(sitePage.locator("#log")).toHaveText("dblclick\ncontextmenu\ndropped\n");

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    const results3 = await waitForResults(panelPage, 3);
    const stopText = results3[2].text;
    const lines = stopText.split("\n").filter((l) => !l.startsWith("  "));

    expect(lines.slice(0, 6)).toEqual([
      "Recorded 5 steps on localhost:10040:",
      '1. dblclick button "Double me"',
      '2. click button "Double me"',
      '3. click button "Double me"',
      '4. right-click button "Right me"',
      '5. drag div "Drag me" to region "Drop zone"',
    ]);
    expect(lines.filter((l) => /^\d+\. /.test(l))).toHaveLength(5);

    const dragBlock = stopText.slice(stopText.indexOf('5. drag div "Drag me" to region "Drop zone"'));
    expect(dragBlock).toContain("  id: drag\n");
    expect(dragBlock).toContain("  css: #drag\n");
    expect(dragBlock).toContain("  drop target:\n");
    const dropBlock = dragBlock.slice(dragBlock.indexOf("  drop target:\n"));
    expect(dropBlock).toContain('  role+name: region "Drop zone" (matches ');
    expect(dropBlock).toContain("  id: drop\n");
    expect(dropBlock).toContain("  data-testid: —\n");
    expect(dropBlock).toContain("  name: —\n");
    expect(dropBlock).toContain("  css: #drop\n");
    expect(dropBlock).toContain("  xpath: //*[@id='drop']");

    await context.close();
  });
});
