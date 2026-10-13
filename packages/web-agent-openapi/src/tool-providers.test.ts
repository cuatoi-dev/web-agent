import { describe, it, expect, vi, afterEach } from "vitest";
import { openApiToolProviders } from "./tool-providers.js";
import { ApiRequiredSourceError, type loadApiSource } from "./connect-sources.js";
import type { ApiSourceConfig, ApiToolDef } from "./types.js";

function src(name: string, required: boolean, overrides: Partial<ApiSourceConfig> = {}): ApiSourceConfig {
  return {
    name,
    description: `desc-${name}`,
    specUrl: `http://x/${name}/openapi.json`,
    operations: ["listCats"],
    credentials: "same-origin",
    required,
    ...overrides,
  };
}

function mkToolDef(name: string, source: ApiSourceConfig): ApiToolDef {
  return {
    toolDef: {
      name,
      description: name,
      inputSchema: { type: "object", properties: {} },
      execute: vi.fn(() => Promise.resolve({ content: "ok" })),
    },
    source,
    descriptor: { operationId: "listCats", method: "get", path: "/x", parameters: [] },
    paramLocations: { path: [], query: [], hasBody: false },
  };
}

const mkLoad = (names: string[]) =>
  vi.fn((s: ApiSourceConfig): Promise<ApiToolDef[]> =>
    Promise.resolve(names.map((op) => mkToolDef(`${s.name}_${op}`, s))),
  );

const SPEC = {
  openapi: "3.0.0",
  info: { title: "demo", version: "1" },
  paths: {
    "/cats": {
      get: {
        operationId: "listCats",
        summary: "List cats",
      },
    },
  },
};

describe("openApiToolProviders", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it("returns exactly one provider named openapi and required", () => {
    const providers = openApiToolProviders([src("a", true), src("b", false)]);
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("openapi");
    expect(providers[0].required).toBe(true);
    expect(typeof providers[0].dispose).toBe("undefined");
  });

  it("an empty source list still returns one provider whose load() returns no tools", async () => {
    const load = vi.fn();
    const providers = openApiToolProviders([], { load: load as unknown as typeof loadApiSource });
    expect(providers).toHaveLength(1);
    await expect(providers[0].load()).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("load() returns exactly the tools connectApiSources returns", async () => {
    const load = mkLoad(["listCats"]);
    const providers = openApiToolProviders([src("a", true), src("b", true)], {
      load: load as unknown as typeof loadApiSource,
    });

    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(["a_listCats", "b_listCats"]);
    expect(tools[0].promptSnippet).toBe("a (API source) — desc-a");
    expect(tools[1].promptSnippet).toBe("b (API source) — desc-b");
  });

  it("options.baseUrl reaches the spec fetch", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(SPEC), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const source = src("demo", true, {
      specUrl: "/demo/openapi.json",
      operations: ["listCats"],
      fetch: fetchFn as unknown as typeof fetch,
    });

    const providers = openApiToolProviders([source], { baseUrl: "http://example.test/app/" });
    const tools = await providers[0].load();

    expect(tools.map((t) => t.name)).toEqual(["demo_listCats"]);
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe("http://example.test/demo/openapi.json");
  });

  it("a required source failure rejects load(), so core's runner sees a required failure", async () => {
    const load = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const providers = openApiToolProviders([src("bad", true)], {
      load: load as unknown as typeof loadApiSource,
    });

    const caught: unknown = await providers[0].load().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiRequiredSourceError);
    expect((caught as ApiRequiredSourceError).message).toContain("bad");
  });

  it("an optional source failure resolves load() with the surviving source's tools", async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi
      .fn()
      .mockImplementationOnce((s: ApiSourceConfig) => Promise.resolve([mkToolDef(`${s.name}_listCats`, s)]))
      .mockImplementationOnce(() => Promise.reject(new TypeError("down")));
    const providers = openApiToolProviders([src("good", true), src("bad", false)], {
      load: load as unknown as typeof loadApiSource,
    });

    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(["good_listCats"]);
    expect(warnSpy).toHaveBeenCalled();
  });
});
