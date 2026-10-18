import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import { countMatches, locatorField } from "./locator-text";

const CHECKOUT_URL = "http://localhost:10040/checkout.html";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-09-17-064916-002-verify-and-locator-tools");

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

test.describe("page_verify and page_generate_locator mock e2e (122/002)", () => {
  test("text_visible: PASS for the discount after SAVE10, FAIL for Enter a code", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [new URL(CHECKOUT_URL).origin]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    await sitePage.fill("#coupon", "SAVE10");
    await sitePage.click("#apply-btn");
    await expect(sitePage.locator("#coupon-status")).toHaveText("Discount: -$4.20");

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
          return { text: "Verify text" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          if (lastMsg.content.some((p) => p.type === "tool-result" && p.toolName === "start_debugging")) {
            return {
              toolCalls: [
                {
                  id: "tc_verify_1",
                  name: "page_verify",
                  input: { tabId: id, kind: "text_visible", text: "Discount: -$4.20" },
                },
              ],
            };
          }
          for (const part of lastMsg.content) {
            if (part.type === "tool-result" && (part.toolName === "page_verify" || part.toolName === "page_generate_locator")) {
              window.__VERIFY_RESULTS__ = [
                ...(window.__VERIFY_RESULTS__ ?? []),
                { tool: part.toolName, text: outputText(part.output), isError: !!part.isError },
              ];
            }
          }
          const results = window.__VERIFY_RESULTS__ ?? [];
          if (results.length === 1) {
            return {
              toolCalls: [
                {
                  id: "tc_verify_2",
                  name: "page_verify",
                  input: { tabId: id, kind: "text_visible", text: "Enter a code" },
                },
              ],
            };
          }
          if (results.length >= 2) {
            return { text: results.map((r) => r.text).join("\n") };
          }
        }
        return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
      };
    }, tabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Verify text.");
    await panelPage.waitForFunction(() => (window.__VERIFY_RESULTS__?.length ?? 0) >= 2, { timeout: 15_000 });

    const results = await panelPage.evaluate(() => window.__VERIFY_RESULTS__ ?? []);
    expect(results[0].tool).toBe("page_verify");
    expect(results[0].isError).toBe(false);
    expect(results[0].text).toMatch(/^PASS text "Discount: -\$4\.20" is visible\.$/);
    expect(results[1]).toEqual({
      tool: "page_verify",
      text: 'FAIL expected text "Enter a code" to be visible; found no matching text.',
      isError: false,
    });

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-verify-light.png") });

    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-verify-dark.png") });

    await context.close();
  });

  test("value: PASS on a filled Coupon; missing value is an input error", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [new URL(CHECKOUT_URL).origin]);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    await sitePage.fill("#coupon", "SAVE10");

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
          return { text: "Verify value" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          if (lastMsg.content.some((p) => p.type === "tool-result" && p.toolName === "start_debugging")) {
            return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
          }
          for (const part of lastMsg.content) {
            if (part.type === "tool-result") {
              const text = outputText(part.output);
              if (part.toolName === "page_snapshot") {
                window.__COUPON_REF__ = findRef(text, "Coupon") ?? undefined;
              } else if (part.toolName === "page_verify") {
                window.__VERIFY_RESULTS__ = [
                  ...(window.__VERIFY_RESULTS__ ?? []),
                  { tool: part.toolName, text, isError: !!part.isError },
                ];
              }
            }
          }
          const results = window.__VERIFY_RESULTS__ ?? [];
          if (results.length === 0 && window.__COUPON_REF__ !== undefined) {
            return {
              toolCalls: [
                {
                  id: "tc_verify_1",
                  name: "page_verify",
                  input: { tabId: id, kind: "value", ref: window.__COUPON_REF__, value: "SAVE10" },
                },
              ],
            };
          }
          if (results.length === 1) {
            return {
              toolCalls: [
                {
                  id: "tc_verify_2",
                  name: "page_verify",
                  input: { tabId: id, kind: "value", ref: window.__COUPON_REF__ },
                },
              ],
            };
          }
          if (results.length >= 2) {
            return { text: results.map((r) => r.text).join("\n") };
          }
        }
        return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
      };
    }, tabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Check value.");
    await panelPage.waitForFunction(() => (window.__VERIFY_RESULTS__?.length ?? 0) >= 2, { timeout: 15_000 });

    const results = await panelPage.evaluate(() => window.__VERIFY_RESULTS__ ?? []);
    expect(results[0].text).toMatch(/^PASS \[\d+\] textbox "Coupon" has value "SAVE10"\.$/);
    expect(results[0].isError).toBe(false);
    expect(results[1]).toEqual({
      tool: "page_verify",
      text: 'page_verify kind "value" needs value.',
      isError: true,
    });

    await context.close();
  });

  test("element_visible: PASS for Apply, none-visible FAIL for the hidden button", async ({
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

      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Verify element" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          if (lastMsg.content.some((p) => p.type === "tool-result" && p.toolName === "start_debugging")) {
            return {
              toolCalls: [
                {
                  id: "tc_verify_1",
                  name: "page_verify",
                  input: { tabId: id, kind: "element_visible", role: "button", name: "Apply" },
                },
              ],
            };
          }
          for (const part of lastMsg.content) {
            if (part.type === "tool-result" && part.toolName === "page_verify") {
              window.__VERIFY_RESULTS__ = [
                ...(window.__VERIFY_RESULTS__ ?? []),
                { tool: part.toolName, text: outputText(part.output), isError: !!part.isError },
              ];
            }
          }
          const results = window.__VERIFY_RESULTS__ ?? [];
          if (results.length === 1) {
            return {
              toolCalls: [
                {
                  id: "tc_verify_2",
                  name: "page_verify",
                  input: { tabId: id, kind: "element_visible", role: "button", name: "Clear saved cards" },
                },
              ],
            };
          }
          if (results.length >= 2) {
            return { text: results.map((r) => r.text).join("\n") };
          }
        }
        return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
      };
    }, tabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Check element visibility.");
    await panelPage.waitForFunction(() => (window.__VERIFY_RESULTS__?.length ?? 0) >= 2, { timeout: 15_000 });

    const results = await panelPage.evaluate(() => window.__VERIFY_RESULTS__ ?? []);
    expect(results[0].tool).toBe("page_verify");
    expect(results[0].isError).toBe(false);
    expect(results[0].text).toMatch(/^PASS button "Apply" is visible\.$/);
    expect(results[1]).toEqual({
      tool: "page_verify",
      text: 'FAIL expected button "Clear saved cards" to be visible; found 1 matching, none visible.',
      isError: false,
    });

    await context.close();
  });

  test("list: Order summary by role and name, PASS then FAIL naming Refund", async ({
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

      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Verify list" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          if (lastMsg.content.some((p) => p.type === "tool-result" && p.toolName === "start_debugging")) {
            return {
              toolCalls: [
                {
                  id: "tc_verify_1",
                  name: "page_verify",
                  input: { tabId: id, kind: "list", role: "list", name: "Order summary", items: ["Coupon", "Total"] },
                },
              ],
            };
          }
          for (const part of lastMsg.content) {
            if (part.type === "tool-result" && part.toolName === "page_verify") {
              window.__VERIFY_RESULTS__ = [
                ...(window.__VERIFY_RESULTS__ ?? []),
                { tool: part.toolName, text: outputText(part.output), isError: !!part.isError },
              ];
            }
          }
          const results = window.__VERIFY_RESULTS__ ?? [];
          if (results.length === 1) {
            return {
              toolCalls: [
                {
                  id: "tc_verify_2",
                  name: "page_verify",
                  input: { tabId: id, kind: "list", role: "list", name: "Order summary", items: ["Refund"] },
                },
              ],
            };
          }
          if (results.length >= 2) {
            return { text: results.map((r) => r.text).join("\n") };
          }
        }
        return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
      };
    }, tabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Check order summary list.");
    await panelPage.waitForFunction(() => (window.__VERIFY_RESULTS__?.length ?? 0) >= 2, { timeout: 15_000 });

    const results = await panelPage.evaluate(() => window.__VERIFY_RESULTS__ ?? []);
    expect(results[0].tool).toBe("page_verify");
    expect(results[0].isError).toBe(false);
    expect(results[0].text).toMatch(/^PASS list "Order summary" shows all 2 items\.$/);
    expect(results[1]).toEqual({
      tool: "page_verify",
      text: 'FAIL expected list "Order summary" to show "Refund"; not found.',
      isError: false,
    });

    await context.close();
  });

  test("page_generate_locator: Apply, Coupon and the second icon button, each matching one element in real Playwright", async ({
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

      let applyRef: string | null = null;
      let couponRef: string | null = null;
      let secondIconRef: string | null = null;

      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Locators" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          if (lastMsg.content.some((p) => p.type === "tool-result" && p.toolName === "start_debugging")) {
            return { toolCalls: [{ id: "tc_snap", name: "page_snapshot", input: { tabId: id } }] };
          }
          for (const part of lastMsg.content) {
            if (part.type === "tool-result") {
              const text = outputText(part.output);
              if (part.toolName === "page_snapshot") {
                applyRef = findRef(text, "Apply");
                couponRef = findRef(text, "Coupon");
                const iconMatches = Array.from(text.matchAll(/- button \[ref=(\d+)\]$/gm));
                secondIconRef = iconMatches[1]?.[1] ?? null;
              } else if (part.toolName === "page_generate_locator") {
                window.__VERIFY_RESULTS__ = [
                  ...(window.__VERIFY_RESULTS__ ?? []),
                  { tool: part.toolName, text, isError: !!part.isError },
                ];
              }
            }
          }
          const results = window.__VERIFY_RESULTS__ ?? [];
          if (results.length === 0 && applyRef !== null) {
            return {
              toolCalls: [
                {
                  id: "tc_loc_1",
                  name: "page_generate_locator",
                  input: { tabId: id, ref: applyRef },
                },
              ],
            };
          }
          if (results.length === 1 && couponRef !== null) {
            return {
              toolCalls: [
                {
                  id: "tc_loc_2",
                  name: "page_generate_locator",
                  input: { tabId: id, ref: couponRef },
                },
              ],
            };
          }
          if (results.length === 2 && secondIconRef !== null) {
            return {
              toolCalls: [
                {
                  id: "tc_loc_3",
                  name: "page_generate_locator",
                  input: { tabId: id, ref: secondIconRef },
                },
              ],
            };
          }
          if (results.length >= 3) {
            return { text: results.map((r) => r.text).join("\n") };
          }
        }
        return { toolCalls: [{ id: "tc_debug", name: "start_debugging", input: { tabId: id } }] };
      };
    }, tabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Generate locators.");
    await panelPage.waitForFunction(() => (window.__VERIFY_RESULTS__?.length ?? 0) >= 3, { timeout: 15_000 });

    const results = await panelPage.evaluate(() => window.__VERIFY_RESULTS__ ?? []);
    const body = (r: { text: string }) => r.text.split("\n").slice(1);
    expect(results.map((r) => [r.tool, r.isError])).toEqual([
      ["page_generate_locator", false],
      ["page_generate_locator", false],
      ["page_generate_locator", false],
    ]);
    expect(results[0].text).toMatch(/^\[\d+\] button "Apply"\n/);
    expect(body(results[0])).toEqual([
      '  role+name: button "Apply" (matches 1)',
      "  id: apply-btn",
      "  data-testid: —",
      "  name: —",
      "  css: #apply-btn",
      "  xpath: //*[@id='apply-btn']",
    ]);
    expect(results[1].text).toMatch(/^\[\d+\] textbox "Coupon"\n/);
    expect(body(results[1])).toEqual([
      '  role+name: textbox "Coupon" (matches 1)',
      "  id: coupon",
      "  data-testid: —",
      "  name: coupon",
      "  css: #coupon",
      "  xpath: //*[@id='coupon']",
    ]);
    // Two buttons share data-testid="icon-action", so it is not shown.
    expect(body(results[2])[0]).toMatch(/^ {2}role\+name: button "" \(matches \d+\)$/);
    expect(body(results[2]).slice(1)).toEqual([
      "  id: icon-action-2",
      "  data-testid: —",
      "  name: —",
      "  css: #icon-action-2",
      "  xpath: //*[@id='icon-action-2']",
    ]);

    for (const r of results) {
      expect(r.text).not.toMatch(/getBy|\.nth\(/);
      const css = locatorField(r.text, "css");
      const xpath = locatorField(r.text, "xpath");
      expect(css).not.toBeNull();
      expect(xpath).not.toBeNull();
      expect(await countMatches(sitePage, css!, xpath!)).toEqual({ css: 1, xpath: 1 });
    }
    await expect(sitePage.locator(locatorField(results[2].text, "css")!)).toHaveId("icon-action-2");

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await panelPage.emulateMedia({ colorScheme: "light" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-light"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-locator-light.png") });

    await panelPage.emulateMedia({ colorScheme: "dark" });
    await panelPage.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "mock-locator-dark.png") });

    await context.close();
  });

  test("both tools before start_debugging return the not-started gate text", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    // 131/002 — page_verify and page_generate_locator run on the debugger now,
    // so they gate on start_debugging, not on enabledOrigins. Deliberately
    // never call start_debugging in this test.

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
          return { text: "Not activated" };
        }
        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg.content)) {
          for (const part of lastMsg.content) {
            if (part.type === "tool-result") {
              window.__VERIFY_RESULTS__ = [
                ...(window.__VERIFY_RESULTS__ ?? []),
                { tool: part.toolName, text: outputText(part.output), isError: !!part.isError },
              ];
            }
          }
          const results = window.__VERIFY_RESULTS__ ?? [];
          if (results.length === 1) {
            return {
              toolCalls: [
                {
                  id: "tc_not_act_2",
                  name: "page_generate_locator",
                  input: { tabId: id, ref: "1" },
                },
              ],
            };
          }
          if (results.length >= 2) {
            return { text: results.map((r) => r.text).join("\n") };
          }
        }
        return {
          toolCalls: [
            {
              id: "tc_not_act_1",
              name: "page_verify",
              input: { tabId: id, kind: "text_visible", text: "Cart" },
            },
          ],
        };
      };
    }, tabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await chooseAgent(panelPage, "tesagent");

    await sendMessage(panelPage, "Run tools on non-activated tab.");
    await panelPage.waitForFunction(() => (window.__VERIFY_RESULTS__?.length ?? 0) >= 2, { timeout: 15_000 });

    const results = await panelPage.evaluate(() => window.__VERIFY_RESULTS__ ?? []);
    const expectedText = `Debugging is not started on tab #${tabId}. Call start_debugging first.`;
    expect(results[0]).toEqual({
      tool: "page_verify",
      text: expectedText,
      isError: true,
    });
    expect(results[1]).toEqual({
      tool: "page_generate_locator",
      text: expectedText,
      isError: true,
    });

    await context.close();
  });
});
