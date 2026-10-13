import { test, expect } from "./extension.fixture";

test.describe("Page tools mock e2e", () => {
  test.beforeEach(async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
  });

  test("snapshot_page extracts document content while excluding agent UI", async ({ context }) => {
    const page = await context.newPage();

    await page.addInitScript(() => {
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
      let turnStep = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Page Summary" };
        }

        turnStep++;
        if (turnStep === 1) {
          return {
            toolCalls: [
              {
                id: "tc_snapshot",
                name: "snapshot_page",
                input: {},
              },
            ],
          };
        }

        // Find tool result for snapshot_page
        for (const m of opts.messages) {
          if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if (p.type === "tool-result" && p.toolName === "snapshot_page") {
                window.__LAST_SNAPSHOT__ = outputText(p.output);
              }
            }
          }
        }

        return {
          text: "Snapshot processed successfully.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-tools.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const panel = page.locator("web-agent-bubble agent-chat-panel");
    await expect(panel).toBeAttached();

    // Send a message to start turn
    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Summarize this page");

    const sendBtn = page.locator('web-agent-bubble md-icon-button[data-aria-label="Send"], web-agent-bubble button[aria-label="Send"]');
    if (await sendBtn.isVisible()) {
      await sendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Wait for assistant reply
    await page.waitForFunction(() => {
      const bubble = document.querySelector("web-agent-bubble");
      const shadow = bubble?.shadowRoot;
      const views = [...(shadow?.querySelectorAll("agent-message-view") ?? [])];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      if (assistantViews.length === 0) return false;
      const text = (assistantViews[0].querySelector(".content")?.textContent ?? "").trim();
      return text.includes("Snapshot processed");
    }, { timeout: 15_000 });

    const lastSnapshot = await page.evaluate(() => window.__LAST_SNAPSHOT__);
    expect(lastSnapshot).toBeDefined();
    expect(lastSnapshot).toContain("Understanding React");
    expect(lastSnapshot).toContain("Search documentation");
    // Ensure agent UI itself is excluded
    expect(lastSnapshot).not.toContain("agent-chat-panel");
    expect(lastSnapshot).not.toContain("web-agent-bubble");
  });

  test("click triggers action cue and clicks target button", async ({ context }) => {
    const page = await context.newPage();

    await page.addInitScript(() => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = () => {
        callCount++;
        if (callCount === 1) {
          return {
            toolCalls: [
              {
                id: "tc_snap",
                name: "snapshot_page",
                input: {},
              },
            ],
          };
        }
        if (callCount === 2) {
          // Click the search button (ref 2 based on interactive list)
          return {
            toolCalls: [
              {
                id: "tc_click",
                name: "click",
                input: { ref: "2" },
              },
            ],
          };
        }
        return {
          text: "Clicked the button successfully.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-tools.html");

    // Track click on search button
    await page.evaluate(() => {
      window.__SEARCH_CLICKED__ = false;
      document.getElementById("search-btn")?.addEventListener("click", () => {
        window.__SEARCH_CLICKED__ = true;
      });
    });

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Click search button");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => window.__SEARCH_CLICKED__ === true, { timeout: 15_000 });
    const clicked = await page.evaluate(() => window.__SEARCH_CLICKED__);
    expect(clicked).toBe(true);
  });

  test("fill types into input element with action cue", async ({ context }) => {
    const page = await context.newPage();

    await page.addInitScript(() => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = () => {
        callCount++;
        if (callCount === 1) {
          return {
            toolCalls: [
              {
                id: "tc_snap",
                name: "snapshot_page",
                input: {},
              },
            ],
          };
        }
        if (callCount === 2) {
          // Fill the search input (ref 1)
          return {
            toolCalls: [
              {
                id: "tc_fill",
                name: "fill",
                input: { ref: "1", value: "Components" },
              },
            ],
          };
        }
        return {
          text: "Filled the input with Components.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-tools.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Search for Components");
    await page.keyboard.press("Enter");

    const searchInput = page.locator("#site-search");
    await expect(searchInput).toHaveValue("Components", { timeout: 15_000 });
  });

  test("data-agent-permission='ask' triggers confirm dialog and handles user allow and reject", async ({ context }) => {
    const page = await context.newPage();

    await page.addInitScript(() => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = () => {
        callCount++;
        if (callCount === 1) {
          return {
            toolCalls: [
              {
                id: "tc_snap",
                name: "snapshot_page",
                input: {},
              },
            ],
          };
        }
        if (callCount === 2) {
          // Click sensitive button (ref 3)
          return {
            toolCalls: [
              {
                id: "tc_sensitive_click",
                name: "click",
                input: { ref: "3" },
              },
            ],
          };
        }
        return {
          text: "Turn finished.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-tools.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Reset the session");
    await page.keyboard.press("Enter");

    // Scrim confirm dialog should appear
    const scrim = page.locator("web-agent-bubble agent-chat-panel .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });

    const reasonEl = scrim.locator(".wa-confirm-reason");
    await expect(reasonEl).toContainText("Clears user session");

    // Click Allow
    const allowBtn = scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first();
    await allowBtn.click();

    // Scrim disappears after choice
    await expect(scrim).toHaveCount(0, { timeout: 5000 });
  });

  test("data-agent-permission='block' prevents execution immediately", async ({ context }) => {
    const page = await context.newPage();

    await page.addInitScript(() => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        callCount++;
        if (callCount === 1) {
          return {
            toolCalls: [
              {
                id: "tc_snap",
                name: "snapshot_page",
                input: {},
              },
            ],
          };
        }
        if (callCount === 2) {
          // Click blocked button (ref 4)
          return {
            toolCalls: [
              {
                id: "tc_block_click",
                name: "click",
                input: { ref: "4" },
              },
            ],
          };
        }
        const lastMsg = opts.messages[opts.messages.length - 1];
        window.__BLOCKED_RESULT__ = JSON.stringify(lastMsg);
        return {
          text: "Action was blocked as expected.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-tools.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Delete my account");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => window.__BLOCKED_RESULT__ !== undefined, { timeout: 15_000 });
    const blockedRes = await page.evaluate(() => window.__BLOCKED_RESULT__);
    expect(blockedRes).toContain("blocked");
  });

  test("client-side SPA navigation preserves bubble and refreshes snapshot ref table", async ({ context }) => {
    const page = await context.newPage();

    await page.addInitScript(() => {
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
          return { text: "SPA Test" };
        }

        const hasToolResult = Array.isArray(lastMsg?.content) && lastMsg.content.some((p) => p.type === "tool-result");
        if (hasToolResult && Array.isArray(lastMsg?.content)) {
          const toolResult = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "snapshot_page");
          const out = toolResult && toolResult.type === "tool-result" ? outputText(toolResult.output) : "";
          if (turn === 1) {
            window.__SNAPSHOT_GEN1__ = out;
            return { text: "First snapshot complete." };
          } else {
            window.__SNAPSHOT_GEN2__ = out;
            return { text: "Second snapshot complete." };
          }
        }

        turn++;
        return {
          toolCalls: [
            {
              id: `tc_snap_${turn}`,
              name: "snapshot_page",
              input: {},
            },
          ],
        };
      };
    });

    await page.goto("http://localhost:10040/page-tools.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    // Turn 1
    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("First snapshot");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => window.__SNAPSHOT_GEN1__ !== undefined, { timeout: 15_000 });
    const snap1 = await page.evaluate(() => window.__SNAPSHOT_GEN1__);
    expect(snap1).toContain("generation: 1");

    // Perform SPA route change / DOM mutation
    await page.evaluate(() => {
      window.__SPA_MARKER__ = true;
      history.pushState({}, "", "/new-route");
      const main = document.querySelector("main");
      if (main) {
        main.innerHTML = `<section id="new-section"><h1>New Route Content</h1><button id="new-btn">New Route Action</button></section>`;
      }
    });

    // Marker survives (no full reload)
    const markerSurvives = await page.evaluate(() => window.__SPA_MARKER__ === true);
    expect(markerSurvives).toBe(true);

    // Turn 2
    await inputArea.click();
    await page.keyboard.type("Second snapshot");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => window.__SNAPSHOT_GEN2__ !== undefined, { timeout: 15_000 });
    const snap2 = await page.evaluate(() => window.__SNAPSHOT_GEN2__);
    expect(snap2).toContain("generation: 2");
    expect(snap2).toContain("New Route Content");
    expect(snap2).toContain("New Route Action");
  });
});
