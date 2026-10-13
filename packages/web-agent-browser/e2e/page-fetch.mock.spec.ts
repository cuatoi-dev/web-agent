import { test, expect } from "./extension.fixture";

test.describe("Page fetch tool mock e2e", () => {
  test.beforeEach(async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
  });

  test("GET same-origin returns 200 and parsed inventory data", async ({ context }) => {
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
          return { text: "Inventory Query" };
        }

        turnStep++;
        if (turnStep === 1) {
          return {
            toolCalls: [
              {
                id: "tc_fetch_1",
                name: "page_fetch",
                input: { url: "/api/inventory" },
              },
            ],
          };
        }

        for (const m of opts.messages) {
          if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if (p.type === "tool-result" && p.toolName === "page_fetch") {
                const out = outputText(p.output);
                window.__LAST_FETCH_OUTPUT__ = out;
              }
            }
          }
        }

        return {
          text: "Retrieved inventory: 14 Cat Bed Deluxe in stock.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-api.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Check inventory");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => {
      const bubble = document.querySelector("web-agent-bubble");
      const shadow = bubble?.shadowRoot;
      const views = [...(shadow?.querySelectorAll("agent-message-view") ?? [])];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      if (assistantViews.length === 0) return false;
      const text = (assistantViews[0].querySelector(".content")?.textContent ?? "").trim();
      return text.includes("Cat Bed Deluxe");
    }, { timeout: 15_000 });

    const fetchOutput = await page.evaluate(() => window.__LAST_FETCH_OUTPUT__);
    expect(fetchOutput).toBeDefined();
    expect(fetchOutput).toContain("Status: 200 OK");
    expect(fetchOutput).toContain("Content-Type: application/json; charset=utf-8");
    expect(fetchOutput).toContain("Cat Bed Deluxe");
    expect(fetchOutput).toContain("Catnip Toy Mouse");
  });

  test("POST same-origin sends headers and body and receives echo response", async ({ context }) => {
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
          return { text: "Echo Test" };
        }

        turnStep++;
        if (turnStep === 1) {
          return {
            toolCalls: [
              {
                id: "tc_fetch_post",
                name: "page_fetch",
                input: {
                  url: "/api/echo",
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ message: "Hello Server" }),
                },
              },
            ],
          };
        }

        for (const m of opts.messages) {
          if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if (p.type === "tool-result" && p.toolName === "page_fetch") {
                const out = outputText(p.output);
                window.__LAST_POST_OUTPUT__ = out;
              }
            }
          }
        }

        return {
          text: "Echo POST successful.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-api.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Send POST echo");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => {
      const bubble = document.querySelector("web-agent-bubble");
      const shadow = bubble?.shadowRoot;
      const views = [...(shadow?.querySelectorAll("agent-message-view") ?? [])];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      if (assistantViews.length === 0) return false;
      const text = (assistantViews[0].querySelector(".content")?.textContent ?? "").trim();
      return text.includes("Echo POST successful");
    }, { timeout: 15_000 });

    const postOutput = await page.evaluate(() => window.__LAST_POST_OUTPUT__);
    expect(postOutput).toBeDefined();
    expect(postOutput).toContain("Status: 200 OK");
    expect(postOutput).toContain("Hello Server");
    expect(postOutput).toContain('"method":"POST"');
  });

  test("cross-origin URL is blocked and returns error naming both origins", async ({ context }) => {
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
          return { text: "Cross Origin Test" };
        }

        turnStep++;
        if (turnStep === 1) {
          return {
            toolCalls: [
              {
                id: "tc_fetch_cors",
                name: "page_fetch",
                input: { url: "https://example.com/api/data" },
              },
            ],
          };
        }

        for (const m of opts.messages) {
          if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if (p.type === "tool-result" && p.toolName === "page_fetch") {
                const out = outputText(p.output);
                window.__LAST_CORS_OUTPUT__ = out;
                window.__LAST_CORS_IS_ERROR__ = p.isError;
              }
            }
          }
        }

        return {
          text: "Cross-origin request was properly rejected.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-api.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Fetch from example.com");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => {
      const bubble = document.querySelector("web-agent-bubble");
      const shadow = bubble?.shadowRoot;
      const views = [...(shadow?.querySelectorAll("agent-message-view") ?? [])];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      if (assistantViews.length === 0) return false;
      const text = (assistantViews[0].querySelector(".content")?.textContent ?? "").trim();
      return text.includes("properly rejected");
    }, { timeout: 15_000 });

    const corsOutput = await page.evaluate(() => window.__LAST_CORS_OUTPUT__);
    const corsIsError = await page.evaluate(() => window.__LAST_CORS_IS_ERROR__);
    expect(corsIsError).toBe(true);
    expect(corsOutput).toContain('Cross-origin request blocked: requested origin "https://example.com" does not match page origin "http://localhost:10040"');
    expect(corsOutput).toContain("The page_fetch tool only allows same-origin requests");
  });

  test("non-2xx response returns real status code and body with isError false", async ({ context }) => {
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
          return { text: "404 Test" };
        }

        turnStep++;
        if (turnStep === 1) {
          return {
            toolCalls: [
              {
                id: "tc_fetch_404",
                name: "page_fetch",
                input: { url: "/api/unknown-endpoint" },
              },
            ],
          };
        }

        for (const m of opts.messages) {
          if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if (p.type === "tool-result" && p.toolName === "page_fetch") {
                const out = outputText(p.output);
                window.__LAST_404_OUTPUT__ = out;
                window.__LAST_404_IS_ERROR__ = p.isError;
              }
            }
          }
        }

        return {
          text: "Server returned 404 Not Found as expected.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-api.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Call unknown API endpoint");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => {
      const bubble = document.querySelector("web-agent-bubble");
      const shadow = bubble?.shadowRoot;
      const views = [...(shadow?.querySelectorAll("agent-message-view") ?? [])];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      if (assistantViews.length === 0) return false;
      const text = (assistantViews[0].querySelector(".content")?.textContent ?? "").trim();
      return text.includes("Server returned 404");
    }, { timeout: 15_000 });

    const notFoundOutput = await page.evaluate(() => window.__LAST_404_OUTPUT__);
    const notFoundIsError = await page.evaluate(() => window.__LAST_404_IS_ERROR__);
    expect(notFoundIsError).toBeFalsy();
    expect(notFoundOutput).toContain("Status: 404");
    expect(notFoundOutput).toContain("Endpoint not found");
  });

  test("large response body is truncated at ceiling with truncation marker", async ({ context }) => {
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
          return { text: "Large Response Test" };
        }

        turnStep++;
        if (turnStep === 1) {
          return {
            toolCalls: [
              {
                id: "tc_fetch_large",
                name: "page_fetch",
                input: { url: "/api/large" },
              },
            ],
          };
        }

        for (const m of opts.messages) {
          if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if (p.type === "tool-result" && p.toolName === "page_fetch") {
                const out = outputText(p.output);
                window.__LAST_LARGE_OUTPUT__ = out;
              }
            }
          }
        }

        return {
          text: "Large response received and truncated.",
        };
      };
    });

    await page.goto("http://localhost:10040/page-api.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("Fetch large response");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => {
      const bubble = document.querySelector("web-agent-bubble");
      const shadow = bubble?.shadowRoot;
      const views = [...(shadow?.querySelectorAll("agent-message-view") ?? [])];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      if (assistantViews.length === 0) return false;
      const text = (assistantViews[0].querySelector(".content")?.textContent ?? "").trim();
      return text.includes("Large response received");
    }, { timeout: 15_000 });

    const largeOutput = await page.evaluate(() => window.__LAST_LARGE_OUTPUT__);
    expect(largeOutput).toBeDefined();
    expect(largeOutput).toContain("…(output truncated)");
    if (!largeOutput) throw new Error("expected largeOutput");
    // 6000 character limit plus header text
    expect(largeOutput.length).toBeLessThanOrEqual(6200);
  });
});
