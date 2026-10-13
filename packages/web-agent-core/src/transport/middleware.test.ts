import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wrapProvider, withRetry, isRetryableError } from "./middleware.js";
import { createMockProvider, makeMockError } from "./mock-provider.js";
import { reassembleStream } from "./stream-parts.js";
import { DEFAULT_CONFIG, type AgentConfig } from "../config.js";
import { AgentError, mapToAgentError } from "../loop/errors.js";
import type { LanguageModel, ProviderCallOptions, ProviderResult } from "./provider.types.js";
import type { StreamPart } from "./stream-parts.js";
import type { TextBlock } from "../types.js";

const baseOpts: ProviderCallOptions = {
  messages: [{ role: "user", content: "hi" }],
  model: "mock-model",
};

function makeMock(text: string): LanguageModel {
  return createMockProvider({ text });
}

describe("wrapProvider — no-op pass-through", () => {
  it("generate returns same result as inner model", async () => {
    const inner = makeMock("hello");
    const wrapped = wrapProvider(inner, {});
    const expected = await inner.generate(baseOpts);
    const actual = await wrapped.generate(baseOpts);
    expect(actual).toEqual(expected);
  });

  it("doStream yields same reassembled result as inner model", async () => {
    const inner = makeMock("hello");
    const wrapped = wrapProvider(inner, {});
    const { stream } = await wrapped.doStream!(baseOpts);
    const result = await reassembleStream(stream);
    expect((result.content[0] as TextBlock).text).toBe("hello");
  });

  it("preserves provider/modelId from inner model when no overrides", () => {
    const inner = makeMock("x");
    const wrapped = wrapProvider(inner, {});
    expect(wrapped.provider).toBe(inner.provider);
    expect(wrapped.modelId).toBe(inner.modelId);
  });

  it("doStream is undefined on wrapper when inner has no doStream", () => {
    const inner: LanguageModel = {
      provider: "p",
      modelId: "m",
      generate: () => Promise.resolve({ content: [], finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }),
    };
    const wrapped = wrapProvider(inner, {}) as { doStream?: unknown };
    expect(wrapped.doStream).toBeUndefined();
  });
});

describe("wrapProvider — transformParams", () => {
  it("mutated params are seen by inner model", async () => {
    const seenModels: string[] = [];
    const inner: LanguageModel = {
      provider: "p",
      modelId: "m",
      generate: (opts) => {
        seenModels.push(opts.model);
        return Promise.resolve({ content: [{ type: "text", text: "ok" }], finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } });
      },
    };
    const wrapped = wrapProvider(inner, {
      transformParams: ({ params }) => ({ ...params, model: "overridden-model" }),
    });
    await wrapped.generate(baseOpts);
    expect(seenModels[0]).toBe("overridden-model");
  });
});

describe("wrapProvider — wrapGenerate", () => {
  it("can short-circuit / wrap the result", async () => {
    const inner = makeMock("original");
    const wrapped = wrapProvider(inner, {
      wrapGenerate: async ({ doGenerate }) => {
        const r = await doGenerate();
        return {
          ...r,
          warnings: [{ type: "other" as const, message: "injected" }],
        };
      },
    });
    const r = await wrapped.generate(baseOpts);
    expect(r.warnings).toEqual([{ type: "other", message: "injected" }]);
    expect((r.content[0] as TextBlock).text).toBe("original");
  });
});

describe("wrapProvider — wrapStream", () => {
  it("wraps the async iterable and still reassembles correctly", async () => {
    const inner = makeMock("streamed");
    let partCount = 0;
    const wrapped = wrapProvider(inner, {
      wrapStream: async ({ doStream }) => {
        const { stream } = await doStream();
        async function* counting(): AsyncGenerator<StreamPart> {
          for await (const p of stream) {
            partCount++;
            yield p;
          }
        }
        return { stream: counting() };
      },
    });
    const { stream } = await wrapped.doStream!(baseOpts);
    const result = await reassembleStream(stream);
    expect((result.content[0] as TextBlock).text).toBe("streamed");
    expect(partCount).toBeGreaterThan(0);
  });
});

describe("wrapProvider — overrideProvider / overrideModelId", () => {
  it("changes reported provider and modelId", () => {
    const inner = makeMock("x");
    const wrapped = wrapProvider(inner, {
      overrideProvider: () => "custom-provider",
      overrideModelId: () => "custom-model",
    });
    expect(wrapped.provider).toBe("custom-provider");
    expect(wrapped.modelId).toBe("custom-model");
  });
});

describe("wrapProvider — two middlewares compose (outer = first)", () => {
  it("outer wrapGenerate executes after inner transformParams", async () => {
    const seenModels: string[] = [];
    const inner: LanguageModel = {
      provider: "p",
      modelId: "m",
      generate: (opts) => {
        seenModels.push(opts.model);
        return Promise.resolve({ content: [{ type: "text", text: "base" }], finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } });
      },
    };
    const order: string[] = [];
    const mw1 = {
      wrapGenerate: async ({ doGenerate }: { doGenerate: () => Promise<ProviderResult>; params: ProviderCallOptions; model: LanguageModel }) => {
        order.push("outer");
        return doGenerate();
      },
    };
    const mw2 = {
      wrapGenerate: async ({ doGenerate }: { doGenerate: () => Promise<ProviderResult>; params: ProviderCallOptions; model: LanguageModel }) => {
        order.push("inner");
        return doGenerate();
      },
    };
    const wrapped = wrapProvider(inner, [mw1, mw2]);
    await wrapped.generate(baseOpts);
    expect(order).toEqual(["outer", "inner"]);
  });
});

// ---------------------------------------------------------------------------
// withRetry middleware
// ---------------------------------------------------------------------------

const GOOD_RESULT: ProviderResult = {
  content: [{ type: "text", text: "hello" }],
  finishReason: "stop",
  usage: { inputTokens: 0, outputTokens: 0 },
};
const EMPTY_RESULT: ProviderResult = {
  content: [],
  finishReason: "unknown",
  usage: { inputTokens: 0, outputTokens: 0 },
};
const EMPTY_END_TURN_RESULT: ProviderResult = {
  content: [],
  finishReason: "stop",
  usage: { inputTokens: 6, outputTokens: 2 },
};
const BLANK_TEXT_END_TURN_RESULT: ProviderResult = {
  content: [{ type: "text", text: "   " }],
  finishReason: "stop",
  usage: { inputTokens: 6, outputTokens: 2 },
};

function goodStreamParts(text = "hello"): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } },
  ];
}
function emptyStreamParts(): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "finish", finishReason: "unknown", usage: { inputTokens: 0, outputTokens: 0 } },
  ];
}
function endTurnStreamParts(): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "finish", finishReason: "stop", usage: { inputTokens: 6, outputTokens: 2 } },
  ];
}
function lengthStreamParts(): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "finish", finishReason: "length", usage: { inputTokens: 6, outputTokens: 2 } },
  ];
}
// Must stay a real async generator: middleware.ts's retry loop calls
// `stream[Symbol.asyncIterator]()` directly (not `for await...of`), so a sync
// generator here breaks at runtime ("stream[Symbol.asyncIterator] is not a
// function") — confirmed by a failing test run. The `await` has no effect on
// the yielded values; it exists only to keep this a genuine async generator.
async function* toStream(parts: StreamPart[]): AsyncGenerator<StreamPart> {
  await Promise.resolve();
  for (const p of parts) yield p;
}

/** Build a LanguageModel whose generate/doStream behave differently per call (by index). */
// No return-type annotation — keeps generate/doStream typed as Mock<...>
// (not LanguageModel's method-shorthand signatures) so `inner.generate`/
// `inner.doStream` stay directly usable with `.toHaveBeenCalledTimes` below.
function scriptedModel(opts: {
  generate?: Array<(o: ProviderCallOptions) => Promise<ProviderResult>>;
  stream?: Array<(o: ProviderCallOptions) => Promise<{ stream: AsyncIterable<StreamPart> }>>;
}) {
  let gi = 0;
  let si = 0;
  return {
    provider: "p",
    modelId: "m",
    generate: vi.fn(async (o: ProviderCallOptions) => {
      const fn = opts.generate![Math.min(gi, opts.generate!.length - 1)];
      gi++;
      return fn(o);
    }),
    doStream: vi.fn(async (o: ProviderCallOptions) => {
      const fn = opts.stream![Math.min(si, opts.stream!.length - 1)];
      si++;
      return fn(o);
    }),
  };
}

function cfg(over: Partial<AgentConfig> = {}): AgentConfig {
  return { ...DEFAULT_CONFIG, model: "test-model", ...over };
}

describe("withRetry middleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries an empty stream then succeeds (stream)", async () => {
    const inner = scriptedModel({
      stream: [
        () => Promise.resolve({ stream: toStream(emptyStreamParts()) }),
        () => Promise.resolve({ stream: toStream(goodStreamParts("hello")) }),
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const p = wrapped.doStream!(baseOpts);
    await vi.advanceTimersByTimeAsync(1000);
    const { stream } = await p;
    const result = await reassembleStream(stream);
    expect((result.content[0] as TextBlock).text).toBe("hello");
    expect(inner.doStream).toHaveBeenCalledTimes(2);
  });

  it("retries an empty response then succeeds (generate)", async () => {
    const inner = scriptedModel({
      generate: [() => Promise.resolve(EMPTY_RESULT), () => Promise.resolve(GOOD_RESULT)],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const p = wrapped.generate(baseOpts);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await p;
    expect((result.content[0] as TextBlock).text).toBe("hello");
    expect(inner.generate).toHaveBeenCalledTimes(2);
  });

  it("does not retry a deterministic 400 (generate)", async () => {
    const err: Error & { statusCode: number } = Object.assign(new Error("bad request"), { statusCode: 400 });
    const inner = scriptedModel({ generate: [() => Promise.reject(err)] });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    await expect(wrapped.generate(baseOpts)).rejects.toMatchObject({ name: "AgentError", kind: "bad_request" });
    expect(inner.generate).toHaveBeenCalledTimes(1);
  });

  it("throws a friendly AgentError when retries are exhausted (always empty)", async () => {
    const inner = scriptedModel({ generate: [() => Promise.resolve(EMPTY_RESULT)] });
    const wrapped = wrapProvider(inner, withRetry(cfg({ maxRetries: 2 })));
    const p = wrapped.generate(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({
      name: "AgentError",
      message: "Model returned no response or request timed out after multiple retries. Please try again.",
    });
    await vi.advanceTimersByTimeAsync(1000 + 1000);
    await assertion;
    expect(inner.generate).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("an empty end_turn is returned, not retried (generate)", async () => {
    const inner = scriptedModel({ generate: [() => Promise.resolve(EMPTY_END_TURN_RESULT)] });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const result = await wrapped.generate(baseOpts);
    expect(result.content).toHaveLength(0);
    expect(result.finishReason).toBe("stop");
    expect(inner.generate).toHaveBeenCalledTimes(1);
  });

  it("a whitespace-only end_turn is returned, not retried (generate)", async () => {
    const inner = scriptedModel({ generate: [() => Promise.resolve(BLANK_TEXT_END_TURN_RESULT)] });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const result = await wrapped.generate(baseOpts);
    expect(result.finishReason).toBe("stop");
    expect(inner.generate).toHaveBeenCalledTimes(1);
  });

  it("max_tokens with no content is still retried (generate)", async () => {
    const inner = scriptedModel({
      generate: [() => Promise.resolve({ content: [], finishReason: "length", usage: { inputTokens: 6, outputTokens: 2 } })],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ maxRetries: 2 })));
    const p = wrapped.generate(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError" });
    await vi.advanceTimersByTimeAsync(1000 + 1000);
    await assertion;
    expect(inner.generate).toHaveBeenCalledTimes(3);
  });

  it("a finish/stop ends the acquisition drain (stream)", async () => {
    const inner = scriptedModel({
      stream: [() => Promise.resolve({ stream: toStream(endTurnStreamParts()) })],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const { stream } = await wrapped.doStream!(baseOpts);
    const result = await reassembleStream(stream);
    expect(result.content).toHaveLength(0);
    expect(result.finishReason).toBe("stop");
    expect(inner.doStream).toHaveBeenCalledTimes(1);
  });

  it("a finish/unknown stream is still retried (stream)", async () => {
    const inner = scriptedModel({
      stream: [
        () => Promise.resolve({ stream: toStream(emptyStreamParts()) }),
        () => Promise.resolve({ stream: toStream(goodStreamParts("hello")) }),
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const p = wrapped.doStream!(baseOpts);
    await vi.advanceTimersByTimeAsync(1000);
    const { stream } = await p;
    const result = await reassembleStream(stream);
    expect((result.content[0] as TextBlock).text).toBe("hello");
    expect(inner.doStream).toHaveBeenCalledTimes(2);
  });

  it("a finish/length stream is still retried (stream)", async () => {
    const inner = scriptedModel({
      stream: [
        () => Promise.resolve({ stream: toStream(lengthStreamParts()) }),
        () => Promise.resolve({ stream: toStream(goodStreamParts("hello")) }),
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const p = wrapped.doStream!(baseOpts);
    await vi.advanceTimersByTimeAsync(1000);
    const { stream } = await p;
    const result = await reassembleStream(stream);
    expect((result.content[0] as TextBlock).text).toBe("hello");
    expect(inner.doStream).toHaveBeenCalledTimes(2);
  });

  it("times out a hung request, retries, then throws exhausted AgentError", async () => {
    const inner = scriptedModel({
      generate: [
        (o: ProviderCallOptions) =>
          new Promise<ProviderResult>((resolve, reject) => {
            const t = setTimeout(() => resolve(GOOD_RESULT), 100);
            o.abortSignal?.addEventListener("abort", () => {
              clearTimeout(t);
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ requestTimeoutMs: 20, maxRetries: 1 })));
    const p = wrapped.generate(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError" });
    await vi.advanceTimersByTimeAsync(20 + 1000 + 20);
    await assertion;
    expect(inner.generate).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("a config that omits requestTimeoutMs gets the 5-minute default, not 30 seconds", async () => {
    // 110/005 P3. Do not spread DEFAULT_CONFIG's own requestTimeoutMs here —
    // the point is the `?? 300_000` fallback at middleware.ts:425, which only
    // a config that never sets the field can exercise.
    const { requestTimeoutMs: _omitted, ...withoutTimeout } = cfg({ maxRetries: 0 });
    void _omitted;
    const inner = scriptedModel({
      generate: [() => new Promise<ProviderResult>(() => {})],
    });
    const wrapped = wrapProvider(inner, withRetry(withoutTimeout));
    const p = wrapped.generate(baseOpts);
    let settled = false;
    p.catch(() => {
      settled = true;
    });
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError" });

    await vi.advanceTimersByTimeAsync(299_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(settled).toBe(true);
  });

  it("respects a pre-aborted user signal without retrying (generate)", async () => {
    const inner = scriptedModel({
      generate: [
        (o: ProviderCallOptions) =>
          new Promise<ProviderResult>((_, reject) => {
            if (o.abortSignal?.aborted) reject(new DOMException("aborted", "AbortError"));
          }),
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const controller = new AbortController();
    controller.abort();
    await expect(
      wrapped.generate({ ...baseOpts, abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AgentError", kind: "aborted" });
    expect(inner.generate).toHaveBeenCalledTimes(1);
  });

  it("preserves a rate-limit classification on exhausted retries", async () => {
    const err: Error & { statusCode: number } = Object.assign(new Error("rate limited"), { statusCode: 429 });
    const inner = scriptedModel({ generate: [() => Promise.reject(err)] });
    const wrapped = wrapProvider(inner, withRetry(cfg({ maxRetries: 1 })));
    const p = wrapped.generate(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError", kind: "rate_limit" });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(inner.generate).toHaveBeenCalledTimes(2);
  });

  it("classification integration using mock error (429 retry, 400 terminal)", async () => {
    const inner429 = createMockProvider({ error: { status: 429, message: "rate limited" } });
    const wrapped429 = wrapProvider(inner429, withRetry(cfg({ maxRetries: 1 })));
    const p429 = wrapped429.generate(baseOpts);
    const assertion429 = expect(p429).rejects.toMatchObject({ name: "AgentError", kind: "rate_limit" });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion429;

    const inner400 = createMockProvider({ error: { status: 400, message: "bad request" } });
    const wrapped400 = wrapProvider(inner400, withRetry(cfg({ maxRetries: 1 })));
    await expect(wrapped400.generate(baseOpts)).rejects.toMatchObject({ name: "AgentError", kind: "bad_request" });
  });
});

// ---------------------------------------------------------------------------
// withRetry — auto-retry policy: default maxRetries, Fibonacci backoff,
// onRetryAttempt surfacing (044-4)
// ---------------------------------------------------------------------------

describe("withRetry — auto-retry policy (044-4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to 5 retries (6 total attempts) on a persistently-transient failure", async () => {
    const inner = createMockProvider({ error: { status: 500, message: "server error" } });
    const spy = vi.spyOn(inner, "generate");
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const p = wrapped.generate(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError" });
    await vi.advanceTimersByTimeAsync(1000 + 1000 + 2000 + 3000 + 5000);
    await assertion;
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it("uses the Fibonacci-ish backoff sequence [1000,1000,2000,3000,5000]ms between attempts", async () => {
    const inner = createMockProvider({ error: { status: 500, message: "server error" } });
    const spy = vi.spyOn(inner, "generate");
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const p = wrapped.generate(baseOpts);
    p.catch(() => {}); // avoid unhandled rejection warnings while stepping

    const backoffSeq = [1000, 1000, 2000, 3000, 5000];
    let expectedAttempts = 1; // the initial attempt happens synchronously before any sleep
    for (const delay of backoffSeq) {
      // Advance to just before the next backoff delay elapses: attempt count unchanged.
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(spy).toHaveBeenCalledTimes(expectedAttempts);
      // Advance the last 1ms: the delay elapses and the next attempt fires.
      await vi.advanceTimersByTimeAsync(1);
      expectedAttempts++;
      expect(spy).toHaveBeenCalledTimes(expectedAttempts);
    }
    await expect(p).rejects.toMatchObject({ name: "AgentError" });
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it("calls onRetryAttempt(1,5,err)…(5,5,err) before each retry sleep, not on the final failure", async () => {
    const calls: Array<[number, number, unknown]> = [];
    const onRetryAttempt = vi.fn((attempt: number, maxRetries: number, error: unknown) => {
      calls.push([attempt, maxRetries, error]);
    });
    const inner = createMockProvider({ error: { status: 500, message: "server error" } });
    const wrapped = wrapProvider(inner, withRetry(cfg({ onRetryAttempt })));
    const p = wrapped.generate(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError" });
    await vi.advanceTimersByTimeAsync(1000 + 1000 + 2000 + 3000 + 5000);
    await assertion;

    expect(onRetryAttempt).toHaveBeenCalledTimes(5);
    expect(calls.map(([a, m]) => [a, m])).toEqual([
      [1, 5], [2, 5], [3, 5], [4, 5], [5, 5],
    ]);
  });

  it("does not call onRetryAttempt for a terminal 400/401/403 (fails on attempt 1, no retry)", async () => {
    const onRetryAttempt = vi.fn();
    const inner400 = createMockProvider({ error: { status: 400, message: "bad request" } });
    const spy400 = vi.spyOn(inner400, "generate");
    const wrapped400 = wrapProvider(inner400, withRetry(cfg({ onRetryAttempt })));
    await expect(wrapped400.generate(baseOpts)).rejects.toMatchObject({ kind: "bad_request" });
    expect(onRetryAttempt).not.toHaveBeenCalled();
    expect(spy400).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// withRetry — idle deadline (012)
//
// The per-attempt deadline is time SINCE THE LAST TRANSPORT ACTIVITY, not
// time to first content. `onTransportProgress` (called by the SSE reader on
// every raw chunk, including keep-alive comments) restarts the clock.
// ---------------------------------------------------------------------------

function delayFake(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("withRetry — idle deadline (012)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not retry a stream that keeps reporting transport progress", async () => {
    const onRetryAttempt = vi.fn();
    const inner = scriptedModel({
      stream: [
        (o: ProviderCallOptions) => {
          for (let i = 1; i <= 9; i++) {
            setTimeout(() => o.onTransportProgress?.(), i * 5000);
          }
          async function* gen(): AsyncGenerator<StreamPart> {
            yield { type: "stream-start", warnings: [] };
            await delayFake(45000);
            yield { type: "text-start", id: "t" };
            yield { type: "text-delta", id: "t", delta: "hello" };
            yield { type: "text-end", id: "t" };
            yield { type: "finish", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } };
          }
          return Promise.resolve({ stream: gen() });
        },
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ onRetryAttempt })));
    const p = wrapped.doStream!(baseOpts);
    await vi.advanceTimersByTimeAsync(46000);
    // Assert call count/onRetryAttempt BEFORE awaiting `p`: with the old 30 s
    // default, pre-fix code had a second attempt still mid-flight at t=46000
    // (its 45 s content delay started after the 30 s timeout + 1 s backoff), so
    // awaiting `p` here would hang in real time instead of failing cleanly.
    expect(inner.doStream).toHaveBeenCalledTimes(1);
    expect(onRetryAttempt).not.toHaveBeenCalled();
    const { stream } = await p;
    const result = await reassembleStream(stream);
    expect((result.content[0] as TextBlock).text).toBe("hello");
  });

  it("still times out and retries a stream that reports no progress", async () => {
    const inner = scriptedModel({
      stream: [() => new Promise(() => {}), () => new Promise(() => {})],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ requestTimeoutMs: 20, maxRetries: 1 })));
    const p = wrapped.doStream!(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError" });
    await vi.advanceTimersByTimeAsync(20 + 1000 + 20);
    await assertion;
    expect(inner.doStream).toHaveBeenCalledTimes(2);
  });

  it("restarts the window on each progress report, then times out when progress stops", async () => {
    const inner = scriptedModel({
      stream: [
        (o: ProviderCallOptions) => {
          o.onTransportProgress?.();
          setTimeout(() => o.onTransportProgress?.(), 10);
          return new Promise(() => {});
        },
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ requestTimeoutMs: 20, maxRetries: 0 })));
    let settled = false;
    const p = wrapped.doStream!(baseOpts);
    p.catch(() => {}).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(29);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await expect(p).rejects.toMatchObject({ name: "AgentError" });
    expect(inner.doStream).toHaveBeenCalledTimes(1);
  });

  it("ignores progress reported after the attempt's timer is cleared", async () => {
    const inner = scriptedModel({
      stream: [
        (o: ProviderCallOptions) => {
          setTimeout(() => o.onTransportProgress?.(), 5);
          // Must stay a real async generator — see toStream above.
          async function* gen(): AsyncGenerator<StreamPart> {
            await Promise.resolve();
            yield { type: "stream-start", warnings: [] };
            yield { type: "text-start", id: "t" };
            yield { type: "text-delta", id: "t", delta: "hello" };
            yield { type: "text-end", id: "t" };
            yield { type: "finish", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } };
          }
          return Promise.resolve({ stream: gen() });
        },
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ requestTimeoutMs: 20, maxRetries: 0 })));
    const p = wrapped.doStream!(baseOpts);
    await vi.advanceTimersByTimeAsync(1000);
    const { stream } = await p;
    const result = await reassembleStream(stream);
    expect((result.content[0] as TextBlock).text).toBe("hello");
    expect(inner.doStream).toHaveBeenCalledTimes(1);
  });

  it("passes onTransportProgress to the inner model on both paths", async () => {
    let seenGenerate: unknown;
    let seenStream: unknown;
    const inner = scriptedModel({
      generate: [
        (o: ProviderCallOptions) => {
          seenGenerate = typeof o.onTransportProgress;
          return Promise.resolve(GOOD_RESULT);
        },
      ],
      stream: [
        (o: ProviderCallOptions) => {
          seenStream = typeof o.onTransportProgress;
          return Promise.resolve({ stream: toStream(goodStreamParts()) });
        },
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    await wrapped.generate(baseOpts);
    await wrapped.doStream!(baseOpts);
    expect(seenGenerate).toBe("function");
    expect(seenStream).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// isRetryableError — centralized classification (044-2)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// withRetry — stream idle deadline (006)
//
// Protects the part of the stream AFTER the first content part, which the
// idle deadline above (012) deliberately leaves alone (see the comment on
// withRetry). A gateway that sends one word and then goes quiet without
// closing the connection must not hang the turn forever: it stalls, retries
// through the same attempt loop and backoff, and only surfaces an error once
// every retry is exhausted.
// ---------------------------------------------------------------------------

/** A stream that emits its first content part, then goes silent forever
 *  without closing — the exact shape the gateway hang was reported as. */
function stallAfterFirstContent(o: ProviderCallOptions) {
  async function* gen(): AsyncGenerator<StreamPart> {
    yield { type: "stream-start", warnings: [] };
    yield { type: "text-start", id: "t" };
    yield { type: "text-delta", id: "t", delta: "Stalled..." };
    await new Promise<void>((_, reject) => {
      o.abortSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  }
  return Promise.resolve({ stream: gen() });
}

describe("withRetry — stream idle deadline (006)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out after the default 2-minute idle deadline and retries, then succeeds", async () => {
    const onRetryAttempt = vi.fn();
    const inner = scriptedModel({
      stream: [stallAfterFirstContent, () => Promise.resolve({ stream: toStream(goodStreamParts("recovered")) })],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ onRetryAttempt })));
    const p = wrapped.doStream!(baseOpts);
    const { stream } = await p;
    const resultPromise = reassembleStream(stream);
    await vi.advanceTimersByTimeAsync(120_000 + 1000);
    const result = await resultPromise;
    // Both attempts use text id "t" (stallAfterFirstContent and
    // goodStreamParts). Before the reset this was "Stalled...recovered".
    expect(result.content).toEqual([{ type: "text", text: "recovered" }]);
    expect(inner.doStream).toHaveBeenCalledTimes(2);
    expect(onRetryAttempt).toHaveBeenCalledTimes(1);
    expect(onRetryAttempt).toHaveBeenCalledWith(1, 5, expect.any(Error));
  });

  it("times out after a configured streamIdleTimeoutMs and retries", async () => {
    const onRetryAttempt = vi.fn();
    const inner = scriptedModel({
      stream: [stallAfterFirstContent, () => Promise.resolve({ stream: toStream(goodStreamParts("recovered")) })],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ streamIdleTimeoutMs: 50, onRetryAttempt })));
    const p = wrapped.doStream!(baseOpts);
    const { stream } = await p;
    const resultPromise = reassembleStream(stream);
    await vi.advanceTimersByTimeAsync(50 + 1000);
    await resultPromise;
    expect(inner.doStream).toHaveBeenCalledTimes(2);
    expect(onRetryAttempt).toHaveBeenCalledTimes(1);
  });

  it("throws the friendly exhausted error once every retry stalls out", async () => {
    const inner = scriptedModel({ stream: [stallAfterFirstContent] });
    const wrapped = wrapProvider(inner, withRetry(cfg({ streamIdleTimeoutMs: 10, maxRetries: 1 })));
    const p = wrapped.doStream!(baseOpts);
    const { stream } = await p;
    const assertion = expect(reassembleStream(stream)).rejects.toMatchObject({
      name: "AgentError",
      message: "Model returned no response or request timed out after multiple retries. Please try again.",
    });
    await vi.advanceTimersByTimeAsync(10 + 1000 + 10);
    await assertion;
    expect(inner.doStream).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("resets the idle deadline on every content part so a long slow stream finishes", async () => {
    const inner = scriptedModel({
      stream: [
        () => {
          async function* gen(): AsyncGenerator<StreamPart> {
            yield { type: "stream-start", warnings: [] };
            yield { type: "text-start", id: "t" };
            for (let i = 0; i < 3; i++) {
              await delayFake(90_000);
              yield { type: "text-delta", id: "t", delta: `chunk${i} ` };
            }
            yield { type: "text-end", id: "t" };
            yield { type: "finish", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } };
          }
          return Promise.resolve({ stream: gen() });
        },
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ streamIdleTimeoutMs: 120_000 })));
    const { stream } = await wrapped.doStream!(baseOpts);
    const resultPromise = reassembleStream(stream);
    await vi.advanceTimersByTimeAsync(90_000 * 3);
    const result = await resultPromise;
    expect((result.content[0] as TextBlock).text).toBe("chunk0 chunk1 chunk2 ");
    expect(inner.doStream).toHaveBeenCalledTimes(1);
  });

  it("cleans up the stream idle timer when the stream ends normally", async () => {
    const inner = makeMock("done");
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const { stream } = await wrapped.doStream!(baseOpts);
    await reassembleStream(stream);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up the stream idle timer immediately on user abort, without waiting for the deadline", async () => {
    const inner = scriptedModel({ stream: [stallAfterFirstContent] });
    const controller = new AbortController();
    const wrapped = wrapProvider(inner, withRetry(cfg({ streamIdleTimeoutMs: 120_000 })));
    const { stream } = await wrapped.doStream!({ ...baseOpts, abortSignal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next(); // stream-start
    await iterator.next(); // text-start
    await iterator.next(); // text-delta ("Stalled...")
    const nextP = iterator.next(); // now hung on the stalled promise
    controller.abort();
    await expect(nextP).rejects.toMatchObject({ name: "AgentError", kind: "aborted" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// stream-restart signal
// ---------------------------------------------------------------------------

describe("withRetry — stream-restart signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits stream-restart before replaying a retried attempt", async () => {
    const inner = scriptedModel({
      stream: [stallAfterFirstContent, () => Promise.resolve({ stream: toStream(goodStreamParts("recovered")) })],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const { stream } = await wrapped.doStream!(baseOpts);
    const parts: StreamPart[] = [];
    const collectionPromise = (async () => {
      for await (const p of stream) parts.push(p);
    })();
    await vi.advanceTimersByTimeAsync(120_000 + 1000);
    await collectionPromise;
    const restartParts = parts.filter(p => p.type === "stream-restart");
    expect(restartParts).toHaveLength(1);
    expect(restartParts[0]).toEqual({ type: "stream-restart", attempt: 1 });
    // stream-restart must appear after the first attempt's text-delta and
    // before the second attempt's stream-start.
    const restartIdx = parts.findIndex(p => p.type === "stream-restart");
    const firstTextDeltaIdx = parts.findIndex(p => p.type === "text-delta");
    const secondStreamStartIdx = parts.findIndex((p, i) => i > restartIdx && p.type === "stream-start");
    expect(restartIdx).toBeGreaterThan(firstTextDeltaIdx);
    expect(secondStreamStartIdx).toBeGreaterThan(restartIdx);
  });

  it("emits no stream-restart when the first attempt succeeds", async () => {
    const inner = scriptedModel({
      stream: [() => Promise.resolve({ stream: toStream(goodStreamParts()) })],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const { stream } = await wrapped.doStream!(baseOpts);
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);
    expect(parts.every(p => p.type !== "stream-restart")).toBe(true);
  });

  it("stream-restart for a pre-content retry is emitted but is a no-op reset", async () => {
    // emptyStreamParts has no CONTENT_PARTS, so attempt 0 fails with
    // EmptyResponseError before any content is yielded. Attempt 1 acquires
    // content and emits stream-restart (attempt > 0). resetBlocks() on an empty
    // state is a no-op, so the final result is identical to a single-attempt run.
    const inner = scriptedModel({
      stream: [
        () => Promise.resolve({ stream: toStream(emptyStreamParts()) }),
        () => Promise.resolve({ stream: toStream(goodStreamParts("hello")) }),
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg()));
    const p = wrapped.doStream!(baseOpts);
    await vi.advanceTimersByTimeAsync(1000);
    const { stream } = await p;
    const result = await reassembleStream(stream);
    // The content is correct despite stream-restart being emitted.
    expect((result.content[0] as TextBlock).text).toBe("hello");
  });

  it("a stream-restart alone does not satisfy the content check", async () => {
    // An attempt that yields only stream-start then a synthetic stream-restart
    // (which is not in CONTENT_PARTS) must be treated as an empty response
    // and retried.
    const onRetryAttempt = vi.fn();
    const inner = scriptedModel({
      stream: [
        () => Promise.resolve({ stream: toStream(emptyStreamParts()) }),
        () => Promise.resolve({ stream: toStream(goodStreamParts("ok")) }),
      ],
    });
    const wrapped = wrapProvider(inner, withRetry(cfg({ onRetryAttempt })));
    const p = wrapped.doStream!(baseOpts);
    await vi.advanceTimersByTimeAsync(1000);
    const { stream } = await p;
    const result = await reassembleStream(stream);
    expect((result.content[0] as TextBlock).text).toBe("ok");
    expect(onRetryAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("isRetryableError", () => {
  it("classifies raw status errors: 400/401/403 terminal, 429/500/undefined retryable", () => {
    expect(isRetryableError({ statusCode: 400 })).toBe(false);
    expect(isRetryableError({ statusCode: 401 })).toBe(false);
    expect(isRetryableError({ statusCode: 403 })).toBe(false);
    expect(isRetryableError({ statusCode: 429 })).toBe(true);
    expect(isRetryableError({ statusCode: 500 })).toBe(true);
    expect(isRetryableError({})).toBe(true);
  });

  it("classifies AgentError kinds: rate_limit/network retryable, others terminal", () => {
    expect(isRetryableError(new AgentError("m", "rate_limit"))).toBe(true);
    expect(isRetryableError(new AgentError("m", "network"))).toBe(true);
    expect(isRetryableError(new AgentError("m", "fatal_auth"))).toBe(false);
    expect(isRetryableError(new AgentError("m", "bad_request"))).toBe(false);
    expect(isRetryableError(new AgentError("m", "aborted"))).toBe(false);
    expect(isRetryableError(new AgentError("m", "max_iterations"))).toBe(false);
  });

  it("classifies mapped AgentError from provider errors end-to-end: 500/429 retryable, 400/401 terminal", () => {
    expect(isRetryableError(mapToAgentError(makeMockError({ status: 500 })))).toBe(true);
    expect(isRetryableError(mapToAgentError(makeMockError({ status: 429 })))).toBe(true);
    expect(isRetryableError(mapToAgentError(makeMockError({ status: 400 })))).toBe(false);
    expect(isRetryableError(mapToAgentError(makeMockError({ status: 401 })))).toBe(false);
  });
});
