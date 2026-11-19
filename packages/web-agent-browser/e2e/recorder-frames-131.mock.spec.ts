// The recorder on the debugger, in every frame: cross-site,
// same-site and doubly-nested. Harness copied from
// iframe-tools-131.mock.spec.ts:1-149, with the plan-queue model driving
// start_debugging/start_recording/stop_recording while the USER
// (not the agent) acts directly on the fixture page and its frames.
import { test, expect, getTabId } from "./extension.fixture";
import { watchPanel } from "./panel-ready";
import { routeCrossSiteFrames } from "./cross-site-frames";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout-frames.html`;

const CLOSED_FRAME = `<!doctype html><html><head><meta charset="utf-8"><title>Closed</title></head><body>
<closed-host id="closed-host"></closed-host>
<script>
customElements.define("closed-host", class extends HTMLElement {
  constructor() {
    super();
    const button = document.createElement("button");
    button.textContent = "Closed button";
    this.attachShadow({ mode: "closed" }).appendChild(button);
  }
});
</script></body></html>`;

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
        return { text: "Recorder frames 131" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
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
        }
      }
      window.__SEEN_TOOL_IDS__ = seen;
      window.__TOOL_RESULTS__ = results;
      if (results.length < queue.length) {
        const next = queue[results.length];
        return {
          toolCalls: [{ id: `tc_${results.length}`, name: next.name, input: { tabId: id, ...next.input } }],
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
  await chooseAgent(panelPage, "tesagent");
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
  }, plan);
  return panelPage;
}

async function nextPlan(panelPage: Page, plan: PlannedCall[]): Promise<void> {
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = (window.__PLAN__ ?? []).concat(p);
  }, plan);
}

async function runPlan(panelPage: Page, prompt: string, count: number): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await sendMessage(panelPage, prompt);
  await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, count, { timeout: 30_000 });
  return panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

async function openCheckout(context: BrowserContext): Promise<{ worker: Worker; sitePage: Page; tabId: number }> {
  const worker = await getWorker(context);
  await routeCrossSiteFrames(context);
  const sitePage = await context.newPage();
  await sitePage.goto(CHECKOUT_URL);
  const tabId = await getTabId(worker, CHECKOUT_URL);
  return { worker, sitePage, tabId };
}

/** Starts debugging then recording, both via the agent's own tools, and
 *  returns the two results. Mirrors recorder.mock.spec.ts's flow. */
async function startDebuggingAndRecording(context: BrowserContext, extensionId: string, tabId: number): Promise<Page> {
  const panelPage = await openPanel(context, extensionId, tabId, [
    { name: "start_debugging", input: {} },
    { name: "start_recording", input: {} },
  ]);
  await sendMessage(panelPage, "Start debugging and record my actions.");
  const scrim = panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
  await expect(scrim).toBeVisible({ timeout: 15_000 });
  await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
  await expect(scrim).toHaveCount(0, { timeout: 5000 });
  await panelPage.waitForFunction(() => (window.__TOOL_RESULTS__?.length ?? 0) >= 2, { timeout: 20_000 });
  return panelPage;
}

test.describe("recorder in every frame — cross-site, same-site, nested", () => {
  test("F1 a click and a fill in the cross-site Payment iframe are recorded", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);
    const panelPage = await startDebuggingAndRecording(context, extensionId, tabId);

    await sitePage.frameLocator("#payment").locator("#card").fill("4242 4242 4242 4242");
    await sitePage.frameLocator("#payment").locator("#pay").click();
    await sitePage.waitForTimeout(200);

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    const results = await runPlan(panelPage, "Stop recording.", 3);
    const stopText = results[2].text;
    expect(stopText).toContain('(frame http://pay.test) fill textbox "Card number" "4242 4242 4242 4242"');
    expect(stopText).toContain('(frame http://pay.test) click button "Pay"');

    await context.close();
  });

  test("F2 a click in the same-site Shipping iframe is recorded with its frame chain", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);
    const panelPage = await startDebuggingAndRecording(context, extensionId, tabId);

    await sitePage.frameLocator("#shipping").locator("#save-shipping").click();
    await sitePage.waitForTimeout(200);

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    const stopResults = await runPlan(panelPage, "Stop recording.", 3);
    expect(stopResults[2].text).toContain('click button "Save shipping"');

    await context.close();
  });

  test("F3 a click in the doubly-nested bank.test iframe is recorded", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);
    const panelPage = await startDebuggingAndRecording(context, extensionId, tabId);

    await sitePage.frameLocator("#payment").frameLocator("#bank").locator("#confirm").click();
    await sitePage.waitForTimeout(200);

    await nextPlan(panelPage, [
      { name: "stop_recording", input: {} },
    ]);
    const results = await runPlan(panelPage, "Stop recording.", 3);
    expect(results[2].text).toContain('(frame http://bank.test) click button "Confirm with bank"');
    expect(results[2].text).toContain("\n  frames: #payment >> #bank");

    await context.close();
  });

  test("F5 a full navigation to a second fixture page keeps the recording", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);
    const panelPage = await startDebuggingAndRecording(context, extensionId, tabId);

    await sitePage.locator("#top-button").click();
    await sitePage.locator("#second-page-link").click();
    await expect(sitePage.locator("#signed-out-status")).toBeVisible({ timeout: 10_000 });
    await sitePage.locator("#back-link").click();
    await sitePage.waitForTimeout(200);

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    const results = await runPlan(panelPage, "Stop recording.", 3);
    const stopText = results[2].text;
    expect(stopText).not.toContain("Recording stopped: the page navigated.");
    expect(stopText).toContain('click button "Top button"');
    expect(stopText).toContain('click link "Sign out"');
    expect(stopText).toContain('click link "Back to checkout"');

    await context.close();
  });

  // F6, the user's Cancel, is Chrome's native "Cancel" button on the
  // debugging infobar — a real OS-level UI element Playwright cannot click.
  // `stop_debugging` drives the SAME code path: debugger-session.ts's stop()
  // fires the identical `onDetached` listener with a non-"target_closed"
  // reason, which recording-controller.ts's `onDetached` handler maps to the
  // same "Recording stopped: debugging was canceled." note either way — the
  // handler cannot tell the two reasons apart except by the "the tab closed"
  // wording, which stays covered by M7/F7-equivalent tab-close coverage. The
  // unit test `recording-controller.test.ts` "onDetached(tabId,
  // \"canceled_by_user\")" exercises the literal reason string directly.
  test("F6 stop_debugging during a recording ends it with the steps kept (proxy for Cancel on the debugging bar)", async ({
    context,
    extensionId,
  }) => {
    const { sitePage, tabId } = await openCheckout(context);
    const panelPage = await startDebuggingAndRecording(context, extensionId, tabId);

    await sitePage.locator("#top-button").click();
    await sitePage.waitForTimeout(200);

    await nextPlan(panelPage, [{ name: "stop_debugging", input: {} }]);
    const results = await runPlan(panelPage, "Stop debugging.", 3);
    expect(results[2].text).toBe(`Stopped debugging tab #${tabId}. Emulation was reset.`);

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    const stopResults = await runPlan(panelPage, "What happened to the recording?", 4);
    const stopText = stopResults[3].text;
    expect(stopText).toContain("Recording stopped: debugging was canceled.");
    expect(stopText).toContain('click button "Top button"');

    await context.close();
  });

  test("F7 a closed-root click in a cross-site frame names the inner button", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);
    await context.route("http://closed.test/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: CLOSED_FRAME }),
    );
    await sitePage.evaluate(() => {
      const f = document.createElement("iframe");
      f.id = "closed-frame";
      f.src = "http://closed.test/";
      document.body.prepend(f);
    });
    await sitePage.frameLocator("#closed-frame").locator("#closed-host").waitFor();
    const panelPage = await startDebuggingAndRecording(context, extensionId, tabId);
    await sitePage.frameLocator("#closed-frame").locator("#closed-host").click();
    await expect(panelPage.locator("agent-chat-panel:not([hidden]) .wa-watch-me-steps li")).toHaveText([
      '(frame http://closed.test) click button "Closed button"',
    ]);
    await context.close();
  });

  test("F8 a closed-root click in a same-site frame on a scrolled page names the inner button", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);
    await sitePage.setViewportSize({ width: 900, height: 500 });
    await sitePage.evaluate(() => {
      document.body.style.minHeight = "2000px";
    });
    await sitePage.evaluate((origin) => {
      const f = document.createElement("iframe");
      f.id = "closed-frame";
      f.src = `${origin}/recorder-gaps.html`;
      f.style.height = "400px";
      f.style.width = "800px";
      document.body.prepend(f);
    }, ORIGIN);
    await sitePage.frameLocator("#closed-frame").locator("#closed-host").waitFor();
    await sitePage.evaluate(() => window.scrollTo(0, 30));
    expect(await sitePage.evaluate(() => window.scrollY)).toBe(30);

    const panelPage = await startDebuggingAndRecording(context, extensionId, tabId);
    await sitePage.frameLocator("#closed-frame").locator("#closed-host").click();
    await expect(panelPage.locator("agent-chat-panel:not([hidden]) .wa-watch-me-steps li")).toHaveText([
      '(frame http://localhost:10040) click button "Closed button"',
    ]);

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    const results = await runPlan(panelPage, "Stop recording.", 3);
    expect(results[2].text).toContain("\n  frames: #closed-frame");
    expect(results[2].text).toContain("closed shadow root: click the host at position (");

    await context.close();
  });
});
