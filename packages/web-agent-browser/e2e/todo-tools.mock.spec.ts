import { test, expect } from "./extension.fixture";

const SITE = "http://localhost:10040/plain.html";

// The tools each agent had before the todo tools were added. None of them may be
// lost by turning todo on.
const PANEL_TOOLS_BEFORE = [
  "read_tabs",
  "open_tab",
  "navigate_tab",
  "refresh_tab",
  "close_tab",
  "send_to_page_agent",
  "toggle_page_agent",
  "read_page_agent",
];
const PAGE_TOOLS_BEFORE = [
  "snapshot_page",
  "query_state",
  "click",
  "fill",
  "select_option",
  "wait_for",
  "see",
  "page_fetch",
  "page_eval",
];

test.describe("Todo tools on the extension agents", () => {
  test.beforeEach(async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
  });

  test("the side panel agent is offered todo_write and todo_read and keeps its own tools", async ({
    context,
    extensionId,
  }) => {
    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => {
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Todos" };
        }
        window.__WA_TOOLS__ = (opts.tools ?? []).map((t) => t.name);
        return { text: "ok" };
      };
    });
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("hi");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
    const tools = await panelPage.evaluate(() => window.__WA_TOOLS__);

    expect(tools).toContain("todo_write");
    expect(tools).toContain("todo_read");
    expect(tools).toEqual(expect.arrayContaining(PANEL_TOOLS_BEFORE));
    // The scheduler is on by default in the side panel.
    expect(tools).toEqual(expect.arrayContaining(["set_schedule", "list_schedules", "cancel_schedule"]));
  });

  test("the in-page agent is offered todo_write and todo_read and keeps its own tools", async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Todos" };
        }
        window.__WA_TOOLS__ = (opts.tools ?? []).map((t) => t.name);
        return { text: "ok" };
      };
    });
    await page.goto(SITE);

    await page.locator("web-agent-bubble #launcher").click();
    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("hi");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
    const tools = await page.evaluate(() => window.__WA_TOOLS__);

    expect(tools).toContain("todo_write");
    expect(tools).toContain("todo_read");
    expect(tools).toEqual(expect.arrayContaining(PAGE_TOOLS_BEFORE));
    expect(tools).toEqual(expect.arrayContaining(["set_schedule", "list_schedules", "cancel_schedule"]));
  });

  test("empty list shows no indicator; todo_write populates it; todo_read returns ids and statuses; a patch changes one item", async ({
    context,
    extensionId,
  }) => {
    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => {
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      let step = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Todos" };
        }
        // Harvest every tool result seen so far, keyed by the call id this
        // script itself chose. Runs before the step counter advances, so the
        // last call still sees all three.
        for (const m of opts.messages) {
          if (!Array.isArray(m.content)) continue;
          for (const p of m.content) {
            if (p.type !== "tool-result") continue;
            const text = outputText(p.output);
            if (p.toolCallId === "tc_write") window.__WA_TODO_WRITE_RESULT__ = text;
            if (p.toolCallId === "tc_read") window.__WA_TODO_READ_RESULT__ = text;
            if (p.toolCallId === "tc_patch") window.__WA_TODO_PATCH_RESULT__ = text;
          }
        }
        step++;
        if (step === 1) {
          return {
            toolCalls: [{
              id: "tc_write",
              name: "todo_write",
              input: {
                items: [
                  { text: "Open the orders tab" },
                  { text: "Read the pending count" },
                  { text: "Report the total" },
                ],
              },
            }],
          };
        }
        if (step === 2) {
          return { toolCalls: [{ id: "tc_read", name: "todo_read", input: {} }] };
        }
        if (step === 3) {
          return {
            toolCalls: [{
              id: "tc_patch",
              name: "todo_write",
              input: { updates: [{ id: "t2", status: "done" }] },
            }],
          };
        }
        return { text: "ok" };
      };
    });
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // With an empty list the indicator is absent from the DOM,
    // not present and dimmed.
    await expect(panelPage.locator("agent-chat-panel #input")).toBeVisible();
    await expect(panelPage.locator("agent-todo-indicator")).toHaveCount(0);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("plan three steps");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(
      () => window.__WA_TODO_PATCH_RESULT__ !== undefined,
      { timeout: 30_000 },
    );

    // The indicator appears, with the badge counting what is left: three items,
    // one flipped to done, so two remain.
    const indicator = panelPage.locator("agent-todo-indicator");
    await expect(indicator).toHaveCount(1);
    await expect(indicator.locator(".todo-badge")).toHaveText("2");

    // todo_read returns every item with its id and status. The
    // render is core's own (packages/web-agent-core/src/todo.ts:50-57):
    // `1. [ ] text  (id: t1)`.
    const readOut = await panelPage.evaluate(() => window.__WA_TODO_READ_RESULT__ ?? "");
    expect(readOut).toContain("(id: t1)");
    expect(readOut).toContain("(id: t2)");
    expect(readOut).toContain("(id: t3)");
    expect(readOut).toContain("1. [ ] Open the orders tab");
    expect(readOut).toContain("2. [ ] Read the pending count");
    expect(readOut).toContain("3. [ ] Report the total");

    // The patch changes only t2. Items 1 and 3 are byte-identical
    // to what todo_read reported before the patch.
    const patchOut = await panelPage.evaluate(() => window.__WA_TODO_PATCH_RESULT__ ?? "");
    expect(patchOut).toContain("1. [ ] Open the orders tab");
    expect(patchOut).toContain("2. [x] Read the pending count");
    expect(patchOut).toContain("3. [ ] Report the total");
  });

  test("adding a todo does not change the message list height or scroll position", async ({
    context,
    extensionId,
  }) => {
    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => {
      let step = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Todos" };
        }
        step++;
        // Turn 1 answers with prose only. Turn 2 writes the plan and answers
        // with the same prose, so the message list gains identical content in
        // both turns and the ONLY difference is the todo list.
        if (step === 2) {
          return {
            toolCalls: [{
              id: "tc_write2",
              name: "todo_write",
              input: { items: [{ text: "One step" }, { text: "Another step" }] },
            }],
          };
        }
        return { text: "ok" };
      };
    });
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    const listBox = async () =>
      await panelPage.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel");
        const list = panel?.querySelector(".messages-list") as HTMLElement | null;
        if (!list) return null;
        return {
          clientHeight: list.clientHeight,
          scrollTop: list.scrollTop,
        };
      });

    await inputArea.click();
    await panelPage.keyboard.type("first");
    await panelPage.keyboard.press("Enter");
    await expect(panelPage.locator("agent-chat-panel agent-message-view")).toHaveCount(2);
    await panelPage.waitForTimeout(500);
    const before = await listBox();
    expect(before).not.toBeNull();

    await inputArea.click();
    await panelPage.keyboard.type("second");
    await panelPage.keyboard.press("Enter");
    await expect(panelPage.locator("agent-todo-indicator")).toHaveCount(1);
    await panelPage.waitForTimeout(500);
    const after = await listBox();

    // The indicator lives in the composer control row, not above the
    // conversation, so the list's own box is untouched.
    expect(after?.clientHeight).toBe(before?.clientHeight);
    expect(after?.scrollTop).toBe(before?.scrollTop);
  });
});
