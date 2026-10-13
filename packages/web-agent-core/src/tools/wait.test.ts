import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runWait } from "./wait.js";
import type { ToolContext } from "./build-tools.js";

function mockCtx(signal: AbortSignal): ToolContext {
  return {
    app: { appName: "test" },
    signal,
  };
}

describe("runWait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with Waited Ns. after the given seconds", async () => {
    const ac = new AbortController();
    const promise = runWait({ seconds: 5 }, mockCtx(ac.signal));

    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.content).toBe("Waited 5s.");
    expect(result.isError).toBeUndefined();
  });

  it("does not resolve before the full duration", async () => {
    const ac = new AbortController();
    const promise = runWait({ seconds: 5 }, mockCtx(ac.signal));

    await vi.advanceTimersByTimeAsync(4999);

    // Use a microtask check: the promise should not have settled yet.
    const early = await Promise.race([
      promise.then((r) => ({ settled: true, result: r })),
      Promise.resolve({ settled: false, result: null }),
    ]);
    expect(early.settled).toBe(false);
  });

  it("aborts early when ctx.signal is aborted mid-wait", async () => {
    const ac = new AbortController();
    const promise = runWait({ seconds: 10 }, mockCtx(ac.signal));

    await vi.advanceTimersByTimeAsync(1000);
    ac.abort();

    const result = await promise;
    expect(result.content).toBe("Wait aborted after less than 10s.");
  });

  it("returns immediately when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const result = await runWait({ seconds: 5 }, mockCtx(ac.signal));
    expect(result.content).toBe("Wait aborted before starting.");

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it("rejects (returns isError) when seconds exceeds WAIT_MAX_SECONDS", async () => {
    const ac = new AbortController();

    const result31 = await runWait({ seconds: 31 }, mockCtx(ac.signal));
    expect(result31.isError).toBe(true);
    expect(result31.content).toMatch(/Must be between 1 and 30/);

    const result999 = await runWait({ seconds: 999 }, mockCtx(ac.signal));
    expect(result999.isError).toBe(true);
    expect(result999.content).toMatch(/Must be between 1 and 30/);
  });

  it("rejects (returns isError) when seconds is below 1", async () => {
    const ac = new AbortController();

    const result0 = await runWait({ seconds: 0 }, mockCtx(ac.signal));
    expect(result0.isError).toBe(true);
    expect(result0.content).toMatch(/Must be between 1 and 30/);

    const resultNeg = await runWait({ seconds: -1 }, mockCtx(ac.signal));
    expect(resultNeg.isError).toBe(true);
    expect(resultNeg.content).toMatch(/Must be between 1 and 30/);
  });

  it("rejects non-finite seconds defensively", async () => {
    const ac = new AbortController();

    const resultNaN = await runWait({ seconds: NaN }, mockCtx(ac.signal));
    expect(resultNaN.isError).toBe(true);
    expect(resultNaN.content).toMatch(/Invalid seconds/);
  });
});
