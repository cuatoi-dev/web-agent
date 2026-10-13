import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const CHECKOUT_URL = "http://localhost:10040/checkout.html";

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

test.describe("Act-by-ref page tools mock e2e (122/001)", () => {
  test("page_fill_form with one valid ref and one stale ref leaves both page fields empty", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [new URL(CHECKOUT_URL).origin]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await context.newPage();
    await panelPage.addInitScript((id: number) => {
      // A tool's real output is always a string (ToolOutcome.content in
      // web-agent-core), but the mock script reads it back off a
      // ToolResultPart whose `output` field is `unknown` — narrow rather
      // than optional-chain, which `unknown` does not support.
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      function findRef(text: string, label: string): string | null {
        const m = text.match(new RegExp(`"${label}"[^\\n]*\\[ref=(\\d+)\\]`));
        return m ? m[1] : null;
      }
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Checkout test" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result");
          const text = part && part.type === "tool-result" ? outputText(part.output) : "";
          if (part?.toolName === "start_debugging") {
            return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
          }
          if (part?.toolName === "page_snapshot" && window.__COUPON_REF__ === undefined) {
            window.__COUPON_REF__ = findRef(text, "Coupon") ?? undefined;
            window.__EMAIL_REF__ = findRef(text, "Email") ?? undefined;
            return { text: "First snapshot done." };
          }
          if (part?.toolName === "page_snapshot") {
            return {
              toolCalls: [
                {
                  id: "tc_fill",
                  name: "page_fill_form",
                  input: {
                    tabId: id,
                    fields: [
                      { ref: window.__COUPON_REF__, value: "SAVE10" },
                      { ref: window.__EMAIL_REF__, value: "qa@example.com" },
                    ],
                  },
                },
              ],
            };
          }
          if (part?.toolName === "page_fill_form") {
            window.__FILL_RESULT__ = text;
            return { text: "Fill attempted." };
          }
        }
        if (!window.__DEBUG_STARTED__) {
          window.__DEBUG_STARTED__ = true;
          return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
        }
        return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
      };
    }, tabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    // Turn A — snapshot once to learn the coupon and email refs.
    await sendMessage(panelPage, "Snapshot this page.");
    await panelPage.waitForFunction(() => window.__COUPON_REF__ !== undefined, { timeout: 15_000 });

    // 131/002 — a ref is a Chrome node id, valid for as long as its element
    // is on the page; there is no snapshot "generation" any more. Remove the
    // email field from the DOM entirely so its earlier ref genuinely goes
    // stale (describe() sees el.isConnected === false).
    await sitePage.evaluate(() => {
      document.getElementById("email")?.remove();
    });

    // Turn B — fill using the (now stale) email ref.
    await sendMessage(panelPage, "Fill the form.");
    await panelPage.waitForFunction(() => window.__FILL_RESULT__ !== undefined, { timeout: 15_000 });

    const fillResult = await panelPage.evaluate(() => window.__FILL_RESULT__);
    expect(fillResult).toContain("is no longer on the page");
    expect(fillResult).toContain("Take a new snapshot");
    expect(await sitePage.locator("#coupon-trusted").textContent()).toBe("");

    expect(await sitePage.locator("#coupon").inputValue()).toBe("");
    // The email field was removed to make its ref stale — it no longer exists
    // to read back.
    expect(await sitePage.evaluate(() => document.getElementById("email"))).toBeNull();
  });

  test("page_click on Place order: Reject leaves the handler unrun", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [new URL(CHECKOUT_URL).origin]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await context.newPage();
    await panelPage.addInitScript((id: number) => {
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      function findRef(text: string, label: string): string | null {
        const m = text.match(new RegExp(`"${label}"[^\\n]*\\[ref=(\\d+)\\]`));
        return m ? m[1] : null;
      }
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Checkout test" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result");
          const text = part && part.type === "tool-result" ? outputText(part.output) : "";
          if (part?.toolName === "start_debugging") {
            return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
          }
          if (part?.toolName === "page_snapshot") {
            const ref = findRef(text, "Place order");
            return { toolCalls: [{ id: "tc_click", name: "page_click", input: { tabId: id, ref } }] };
          }
          if (part?.toolName === "page_click") {
            window.__CLICK_RESULT__ = text;
            return { text: "Click attempted." };
          }
        }
        if (!window.__DEBUG_STARTED__) {
          window.__DEBUG_STARTED__ = true;
          return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
        }
        return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
      };
    }, tabId);
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Snapshot then click Place order.");

    const scrim = panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });
    await expect(scrim).toContainText("Place order");

    const rejectBtn = scrim.locator("button:has-text('Reject'), md-outlined-button:has-text('Reject')").first();
    await rejectBtn.click();
    await expect(scrim).toHaveCount(0, { timeout: 5000 });

    await panelPage.waitForFunction(() => window.__CLICK_RESULT__ !== undefined, { timeout: 15_000 });
    const rejectResult = await panelPage.evaluate(() => window.__CLICK_RESULT__);
    expect(rejectResult).toContain("was not confirmed by the user; not performed.");
    expect(await sitePage.locator("#coupon-status").textContent()).not.toBe("Order placed.");
  });

  test("page_click on Place order: Allow runs the click handler", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [new URL(CHECKOUT_URL).origin]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await context.newPage();
    await panelPage.addInitScript((id: number) => {
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      function findRef(text: string, label: string): string | null {
        const m = text.match(new RegExp(`"${label}"[^\\n]*\\[ref=(\\d+)\\]`));
        return m ? m[1] : null;
      }
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Checkout test" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result");
          const text = part && part.type === "tool-result" ? outputText(part.output) : "";
          if (part?.toolName === "start_debugging") {
            return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
          }
          if (part?.toolName === "page_snapshot") {
            const ref = findRef(text, "Place order");
            return { toolCalls: [{ id: "tc_click", name: "page_click", input: { tabId: id, ref } }] };
          }
          if (part?.toolName === "page_click") {
            window.__CLICK_RESULT__ = text;
            return { text: "Click attempted." };
          }
        }
        if (!window.__DEBUG_STARTED__) {
          window.__DEBUG_STARTED__ = true;
          return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
        }
        return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
      };
    }, tabId);
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Snapshot then click Place order.");

    const scrim = panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });

    const allowBtn = scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first();
    await allowBtn.click();
    await expect(scrim).toHaveCount(0, { timeout: 5000 });

    await panelPage.waitForFunction(() => window.__CLICK_RESULT__ !== undefined, { timeout: 15_000 });
    const allowResult = await panelPage.evaluate(() => window.__CLICK_RESULT__);
    expect(allowResult).toContain("Clicked");
    expect(allowResult).toContain("Place order");
    await expect(sitePage.locator("#coupon-status")).toHaveText("Order placed.");
  });

  test("page_select_option: two values on Shipping errors and leaves the selection unchanged; two values on Extras selects exactly those", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [new URL(CHECKOUT_URL).origin]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await context.newPage();
    await panelPage.addInitScript((id: number) => {
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      function findRef(text: string, label: string): string | null {
        const m = text.match(new RegExp(`"${label}"[^\\n]*\\[ref=(\\d+)\\]`));
        return m ? m[1] : null;
      }
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Checkout test" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result");
          const text = part && part.type === "tool-result" ? outputText(part.output) : "";
          if (part?.toolName === "start_debugging") {
            return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
          }
          if (part?.toolName === "page_snapshot" && window.__SHIPPING_REF__ === undefined) {
            window.__SHIPPING_REF__ = findRef(text, "Shipping") ?? undefined;
            window.__EXTRAS_REF__ = findRef(text, "Extras") ?? undefined;
            return {
              toolCalls: [
                {
                  id: "tc_sel1",
                  name: "page_select_option",
                  input: { tabId: id, ref: window.__SHIPPING_REF__, values: ["Standard", "Express"] },
                },
              ],
            };
          }
          if (part?.toolName === "page_select_option" && window.__SHIPPING_RESULT__ === undefined) {
            window.__SHIPPING_RESULT__ = text;
            return {
              toolCalls: [
                {
                  id: "tc_sel2",
                  name: "page_select_option",
                  input: { tabId: id, ref: window.__EXTRAS_REF__, values: ["Gift wrap", "Card"] },
                },
              ],
            };
          }
          if (part?.toolName === "page_select_option") {
            window.__EXTRAS_RESULT__ = text;
            return { text: "Selections attempted." };
          }
        }
        if (!window.__DEBUG_STARTED__) {
          window.__DEBUG_STARTED__ = true;
          return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
        }
        return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
      };
    }, tabId);
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Snapshot the page, then select shipping options and extras.");

    await panelPage.waitForFunction(() => window.__EXTRAS_RESULT__ !== undefined, { timeout: 15_000 });

    const shippingResult = await panelPage.evaluate(() => window.__SHIPPING_RESULT__);
    expect(shippingResult).toContain("is a single-choice select; pass exactly one value.");
    expect(await sitePage.locator("#shipping").inputValue()).toBe("standard");

    const extrasResult = await panelPage.evaluate(() => window.__EXTRAS_RESULT__);
    expect(extrasResult).toContain('Selected "Gift wrap", "Card"');
    const selectedExtras = await sitePage
      .locator("#extras")
      .evaluate((el: HTMLSelectElement) => Array.from(el.selectedOptions).map((o) => o.label));
    expect(selectedExtras).toEqual(["Gift wrap", "Card"]);
  });

  test("page_snapshot before start_debugging returns the not-started gate text", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    // 131/002 — page_snapshot runs on the debugger now, so it gates on
    // start_debugging, not on enabledOrigins. Deliberately not enabled AND
    // deliberately never call start_debugging.

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const panelPage = await context.newPage();
    await panelPage.addInitScript((id: number) => {
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Checkout test" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "page_snapshot");
          const text = part && part.type === "tool-result" ? outputText(part.output) : "";
          window.__NOT_ACTIVATED_RESULT__ = text;
          return { text: "Tried the snapshot." };
        }
        return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
      };
    }, tabId);
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Snapshot this page.");

    await panelPage.waitForFunction(() => window.__NOT_ACTIVATED_RESULT__ !== undefined, { timeout: 15_000 });
    const result = await panelPage.evaluate(() => window.__NOT_ACTIVATED_RESULT__);
    expect(result).toBe(`Debugging is not started on tab #${tabId}. Call start_debugging first.`);
  });
});
