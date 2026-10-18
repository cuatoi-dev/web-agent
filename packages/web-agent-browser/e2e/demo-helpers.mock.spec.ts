import { test, expect, ask, expectOrder, normalizeBrandReply, type AuditCall } from "./demo-helpers";

const calls = (...names: string[]): AuditCall[] =>
  names.map((name) => ({ name, input: {}, outcomeSummary: "" }));

test("expectOrder matches repeated calls after the preceding match", () => {
  expectOrder(calls("page_eval", "start_debugging", "page_eval"), [
    "page_eval",
    "start_debugging",
    "page_eval",
  ]);
});

test("expectOrder reports a missing later occurrence", () => {
  expect(() =>
    expectOrder(calls("page_eval", "start_debugging"), [
      "page_eval",
      "start_debugging",
      "page_eval",
    ]),
  ).toThrow(/expected page_eval in trace/);
});

test("expectOrder ignores unrelated calls between distinct names, and rejects a swap", () => {
  expectOrder(
    calls("read_tabs", "page_snapshot", "start_debugging", "page_eval"),
    ["read_tabs", "start_debugging", "page_eval"],
  );
  expect(() =>
    expectOrder(calls("read_tabs", "page_eval", "start_debugging"), [
      "read_tabs",
      "start_debugging",
      "page_eval",
    ]),
  ).toThrow(/expected page_eval in trace/);
});

const PANEL_STAND_IN = (userText: string) => `<!doctype html><script>
customElements.define("agent-chat-panel", class extends HTMLElement {
  messages = [];
  error = null;
  running = false;
  async send(text) {
    this.messages = [
      { role: "user", text: ${JSON.stringify(userText)}.replace("__PROMPT__", text) },
      { role: "assistant", text: "done", trace: [{ name: "page_verify", input: { kind: "text_visible", text: "ok" }, outcomeSummary: "ok" }] },
    ];
    return { ran: "message" };
  }
});
</script><agent-chat-panel></agent-chat-panel>`;

test("ask finds a prompt that is the whole user message", async ({ page }) => {
  await page.setContent(PANEL_STAND_IN("__PROMPT__"));
  const { trace, reply } = await ask(page, "Export it");
  expect(trace.map((t) => t.name)).toEqual(["page_verify"]);
  expect(reply).toBe("done");
});

test("ask finds a prompt that an attachment put text before", async ({ page }) => {
  await page.setContent(PANEL_STAND_IN("# Recorded steps on http://localhost:10040/checkout.html\n1. fill #coupon\n__PROMPT__"));
  const { trace } = await ask(page, "Export it");
  expect(trace.map((t) => t.name)).toEqual(["page_verify"]);
});

const STALLED_PANEL_STAND_IN = `<!doctype html><script>
customElements.define("agent-chat-panel", class extends HTMLElement {
  messages = [
    { role: "user", text: "An earlier turn" },
    { role: "assistant", text: "earlier", trace: [{ name: "stale_tool", input: {}, outcomeSummary: "ok" }] },
    { role: "user", text: "# Recorded steps on http://localhost:10040/checkout.html\\nExport it" },
    { role: "assistant", text: "", trace: [{ name: "page_verify", input: { kind: "text_visible", text: "ok" }, outcomeSummary: "ok" }] },
  ];
  error = null;
  running = true;
  async send() {
    await new Promise(() => {});
  }
});
</script><agent-chat-panel></agent-chat-panel>`;

test("a timed-out turn reports only its own tool trace", async ({ page }) => {
  await page.setContent(STALLED_PANEL_STAND_IN);
  let failure = "";
  try {
    await ask(page, "Export it", { timeoutMs: 500 });
  } catch (err: unknown) {
    failure = err instanceof Error ? err.message : String(err);
  }
  expect(failure).toContain("turn timed out after 500ms");
  expect(failure).toContain("page_verify");
  expect(failure).not.toContain("stale_tool");
});

test("first demo profile writes a storage marker", async ({ demoExtension }) => {
  const worker = demoExtension.context.serviceWorkers()[0];
  await worker.evaluate(() => chrome.storage.local.set({ demoProfileMarker: "first", savedSkills: [{ name: "marker" }] }));
  expect(await worker.evaluate(() => chrome.storage.local.get("demoProfileMarker"))).toEqual({ demoProfileMarker: "first" });
});

test("next demo profile has no storage marker", async ({ demoExtension }) => {
  const worker = demoExtension.context.serviceWorkers()[0];
  expect(await worker.evaluate(() => chrome.storage.local.get(["demoProfileMarker", "savedSkills"]))).toEqual({});
});

test("normalizeBrandReply trims punctuation and whitespace and normalizes case", () => {
  const cases = [
    { input: "BRAND002", expected: "BRAND002" },
    { input: "BRAND002.", expected: "BRAND002" },
    { input: "brand002!", expected: "BRAND002" },
    { input: " BRAND002 ", expected: "BRAND002" },
  ];
  for (const { input, expected } of cases) {
    expect(normalizeBrandReply(input)).toBe(expected);
  }
  expect(normalizeBrandReply("BRAND003")).toBe("BRAND003");
  expect(normalizeBrandReply("BRAND003")).not.toBe("BRAND002");
});

