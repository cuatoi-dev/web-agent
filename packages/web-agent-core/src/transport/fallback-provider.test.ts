import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFallbackProviderFactory } from "./fallback-provider.js";
import type { ProviderFallbackNotice } from "./fallback-provider.js";
import { createMockProvider, type MockScript } from "./mock-provider.js";
import { providerRegistry } from "./registry.js";
import { wrapProvider, withRetry } from "./middleware.js";
import { DEFAULT_CONFIG, type AgentConfig } from "../config.js";
import { AgentError } from "../loop/errors.js";
import type { ProviderCallOptions } from "./provider.types.js";
import type { TextBlock } from "../types.js";
import type { ToolOutcome } from "../tools/build-tools.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Register one endpointType per fake entry, each wrapping a single shared
 *  mock model (through the same withRetry the built-ins go through) so call
 *  counts are meaningful and one attempt per entry can be proved. */
function registerEntry(name: string, script: MockScript) {
  const inner = createMockProvider(script, { provider: name, modelId: name });
  const spy = {
    provider: inner.provider,
    modelId: inner.modelId,
    generate: vi.fn((opts: ProviderCallOptions) => inner.generate(opts)),
  };
  providerRegistry.register(name, (cfg) => wrapProvider(spy, withRetry(cfg)));
  return spy;
}

const baseCfg = { ...DEFAULT_CONFIG, model: "unused", requestTimeoutMs: 50 } as AgentConfig;

const baseOpts: ProviderCallOptions = {
  messages: [{ role: "user", content: "hi" }],
  model: "unused",
};

describe("createFallbackProviderFactory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a 429 on the first entry falls back to the next", async () => {
    const a = registerEntry("fp-429", { error: { status: 429, message: "rate limited" } });
    const b = registerEntry("fp-429-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-429", model: "a-model", baseURL: "" },
      { endpointType: "fp-429-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    const result = await model.generate(baseOpts);
    expect((result.content[0] as TextBlock).text).toBe("from-b");
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(b.generate).toHaveBeenCalledTimes(1);
  });

  it("a 400 falls back", async () => {
    const a = registerEntry("fp-400", { error: { status: 400, message: "bad request" } });
    registerEntry("fp-400-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-400", model: "a-model", baseURL: "" },
      { endpointType: "fp-400-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    const result = await model.generate(baseOpts);
    expect((result.content[0] as TextBlock).text).toBe("from-b");
    expect(a.generate).toHaveBeenCalledTimes(1);
  });

  it("a 401 falls back", async () => {
    const a = registerEntry("fp-401", { error: { status: 401, message: "unauthorized" } });
    registerEntry("fp-401-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-401", model: "a-model", baseURL: "" },
      { endpointType: "fp-401-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    const result = await model.generate(baseOpts);
    expect((result.content[0] as TextBlock).text).toBe("from-b");
    expect(a.generate).toHaveBeenCalledTimes(1);
  });

  it("a request that stalls past the timeout falls back", async () => {
    const a = registerEntry("fp-stall", { delayMs: 500 });
    registerEntry("fp-stall-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-stall", model: "a-model", baseURL: "" },
      { endpointType: "fp-stall-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    const p = model.generate(baseOpts);
    await vi.advanceTimersByTimeAsync(50);
    const result = await p;
    expect((result.content[0] as TextBlock).text).toBe("from-b");
    expect(a.generate).toHaveBeenCalledTimes(1);
  });

  it("a 2xx result does not move the cursor", async () => {
    const a = registerEntry("fp-2xx-a", { text: "from-a" });
    const b = registerEntry("fp-2xx-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-2xx-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-2xx-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    await model.generate(baseOpts);
    await model.generate(baseOpts);
    expect(a.generate).toHaveBeenCalledTimes(2);
    expect(b.generate).not.toHaveBeenCalled();
  });

  it("the cursor is sticky after a fallback", async () => {
    const a = registerEntry("fp-sticky-a", { error: { status: 500, message: "boom" } });
    const b = registerEntry("fp-sticky-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-sticky-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-sticky-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    await model.generate(baseOpts);
    await model.generate(baseOpts);
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(b.generate).toHaveBeenCalledTimes(2);
  });

  it("each entry gets exactly one attempt", async () => {
    const a = registerEntry("fp-one-attempt", { error: { status: 500, message: "boom" } });
    registerEntry("fp-one-attempt-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-one-attempt", model: "a-model", baseURL: "" },
      { endpointType: "fp-one-attempt-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    await model.generate(baseOpts);
    expect(a.generate).toHaveBeenCalledTimes(1);
  });

  it("it throws only after every entry has been tried", async () => {
    const a = registerEntry("fp-all-fail-a", { error: { status: 500, message: "a-down" } });
    const b = registerEntry("fp-all-fail-b", { error: { status: 500, message: "b-down" } });
    const c = registerEntry("fp-all-fail-c", { error: { status: 500, message: "c-down" } });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-all-fail-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-all-fail-b", model: "b-model", baseURL: "" },
      { endpointType: "fp-all-fail-c", model: "c-model", baseURL: "" },
    ])(baseCfg);
    await expect(model.generate(baseOpts)).rejects.toBeInstanceOf(AgentError);
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(b.generate).toHaveBeenCalledTimes(1);
    expect(c.generate).toHaveBeenCalledTimes(1);
  });

  it("it wraps around from the middle of the list", async () => {
    const order: string[] = [];
    let aCall = 0;
    registerEntry("fp-wrap-a", () => {
      order.push("a");
      aCall++;
      return { error: { status: 500, message: `a-down-${aCall}` } };
    });
    let bCall = 0;
    registerEntry("fp-wrap-b", () => {
      order.push("b");
      bCall++;
      return bCall === 1
        ? { error: { status: 500, message: "b-down-1" } }
        : { text: "from-b-call2" };
    });
    let cCall = 0;
    registerEntry("fp-wrap-c", () => {
      order.push("c");
      cCall++;
      return cCall === 1
        ? { text: "from-c-call1" }
        : { error: { status: 500, message: "c-down-2" } };
    });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-wrap-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-wrap-b", model: "b-model", baseURL: "" },
      { endpointType: "fp-wrap-c", model: "c-model", baseURL: "" },
    ])(baseCfg);

    // Call 1: a fails, b fails, c answers -> cursor ends on entry c (index 2).
    order.length = 0;
    const r1 = await model.generate(baseOpts);
    expect((r1.content[0] as TextBlock).text).toBe("from-c-call1");
    expect(order).toEqual(["a", "b", "c"]);

    // Call 2: cursor starts at c -> c fails, wraps to a, a fails, b answers.
    order.length = 0;
    const r2 = await model.generate(baseOpts);
    expect((r2.content[0] as TextBlock).text).toBe("from-b-call2");
    expect(order).toEqual(["c", "a", "b"]);
  });

  it("nothing is written to localStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    registerEntry("fp-ls-a", { error: { status: 500, message: "boom" } });
    registerEntry("fp-ls-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-ls-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-ls-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    await model.generate(baseOpts);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    setItem.mockRestore();
  });

  it("a chain entry that ends its turn empty is not failed over", async () => {
    const onProviderFallback = vi.fn();
    const a = registerEntry("fp-empty-end-a", { content: [], finishReason: "stop" });
    const b = registerEntry("fp-empty-end-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-empty-end-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-empty-end-b", model: "b-model", baseURL: "" },
    ])({ ...baseCfg, onProviderFallback });
    const result = await model.generate(baseOpts);
    expect(result.content).toHaveLength(0);
    expect(result.finishReason).toBe("stop");
    expect(a.generate).toHaveBeenCalledTimes(1);
    expect(b.generate).not.toHaveBeenCalled();
    expect(onProviderFallback).not.toHaveBeenCalled();
  });

  it("a chain entry that returns an empty incomplete result IS failed over", async () => {
    const onProviderFallback = vi.fn();
    registerEntry("fp-dead-a", { content: [], finishReason: "unknown" });
    const b = registerEntry("fp-dead-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-dead-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-dead-b", model: "b-model", baseURL: "" },
    ])({ ...baseCfg, onProviderFallback });
    const result = await model.generate(baseOpts);
    expect((result.content[0] as TextBlock).text).toBe("from-b");
    expect(b.generate).toHaveBeenCalledTimes(1);
    expect(onProviderFallback).toHaveBeenCalledTimes(1);
  });

  it("a user abort neither falls back nor moves the cursor", async () => {
    const a = registerEntry("fp-abort-a", { text: "from-a" });
    const b = registerEntry("fp-abort-b", { text: "from-b" });
    const model = createFallbackProviderFactory([
      { endpointType: "fp-abort-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-abort-b", model: "b-model", baseURL: "" },
    ])(baseCfg);
    const controller = new AbortController();
    controller.abort();
    await expect(
      model.generate({ ...baseOpts, abortSignal: controller.signal }),
    ).rejects.toBeTruthy();
    expect(b.generate).not.toHaveBeenCalled();

    // A later call still starts at entry A.
    await model.generate(baseOpts);
    expect(a.generate).toHaveBeenCalledTimes(2);
    expect(b.generate).not.toHaveBeenCalled();
  });

  it("onProviderFallback names the failed entries and the answerer", async () => {
    registerEntry("fp-notice-a", { error: { status: 429, message: "rate limited" } });
    registerEntry("fp-notice-b", { text: "ok" });
    const notices: ProviderFallbackNotice[] = [];
    const model = createFallbackProviderFactory([
      { endpointType: "fp-notice-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-notice-b", model: "b-model", baseURL: "" },
    ])({ ...baseCfg, onProviderFallback: (n) => notices.push(n) });
    await model.generate(baseOpts);
    expect(notices.length).toBe(1);
    expect(notices[0].failed).toEqual([
      { provider: "fp-notice-a", model: "a-model", message: expect.stringContaining("429") as unknown },
    ]);
    expect(notices[0].answered).toEqual({ provider: "fp-notice-b", model: "b-model" });
  });

  it("onProviderFallback reports no answerer when every entry fails", async () => {
    registerEntry("fp-notice-none-a", { error: { status: 500, message: "a-down" } });
    registerEntry("fp-notice-none-b", { error: { status: 500, message: "b-down" } });
    const notices: ProviderFallbackNotice[] = [];
    const model = createFallbackProviderFactory([
      { endpointType: "fp-notice-none-a", model: "a-model", baseURL: "" },
      { endpointType: "fp-notice-none-b", model: "b-model", baseURL: "" },
    ])({ ...baseCfg, onProviderFallback: (n) => notices.push(n) });
    await expect(model.generate(baseOpts)).rejects.toBeInstanceOf(AgentError);
    expect(notices.length).toBe(1);
    expect(notices[0].answered).toBeUndefined();
    expect(notices[0].failed.length).toBe(2);
  });

  it("a completed tool is never re-executed", async () => {
    const { createAgentSession } = await import("../controller.js");
    const { z } = await import("zod");

    let toolCallCount = 0;
    const countTool = {
      name: "count_me",
      description: "count",
      inputSchema: z.object({}).strict(),
      execute: () => {
        toolCallCount++;
        return Promise.resolve("counted" as unknown as ToolOutcome);
      },
    };

    registerEntry("fp-tool-turn-a", [
      { toolCalls: [{ id: "t1", name: "count_me", input: {} }], finishReason: "tool-calls" },
      { error: { status: 500, message: "a-down" } },
    ]);
    registerEntry("fp-tool-turn-b", { error: { status: 500, message: "b-down" } });

    providerRegistry.register(
      "fp-tool-turn-chain",
      createFallbackProviderFactory([
        { endpointType: "fp-tool-turn-a", model: "a-model", baseURL: "" },
        { endpointType: "fp-tool-turn-b", model: "b-model", baseURL: "" },
      ]),
    );

    const session = createAgentSession({
      model: "unused",
      endpointType: "fp-tool-turn-chain",
      persist: false,
      tools: () => [countTool],
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "count please" }]);

    expect(toolCallCount).toBe(1);
    const state = session.getState();
    expect(state.messages.some((m) => m.failed)).toBe(true);
  });
});
