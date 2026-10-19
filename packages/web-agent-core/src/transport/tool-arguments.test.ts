import { describe, it, expect, vi } from "vitest";
import { safeJsonParse } from "./tool-arguments.js";

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------
describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ input: { a: 1 } });
  });

  it("does not warn for valid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(safeJsonParse('{"a":1}')).toEqual({ input: { a: 1 } });
      expect(safeJsonParse("{}")).toEqual({ input: {} });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("issue is absent for valid JSON", () => {
    const result = safeJsonParse('{"a":1}');
    expect(result.issue).toBeUndefined();
  });

  it("returns { input: {}, issue: \"unparsable\" } for invalid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = safeJsonParse("{invalid", { toolName: "calc", toolCallId: "call_1" });
      expect(result).toEqual({ input: {}, issue: "unparsable" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("calc");
      expect(msg).toContain("call_1");
      expect(msg).toContain("{invalid");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns { input: {}, issue: \"empty\" } for empty string", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = safeJsonParse("", { toolName: "calc", toolCallId: "call_1" });
      expect(result).toEqual({ input: {}, issue: "empty" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("no argument JSON");
      expect(msg).toContain("calc");
      expect(msg).toContain("call_1");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns naming unknown when context is not provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = safeJsonParse("{invalid");
      expect(result).toEqual({ input: {}, issue: "unparsable" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("unknown");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
