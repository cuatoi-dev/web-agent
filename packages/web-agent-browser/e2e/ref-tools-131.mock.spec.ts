// 131/002 — mock-tier proof for accessibility-tree page_snapshot and the eight
// debugger ref tools (task 2 of idea 131), covering R1-R16 from the refined
// plan's code change 22. Where an existing spec (act-by-ref.mock.spec.ts,
// verify-locator.mock.spec.ts, network-dialog.mock.spec.ts,
// debugger-tools-002.mock.spec.ts) already proves an R item, it is proven
// again here so the R-list maps one-to-one onto this file, per the finish
// brief for this task's completion round (2026-09-19).
import { test, expect, getTabId } from "./extension.fixture";
import { captionOf, expectSavedPng } from "./saved-files";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const CHECKOUT_URL = `${ORIGIN}/checkout.html`;

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

/** Same plan-queue mock model `debugger-tools-002.mock.spec.ts` and
 *  `network-dialog.mock.spec.ts` use, extended so "@Label" resolves against
 *  the latest page_snapshot for `ref`, `scope`, and every `fields[].ref`. */
async function openPanel(context: BrowserContext, extensionId: string, tabId: number, plan: PlannedCall[]): Promise<Page> {
  const panelPage = await context.newPage();
  await panelPage.addInitScript((id: number) => {
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Ref tools 131" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
      // A page_screenshot success stashes its image as a PENDING image the
      // core loop injects as its own user message on the NEXT call — that
      // pushes the tool-result one position back from the end, so every
      // message is scanned (deduped by toolCallId) rather than only the last
      // one (same fix debugger-tools-002.mock.spec.ts's openPanel uses).
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
        const m = snap?.text.match(new RegExp(`"${escaped}"[^\\n]*\\[ref=(\\d+)\\]`));
        return m ? m[1] : "missing";
      }
      function resolved(v: unknown): unknown {
        return typeof v === "string" && v.startsWith("@") ? refFor(v.slice(1)) : v;
      }
      function resolveRefs(input: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = { ...input };
        if ("ref" in out) out.ref = resolved(out.ref);
        if ("scope" in out) out.scope = resolved(out.scope);
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

test.describe("Ref tools 131 mock e2e (131/002)", () => {
  test("R1-R5 page_snapshot: shape, scope, include_text, and ref stability across a second snapshot", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    await sitePage.fill("#email", "qa@example.com");
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results1 = await runPlan(panelPage, "Start debugging and snapshot.", 2);

    const snapshot1 = results1[1].text;
    // R1 — Cart heading, Email textbox with its value after ":", Apply button, each [ref=<n>].
    // A heading also carries a [level=N] property before its [ref=N]; a
    // value-holding role prints [ref=N] BEFORE its ": <value>" suffix
    // (ax-snapshot.ts's print() order: role/name, properties, ref, value).
    expect(snapshot1).toMatch(/- heading "Cart"[^\n]*\[ref=\d+\]/);
    expect(snapshot1).toMatch(/- textbox "Email" \[ref=\d+\]: qa@example\.com/);
    expect(snapshot1).toMatch(/- button "Apply" \[ref=\d+\]/);

    // R2 — no unnamed generic line, and Apply's own text is not printed a second time.
    expect(snapshot1).not.toMatch(/^\s*- generic$/m);
    expect((snapshot1.match(/"Apply"/g) ?? []).length).toBe(1);

    const applyMatch = /- button "Apply" \[ref=(\d+)\]/.exec(snapshot1);
    expect(applyMatch).not.toBeNull();
    const applyRef = applyMatch![1];

    // R3 — scope prints only that subtree; an unknown scope errors.
    const results2 = await appendPlan(
      panelPage,
      [
        { name: "page_snapshot", input: { scope: applyRef } },
        { name: "page_snapshot", input: { scope: "999999" } },
      ],
      "Snapshot just the Apply button, then an unknown scope.",
      4,
    );
    expect(results2[2].text.trim()).toBe(`- button "Apply" [ref=${applyRef}]`);
    expect(results2[3]).toEqual({
      tool: "page_snapshot",
      text: "Ref 999999 is not on the page. Take a new snapshot.",
      isError: true,
    });

    // R4 — include_text keeps matching nodes and their ancestors only.
    const results3 = await appendPlan(
      panelPage,
      [{ name: "page_snapshot", input: { include_text: "email" } }],
      "Snapshot only the email field.",
      5,
    );
    expect(results3[4].text).toMatch(/textbox "Email"/);
    expect(results3[4].text).not.toMatch(/"Shipping"/);

    // R5 — a ref from snapshot 1 still resolves after a second full snapshot.
    const results4 = await appendPlan(
      panelPage,
      [
        { name: "page_snapshot", input: {} },
        { name: "page_click", input: { ref: applyRef } },
      ],
      "Snapshot again, then click Apply using the first snapshot's ref.",
      7,
    );
    expect(results4[6].isError).toBe(false);
    expect(results4[6].text).toContain("Clicked");
    expect(results4[6].text).toContain("Apply");

    await context.close();
  });

  test("R6-R8 page_click, page_fill_form and page_select_option", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      {
        name: "page_fill_form",
        input: {
          fields: [
            { ref: "@Coupon", value: "SAVE10" },
            { ref: "@Email", value: "qa@example.com" },
          ],
        },
      },
      { name: "page_click", input: { ref: "@Apply" } },
      { name: "page_select_option", input: { ref: "@Shipping", values: ["express"] } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    // Run up to the first select in its own batch — the whole plan resolves
    // back-to-back once queued, so checking mid-sequence DOM state only works
    // if the check happens BEFORE the next stage is appended (124/002 fix
    // round 1 lesson, reused by debugger-tools-002.mock.spec.ts T8).
    const results = await runPlan(
      panelPage,
      "Start debugging, snapshot, fill the form, click Apply, then pick Express shipping by value.",
      5,
    );

    // R7 — page_fill_form fills two fields; the page's own listeners fire.
    expect(results[2].isError).toBe(false);
    expect(results[2].text).toMatch(/^Filled 2 fields: \[\d+\] textbox "Coupon", \[\d+\] textbox "Email"\./);
    expect(await sitePage.locator("#coupon").inputValue()).toBe("SAVE10");
    expect(await sitePage.locator("#email").inputValue()).toBe("qa@example.com");
    expect(await sitePage.locator("#coupon-trusted").textContent()).toBe("true");

    // R6 — page_click on Apply changes #coupon-status.
    expect(results[3].isError).toBe(false);
    expect(results[3].text).toContain("Clicked");
    await expect(sitePage.locator("#coupon-status")).toHaveText("Discount: -$4.20");

    // R8 — page_select_option by value.
    expect(results[4].isError).toBe(false);
    expect(results[4].text).toContain('Selected "Express"');
    expect(await sitePage.locator("#shipping").inputValue()).toBe("express");

    // R8 continued — page_select_option by label, checked in its own stage.
    const results2 = await appendPlan(
      panelPage,
      [{ name: "page_select_option", input: { ref: "@Shipping", values: ["Standard"] } }],
      "Now pick Standard shipping by label.",
      6,
    );
    expect(results2[5].isError).toBe(false);
    expect(results2[5].text).toContain('Selected "Standard"');
    expect(await sitePage.locator("#shipping").inputValue()).toBe("standard");

    await context.close();
  });

  test("R9 page_upload_file: a text file, a base64 file, and the 10 MB limit", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      {
        name: "page_upload_file",
        input: { ref: "@Attachments", files: [{ name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" }] },
      },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    // Each upload's DOM effect is checked before the next upload is queued —
    // running the whole plan first would let a later upload overwrite
    // #upload-status before it is read (same lesson as the select test above).
    const results = await runPlan(panelPage, "Start debugging, snapshot, then upload a text file.", 3);

    expect(results[2].isError).toBe(false);
    expect(results[2].text).toMatch(/orders\.csv \(8 B\)\.$/);
    await expect(sitePage.locator("#upload-status")).toHaveText("orders.csv|text/csv|8");

    const results2 = await appendPlan(
      panelPage,
      [
        {
          name: "page_upload_file",
          input: {
            ref: "@Attachments",
            files: [{ name: "note.bin", mimeType: "application/octet-stream", base64: Buffer.from("hi").toString("base64") }],
          },
        },
      ],
      "Now upload a base64 file.",
      4,
    );
    expect(results2[3].isError).toBe(false);
    expect(results2[3].text).toMatch(/note\.bin \(2 B\)\.$/);
    await expect(sitePage.locator("#upload-status")).toHaveText("note.bin|application/octet-stream|2");

    const results3 = await appendPlan(
      panelPage,
      [
        {
          name: "page_upload_file",
          input: {
            ref: "@Attachments",
            files: [{ name: "huge.bin", mimeType: "application/octet-stream", size: 11_534_336, fill: "A" }],
          },
        },
      ],
      "Now try to upload an oversized file.",
      5,
    );
    expect(results3[4]).toEqual({
      tool: "page_upload_file",
      text: "Uploads are limited to 10 MB in total.",
      isError: true,
    });

    await context.close();
  });

  test("R10 page_screenshot with a ref returns an image sized to that element", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_screenshot", input: { ref: "@Apply" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, snapshot, then screenshot the Apply button.", 3);

    expect(results[2].isError).toBe(false);
    expect(captionOf(results[2].text)).toMatch(/^Screenshot of \[\d+\] button "Apply", [\d.]+ × [\d.]+\.$/);
    expectSavedPng(results[2].text);

    await context.close();
  });

  test("R11-R12 page_verify for all four kinds, and page_generate_locator", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);
    await sitePage.fill("#coupon", "SAVE10");
    await sitePage.click("#apply-btn");
    await expect(sitePage.locator("#coupon-status")).toHaveText("Discount: -$4.20");

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_verify", input: { kind: "text_visible", text: "Discount: -$4.20" } },
      { name: "page_verify", input: { kind: "text_visible", text: "Enter a code" } },
      { name: "page_snapshot", input: {} },
      { name: "page_verify", input: { kind: "value", ref: "@Coupon", value: "SAVE10" } },
      { name: "page_verify", input: { kind: "value", ref: "@Coupon" } },
      { name: "page_verify", input: { kind: "element_visible", role: "button", name: "Apply" } },
      { name: "page_verify", input: { kind: "element_visible", role: "button", name: "Clear saved cards" } },
      { name: "page_verify", input: { kind: "list", role: "list", name: "Order summary", items: ["Coupon", "Total"] } },
      { name: "page_verify", input: { kind: "list", role: "list", name: "Order summary", items: ["Refund"] } },
      { name: "page_generate_locator", input: { ref: "@Apply" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(
      panelPage,
      "Run page_verify for all four kinds, then generate a locator for Apply.",
      11,
    );

    // text_visible
    expect(results[1].isError).toBe(false);
    expect(results[1].text).toMatch(/^PASS text "Discount: -\$4\.20" is visible\.$/);
    expect(results[2]).toEqual({
      tool: "page_verify",
      text: 'FAIL expected text "Enter a code" to be visible; found no matching text.',
      isError: false,
    });

    // value
    expect(results[4].isError).toBe(false);
    expect(results[4].text).toMatch(/^PASS \[\d+\] textbox "Coupon" has value "SAVE10"\.$/);
    expect(results[5]).toEqual({ tool: "page_verify", text: 'page_verify kind "value" needs value.', isError: true });

    // element_visible
    expect(results[6].isError).toBe(false);
    expect(results[6].text).toMatch(/^PASS button "Apply" is visible\.$/);
    expect(results[7]).toEqual({
      tool: "page_verify",
      text: 'FAIL expected button "Clear saved cards" to be visible; found 1 matching, none visible.',
      isError: false,
    });

    // list
    expect(results[8].isError).toBe(false);
    expect(results[8].text).toMatch(/^PASS list "Order summary" shows all 2 items\.$/);
    expect(results[9]).toEqual({
      tool: "page_verify",
      text: 'FAIL expected list "Order summary" to show "Refund"; not found.',
      isError: false,
    });

    // R12
    expect(results[10].tool).toBe("page_generate_locator");
    expect(results[10].isError).toBe(false);
    expect(results[10].text).toMatch(/^\[\d+\] button "Apply"\n {2}role\+name: button "Apply" \(matches 1\)\n/);
    expect(results[10].text).toContain("\n  css: #apply-btn\n");
    expect(results[10].text).toContain("\n  xpath: //*[@id='apply-btn']");

    await context.close();
  });

  test("R13 a removed ref returns the stale-ref error from all eight ref tools", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results1 = await runPlan(panelPage, "Start debugging and snapshot.", 2);

    const emailMatch = /"Email"[^\n]*\[ref=(\d+)\]/.exec(results1[1].text);
    expect(emailMatch).not.toBeNull();
    const emailRef = emailMatch![1];

    // A ref is a Chrome node id, valid for as long as its element is on the
    // page — remove the element entirely so describe() sees isConnected === false.
    await sitePage.evaluate(() => document.getElementById("email")?.remove());
    const staleText = `Ref ${emailRef} is no longer on the page. Take a new snapshot.`;

    const staleCalls: PlannedCall[] = [
      { name: "page_click", input: { ref: emailRef } },
      { name: "page_hover", input: { ref: emailRef } },
      { name: "page_fill_form", input: { fields: [{ ref: emailRef, value: "x" }] } },
      { name: "page_select_option", input: { ref: emailRef, values: ["x"] } },
      { name: "page_upload_file", input: { ref: emailRef, files: [{ name: "a.txt", mimeType: "text/plain", text: "a" }] } },
      { name: "page_screenshot", input: { ref: emailRef } },
      { name: "page_verify", input: { kind: "value", ref: emailRef, value: "x" } },
      { name: "page_generate_locator", input: { ref: emailRef } },
    ];
    const results2 = await appendPlan(panelPage, staleCalls, "Try all eight ref tools on the removed field.", 10);

    for (let i = 0; i < staleCalls.length; i++) {
      expect(results2[2 + i]).toEqual({ tool: staleCalls[i].name, text: staleText, isError: true });
    }

    await context.close();
  });

  test("R14 every ref tool works with the fixture origin absent from enabledOrigins", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const stored = await worker.evaluate(() => chrome.storage.local.get("enabledOrigins"));
    expect(stored.enabledOrigins ?? []).not.toContain(ORIGIN);

    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Apply" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(
      panelPage,
      "Start debugging, snapshot, then click Apply — the origin is never enabled.",
      3,
    );

    expect(results[0].isError).toBe(false);
    expect(results[2].isError).toBe(false);
    expect(results[2].text).toContain("Clicked");

    await context.close();
  });

  // R15 — "a tab opened before the extension loaded". Playwright's persistent
  // context packages this extension into the browser at launch, so there is no
  // way in this harness to literally open a tab before the extension exists.
  // The closest verifiable proxy: open the site tab before this test touches
  // the extension's service worker or side panel at all, so nothing here could
  // have primed a content script on it, then prove the ref tools still work —
  // they never depend on the content script or on enabledOrigins, which is
  // idea 131's point.
  test("R15 a tab opened before this test touched the panel or worker still answers every ref tool", async ({
    context,
    extensionId,
  }) => {
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);

    const worker = await getWorker(context);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    // No content-script marker: the extension never activated on this tab.
    expect(await sitePage.evaluate(() => document.querySelector("web-agent-bubble"))).toBeNull();

    const plan: PlannedCall[] = [
      { name: "start_debugging", input: {} },
      { name: "page_snapshot", input: {} },
      { name: "page_click", input: { ref: "@Apply" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Start debugging, snapshot, then click Apply.", 3);

    expect(results[0].isError).toBe(false);
    expect(results[2].isError).toBe(false);
    expect(results[2].text).toContain("Clicked");

    await context.close();
  });

  test("R16 without start_debugging, each ref tool returns the not-started gate text", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    const sitePage = await context.newPage();
    await sitePage.goto(CHECKOUT_URL);
    const tabId = await getTabId(worker, CHECKOUT_URL);

    const plan: PlannedCall[] = [
      { name: "page_click", input: { ref: "1" } },
      { name: "page_hover", input: { ref: "1" } },
      { name: "page_fill_form", input: { fields: [{ ref: "1", value: "x" }] } },
      { name: "page_select_option", input: { ref: "1", values: ["x"] } },
      { name: "page_upload_file", input: { ref: "1", files: [{ name: "a.txt", mimeType: "text/plain", text: "a" }] } },
      { name: "page_screenshot", input: { ref: "1" } },
      { name: "page_verify", input: { kind: "value", ref: "1", value: "x" } },
      { name: "page_generate_locator", input: { ref: "1" } },
    ];
    const panelPage = await openPanel(context, extensionId, tabId, plan);
    const results = await runPlan(panelPage, "Try all eight ref tools before starting debugging.", 8);

    const gateText = `Debugging is not started on tab #${tabId}. Call start_debugging first.`;
    for (let i = 0; i < plan.length; i++) {
      expect(results[i]).toEqual({ tool: plan[i].name, text: gateText, isError: true });
    }

    await context.close();
  });
});
