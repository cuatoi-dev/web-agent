import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wrapProvider, withRetry, isRetryableError } from "./middleware.js";
import { createMockProvider, makeMockError } from "./mock-provider.js";
import { createAnthropicLanguageModel } from "./anthropic-provider.js";
import { DEFAULT_CONFIG, type AgentConfig } from "../config.js";
import { AgentError, mapToAgentError } from "../loop/errors.js";
import type { LanguageModel, ProviderCallOptions, ProviderResult } from "./provider.types.js";
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

  it("preserves provider/modelId from inner model when no overrides", () => {
    const inner = makeMock("x");
    const wrapped = wrapProvider(inner, {});
    expect(wrapped.provider).toBe(inner.provider);
    expect(wrapped.modelId).toBe(inner.modelId);
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

/** Build a LanguageModel whose generate behaves differently per call (by index). */
// No return-type annotation — keeps generate typed as Mock<...> (not
// LanguageModel's method-shorthand signature) so `inner.generate` stays
// directly usable with `.toHaveBeenCalledTimes` below.
function scriptedModel(opts: {
  generate?: Array<(o: ProviderCallOptions) => Promise<ProviderResult>>;
}) {
  let gi = 0;
  return {
    provider: "p",
    modelId: "m",
    generate: vi.fn(async (o: ProviderCallOptions) => {
      const fn = opts.generate![Math.min(gi, opts.generate!.length - 1)];
      gi++;
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

  it("a config that omits requestTimeoutMs gets the 15-minute default", async () => {
    // 110/005 P3. Do not spread DEFAULT_CONFIG's own requestTimeoutMs here —
    // the point is the `?? 900_000` fallback in withRetry, which only
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

    await vi.advanceTimersByTimeAsync(899_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
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
// withRetry — hard deadline
//
// One deadline per attempt, never restarted. These tests run the real
// Anthropic provider through the real middleware with an injected fetch.
// ---------------------------------------------------------------------------

const JSON_OK = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "m",
  content: [{ type: "text", text: "hello" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** A fetch that never settles. Records the signal of every call. */
function hangingFetch() {
  const signals: AbortSignal[] = [];
  const fn = vi.fn((_url: unknown, init?: { signal?: AbortSignal | null }) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>(() => {});
  });
  return { fn: fn as unknown as typeof fetch, signals, calls: fn };
}

function realModel(config: AgentConfig, fetchImpl: typeof fetch) {
  return wrapProvider(
    createAnthropicLanguageModel(config, { fetch: fetchImpl }),
    withRetry(config),
  );
}

describe("withRetry — hard deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts at 900000 ms by default, retries after backoff, and rejects when the retry also times out", async () => {
    const { requestTimeoutMs: _omitted, ...withoutTimeout } = cfg({ maxRetries: 1 });
    void _omitted;
    const { fn, signals, calls } = hangingFetch();
    const wrapped = realModel(withoutTimeout, fn);
    const p = wrapped.generate(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError", kind: "network" });

    await vi.advanceTimersByTimeAsync(899_999);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0].aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(signals[1].aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(900_000);
    expect(signals[1].aborted).toBe(true);
    await assertion;
  });

  it("uses a configured deadline and does not restart it when response headers arrive", async () => {
    // Headers arrive at 10 ms; the body never completes. A progress-based
    // timer would restart at 10 ms and abort at 60 ms. The hard deadline
    // aborts at 50 ms.
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn((_url: unknown, init?: { signal?: AbortSignal | null }) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            status: 200,
            json: () => new Promise(() => {}),
          } as unknown as Response);
        }, 10);
      });
    }) as unknown as typeof fetch;
    const wrapped = realModel(cfg({ requestTimeoutMs: 50, maxRetries: 0 }), fetchImpl);
    let settled = false;
    const p = wrapped.generate(baseOpts);
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError" });
    p.catch(() => {}).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signals[0].aborted).toBe(true);
  });

  it("returns a response that completes before the deadline and leaves no timer behind", async () => {
    const baseline = vi.getTimerCount();
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn((_url: unknown, init?: { signal?: AbortSignal | null }) => {
      if (init?.signal) signals.push(init.signal);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON_OK),
      } as unknown as Response);
    }) as unknown as typeof fetch;
    const wrapped = realModel(cfg({ requestTimeoutMs: 50, maxRetries: 3 }), fetchImpl);
    const result = await wrapped.generate(baseOpts);
    expect((result.content[0] as TextBlock).text).toBe("hello");
    expect(vi.getTimerCount()).toBe(baseline);
    await vi.advanceTimersByTimeAsync(60);
    expect(signals[0].aborted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the caller aborts a pending request, and leaves no timer behind", async () => {
    const baseline = vi.getTimerCount();
    const { fn, calls } = hangingFetch();
    const wrapped = realModel(cfg({ maxRetries: 3 }), fn);
    const controller = new AbortController();
    const p = wrapped.generate({ ...baseOpts, abortSignal: controller.signal });
    const assertion = expect(p).rejects.toMatchObject({ name: "AgentError", kind: "aborted" });
    await vi.advanceTimersByTimeAsync(5);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(baseline);
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
