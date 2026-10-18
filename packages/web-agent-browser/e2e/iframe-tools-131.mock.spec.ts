// 131/003 — mock-tier proof for page tools reaching into same-site and
// cross-site iframes, T1-T11 from the refined plan's Test plan. Harness
// copied from ref-tools-131.mock.spec.ts:1-136, with CHECKOUT_URL pointed at
// the new fixture, routeCrossSiteFrames applied, and refFor extended to also
// match an "f<k>:" prefixed ref.
import { test, expect, getTabId } from "./extension.fixture";
import { routeCrossSiteFrames } from "./cross-site-frames";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout-frames.html`;

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

/** Same plan-queue mock model ref-tools-131.mock.spec.ts uses, extended so
 *  "@Label" also resolves against `frame`, for page_eval's frame input. */
async function openPanel(context: BrowserContext, extensionId: string, tabId: number, plan: PlannedCall[]): Promise<Page> {
  const panelPage = await context.newPage();
  await panelPage.addInitScript((id: number) => {
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Iframe tools 131" };
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
      function refFor(label: string): string {
        const snap = [...results].reverse().find((r) => r.tool === "page_snapshot");
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = snap?.text.match(new RegExp(`"${escaped}"[^\\n]*\\[ref=((?:f\\d+:)?\\d+)\\]`));
        return m ? m[1] : "missing";
      }
      function resolved(v: unknown): unknown {
        return typeof v === "string" && v.startsWith("@") ? refFor(v.slice(1)) : v;
      }
      function resolveRefs(input: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = { ...input };
        if ("ref" in out) out.ref = resolved(out.ref);
        if ("scope" in out) out.scope = resolved(out.scope);
        if ("frame" in out) out.frame = resolved(out.frame);
        if (Array.isArray(out.fields)) {
          out.fields = out.fields.map((f: Record<string, unknown>) => ({ ...f, ref: resolved(f.ref) }));
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
  await chooseAgent(panelPage, "tesagent");
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
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

async function appendPlan(
  panelPage: Page,
  extra: PlannedCall[],
  prompt: string,
  count: number,
): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = [...(window.__PLAN__ ?? []), ...p];
  }, extra);
  return runPlan(panelPage, prompt, count);
}

/** The indentation (leading two-space groups) of the first line matching
 *  `re` in `text`. */
function depthOf(text: string, re: RegExp): number {
  const line = text.split("\n").find((l) => re.test(l));
  if (!line) throw new Error(`no line matches ${re}`);
  const m = /^( *)/.exec(line);
  return (m?.[1].length ?? 0) / 2;
}

async function openCheckout(context: BrowserContext): Promise<{ worker: Worker; sitePage: Page; tabId: number }> {
  const worker = await getWorker(context);
  await routeCrossSiteFrames(context);
  const sitePage = await context.newPage();
  await sitePage.goto(CHECKOUT_URL);
  const tabId = await getTabId(worker, CHECKOUT_URL);
  return { worker, sitePage, tabId };
}

test.describe("Iframe tools 131 mock e2e (131/003)", () => {
  test("T1 page_snapshot lists every iframe, same-site plain refs, cross-site f1: refs", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging and snapshot.", 2);

    const snap = results[1].text;
    expect(snap).toMatch(/- iframe "Shipping" · http:\/\/localhost:10040 \[ref=\d+\]/);
    expect(snap).toMatch(/- iframe "Payment" · http:\/\/pay\.test \[ref=\d+\]/);
    expect(snap).toMatch(/- button "Save shipping" \[ref=\d+\]/);
    expect(snap).toMatch(/- button "Pay" \[ref=f1:\d+\]/);
    expect(snap).toMatch(/- button "Top button" \[ref=\d+\]/);

    // The Shipping/Payment content is one level deeper than the iframe line.
    expect(depthOf(snap, /- iframe "Shipping"/)).toBeLessThan(depthOf(snap, /- button "Save shipping"/));
    expect(depthOf(snap, /- iframe "Payment"/)).toBeLessThan(depthOf(snap, /- button "Pay"/));

    await sitePage.close();
    await context.close();
  });

  test("T2 page_click fires the handler in the same-site AND the cross-site iframe", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Save shipping" } },
      { name: "page_click", input: { ref: "@Pay" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, snapshot, click Save shipping, then click Pay.", 4);

    expect(results[2].isError).toBe(false);
    expect(results[2].text).toContain("Clicked");
    expect(results[3].isError).toBe(false);
    expect(results[3].text).toContain("Clicked");

    const shippingFrame = sitePage.frames().find((f) => f.url().includes("shipping-frame.html"));
    expect(shippingFrame).toBeDefined();
    await expect.poll(() => shippingFrame!.title()).toBe("Shipping saved");

    const paymentFrame = sitePage.frames().find((f) => f.url().startsWith("http://pay.test"));
    expect(paymentFrame).toBeDefined();
    await expect(paymentFrame!.locator("#state")).toHaveText("Paid");

    await sitePage.close();
    await context.close();
  });

  test("T3 page_fill_form fills a field inside the cross-site iframe", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_fill_form", input: { fields: [{ ref: "@Card number", value: "4242 4242 4242 4242" }] } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, snapshot, then fill the card number.", 3);

    expect(results[2].isError).toBe(false);
    expect(results[2].text).toMatch(/^Filled 1 field: \[f1:\d+\] textbox "Card number"\./);

    const paymentFrame = sitePage.frames().find((f) => f.url().startsWith("http://pay.test"));
    await expect(paymentFrame!.locator("#card")).toHaveValue("4242 4242 4242 4242");

    await sitePage.close();
    await context.close();
  });

  test("T4 select, upload, hover, verify, generate-locator and screenshot all work on a ref in each frame", async ({
    context,
    extensionId,
  }) => {
    const { tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_select_option", input: { ref: "@Speed", values: ["exp"] } },
      {
        name: "page_upload_file",
        input: { ref: "@Receipt", files: [{ name: "r.txt", mimeType: "text/plain", text: "hello world!" }] },
      },
      { name: "page_hover", input: { ref: "@Save shipping" } },
      { name: "page_verify", input: { kind: "element_visible", ref: "@Pay" } },
      { name: "page_generate_locator", input: { ref: "@Pay" } },
      { name: "page_screenshot", input: { ref: "@Pay" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Run one tool on a ref in each frame.", 8);

    for (let i = 2; i < 8; i++) expect(results[i].isError).toBe(false);
    expect(results[5].text).toMatch(/^PASS /);
    expect(results[6].text).toContain("page.");
    expect(results[6].text).toContain("matches 1 element");
    expect(results[7].text).toMatch(/^Screenshot of \[f1:\d+\] .+, [\d.]+ × [\d.]+\.$/);

    await context.close();
  });

  test("T5 a cross-site iframe nested inside another is listed and clickable", async ({ context, extensionId }) => {
    const { sitePage, tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results1 = await runPlan(panelPage, "Start debugging and snapshot.", 2);

    const snap1 = results1[1].text;
    expect(snap1).toMatch(/- iframe "Bank" · http:\/\/bank\.test \[ref=f1:\d+\]/);
    expect(depthOf(snap1, /- iframe "Payment"/)).toBeLessThan(depthOf(snap1, /- iframe "Bank"/));
    expect(snap1).toMatch(/- button "Confirm with bank" \[ref=f2:\d+\]/);

    const results2 = await appendPlan(
      panelPage,
      [{ name: "page_click", input: { ref: "@Confirm with bank" } }],
      "Click Confirm with bank.",
      3,
    );
    expect(results2[2].isError).toBe(false);
    expect(results2[2].text).toContain("Confirm with bank");

    const bankFrame = sitePage.frames().find((f) => f.url().startsWith("http://bank.test"));
    await expect(bankFrame!.locator("#bank-state")).toHaveText("Confirmed");

    await sitePage.close();
    await context.close();
  });

  test("T6 an iframe added after start_debugging appears in the next snapshot with a higher k", async ({
    context,
    extensionId,
  }) => {
    const { sitePage, tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results1 = await runPlan(panelPage, "Start debugging and snapshot.", 2);
    const firstKs = [...results1[1].text.matchAll(/\[ref=f(\d+):\d+\]/g)].map((m) => Number(m[1]));
    const maxFirstK = Math.max(0, ...firstKs);

    await sitePage.evaluate(() => {
      const el = document.createElement("iframe");
      el.id = "late";
      el.title = "Late";
      el.src = "http://bank.test/";
      document.body.appendChild(el);
    });
    await sitePage.waitForTimeout(1000);

    const results2 = await appendPlan(panelPage, [{ name: "page_snapshot", input: {} }], "Snapshot again.", 3);
    const snap2 = results2[2].text;
    expect(snap2).toMatch(/- iframe "Late" · http:\/\/bank\.test \[ref=\d+\]/);
    const lastConfirmMatch = [...snap2.matchAll(/- button "Confirm with bank" \[ref=f(\d+):\d+\]/g)].pop();
    expect(lastConfirmMatch).toBeDefined();
    expect(Number(lastConfirmMatch![1])).toBeGreaterThan(maxFirstK);

    await sitePage.close();
    await context.close();
  });

  test("T7 after a cross-site iframe is removed, its f<k>: refs return the stale-ref error", async ({
    context,
    extensionId,
  }) => {
    const { sitePage, tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results1 = await runPlan(panelPage, "Start debugging and snapshot.", 2);
    const payMatch = /- button "Pay" \[ref=(f\d+:\d+)\]/.exec(results1[1].text);
    expect(payMatch).not.toBeNull();
    const payRef = payMatch![1];

    await sitePage.evaluate(() => document.getElementById("payment")?.remove());
    await sitePage.waitForTimeout(1000);

    const results2 = await appendPlan(panelPage, [{ name: "page_click", input: { ref: payRef } }], "Click the old Pay ref.", 3);
    expect(results2[2]).toEqual({
      tool: "page_click",
      text: `Ref ${payRef} is no longer on the page. Take a new snapshot.`,
      isError: true,
    });

    await sitePage.close();
    await context.close();
  });

  test("T8 page_eval with frame: cross-site origin, same-site title, and the not-an-iframe error", async ({
    context,
    extensionId,
  }) => {
    const { tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_eval", input: { frame: "@Payment", code: "return location.origin" } },
      { name: "page_eval", input: { frame: "@Shipping", code: "return document.title" } },
      { name: "page_eval", input: { frame: "@Top button", code: "return 1" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Run page_eval in the payment frame, the shipping frame, and on a non-frame ref.", 5);

    expect(results[2]).toEqual({ tool: "page_eval", text: "Result type: string\n\nhttp://pay.test", isError: false });
    expect(results[3]).toEqual({ tool: "page_eval", text: "Result type: string\n\nShipping", isError: false });
    expect(results[4]).toEqual({
      tool: "page_eval",
      text: "frame must be the ref of an iframe from page_snapshot.",
      isError: true,
    });

    await context.close();
  });

  test("T9 a page_eval past its timeout is stopped, and the frame still answers the next call", async ({
    context,
    extensionId,
  }) => {
    const { tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_eval", input: { frame: "@Payment", code: "while (true) {}", timeoutMs: 1000 } },
      { name: "page_eval", input: { frame: "@Payment", code: "return 1 + 1" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Run an infinite loop in the payment frame with a 1s timeout, then run 1 + 1 in it.", 4);

    expect(results[2]).toEqual({
      tool: "page_eval",
      text: "page_eval stopped the script after 1000 ms: it was still running. The tab is responsive again.",
      isError: true,
    });
    expect(results[3]).toEqual({ tool: "page_eval", text: "Result type: number\n\n2", isError: false });

    await context.close();
  });

  test("T11 page_console returns an iframe message prefixed with its origin", async ({ context, extensionId }) => {
    const { tabId } = await openCheckout(context);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Pay" } },
      { name: "page_console", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, snapshot, click Pay, then read the console.", 4);

    expect(results[3].text).toContain("(frame http://pay.test) payment frame: pay pressed");
    const readyLine = results[3].text.split("\n").find((l) => l.includes("checkout page ready"));
    expect(readyLine).toBeDefined();
    expect(readyLine).not.toContain("(frame ");

    await context.close();
  });
});
