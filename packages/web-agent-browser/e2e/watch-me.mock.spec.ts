import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import { watchPanel } from "./panel-ready";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-09-19-041603-004-recording-watch-me-and-cleanup");

const WATCH_ME = 'agent-chat-panel:not([hidden]) [data-attachment-provider="watch-me"] button';

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

async function allow(panelPage: Page): Promise<void> {
  const scrim = panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
  await expect(scrim).toBeVisible({ timeout: 15_000 });
  await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
  await expect(scrim).toHaveCount(0, { timeout: 5000 });
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
  // Opening the panel as `context.newPage()` (Playwright has no side-panel
  // API) makes IT the active tab. `bringToFront()` on the site page afterwards
  // restores it as the active tab so `chrome.tabs.query({active:true})`
  // (Watch me's `getActiveTab`) resolves the checkout tab, not the extension
  // page.
  sitePage?: Page,
): Promise<Page> {
  const panelPage = await context.newPage();
  await panelPage.addInitScript((id: number) => {
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Watch me mock" };
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
      // Echo the last user text back, so a "Turn this into a test" send has an
      // observable assistant reply the spec can wait on.
      const lastUserText = [...opts.messages].reverse().find((m) => m.role === "user");
      return { text: `ack: ${typeof lastUserText?.content === "string" ? lastUserText.content : "done"}` };
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
  }, plan);
  if (sitePage) await sitePage.bringToFront();
  return panelPage;
}

async function nextPlan(panelPage: Page, plan: PlannedCall[]): Promise<void> {
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = (window.__PLAN__ ?? []).concat(p);
  }, plan);
}

async function waitForResults(panelPage: Page, count: number): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, count, { timeout: 20_000 });
  return panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

test.describe("watch-me composer control mock e2e, self-attaching", () => {
  test("brand visibility: both tesagent and chromagent show Watch me", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [], "chromagent", sitePage);
    await expect(panelPage.locator(WATCH_ME)).toHaveCount(1);
    await expect(panelPage.locator(WATCH_ME)).toHaveAttribute("aria-label", "Watch me: record what you do on this tab");

    await chooseAgent(panelPage, "tesagent");
    const watchMe = panelPage.locator(WATCH_ME);
    await expect(watchMe).toHaveCount(1);
    await expect(watchMe).toHaveAttribute("aria-label", "Watch me: record what you do on this tab");

    await context.close();
  });

  test("Watch me is enabled on a site that is not turned on, and attaches with no confirm", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    // The origin is never added to enabledOrigins — the whole point is that
    // Watch me works on a site that was never turned on.
    const panelPage = await openPanel(context, extensionId, tabId, [], "tesagent", sitePage);
    const watchMe = panelPage.locator(WATCH_ME);
    await expect(watchMe).toBeEnabled();
    await expect(watchMe).not.toHaveAttribute("title", /.+/);
    await expect(watchMe).not.toHaveAttribute("disabled");

    await watchMe.click();
    // No confirm scrim: the button attaches itself the moment it is pressed.
    await expect(panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim")).toHaveCount(0);
    await expect(watchMe).toHaveAttribute("aria-label", "Stop recording");

    await context.close();
  });

  test("start/stop from the composer: live steps, stop card, remove button, and send with the chip", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [], "tesagent", sitePage);
    const watchMe = panelPage.locator(WATCH_ME);
    await expect(watchMe).toBeEnabled();

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await panelPage.hover(WATCH_ME);
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-01-idle-tooltip.png") });

    // Frame 1 asserted: idle icon, no title.
    await expect(watchMe).not.toHaveAttribute("title", /.+/);
    await expect(watchMe).toHaveAttribute("aria-label", "Watch me: record what you do on this tab");

    await watchMe.click();
    await expect(watchMe).toHaveAttribute("aria-label", "Stop recording");

    const slot = panelPage.locator('agent-chat-panel:not([hidden]) [data-attachment-slot="watch-me"]');
    await expect(slot).toContainText("Recording on localhost:10040 · 0 steps");

    await sitePage.locator("#coupon").fill("SAVE10");
    await sitePage.locator("#apply-btn").click();

    await expect(slot).toContainText(/Recording on localhost:10040 · [12] steps?/);
    await expect(slot.locator(".wa-watch-me-live")).toBeVisible();

    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-02-recording-live.png") });

    await watchMe.click(); // Stop
    await expect(watchMe).toHaveAttribute("aria-label", "Watch me: record what you do on this tab");
    await expect(slot).toContainText(/Recorded \d+ steps? on localhost:10040/);
    await expect(slot.locator('button[aria-label="Remove recording"]')).toBeVisible();

    const sendBtn = panelPage.locator('agent-chat-panel:not([hidden]) button[aria-label="Send"]');
    await expect(sendBtn).toBeEnabled();

    await panelPage.locator("agent-chat-panel:not([hidden]) #input").click();
    await panelPage.keyboard.type("Turn this into a test");
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-03-stopped-composer.png") });

    await panelPage.keyboard.press("Enter");

    // The composer returns to idle and the sent message shows the chip.
    await expect(slot).toBeHidden();
    await expect(panelPage.locator("agent-chat-panel:not([hidden])")).toContainText("Recording · 2 steps");

    const debugLog = await panelPage.evaluate(() => {
      const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>("agent-chat-panel:not([hidden])");
      return JSON.stringify(panel?.messages ?? []);
    });
    expect(debugLog).toContain("# Recorded steps on http://localhost:10040/checkout.html");
    expect(debugLog).toContain("role+name: ");

    await context.close();
  });

  test("a full navigation does not end the recording", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [], "tesagent", sitePage);
    const watchMe = panelPage.locator(WATCH_ME);
    await watchMe.click();

    await sitePage.locator("#apply-btn").click();
    await sitePage.locator("#sign-out-link").click();
    await expect(sitePage.locator("#signed-out-status")).toBeVisible({ timeout: 10_000 });
    await sitePage.locator("#back-link").click();
    await sitePage.waitForTimeout(300);

    const slot = panelPage.locator('agent-chat-panel:not([hidden]) [data-attachment-slot="watch-me"]');
    await expect(slot).not.toContainText("Recording stopped: the page navigated.");
    await expect(watchMe).toHaveAttribute("aria-label", "Stop recording");
    await expect(slot).toContainText(/Recording on localhost:10040 · 3 steps/);

    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-04-navigation-continues.png") });

    await context.close();
  });

  test("the remove button clears the stopped recording without sending", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [], "tesagent", sitePage);
    const watchMe = panelPage.locator(WATCH_ME);
    await watchMe.click();
    await sitePage.locator("#apply-btn").click();
    await watchMe.click(); // stop

    const slot = panelPage.locator('agent-chat-panel:not([hidden]) [data-attachment-slot="watch-me"]');
    await expect(slot).toBeVisible();
    await slot.locator('button[aria-label="Remove recording"]').click();

    await expect(slot).toBeHidden();
    const messageCount = await panelPage.evaluate(() => {
      const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>("agent-chat-panel:not([hidden])");
      return (panel?.messages ?? []).length;
    });
    expect(messageCount).toBe(0);

    await context.close();
  });

  test("agent-initiated start_recording shows the same status area and Stop icon", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(
      context,
      extensionId,
      tabId,
      [{ name: "start_debugging", input: {} }, { name: "start_recording", input: {} }],
      "tesagent",
      sitePage,
    );
    await sendMessage(panelPage, "Please record my actions.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    const watchMe = panelPage.locator(WATCH_ME);
    await expect(watchMe).toHaveAttribute("aria-label", "Stop recording");
    const slot = panelPage.locator('agent-chat-panel:not([hidden]) [data-attachment-slot="watch-me"]');
    await expect(slot).toContainText("Recording on localhost:10040");

    // The user presses Stop from the composer — the recording waits there.
    await watchMe.click();
    await expect(slot).toContainText(/Recorded \d+ steps? on localhost:10040/);

    await context.close();
  });

  test("an agent-triggered stop_recording returns the composer to idle, not stopped", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(
      context,
      extensionId,
      tabId,
      [{ name: "start_debugging", input: {} }, { name: "start_recording", input: {} }],
      "tesagent",
      sitePage,
    );
    await sendMessage(panelPage, "Record.");
    await allow(panelPage);
    await waitForResults(panelPage, 2);

    await sitePage.locator("#apply-btn").click();

    await nextPlan(panelPage, [{ name: "stop_recording", input: {} }]);
    await sendMessage(panelPage, "Stop.");
    await waitForResults(panelPage, 3);

    const watchMe = panelPage.locator(WATCH_ME);
    await expect(watchMe).toHaveAttribute("aria-label", "Watch me: record what you do on this tab");
    const slot = panelPage.locator('agent-chat-panel:not([hidden]) [data-attachment-slot="watch-me"]');
    await expect(slot).toBeHidden();

    await context.close();
  });

  test("a provider without view() (the image attach button) renders and behaves exactly as before", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [], "tesagent", sitePage);
    const imageBtn = panelPage.locator('agent-chat-panel:not([hidden]) [data-attachment-provider="image"] button');
    await expect(imageBtn).toBeVisible();
    await expect(imageBtn).toBeEnabled();
    await expect(imageBtn).toHaveAttribute("aria-label", "Attach image");

    await context.close();
  });

  test("reduced motion: the live dot does not animate", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await openPanel(context, extensionId, tabId, [], "tesagent", sitePage);
    await panelPage.emulateMedia({ reducedMotion: "reduce" });
    const watchMe = panelPage.locator(WATCH_ME);
    await watchMe.click();

    const dot = panelPage.locator('agent-chat-panel:not([hidden]) .wa-watch-me-live');
    await expect(dot).toBeVisible();
    const animationName = await dot.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe("none");

    await context.close();
  });
});
