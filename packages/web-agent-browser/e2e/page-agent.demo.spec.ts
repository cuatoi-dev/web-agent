import { test, expect, ask, expectCall, expectOrder } from "./demo-helpers";

async function openSidePanel(demoExtension: { context: import("@playwright/test").BrowserContext; extensionId: string; model: string }) {
  const panel = await demoExtension.context.newPage();
  await panel.setViewportSize({ width: 400, height: 700 });
  await panel.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
  await expect(panel.locator("#chat agent-chat-panel")).toBeAttached();
  return panel;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

test.describe("Page agent — live proof", () => {
  test("page agent: turn on and send", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const site = await demoExtension.context.newPage();
    await site.goto("http://localhost:10040/plain.html");
    const panel = await openSidePanel(demoExtension);

    const { trace } = await ask(
      panel,
      "Turn on the page agent on the plain tab and send it: say hello",
      { model: demoExtension.model },
    );

    expectOrder(trace, ["toggle_page_agent", "send_to_page_agent"]);
    expectCall(trace, "send_to_page_agent", (i) => /hello/i.test(isRecord(i) && typeof i.text === "string" ? i.text : ""));

    await panel.close();
    await site.close();
  });

  test("page agent: first read waits 30 s", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const site = await demoExtension.context.newPage();
    await site.goto("http://localhost:10040/plain.html");
    const panel = await openSidePanel(demoExtension);

    const { trace } = await ask(
      panel,
      "Ask the page agent for a two-line poem and read its answer",
      { model: demoExtension.model },
    );

    const reads = trace.filter((t) => t.name === "read_page_agent");
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0].input && isRecord(reads[0].input) ? reads[0].input.wait : undefined).toBe(30);

    await panel.close();
    await site.close();
  });

  test("page agent: compact and new session", async ({ demoExtension }) => {
    test.setTimeout(150_000);
    const site = await demoExtension.context.newPage();
    await site.goto("http://localhost:10040/plain.html");
    const panel = await openSidePanel(demoExtension);

    const { trace } = await ask(
      panel,
      "Compact that page agent's conversation, then start it fresh",
      { model: demoExtension.model },
    );

    expectCall(trace, "send_to_page_agent", (i) => (isRecord(i) && typeof i.text === "string" ? i.text : "").trim().startsWith("/compact"));
    expectCall(trace, "send_to_page_agent", (i) => /^\/(new|clear)/.test((isRecord(i) && typeof i.text === "string" ? i.text : "").trim()));

    await panel.close();
    await site.close();
  });
});
