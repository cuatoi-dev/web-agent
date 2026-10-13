import { z } from "zod";
import type { CustomToolDef, ToolProvider } from "@cuatoi/web-agent-core";
import { DEFAULT_PAGE_EVAL_MAX_CHARS } from "./constants";
import { errorMessage } from "./error-message";
import { describeValue, runInPageRealm, thrownName, truncate } from "../core/run-eval";
import type { PageEvalToolsOptions } from "./types";

export type { DescribedValue, PageEvalToolsOptions } from "./types";
// Re-exported so `src/lib/page-eval-tool.test.ts` and any other reader keep the
// import path they have today. 118/001 moved the body to `src/core/run-eval.ts`.
export { describeValue } from "../core/run-eval";

export function createPageEvalTool(options: PageEvalToolsOptions = {}): CustomToolDef {
  const maxChars = options.maxChars ?? DEFAULT_PAGE_EVAL_MAX_CHARS;

  return {
    name: "page_eval",
    description:
      "Run JavaScript in this page's own realm and return the result. The code you supply is the body of an async function: use `return` to send a value back, and `await` for anything asynchronous. It sees everything the page's own scripts see — window, document, and any global, object or function the site defines. Use it to read a framework's state, call a function the page already provides, or make a change that has no button. The result is serialized and capped; a value that cannot be serialized comes back described. The code runs on the page's own thread and cannot be interrupted once it starts.",
    inputSchema: z.object({
      code: z
        .string()
        .describe(
          "JavaScript to run as an async function body in the page's realm. Use `return` to send a value back, for example: return window.__STORE_STATE__.pendingOrders",
        ),
    }),
    summarize: (input) => {
      const code = typeof input.code === "string" ? input.code.trim() : "";
      const firstLine = code.split("\n")[0] ?? "";
      return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    },
    execute: async (input) => {
      const code = typeof input.code === "string" ? input.code.trim() : "";
      if (!code) {
        return { content: "No code provided to page_eval.", isError: true };
      }

      const result = await runInPageRealm(code, options.runner);

      if (result.kind === "csp") {
        return {
          content:
            `Blocked by this page's Content Security Policy. The page does not allow 'unsafe-eval', ` +
            `so page_eval cannot run JavaScript here.\nPolicy: ${result.policy}\nBrowser message: ${result.message}`,
          isError: true,
        };
      }
      if (result.kind === "throw") {
        return { content: `The code threw ${result.name}: ${result.message}`, isError: true };
      }
      // Describing the value used to happen inside the same try as the run, so a value
      // that throws while being described came back as "The code threw …".
      // Keeping the catch keeps that exactly true — criterion 11.
      try {
        const { kind, text } = describeValue(result.value);
        return { content: `Result type: ${kind}\n\n${truncate(text, maxChars)}` };
      } catch (err) {
        return { content: `The code threw ${thrownName(err)}: ${errorMessage(err)}`, isError: true };
      }
    },
  };
}

export function pageEvalTools(options: PageEvalToolsOptions = {}): ToolProvider[] {
  return [
    {
      name: "page-eval-tools",
      required: false,
      load: () => Promise.resolve([createPageEvalTool(options)]),
    },
  ];
}
