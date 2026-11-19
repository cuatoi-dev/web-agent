import { test, expect, getTabId } from "./extension.fixture";

test.describe("Side panel page agent tools mock e2e", () => {
  test("toggle_page_agent turns bubble ON and send_to_page_agent delivers message", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    // Clear enabledOrigins
    await worker.evaluate(() => chrome.storage.local.clear());

    const sitePage = await context.newPage();
    await sitePage.addInitScript(() => {
      window.__WA_MOCK_SCRIPT__ = () => ({ text: "Bubble assistant mock reply." });
    });
    await sitePage.goto("http://localhost:10040/plain.html");
    const siteTabId = await getTabId(worker, "http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((targetTabId: number) => {
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
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Page Agent" };
        }
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [
              { id: "tc_toggle", name: "toggle_page_agent", input: { tabId: targetTabId } },
            ],
          };
        }
        if (turn === 2) {
          let toggleResult = "";
          if (Array.isArray(lastMsg?.content)) {
            const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "toggle_page_agent");
            if (part && part.type === "tool-result") toggleResult = outputText(part.output);
          }
          window.__TOGGLE_RESULT__ = toggleResult;
          return {
            toolCalls: [
              { id: "tc_send", name: "send_to_page_agent", input: { tabId: targetTabId, text: "Hello from the side panel" } },
            ],
          };
        }
        if (turn === 3) {
          let sendResult = "";
          if (Array.isArray(lastMsg?.content)) {
            const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "send_to_page_agent");
            if (part && part.type === "tool-result") sendResult = outputText(part.output);
          }
          window.__SEND_RESULT__ = sendResult;
          return { text: "Delivered." };
        }
        return { text: "Done." };
      };
    }, siteTabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Turn on agent and send hello");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__TOGGLE_RESULT__ !== undefined, { timeout: 15_000 });
    const toggleResult = await panelPage.evaluate(() => window.__TOGGLE_RESULT__);
    expect(toggleResult).toContain("is now ON");

    // Check storage
    const storageData = await worker.evaluate(() => chrome.storage.local.get("enabledOrigins"));
    expect(storageData.enabledOrigins).toContain("http://localhost:10040");

    // Check site page bubble launcher
    await expect(sitePage.locator("web-agent-bubble")).toBeAttached();

    await panelPage.waitForFunction(() => window.__SEND_RESULT__ !== undefined, { timeout: 15_000 });
    const sendResult = await panelPage.evaluate(() => window.__SEND_RESULT__);
    expect(sendResult).toContain("Sent to the web agent");

    // Check bubble panel is open (display: flex) and message exists
    await sitePage.waitForFunction(() => {
      const bubble = document.querySelector("web-agent-bubble");
      if (!bubble?.shadowRoot) return false;
      const container = bubble.shadowRoot.querySelector("#panel-container") as HTMLElement;
      const panel = bubble.shadowRoot.querySelector("agent-chat-panel");
      if (!container || container.style.display !== "flex" || !panel) return false;
      function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
      }
      // `AgentChatPanel.messages` is declared `SessionMessage[]`
      // (chat-panel-state.ts) and already falls back to its own internal
      // state, so the protected `_state` read this line used to add is both
      // redundant and inaccessible from outside the class once properly typed.
      const msgs: unknown[] = panel.messages ?? [];
      return msgs.some((raw) => {
        const m = isRecord(raw) ? raw : {};
        const c = m.text ?? (typeof m.content === "string" ? m.content : JSON.stringify(m.parts ?? m.content ?? ""));
        return m.role === "user" && typeof c === "string" && c.includes("Hello from the side panel");
      });
    }, { timeout: 15_000 });
  });

  test("send_to_page_agent re-opens a bubble the user opened and then closed", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.clear());

    const sitePage = await context.newPage();
    await sitePage.addInitScript(() => {
      window.__WA_MOCK_SCRIPT__ = () => ({ text: "Bubble assistant mock reply." });
    });
    await sitePage.goto("http://localhost:10040/plain.html");
    const siteTabId = await getTabId(worker, "http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((targetTabId: number) => {
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Reopen" };
        }
        turn++;
        // Turn 1 mounts the bubble. The spec then opens and closes it by
        // hand, so turn 3's send is the case the old guard got wrong.
        if (turn === 1) {
          return {
            toolCalls: [
              { id: "tc_toggle_reopen", name: "toggle_page_agent", input: { tabId: targetTabId } },
            ],
          };
        }
        if (turn === 2) return { text: "Agent is on." };
        if (turn === 3) {
          return {
            toolCalls: [
              { id: "tc_send_reopen", name: "send_to_page_agent", input: { tabId: targetTabId, text: "Hello after close" } },
            ],
          };
        }
        if (turn === 4) {
          let sendResult = "";
          let isError = false;
          if (Array.isArray(lastMsg?.content)) {
            const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "send_to_page_agent");
            if (part && part.type === "tool-result") {
              sendResult = outputText(part.output);
              isError = !!part.isError;
            }
          }
          window.__SEND_AFTER_CLOSE_RESULT__ = { sendResult, isError };
          return { text: "Delivered." };
        }
        return { text: "Done." };
      };
    }, siteTabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Turn on the agent in that tab");
    await panelPage.keyboard.press("Enter");

    await expect(sitePage.locator("web-agent-bubble")).toBeAttached();

    // Open the bubble through its own launcher, then close it again. The
    // shadow root is open (web-agent-embed.ts), so Playwright's CSS engine
    // pierces it.
    const launcher = sitePage.locator("web-agent-bubble #launcher");
    const containerDisplay = () =>
      sitePage.evaluate(() => {
        const b = document.querySelector("web-agent-bubble");
        const c = b?.shadowRoot?.querySelector("#panel-container") as HTMLElement | null;
        return c?.style.display ?? "";
      });

    await launcher.click();
    await expect.poll(containerDisplay).toBe("flex");
    await launcher.click();
    await expect.poll(containerDisplay).toBe("none");

    // The bug: from here, every send landed in a panel nobody could see.
    await inputArea.click();
    await panelPage.keyboard.type("Send hello to the page agent");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__SEND_AFTER_CLOSE_RESULT__ !== undefined, { timeout: 15_000 });
    const result = await panelPage.evaluate(() => window.__SEND_AFTER_CLOSE_RESULT__);
    if (!result) throw new Error("expected __SEND_AFTER_CLOSE_RESULT__");
    // `delivered: false` would have produced "did not accept the message"
    // instead (page-agent-tools.ts).
    expect(result.sendResult).toContain("Sent to the web agent");
    expect(result.isError).toBe(false);

    // The panel is visible again, and carries the message.
    await expect.poll(containerDisplay).toBe("flex");
    await sitePage.waitForFunction(() => {
      const bubble = document.querySelector("web-agent-bubble");
      const panel = bubble?.shadowRoot?.querySelector("agent-chat-panel");
      if (!panel) return false;
      function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
      }
      const msgs: unknown[] = panel.messages ?? [];
      return msgs.some((raw) => {
        const m = isRecord(raw) ? raw : {};
        const c = m.text ?? (typeof m.content === "string" ? m.content : JSON.stringify(m.parts ?? m.content ?? ""));
        return m.role === "user" && typeof c === "string" && c.includes("Hello after close");
      });
    }, { timeout: 15_000 });
  });

  test("send_to_page_agent against a tab where the bubble is off reports error naming toggle_page_agent", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.clear());

    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");
    const siteTabId = await getTabId(worker, "http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((targetTabId: number) => {
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
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Send Off" };
        }
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [
              { id: "tc_send", name: "send_to_page_agent", input: { tabId: targetTabId, text: "Hello when off" } },
            ],
          };
        }
        let sendResult = "";
        let isError = false;
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "send_to_page_agent");
          if (part && part.type === "tool-result") {
            sendResult = outputText(part.output);
            isError = !!part.isError;
          }
        }
        window.__SEND_OFF_RESULT__ = { sendResult, isError };
        return { text: "Done." };
      };
    }, siteTabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Send hello to off tab");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__SEND_OFF_RESULT__ !== undefined, { timeout: 15_000 });
    const sendOffResult = await panelPage.evaluate(() => window.__SEND_OFF_RESULT__);
    if (!sendOffResult) throw new Error("expected __SEND_OFF_RESULT__");
    const { sendResult, isError } = sendOffResult;
    expect(sendResult).toContain("toggle_page_agent");
    expect(isError).toBe(true);
    await expect(sitePage.locator("web-agent-bubble")).toHaveCount(0);
  });

  test("toggle_page_agent on nested-agent.html reports page already has its own agent", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.clear());

    const hostPage = await context.newPage();
    await hostPage.goto("http://localhost:10040/nested-agent.html");
    const hostTabId = await getTabId(worker, "http://localhost:10040/nested-agent.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((targetTabId: number) => {
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
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Foreign Agent" };
        }
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [
              { id: "tc_toggle_foreign", name: "toggle_page_agent", input: { tabId: targetTabId } },
            ],
          };
        }
        let toggleResult = "";
        let isError = false;
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "toggle_page_agent");
          if (part && part.type === "tool-result") {
            toggleResult = outputText(part.output);
            isError = !!part.isError;
          }
        }
        window.__FOREIGN_RESULT__ = { toggleResult, isError };
        return { text: "Done." };
      };
    }, hostTabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Toggle on nested page");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__FOREIGN_RESULT__ !== undefined, { timeout: 15_000 });
    const foreignResult = await panelPage.evaluate(() => window.__FOREIGN_RESULT__);
    if (!foreignResult) throw new Error("expected __FOREIGN_RESULT__");
    const { toggleResult, isError } = foreignResult;
    expect(toggleResult).toContain("already has its own agent");
    expect(isError).toBe(true);
    await expect(hostPage.locator("body > web-agent-bubble")).toHaveCount(0);
  });

  test("page-agent tools against extension sidepanel tab returns unreachable error under 10s", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const panelPage = await context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.addInitScript(() => {
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
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Unreachable" };
        }
        turn++;
        if (turn === 1) {
          const targetTabId = window.__TARGET_TAB_ID__;
          return {
            toolCalls: [
              { id: "tc_unreachable", name: "toggle_page_agent", input: { tabId: targetTabId } },
            ],
          };
        }
        let result = "";
        let isError = false;
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "toggle_page_agent");
          if (part && part.type === "tool-result") {
            result = outputText(part.output);
            isError = !!part.isError;
          }
        }
        window.__UNREACHABLE_RESULT__ = { result, isError };
        return { text: "Done." };
      };
    });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const panelTabId = await getTabId(worker, `chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.evaluate((id) => { window.__TARGET_TAB_ID__ = id; }, panelTabId);

    const startTime = Date.now();
    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Toggle self panel tab");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__UNREACHABLE_RESULT__ !== undefined, { timeout: 10_000 });
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(10_000);
    const unreachableResult = await panelPage.evaluate(() => window.__UNREACHABLE_RESULT__);
    if (!unreachableResult) throw new Error("expected __UNREACHABLE_RESULT__");
    const { result, isError } = unreachableResult;
    expect(result).toContain(`Cannot reach tab #${panelTabId}`);
    expect(isError).toBe(true);
  });

  test("toggle_page_agent twice toggles OFF", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.clear());

    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");
    const siteTabId = await getTabId(worker, "http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((targetTabId: number) => {
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
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Toggle Twice" };
        }
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [
              { id: "tc_toggle_1", name: "toggle_page_agent", input: { tabId: targetTabId } },
            ],
          };
        }
        if (turn === 2) {
          return {
            toolCalls: [
              { id: "tc_toggle_2", name: "toggle_page_agent", input: { tabId: targetTabId } },
            ],
          };
        }
        if (turn === 3) {
          let result = "";
          if (Array.isArray(lastMsg?.content)) {
            const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "toggle_page_agent");
            if (part && part.type === "tool-result") result = outputText(part.output);
          }
          window.__SECOND_TOGGLE_RESULT__ = result;
          return { text: "Toggled twice." };
        }
        return { text: "Done." };
      };
    }, siteTabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Toggle twice");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__SECOND_TOGGLE_RESULT__ !== undefined, { timeout: 15_000 });
    const secondResult = await panelPage.evaluate(() => window.__SECOND_TOGGLE_RESULT__);
    expect(secondResult).toContain("is now OFF");
    await expect(sitePage.locator("web-agent-bubble")).toHaveCount(0);

    const storageData = await worker.evaluate(() => chrome.storage.local.get("enabledOrigins"));
    expect(storageData.enabledOrigins || []).not.toContain("http://localhost:10040");
  });

  test("read_page_agent reads back the bubble's conversation after its fixed wait", async ({ context, extensionId }) => {
    // This test really waits out the tool's 30-second fixed sleep — it is the
    // one place other than the unit fake-clock tests and the live proof that
    // exercises the real, unstubbed `sleep`. No condition wait, no polling.
    test.setTimeout(90_000);

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.clear());

    const sitePage = await context.newPage();
    await sitePage.addInitScript(() => {
      window.__WA_MOCK_SCRIPT__ = () => ({ text: "Bubble assistant mock reply." });
    });
    await sitePage.goto("http://localhost:10040/plain.html");
    const siteTabId = await getTabId(worker, "http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((targetTabId: number) => {
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
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Read Loop" };
        }
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [
              { id: "tc_toggle", name: "toggle_page_agent", input: { tabId: targetTabId } },
            ],
          };
        }
        if (turn === 2) {
          return {
            toolCalls: [
              { id: "tc_send", name: "send_to_page_agent", input: { tabId: targetTabId, text: "Read loop hello" } },
            ],
          };
        }
        if (turn === 3) {
          return {
            toolCalls: [
              { id: "tc_read", name: "read_page_agent", input: { tabId: targetTabId, wait: 30 } },
            ],
          };
        }
        if (turn === 4) {
          let readResult = "";
          if (Array.isArray(lastMsg?.content)) {
            const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "read_page_agent");
            if (part && part.type === "tool-result") readResult = outputText(part.output);
          }
          window.__READ_RESULT__ = readResult;
          return { text: "Done." };
        }
        return { text: "Done." };
      };
    }, siteTabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const startTime = Date.now();
    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Toggle, send, then read back");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__READ_RESULT__ !== undefined, { timeout: 80_000 });
    const elapsed = Date.now() - startTime;
    const readResult = await panelPage.evaluate(() => window.__READ_RESULT__);

    // The 30-second fixed wait is real: the whole turn cannot finish before it.
    expect(elapsed).toBeGreaterThanOrEqual(30_000);
    expect(readResult).toContain("[user] Read loop hello");
    expect(readResult).toContain("[assistant]");
    expect(readResult).toContain("Bubble assistant mock reply.");
    expect(readResult).toMatch(/RUNNING|IDLE/);
  });

  test("read_page_agent rejects an invalid wait value without sleeping or reading", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const panelPage = await context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.addInitScript(() => {
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
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Bad Wait" };
        }
        turn++;
        if (turn === 1) {
          const targetTabId = window.__TARGET_TAB_ID__;
          return {
            toolCalls: [
              { id: "tc_bad_wait", name: "read_page_agent", input: { tabId: targetTabId, wait: 60 } },
            ],
          };
        }
        let result = "";
        let isError = false;
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "read_page_agent");
          if (part && part.type === "tool-result") {
            result = outputText(part.output);
            isError = !!part.isError;
          }
        }
        window.__BAD_WAIT_RESULT__ = { result, isError };
        return { text: "Done." };
      };
    });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const panelTabId = await getTabId(worker, `chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.evaluate((id) => { window.__TARGET_TAB_ID__ = id; }, panelTabId);

    const startTime = Date.now();
    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Read with an invalid wait");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__BAD_WAIT_RESULT__ !== undefined, { timeout: 10_000 });
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(10_000);
    const badWaitResult = await panelPage.evaluate(() => window.__BAD_WAIT_RESULT__);
    if (!badWaitResult) throw new Error("expected __BAD_WAIT_RESULT__");
    const { result, isError } = badWaitResult;
    expect(isError).toBe(true);
    expect(result).toContain("30");
    expect(result).toContain("120");
  });

  test("send_to_page_agent reports not delivered after the page removes the bubble", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.clear());

    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/detaching-agent.html");
    const siteTabId = await getTabId(worker, "http://localhost:10040/detaching-agent.html");

    // Mount directly through the bridge, then wait for the fixture's 400 ms
    // observer to remove what was appended — the reproduction for S4, a
    // detached bubble reference.
    await worker.evaluate((tid) => new Promise<void>((resolve) => {
      chrome.tabs.sendMessage(tid, { type: "wa-toggle" }, () => resolve());
    }), siteTabId);
    await expect(sitePage.locator("body > web-agent-bubble")).toHaveCount(0, { timeout: 5000 });

    const panelPage = await context.newPage();
    await panelPage.addInitScript((targetTabId: number) => {
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Detached Send" };
        }
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [
              { id: "tc_send_detached", name: "send_to_page_agent", input: { tabId: targetTabId, text: "hello" } },
            ],
          };
        }
        let sendResult = "";
        let isError = false;
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "send_to_page_agent");
          if (part && part.type === "tool-result") {
            sendResult = outputText(part.output);
            isError = !!part.isError;
          }
        }
        window.__DETACHED_SEND_RESULT__ = { sendResult, isError };
        return { text: "Done." };
      };
    }, siteTabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Send hello to the detached tab");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__DETACHED_SEND_RESULT__ !== undefined, { timeout: 15_000 });
    const detachedSendResult = await panelPage.evaluate(() => window.__DETACHED_SEND_RESULT__);
    if (!detachedSendResult) throw new Error("expected __DETACHED_SEND_RESULT__");
    const { sendResult, isError } = detachedSendResult;
    expect(sendResult).toContain("is not on in tab");
    expect(sendResult).toContain("toggle_page_agent");
    expect(sendResult).not.toContain("Sent to the web agent");
    expect(isError).toBe(true);
  });

  test("the toggle mounts on the first press after the page removed the bubble", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.clear());

    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/detaching-agent.html");
    const siteTabId = await getTabId(worker, "http://localhost:10040/detaching-agent.html");

    // Mount directly through the bridge, then wait for the fixture to detach
    // it, so the toggle below starts from a stale, detached reference —
    // exactly like the reported trace's second press.
    await worker.evaluate((tid) => new Promise<void>((resolve) => {
      chrome.tabs.sendMessage(tid, { type: "wa-toggle" }, () => resolve());
    }), siteTabId);
    await expect(sitePage.locator("body > web-agent-bubble")).toHaveCount(0, { timeout: 5000 });

    const panelPage = await context.newPage();
    await panelPage.addInitScript((targetTabId: number) => {
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      let turn = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Detached Toggle" };
        }
        turn++;
        if (turn === 1) {
          return {
            toolCalls: [
              { id: "tc_toggle_detached", name: "toggle_page_agent", input: { tabId: targetTabId } },
            ],
          };
        }
        let toggleResult = "";
        let isError = false;
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "toggle_page_agent");
          if (part && part.type === "tool-result") {
            toggleResult = outputText(part.output);
            isError = !!part.isError;
          }
        }
        window.__DETACHED_TOGGLE_RESULT__ = { toggleResult, isError };
        return { text: "Done." };
      };
    }, siteTabId);

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Toggle the detached tab");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__DETACHED_TOGGLE_RESULT__ !== undefined, { timeout: 15_000 });
    const detachedToggleResult = await panelPage.evaluate(() => window.__DETACHED_TOGGLE_RESULT__);
    if (!detachedToggleResult) throw new Error("expected __DETACHED_TOGGLE_RESULT__");
    const { toggleResult, isError } = detachedToggleResult;
    expect(toggleResult).toContain("is now ON");
    expect(isError).toBeFalsy();
  });
});
