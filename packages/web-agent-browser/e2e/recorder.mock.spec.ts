import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
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

  panelPage.on("console", (m) => console.log("PANEL LOG:", m.text()));
  panelPage.on("pageerror", (err) => console.error("PANEL ERROR:", err));
  await panelPage.setViewportSize({ width: 400, height: 700 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panelPage.locator("#agent-row")).toBeVisible();
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
  test("M1 user flow, redacted password, export_test and screenshots", async ({ context, extensionId }) => {
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

    const lines = stopText.split("\n");
    expect(lines[0]).toBe("Recorded 8 steps on localhost:10040:");
    expect(lines[1]).toBe("1. scroll down 400 px (journal #1)");
    expect(lines[2]).toBe('2. hover link "Cart (2)" (journal #2)');
    expect(lines[3]).toBe('3. click link "Cart (2)" (journal #3)');
    expect(lines[4]).toBe('4. fill textbox "Coupon" "SAVE10" (journal #4)');
    expect(lines[5]).toBe('5. fill textbox "Password" <password> (journal #5)');
    expect(lines[6]).toBe('6. select combobox "Shipping" "Express" (journal #6)');
    expect(lines[7]).toBe('7. check checkbox "Gift" (journal #7)');
    expect(lines[8]).toBe("8. press Enter (journal #8) (journal #1–#8)");

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

    // M1c: export_test with journalIds [1..8]
    await nextPlan(panelPage, [
      {
        name: "export_test",
        input: {
          format: "playwright",
          suite: "Recorded checkout flow",
          url: CHECKOUT_URL,
          cases: [
            {
              id: "TC-01",
              title: "Recorded flow",
              steps: [{ text: "Recorded steps", journal: [1, 2, 3, 4, 5, 6, 7, 8] }],
            },
          ],
        },
      },
    ]);
    await sendMessage(panelPage, "Export this test.");
    const results4 = await waitForResults(panelPage, 4);
    const exportRes = results4[3];
    const exportText = exportRes.text;

    expect(exportText).toContain("await page.mouse.wheel(0, 400);");
    expect(exportText).toContain(".hover();");
    expect(exportText).toContain(".click();");
    expect(exportText).toContain(".fill('SAVE10');");
    expect(exportText).toContain(".fill(process.env.TEST_PASSWORD ?? '');");
    expect(exportText).toContain(".selectOption('Express');");
    expect(exportText).toContain(".check();");
    expect(exportText).toContain(".press('Enter');");
    expect(exportText).not.toContain("secret123");

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
    const lines = stopRes.text.split("\n");
    expect(lines[1]).toBe('1. click button "Go to cart" (journal #1)');
    expect(lines[2]).toBe("2. route to /cart (journal #2)");
    expect(lines[3]).toBe('3. click button "Apply" (journal #3) (journal #1–#3)');

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
});
