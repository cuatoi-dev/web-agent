import { describe, it, expect, vi, afterEach } from "vitest";
import { createMockProvider, makeMockError } from "./mock-provider.js";
import type { ProviderCallOptions } from "./provider.types.js";
import type { TextBlock } from "../types.js";

const baseOpts: ProviderCallOptions = {
  messages: [{ role: "user", content: "hi" }],
  model: "mock-model",
};

describe("createMockProvider — generate()", () => {
  it("returns text block + stop from text script", async () => {
    const m = createMockProvider({ text: "hello" });
    const r = await m.generate(baseOpts);
    expect(r.content).toEqual([{ type: "text", text: "hello" }]);
    expect(r.finishReason).toBe("stop");
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(r.warnings).toEqual([]);
  });

  it("returns tool_use blocks + tool-calls finishReason", async () => {
    const m = createMockProvider({
      toolCalls: [{ id: "c1", name: "snapshot_page", input: { reason: "test" } }],
    });
    const r = await m.generate(baseOpts);
    expect(r.content).toEqual([{ type: "tool_use", id: "c1", name: "snapshot_page", input: { reason: "test" } }]);
    expect(r.finishReason).toBe("tool-calls");
  });

  it("passes through explicit content/usage/finishReason/warnings", async () => {
    const m = createMockProvider({
      content: [{ type: "text", text: "explicit" }],
      usage: { inputTokens: 5, outputTokens: 10 },
      finishReason: "length",
      warnings: [{ type: "other", message: "w1" }],
    });
    const r = await m.generate(baseOpts);
    expect(r.content).toEqual([{ type: "text", text: "explicit" }]);
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 10 });
    expect(r.finishReason).toBe("length");
    expect(r.warnings).toEqual([{ type: "other", message: "w1" }]);
  });

  it("array script: advances per call, last entry repeats", async () => {
    const m = createMockProvider([{ text: "A" }, { text: "B" }]);
    const r1 = await m.generate(baseOpts);
    const r2 = await m.generate(baseOpts);
    const r3 = await m.generate(baseOpts);
    expect((r1.content[0] as TextBlock).text).toBe("A");
    expect((r2.content[0] as TextBlock).text).toBe("B");
    expect((r3.content[0] as TextBlock).text).toBe("B"); // last repeats
  });

  it("function script receives ProviderCallOptions", async () => {
    const m = createMockProvider((opts) => ({ text: opts.model }));
    const r = await m.generate({ ...baseOpts, model: "special-model" });
    expect((r.content[0] as TextBlock).text).toBe("special-model");
  });

  it("abortSignal already aborted throws AbortError", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const m = createMockProvider({ text: "x" });
    await expect(m.generate({ ...baseOpts, abortSignal: ctrl.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  describe("delayMs (009)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holds the call open", async () => {
      vi.useFakeTimers();
      const m = createMockProvider({ text: "delayed", delayMs: 1000 });
      let settled = false;
      const p = m.generate(baseOpts).then((r) => {
        settled = true;
        return r;
      });

      await vi.advanceTimersByTimeAsync(500);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(500);
      const r = await p;
      expect(settled).toBe(true);
      expect((r.content[0] as TextBlock).text).toBe("delayed");
    });

    it("rejects with AbortError when the signal aborts", async () => {
      const ctrl = new AbortController();
      const m = createMockProvider({ text: "delayed", delayMs: 1000 });
      const p = m.generate({ ...baseOpts, abortSignal: ctrl.signal });
      const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
      ctrl.abort();
      await assertion;
    });
  });
});

describe("createMockProvider — error injection", () => {
  it("generate throws with status", async () => {
    const provider = createMockProvider({ error: { status: 429, message: "rate limited" } });
    await expect(provider.generate(baseOpts)).rejects.toThrow("rate limited");
    await expect(provider.generate(baseOpts)).rejects.toMatchObject({
      status: 429,
      statusCode: 429,
    });
  });

  it("name honored (abort-like)", async () => {
    const provider = createMockProvider({ error: { name: "AbortError" } });
    await expect(provider.generate(baseOpts)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("defaults", async () => {
    const provider = createMockProvider({ error: {} });
    await expect(provider.generate(baseOpts)).rejects.toThrow("Mock provider error");
    await expect(provider.generate(baseOpts)).rejects.toMatchObject({
      name: "Error",
    });
  });

  it("array/function scripts", async () => {
    const provider = createMockProvider([
      { text: "ok" },
      { error: { status: 500 } },
    ]);
    const r1 = await provider.generate(baseOpts);
    expect(r1.content).toEqual([{ type: "text", text: "ok" }]);
    await expect(provider.generate(baseOpts)).rejects.toMatchObject({
      status: 500,
    });

    const fnProvider = createMockProvider(() => {
      throw makeMockError({ status: 400, message: "bad request" });
    });
    await expect(fnProvider.generate(baseOpts)).rejects.toMatchObject({
      status: 400,
      message: "bad request",
    });
  });
});
