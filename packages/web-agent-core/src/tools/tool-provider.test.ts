import { describe, it, expect, vi } from "vitest";
import {
  loadToolProviders,
  RequiredToolProviderError,
  type ToolProvider,
} from "./tool-provider.js";
import type { CustomToolDef } from "./build-tools.js";

const mkTool = (name: string): CustomToolDef => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: "object" },
  execute: () => Promise.resolve({ content: "ok" }),
});

// `disposeSpy` is a plain property (not part of ToolProvider) so a test can
// assert on it directly without reading `.dispose` back off the object,
// which would detach a method from its receiver (unbound-method). Return
// type is inferred (not annotated) so it stays exactly what's returned.
const mkProvider = (
  name: string,
  required: boolean,
  toolNames: string[],
  delayMs = 0,
) => {
  const loadFn = vi.fn().mockImplementation(async () => {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return toolNames.map(mkTool);
  });
  const disposeFn = vi.fn().mockImplementation(async () => {});
  return {
    name,
    required,
    load: loadFn,
    dispose: disposeFn,
    disposeSpy: disposeFn,
  };
};

const mkFailing = (
  name: string,
  required: boolean,
  err: unknown,
  delayMs = 0,
): ToolProvider & { load: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } => {
  const loadFn = vi.fn().mockImplementation(async () => {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw err;
  });
  const disposeFn = vi.fn().mockImplementation(async () => {});
  return {
    name,
    required,
    load: loadFn,
    dispose: disposeFn,
  };
};

describe("loadToolProviders", () => {
  it("undefined -> empty result, no loads", async () => {
    const result = await loadToolProviders(undefined);
    expect(result).toEqual({ tools: [], loaded: [], failures: [] });
  });

  it("empty array -> empty result, no loads", async () => {
    const result = await loadToolProviders([]);
    expect(result).toEqual({ tools: [], loaded: [], failures: [] });
  });

  it("collects tools from a single provider", async () => {
    const p = mkProvider("p", false, ["p_t1", "p_t2"]);
    const result = await loadToolProviders([p]);
    expect(result.tools.map((t) => t.name)).toEqual(["p_t1", "p_t2"]);
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]).toBe(p);
    expect(result.failures).toHaveLength(0);
  });

  it("collects tools from two providers in configured order", async () => {
    const a = mkProvider("a", false, ["a_t1"], 20); // slower
    const b = mkProvider("b", false, ["b_t1"], 5);  // faster
    const result = await loadToolProviders([a, b]);
    expect(result.tools.map((t) => t.name)).toEqual(["a_t1", "b_t1"]);
    expect(result.loaded).toEqual([a, b]);
  });

  it("required failure throws RequiredToolProviderError", async () => {
    const bad = mkFailing("bad", true, new Error("connection failed"));
    await expect(loadToolProviders([bad])).rejects.toThrow(RequiredToolProviderError);
    try {
      await loadToolProviders([bad]);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RequiredToolProviderError);
      if (err instanceof RequiredToolProviderError) {
        expect(err.failures).toHaveLength(1);
        expect(err.failures[0].provider.name).toBe("bad");
        expect(err.message).toContain('"bad": connection failed');
      }
    }
  });

  it("required failure disposes providers that already loaded", async () => {
    const a = mkProvider("a", false, ["a_t1"]);
    const b = mkFailing("b", true, new Error("boom"));
    await expect(loadToolProviders([a, b])).rejects.toThrow(RequiredToolProviderError);
    expect(a.disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("a loaded provider with no dispose does not break the required-failure path", async () => {
    const a: ToolProvider = {
      name: "a",
      required: false,
      load: () => Promise.resolve([mkTool("a_t1")]),
    };
    const b = mkFailing("b", true, new Error("boom"));
    await expect(loadToolProviders([a, b])).rejects.toThrow(RequiredToolProviderError);
  });

  it("optional failure is warned and skipped", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = mkFailing("b", false, new Error("opt fail"));
    const result = await loadToolProviders([b]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('"b"');
    expect(result.tools).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].provider.name).toBe("b");
    spy.mockRestore();
  });

  it("a good provider's tools survive an optional failure", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = mkProvider("a", false, ["a_t1"]);
    const b = mkFailing("b", false, new Error("opt fail"));
    const result = await loadToolProviders([a, b]);
    expect(result.tools.map((t) => t.name)).toEqual(["a_t1"]);
    expect(result.loaded).toEqual([a]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].provider.name).toBe("b");
    spy.mockRestore();
  });

  it("failures are not classified by message text", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f1 = mkFailing("f1", false, new TypeError("type error"));
    const f2 = mkFailing("f2", false, { code: 404, message: "Not Found" });
    const result = await loadToolProviders([f1, f2]);
    expect(result.failures).toHaveLength(2);
    expect(result.tools).toHaveLength(0);
    spy.mockRestore();
  });

  it("loads start concurrently and original rejection object is preserved", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const starts: number[] = [];
    const slow: ToolProvider = {
      name: "slow",
      required: false,
      load: async () => {
        starts.push(Date.now());
        await new Promise((r) => setTimeout(r, 100));
        return [mkTool("slow_t")];
      },
    };
    const fast: ToolProvider = {
      name: "fast",
      required: false,
      load: async () => {
        starts.push(Date.now());
        await new Promise((r) => setTimeout(r, 5));
        return [mkTool("fast_t")];
      },
    };

    const startMs = Date.now();
    await loadToolProviders([slow, fast]);
    const elapsed = Date.now() - startMs;

    expect(Math.abs(starts[0] - starts[1])).toBeLessThan(50);
    expect(elapsed).toBeLessThan(300);

    const origErr = new TypeError("preserved error");
    const failing = mkFailing("failing", false, origErr);
    const failResult = await loadToolProviders([failing]);
    expect(failResult.failures[0].error).toBe(origErr);

    spy.mockRestore();
  });
});
