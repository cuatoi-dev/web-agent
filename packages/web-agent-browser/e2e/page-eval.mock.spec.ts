import { test, expect } from "./extension.fixture";

test.describe("Page eval tool mock e2e", () => {
  test.beforeEach(async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
  });

  async function runEvalTurn(
    page: import("@playwright/test").Page,
    fixture: string,
    code: string,
    prompt: string,
    finalText: string,
  ) {
    await page.addInitScript(
      ([code, finalText]) => {
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
            return { text: "Order Console Query" };
          }

          turnStep++;
          if (turnStep === 1) {
            return {
              toolCalls: [
                {
                  id: "tc_eval_1",
                  name: "page_eval",
                  input: { code },
                },
              ],
            };
          }

          for (const m of opts.messages) {
            if (Array.isArray(m.content)) {
              for (const p of m.content) {
                if (p.type === "tool-result" && p.toolName === "page_eval") {
                  const out = outputText(p.output);
                  window.__LAST_EVAL_OUTPUT__ = out;
                  window.__LAST_EVAL_IS_ERROR__ = p.isError;
                }
              }
            }
          }

          return { text: finalText };
        };
      },
      [code, finalText] as const,
    );

    await page.goto(`http://localhost:10040/${fixture}`);

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type(prompt);
    await page.keyboard.press("Enter");

    await page.waitForFunction(
      (text) => {
        const bubble = document.querySelector("web-agent-bubble");
        const shadow = bubble?.shadowRoot;
        const views = [...(shadow?.querySelectorAll("agent-message-view") ?? [])];
        const assistantViews = views.filter((v) => v.querySelector(".assistant"));
        if (assistantViews.length === 0) return false;
        const content = (assistantViews[0].querySelector(".content")?.textContent ?? "").trim();
        return content.includes(text);
      },
      finalText,
      { timeout: 15_000 },
    );

    const output = await page.evaluate(() => window.__LAST_EVAL_OUTPUT__);
    const isError = await page.evaluate(() => window.__LAST_EVAL_IS_ERROR__);
    return { output, isError };
  }

  test("reads a global the page defines", async ({ context }) => {
    const page = await context.newPage();
    const { output, isError } = await runEvalTurn(
      page,
      "page-eval.html",
      "return window.__STORE_STATE__.pendingOrders",
      "How many pending orders?",
      "There are 7 pending orders.",
    );
    expect(isError).toBeFalsy();
    expect(output).toContain("Result type: number");
    expect(output).toContain("7");
  });

  test("calls a function the page already defines", async ({ context }) => {
    const page = await context.newPage();
    const { output, isError } = await runEvalTurn(
      page,
      "page-eval.html",
      'return window.getShippingEstimate("APAC")',
      "What is the shipping estimate for APAC?",
      "The shipping estimate for APAC is 3 days.",
    );
    expect(isError).toBeFalsy();
    expect(output).toContain("3");
  });

  test("awaits a promise result", async ({ context }) => {
    const page = await context.newPage();
    const { output, isError } = await runEvalTurn(
      page,
      "page-eval.html",
      "return await window.loadDispatchQueue()",
      "What is in the dispatch queue?",
      "The dispatch queue has two orders.",
    );
    expect(isError).toBeFalsy();
    expect(output).toContain("Array(2)");
    expect(output).toContain("ord-88");
    expect(output).toContain("ord-91");
  });

  test("code that throws returns an error carrying the thrown message", async ({ context }) => {
    const page = await context.newPage();
    const { output, isError } = await runEvalTurn(
      page,
      "page-eval.html",
      'throw new Error("shipping service offline")',
      "Run the shipping check.",
      "The shipping check failed.",
    );
    expect(isError).toBe(true);
    expect(output).toContain("The code threw Error: shipping service offline");
  });

  test("an unserializable value comes back described, never as {}", async ({ context }) => {
    const page = await context.newPage();
    const { output, isError } = await runEvalTurn(
      page,
      "page-eval.html",
      "return document.body",
      "Describe the page body element.",
      "The body element is described.",
    );
    expect(isError).toBeFalsy();
    expect(output).toContain("HTMLBodyElement");
    expect(output).not.toBe("{}");
    expect(output).not.toContain("Result type: object\n\n{}");
  });

  test("a result longer than the cap is truncated with the visible marker", async ({ context }) => {
    const page = await context.newPage();
    const { output } = await runEvalTurn(
      page,
      "page-eval.html",
      "return window.__BIG_TEXT__",
      "Return the big text.",
      "Returned the big text.",
    );
    expect(output).toContain("…(output truncated)");
    if (!output) throw new Error("expected output");
    expect(output.length).toBeLessThanOrEqual(6100);
  });

  test("on the strict-CSP fixture the tool returns an error naming the policy", async ({ context }) => {
    const page = await context.newPage();
    const { output, isError } = await runEvalTurn(
      page,
      "page-eval-csp.html",
      "return window.__STORE_STATE__.pendingOrders",
      "How many pending orders?",
      "The page blocked the request.",
    );
    expect(isError).toBe(true);
    expect(output).toContain("Content Security Policy");
    expect(output).toContain("'unsafe-eval'");
    expect(output).toContain("script-src 'self' 'unsafe-inline'");
  });
});
