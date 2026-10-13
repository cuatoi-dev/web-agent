import { describe, it, expect, vi } from "vitest";
import {
  calcTool,
  runCalc,
  MAX_CALC_EXPRESSION_LENGTH,
  MAX_CALC_OUTPUT_LENGTH,
  MAX_CALC_TIMEOUT_MS,
} from "./calc.js";
import type { ToolContext } from "./build-tools.js";

function makeContext(signal?: AbortSignal): ToolContext {
  return {
    app: {},
    signal: signal ?? new AbortController().signal,
  };
}

describe("calcTool", () => {
  it("evaluates basic arithmetic with operator precedence", () => {
    const outcome = runCalc({ expression: "2 + 2 * 10" }, makeContext());
    expect(outcome.content).toBe("22");
    expect(outcome.isError).toBeFalsy();
  });

  it("evaluates expressions with parentheses and decimal numbers", async () => {
    const outcome = await calcTool.execute({ expression: "(15.5 + 4.5) * 3" }, makeContext());
    expect(outcome.content).toBe("60");
    expect(outcome.isError).toBeFalsy();
  });

  it("returns an actionable error when expression is missing", async () => {
    const outcome = await calcTool.execute({}, makeContext());
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("expression");
    expect(outcome.content).toContain("calc again");
    expect(outcome.content).not.toContain("TEOF");
  });

  it("returns the same error for an empty expression", async () => {
    const missingOutcome = await calcTool.execute({}, makeContext());
    const emptyOutcome = await calcTool.execute({ expression: "" }, makeContext());
    expect(emptyOutcome.isError).toBe(true);
    expect(emptyOutcome.content).toBe(missingOutcome.content);
  });

  it("returns the same error for a non-string expression", async () => {
    const missingOutcome = await calcTool.execute({}, makeContext());
    const nonStringOutcome = await calcTool.execute({ expression: 42 }, makeContext());
    expect(nonStringOutcome.isError).toBe(true);
    expect(nonStringOutcome.content).toBe(missingOutcome.content);
  });

  it("still evaluates a whitespace-padded valid expression", async () => {
    const outcome = await calcTool.execute({ expression: "  2 + 2  " }, makeContext());
    expect(outcome.content).toBe("4");
    expect(outcome.isError).toBeFalsy();
  });

  it("refuses expressions exceeding MAX_CALC_EXPRESSION_LENGTH before parsing", async () => {
    const longExpr = "1+".repeat(501) + "1"; // 1003 chars
    const outcome = await calcTool.execute({ expression: longExpr }, makeContext());
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain(`exceeds the maximum limit of ${MAX_CALC_EXPRESSION_LENGTH} characters`);
  });

  it("truncates output exceeding MAX_CALC_OUTPUT_LENGTH and notes truncation", async () => {
    const payload = "a".repeat(600);
    const expression = `'${payload}'`;
    const outcome = await calcTool.execute({ expression }, makeContext());
    expect(outcome.content).toContain("Result truncated:");
    expect(outcome.content).toContain(`exceeded limit of ${MAX_CALC_OUTPUT_LENGTH} characters`);
    expect(outcome.content).toContain("a".repeat(MAX_CALC_OUTPUT_LENGTH));
  });

  it("reports error when evaluation exceeds runtime bound", async () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1050);
    try {
      const outcome = await calcTool.execute({ expression: "1 + 1" }, makeContext());
      expect(outcome.isError).toBe(true);
      expect(outcome.content).toContain(`Evaluation exceeded runtime limit of ${MAX_CALC_TIMEOUT_MS}ms`);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("returns error on syntax error without crashing", async () => {
    const outcome = await calcTool.execute({ expression: "2 + * 4" }, makeContext());
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("Calculation error");
  });

  it("fails when attempting to access JavaScript globals", async () => {
    for (const globalName of ["window", "globalThis", "process", "fetch", "constructor"]) {
      const outcome = await calcTool.execute({ expression: `${globalName}` }, makeContext());
      expect(outcome.isError).toBe(true);
      expect(outcome.content).toContain("Calculation error");
    }
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await calcTool.execute({ expression: "2 + 2" }, makeContext(controller.signal));
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("aborted");
  });

  it("renders friendly HTML through renderer with allowed tags only", () => {
    const html = calcTool.renderer!({ expression: "5 * 5" }, "25");
    expect(html).toBe("Calculated <b>5 * 5</b> → <b>25</b>");
    expect(html).not.toContain("<code>");
  });
});