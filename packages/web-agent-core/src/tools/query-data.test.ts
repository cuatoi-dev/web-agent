import { describe, it, expect } from "vitest";
import { runQueryData } from "./query-data.js";
import { buildTools } from "./build-tools.js";
import type { ToolContext } from "./build-tools.js";
import { dataTools } from "./builders.js";
import { selectRequiredForWideSource } from "./error-messages.js";
import { DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD } from "../config.js";
import { DataSourceProvider } from "../datasource/provider.js";
import { runQuery } from "../datasource/query-engine.js";
import type { DataQuery, QueryResult, FieldSchema } from "../datasource/types.js";

function mockProvider(
  fields: Array<{ name: string; type?: string }> = [],
): DataSourceProvider & { queryCalls: DataQuery[]; describeCalls: number } {
  const provider = {
    queryCalls: [] as DataQuery[],
    describeCalls: 0,
    listSources() {
      return Promise.resolve([]);
    },
    describeSource(name: string) {
      provider.describeCalls++;
      return Promise.resolve({ name, description: "", fields: fields as never, rowCount: 0 });
    },
    query(q: DataQuery) {
      provider.queryCalls.push(q);
      if (q.source === "error") {
        return Promise.reject(new Error('Unknown field "bogus".'));
      }
      return Promise.resolve({
        source: q.source,
        aggregated: !!q.aggregate,
        fields: [{ name: "id", type: "string" }],
        rows: [{ id: "1" }, { id: "2" }],
        page: { limit: 10, offset: 0, total: 2, hasMore: false },
      });
    },
  };
  return provider as unknown as DataSourceProvider & { queryCalls: DataQuery[]; describeCalls: number };
}

function fieldList(count: number): Array<{ name: string; type: string }> {
  return Array.from({ length: count }, (_, i) => ({ name: `f${i}`, type: "string" }));
}

function mockCtx(
  dataSource?: DataSourceProvider,
  signal?: AbortSignal,
  wideSourceFieldThreshold?: number,
): ToolContext {
  return {
    app: { appName: "test" },
    signal: signal ?? new AbortController().signal,
    dataSource,
    wideSourceFieldThreshold,
  };
}

describe("runQueryData", () => {
  it("returns serialized query result from provider", async () => {
    const ctx = mockCtx(mockProvider());
    const out = await runQueryData({ source: "orders" }, ctx);
    const parsed = JSON.parse(out.content) as QueryResult;
    expect(parsed.source).toBe("orders");
    expect(parsed.rows).toHaveLength(2);
  });

  it("returns error when dataSource not in context", async () => {
    const ctx = mockCtx(undefined);
    const out = await runQueryData({ source: "orders" }, ctx);
    expect(out.content).toContain("dataSource not available");
  });

  it("returns aborted message when signal is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const ctx = mockCtx(mockProvider(), ac.signal);
    const out = await runQueryData({ source: "orders" }, ctx);
    expect(out.content).toMatch(/aborted/i);
  });

  it("provider error propagates as string", async () => {
    const ctx = mockCtx(mockProvider());
    try {
      await runQueryData({ source: "error" }, ctx);
      expect.fail("should have thrown");
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/Unknown field/);
    }
  });

  describe("wide-source projection guardrail", () => {
    it("no select on a 300-field source returns the guidance error and never queries", async () => {
      const provider = mockProvider(fieldList(300));
      const ctx = mockCtx(provider);
      const out = await runQueryData({ source: "es-orders" }, ctx);
      expect(out.isError).toBe(true);
      expect(out.content).toContain("has 300 columns");
      expect(provider.queryCalls).toHaveLength(0);
    });

    it("select: [] behaves the same as no select", async () => {
      const provider = mockProvider(fieldList(300));
      const ctx = mockCtx(provider);
      const out = await runQueryData({ source: "es-orders", select: [] }, ctx);
      expect(out.isError).toBe(true);
      expect(provider.queryCalls).toHaveLength(0);
    });

    it("select with columns returns rows and queries with that select", async () => {
      const provider = mockProvider(fieldList(300));
      const ctx = mockCtx(provider);
      const out = await runQueryData({ source: "es-orders", select: ["f1", "f2"] }, ctx);
      expect(out.isError).toBeUndefined();
      expect(provider.queryCalls).toHaveLength(1);
      expect(provider.queryCalls[0].select).toEqual(["f1", "f2"]);
    });

    it("a 16-field source with no select still returns rows", async () => {
      const provider = mockProvider(fieldList(16));
      const ctx = mockCtx(provider);
      const out = await runQueryData({ source: "orders" }, ctx);
      expect(out.isError).toBeUndefined();
      expect(provider.queryCalls).toHaveLength(1);
    });

    it("a source with exactly the threshold's field count returns rows (boundary)", async () => {
      const provider = mockProvider(fieldList(40));
      const ctx = mockCtx(provider);
      const out = await runQueryData({ source: "orders" }, ctx);
      expect(out.isError).toBeUndefined();
    });

    it("a source with one more field than the threshold returns the error (boundary)", async () => {
      const provider = mockProvider(fieldList(41));
      const ctx = mockCtx(provider);
      const out = await runQueryData({ source: "orders" }, ctx);
      expect(out.isError).toBe(true);
      expect(out.content).toContain("has 41 columns");
    });

    it("an aggregate query on a wide source returns rows and never describes the source", async () => {
      const provider = mockProvider(fieldList(300));
      const ctx = mockCtx(provider);
      const out = await runQueryData(
        { source: "es-orders", aggregate: { groupBy: [{ field: "status" }], measures: [{ field: "id", op: "count" }] } },
        ctx,
      );
      expect(out.isError).toBeUndefined();
      expect(provider.describeCalls).toBe(0);
      expect(provider.queryCalls).toHaveLength(1);
    });

    it("a host-configured threshold of 500 lets the 300-field source through", async () => {
      const provider = mockProvider(fieldList(300));
      const ctx = mockCtx(provider, undefined, 500);
      const out = await runQueryData({ source: "es-orders" }, ctx);
      expect(out.isError).toBeUndefined();
    });

    it("a host-configured threshold of 2 blocks a 3-field source", async () => {
      const provider = mockProvider(fieldList(3));
      const ctx = mockCtx(provider, undefined, 2);
      const out = await runQueryData({ source: "orders" }, ctx);
      expect(out.isError).toBe(true);
      expect(out.content).toContain("has 3 columns");
      expect(out.content).toContain("2-column limit");
    });

    it("the example fields in the message come from the source's own first two fields", async () => {
      const provider = mockProvider(fieldList(41));
      const ctx = mockCtx(provider);
      const out = await runQueryData({ source: "orders" }, ctx);
      expect(out.content).toContain('"select": ["f0", "f1"]');
    });

    it("an allow-listed source is not wide by its full field count — only the allow-listed count matters", async () => {
      const provider = mockProvider([
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ]);
      const ctx = mockCtx(provider);
      const out = await runQueryData({ source: "es-allow" }, ctx);
      expect(out.isError).toBeUndefined();
    });
});

// A guardrail outcome declared isError:true must survive wrapExecutor.
describe("the wide-source guardrail result reaches the wrapper", () => {
  it("the wide-source guardrail result reaches the wrapper with isError true", async () => {
    const fields = fieldList(300);
    const ctx = mockCtx(mockProvider(fields));
    const { executors } = buildTools(ctx, dataTools());
    const res = await executors.query_data(
      { source: "wide" },
      { abortSignal: ctx.signal, toolCallId: "tc-wide" },
    );

    expect(res.isError).toBe(true);
    // Same builder the tool calls — proves the text is unchanged, not a pasted copy.
    expect(res.content).toBe(
      selectRequiredForWideSource(
        "wide",
        300,
        DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD,
        fields.map((f) => f.name),
      ),
    );
  });
});

// The engine's aggregate rejection must reach the model flagged, not
// as a successful result.
describe("an aggregate rejection reaches the wrapper", () => {
  function engineBackedProvider(): DataSourceProvider & { queryCalls: DataQuery[]; describeCalls: number } {
    const provider = mockProvider(fieldList(2));
    // Only the external boundary is mocked: the provider hands the query to
    // the REAL in-memory engine, so the guard itself produces the failure.
    const engineRows = [
      { region: "east", total: 10 },
      { region: "west", total: 20 },
    ];
    const engineSchema: FieldSchema[] = [
      { name: "region", type: "string" },
      { name: "total", type: "number" },
    ];
    (provider as unknown as { query: (q: DataQuery) => unknown }).query = (q: DataQuery) => {
      provider.queryCalls.push(q);
      return Promise.resolve(runQuery(engineRows, engineSchema, q));
    };
    return provider;
  }

  it("an aggregate query with a top-level sort reaches the wrapper with isError true", async () => {
    const provider = engineBackedProvider();
    const ctx = mockCtx(provider);
    const { executors } = buildTools(ctx, dataTools());
    const res = await executors.query_data(
      {
        source: "es-orders",
        sort: [{ field: "total", dir: "desc" }],
        aggregate: { groupBy: [{ field: "region" }], measures: [{ field: "total", op: "count" }] },
      },
      { abortSignal: ctx.signal, toolCallId: "tc-agg-sort" },
    );

    expect(res.isError).toBe(true);
    expect(res.content).toContain('Top-level "sort" does not apply to an aggregate query');
    expect(res.content).toContain("This query's result columns are:");
  });
});
});
