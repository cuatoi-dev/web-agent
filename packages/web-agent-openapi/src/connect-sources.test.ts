import { describe, it, expect, vi, afterEach } from "vitest";
import {
  connectApiSources,
  ApiRequiredSourceError,
  type ConnectApiSourcesResult,
} from "./connect-sources.js";
import type { ApiSourceConfig, ApiToolDef } from "./types.js";
import { buildSystemPromptParts } from "@cuatoi/web-agent-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC = {
  openapi: "3.0.0",
  info: { title: "demo", version: "1" },
  paths: {
    "/cats": {
      get: {
        operationId: "listCats",
        summary: "List cats",
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
      },
    },
    "/cats/{id}": {
      get: {
        operationId: "getCat",
        summary: "Get one cat",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
      },
    },
  },
};

const specFetch = () =>
  vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(SPEC), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

const cfg = (
  name: string,
  required: boolean,
  overrides: Partial<ApiSourceConfig> = {},
): ApiSourceConfig => ({
  name,
  description: `desc-${name}`,
  specUrl: `http://x/${name}/openapi.json`,
  operations: ["listCats"],
  credentials: "same-origin",
  required,
  ...overrides,
});

/** A per-source load that returns one tool per op name, named `<source>_<op>`. */
const mkLoad = (names: string[], delayMs = 0) =>
  async (s: ApiSourceConfig): Promise<ApiToolDef[]> => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return names.map((op): ApiToolDef => ({
      toolDef: {
        name: `${s.name}_${op}`,
        description: op,
        inputSchema: { type: "object", properties: {} },
        execute: () => Promise.resolve({ content: "ok" }),
      },
      source: s,
      descriptor: { operationId: op, method: "get", path: "/x", parameters: [] },
      paramLocations: { path: [], query: [], hasBody: false },
    }));
  };

const mkReject = (err: unknown) => async (): Promise<ApiToolDef[]> => {
  await Promise.resolve();
  throw err;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("connectApiSources", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it("returns an empty result and makes no calls when apiSources is undefined", async () => {
    const load = vi.fn(mkLoad(["t1"]));
    const result = await connectApiSources(undefined, { load });
    expect(result).toEqual({ tools: [], failures: [] });
    expect(load).not.toHaveBeenCalled();
  });

  it("returns an empty result for an empty array", async () => {
    const load = vi.fn(mkLoad(["t1"]));
    const result = await connectApiSources([], { load });
    expect(result).toEqual({ tools: [], failures: [] });
    expect(load).not.toHaveBeenCalled();
  });

  it("generates one tool per whitelisted operation, in whitelist order", async () => {
    const result = await connectApiSources(
      [cfg("demo", true, { operations: ["listCats", "getCat"], fetch: specFetch() })],
      {},
    );
    expect(result.tools.map((t) => t.name)).toEqual(["demo_listCats", "demo_getCat"]);
    expect(result.failures).toHaveLength(0);
  });

  it("follows whitelist order, not document order", async () => {
    const result = await connectApiSources(
      [cfg("demo", true, { operations: ["getCat", "listCats"], fetch: specFetch() })],
      {},
    );
    expect(result.tools.map((t) => t.name)).toEqual(["demo_getCat", "demo_listCats"]);
  });

  it("collects tools from two sources in configured order", async () => {
    const load = vi.fn(mkLoad(["listCats"]));
    const result = await connectApiSources([cfg("a", true), cfg("b", true)], { load });
    expect(result.tools.map((t) => t.name)).toEqual(["a_listCats", "b_listCats"]);
  });

  it("tags every tool from a source with the same promptSnippet and does not mutate the source defs", async () => {
    const load = vi.fn(mkLoad(["listCats", "getCat"]));
    const result = await connectApiSources(
      [{ name: "demo", description: "cat API", specUrl: "http://x/demo", operations: ["listCats", "getCat"], credentials: "same-origin", required: true }],
      { load },
    );
    expect(result.tools).toHaveLength(2);
    const expected = "demo (API source) — cat API";
    for (const tool of result.tools) {
      expect(tool.promptSnippet).toBe(expected);
    }
    // original ApiToolDef.toolDef objects are not mutated
    const defs = (await load.mock.results[0]?.value) as ApiToolDef[];
    expect(defs[0]?.toolDef.promptSnippet).toBeUndefined();
  });

  it("throws ApiRequiredSourceError when a required source fails", async () => {
    const load = vi.fn(mkReject(new TypeError("fetch failed")));
    await expect(
      connectApiSources([cfg("bad", true)], { load }),
    ).rejects.toBeInstanceOf(ApiRequiredSourceError);

    const caught: unknown = await connectApiSources([cfg("bad", true)], { load }).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiRequiredSourceError);
    expect((caught as ApiRequiredSourceError).failures).toHaveLength(1);
    expect((caught as ApiRequiredSourceError).message).toContain("bad");
    expect((caught as ApiRequiredSourceError).message).toContain("http://x/bad");
  });

  it("logs and skips an optional source that fails", async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.fn(mkReject(new TypeError("fetch failed")));
    const result = await connectApiSources([cfg("b", false)], { load });
    expect(result.tools).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.source.name).toBe("b");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = typeof warnSpy.mock.calls[0]?.[0] === "string" ? warnSpy.mock.calls[0][0] : "";
    expect(warnArg).toContain("b");
    expect(warnArg).toContain("http://x/b/openapi.json");
  });

  it("keeps a good source's tools when an optional one fails", async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.fn()
      .mockImplementationOnce(mkLoad(["listCats"]))
      .mockImplementationOnce(mkReject(new Error("down")));

    const result = await connectApiSources([cfg("a", true), cfg("b", false)], { load });
    expect(result.tools).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does not classify failures by message text and preserves the original rejection", async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err1 = new TypeError("fetch failed");
    const err2 = { code: 404 };
    const load = vi.fn()
      .mockImplementationOnce(mkReject(err1))
      .mockImplementationOnce(mkReject(err2));

    const result = await connectApiSources([cfg("a", false), cfg("b", false)], { load });
    expect(result.failures).toHaveLength(2);
    expect(result.tools).toHaveLength(0);
    expect(result.failures[0]?.error).toBe(err1);
    expect(result.failures[1]?.error).toBe(err2);
  });

  it("aggregates every required failure into one error", async () => {
    const load = vi.fn()
      .mockImplementationOnce(mkReject(new TypeError("one")))
      .mockImplementationOnce(mkReject(new TypeError("two")));

    const caught: unknown = await connectApiSources([cfg("a", true), cfg("b", true)], { load })
      .catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiRequiredSourceError);
    expect((caught as ApiRequiredSourceError).failures).toHaveLength(2);
    expect((caught as ApiRequiredSourceError).message).toContain("a");
    expect((caught as ApiRequiredSourceError).message).toContain("b");
  });

  it("starts all loads concurrently", async () => {
    const startTimes: Record<string, number> = {};
    const makeTimed = (name: string, delay: number) => async (s: ApiSourceConfig): Promise<ApiToolDef[]> => {
      startTimes[name] = Date.now();
      await new Promise((r) => setTimeout(r, delay));
      return mkLoad(["listCats"])(s);
    };
    const load = vi.fn()
      .mockImplementationOnce(makeTimed("slow", 150))
      .mockImplementationOnce(makeTimed("fast", 5));

    const before = Date.now();
    const result = await connectApiSources([cfg("slow", true), cfg("fast", true)], { load });
    const elapsed = Date.now() - before;

    expect(Math.abs((startTimes["fast"] ?? 0) - (startTimes["slow"] ?? 0))).toBeLessThan(50);
    expect(elapsed).toBeLessThan(300);
    expect(result.tools).toHaveLength(2);
    expect(result.tools.map((t) => t.name)).toEqual(["slow_listCats", "fast_listCats"]);
  });

  it("a source with an empty whitelist contributes no tools and is not a failure", async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result: ConnectApiSourcesResult = await connectApiSources(
      [cfg("demo", true, { operations: [], fetch: specFetch() })],
      {},
    );
    expect(result.tools).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Failure boundary — real functions running through ApiSourceConfig.fetch
  // ---------------------------------------------------------------------------
  describe("failure boundary", () => {
    it("a spec fetch failure degrades the source", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetch404 = vi.fn(() => Promise.resolve(new Response("not found", { status: 404 })));
      const result = await connectApiSources(
        [cfg("demo", false, { fetch: fetch404 })],
        {},
      );
      expect(result.tools).toHaveLength(0);
      expect(result.failures).toHaveLength(1);
      const msg = (result.failures[0]?.error as Error).message;
      expect(msg).toContain("Failed to fetch OpenAPI document");
    });

    it("a malformed spec body degrades the source", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const badJson = vi.fn(() =>
        Promise.resolve(
          new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } }),
        ),
      );
      const result = await connectSources(
        [cfg("demo", false, { fetch: badJson })],
        {},
      );
      expect(result.failures).toHaveLength(1);
      expect((result.failures[0]?.error as Error).message).toContain("Failed to parse OpenAPI document JSON");
    });

    it("an unknown whitelisted operationId degrades the source", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await connectSources(
        [cfg("demo", false, { operations: ["noSuchOp"], fetch: specFetch() })],
        {},
      );
      expect(result.failures).toHaveLength(1);
      expect((result.failures[0]?.error as Error).message).toContain('whitelists operation "noSuchOp"');
    });

    it("a mapper error degrades the source", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Same parameter name in `path` and `query` is rejected by operationToToolDef.
      const dupSpec = {
        openapi: "3.0.0",
        info: { title: "demo", version: "1" },
        paths: {
          "/cats/{id}": {
            get: {
              operationId: "dupOp",
              parameters: [
                { name: "id", in: "path", required: true, schema: { type: "string" } },
                { name: "id", in: "query", required: false, schema: { type: "string" } },
              ],
            },
          },
        },
      };
      const fetchFn = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(dupSpec), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      const result = await connectSources(
        [cfg("demo", false, { operations: ["dupOp"], fetch: fetchFn })],
        {},
      );
      expect(result.failures).toHaveLength(1);
      expect((result.failures[0]?.error as Error).message).toContain("duplicate parameter name");
    });

    it("the same failure is fatal when the source is required", async () => {
      const fetch404 = vi.fn(() => Promise.resolve(new Response("not found", { status: 404 })));
      await expect(
        connectSources([cfg("demo", true, { fetch: fetch404 })], {}),
      ).rejects.toBeInstanceOf(ApiRequiredSourceError);
    });
  });

  // ---------------------------------------------------------------------------
  // Prompt snippet de-duplication
  // ---------------------------------------------------------------------------
  describe("prompt snippet de-duplication", () => {
    it("a source description renders as exactly one tool-guideline line", async () => {
      const load = vi.fn(mkLoad(["listCats", "getCat", "other"]));
      const result = await connectApiSources(
        [{ name: "demo", description: "cat API", specUrl: "http://x/demo", operations: ["listCats", "getCat", "other"], credentials: "same-origin", required: true }],
        { load },
      );
      const toolSnippets = result.tools
        .map((t) => t.promptSnippet)
        .filter((s): s is string => typeof s === "string");
      const toolNames = result.tools.map((t) => t.name);

      const app: Parameters<typeof buildSystemPromptParts>[0] = {
        appName: "TestApp",
        appDescription: "A test app",
        route: "/",
        stateShapeSummary: "",
      };
      const { full } = buildSystemPromptParts(app, { toolSnippets, toolNames });
      const line = "- demo (API source) — cat API";
      const occurrences = full.split(line).length - 1;
      expect(occurrences).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Tool-name collisions
  // ---------------------------------------------------------------------------
  describe("tool-name collisions", () => {
    it("an optional source that collides is dropped and warned", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // "cat-store" and "cat_store" both sanitize to "cat_store".
      const first = cfg("cat-store", true, { operations: ["listCats"], fetch: specFetch() });
      const second = cfg("cat_store", false, { operations: ["listCats"], fetch: specFetch() });
      const result = await connectSources([first, second], {});
      expect(result.tools.map((t) => t.name)).toEqual(["cat_store_listCats"]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.source.name).toBe("cat_store");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const warnArg = typeof warnSpy.mock.calls[0]?.[0] === "string" ? warnSpy.mock.calls[0][0] : "";
      expect(warnArg).toContain('generates tool name "cat_store_listCats"');
      expect(warnArg).toContain("already provides");
    });

    it("a required source that collides throws", async () => {
      const first = cfg("cat-store", true, { operations: ["listCats"], fetch: specFetch() });
      const second = cfg("cat_store", true, { operations: ["listCats"], fetch: specFetch() });
      const caught: unknown = await connectSources([first, second], {}).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(ApiRequiredSourceError);
      expect((caught as ApiRequiredSourceError).message).toContain("cannot be used together — rename one.");
    });

    it("a colliding source is dropped whole, including its non-colliding tools", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const first = cfg("cat-store", true, { operations: ["listCats"], fetch: specFetch() });
      const second = cfg("cat_store", false, { operations: ["listCats", "getCat"], fetch: specFetch() });
      const result = await connectSources([first, second], {});
      expect(result.tools.map((t) => t.name)).toEqual(["cat_store_listCats"]);
      expect(result.failures).toHaveLength(1);
      // getCat (non-colliding) is absent — the whole source was dropped
    });

    it("the first source in configured order keeps the name", async () => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Colliding source declared FIRST: it keeps the name, the second gets dropped.
      const first = cfg("cat_store", true, { operations: ["listCats"], fetch: specFetch() });
      const second = cfg("cat-store", false, { operations: ["listCats"], fetch: specFetch() });
      const result = await connectSources([first, second], {});
      expect(result.tools.map((t) => t.name)).toEqual(["cat_store_listCats"]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.source.name).toBe("cat-store");
    });
  });
});

// Local helper: connect with the REAL load path (through ApiSourceConfig.fetch).
async function connectSources(
  sources: ApiSourceConfig[],
  options?: { baseUrl?: string },
): Promise<ConnectApiSourcesResult> {
  return connectApiSources(sources, { baseUrl: options?.baseUrl });
}