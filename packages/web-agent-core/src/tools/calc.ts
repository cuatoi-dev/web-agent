import { z } from "zod";
import { Parser } from "expr-eval-fork";
import type { CustomToolDef, ToolContext, ToolOutcome } from "./types.js";

export const MAX_CALC_EXPRESSION_LENGTH = 1000;
export const MAX_CALC_OUTPUT_LENGTH = 500;
export const MAX_CALC_TIMEOUT_MS = 1000;

export const calcInputSchema = z
  .object({
    expression: z
      .string()
      .describe("Mathematical expression to evaluate, e.g. '2 + 2 * 10', '(15 * 3.5) / 2', or 'sqrt(144) + 5'."),
  })
  .strict();

export function runCalc(
  input: Record<string, unknown>,
  ctx: ToolContext,
): ToolOutcome {
  const expression = typeof input.expression === "string" ? input.expression : "";

  // A missing, empty, or non-string expression reaches here as "". expr-eval
  // would report that as "unexpected TEOF: EOF", which tells the model nothing.
  // Name the argument and how to retry, as load_skill does (tools/skill-tools.ts).
  if (expression.trim() === "") {
    return {
      content:
        'calc was called without an expression. The "expression" argument is required. ' +
        'Call calc again with {"expression": "<the arithmetic to evaluate>"}, ' +
        'for example {"expression": "2 + 2 * 10"}.',
      isError: true,
    };
  }

  // 1. Pre-parse length check (preventive control against runaway execution)
  if (expression.length > MAX_CALC_EXPRESSION_LENGTH) {
    return {
      content: `Expression length (${expression.length}) exceeds the maximum limit of ${MAX_CALC_EXPRESSION_LENGTH} characters.`,
      isError: true,
    };
  }

  if (ctx.signal?.aborted) {
    return { content: "Calculation aborted before starting.", isError: true };
  }

  // 2. Synchronous evaluation with elapsed-time measurement.
  // Single-threaded synchronous evaluation cannot be interrupted by setTimeout.
  // The expression length bound is the preventive control; this elapsed check is the reporting control.
  try {
    const parser = new Parser();
    const parsedExpr = parser.parse(expression);

    const start = performance.now();
    const rawResult = parsedExpr.evaluate({}) as unknown;
    const elapsed = performance.now() - start;

    if (elapsed > MAX_CALC_TIMEOUT_MS) {
      return {
        content: `Evaluation exceeded runtime limit of ${MAX_CALC_TIMEOUT_MS}ms (took ${Math.round(elapsed)}ms).`,
        isError: true,
      };
    }

    const resultStr = String(rawResult);

    // 3. Output length cap check
    if (resultStr.length > MAX_CALC_OUTPUT_LENGTH) {
      const truncated = resultStr.slice(0, MAX_CALC_OUTPUT_LENGTH);
      return {
        content: `Result truncated: ${truncated}... [Output truncated: exceeded limit of ${MAX_CALC_OUTPUT_LENGTH} characters]`,
      };
    }

    return { content: resultStr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Calculation error: ${message}`,
      isError: true,
    };
  }
}

export const calcTool: CustomToolDef = {
  name: "calc",
  description:
    "Evaluate a mathematical expression. Use this tool for accurate arithmetic calculations rather than calculating in-token.",
  inputSchema: calcInputSchema,
  promptSnippet:
    "Use calc({ expression }) for arithmetic operations, formula evaluations, and precise mathematical calculations.",
  renderer: (input, result) => {
    const { expression } = input as { expression?: string };
    // Host sanitizes to inline tags (<i>, <b>, <em>, <strong>)
    return `Calculated <b>${expression ?? ""}</b> → <b>${result}</b>`;
  },
  summarize: (input) => {
    const { expression } = input as { expression?: string };
    return expression ? `Calculate ${expression}` : "Calculate expression";
  },
  execute: (input, ctx) => Promise.resolve(runCalc(input, ctx)),
};