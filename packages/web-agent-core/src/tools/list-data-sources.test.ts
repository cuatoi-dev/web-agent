import { describe, it, expect } from "vitest";
import { runListDataSources } from "./list-data-sources.js";
import type { ToolContext } from "./build-tools.js";
import { DataSourceProvider } from "../datasource/provider.js";
import type { SourceSummary, SourceInfo } from "../datasource/types.js";

function mockProvider(overrides?: Partial<DataSourceProvider>): DataSourceProvider {
  return {
    listSources() {
      return Promise.resolve([
        { name: "orders", description: "Orders", rowCount: 10, fieldCount: 2, fieldTypes: { string: 1, number: 1 } },
        { name: "products", description: "Products", rowCount: 5, fieldCount: 1, fieldTypes: { string: 1 } },
      ]);
    },
    describeSource(name: string) {
      return Promise.resolve({ name, description: "Test", fields: [{ name: "id", type: "string" }], rowCount: 1 });
    },
    query() {
      return Promise.resolve({ source: "orders", aggregated: false, fields: [], rows: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
    },
    getFieldDetails(query) {
      return Promise.resolve({ source: query.source, fields: [], total: 0, offset: 0, limit: 50, hasMore: false });
    },
    sampleValues(query) {
      return Promise.resolve({ source: query.source, field: query.field, values: [], hasMore: false });
    },
    ...overrides,
  };
}

function mockCtx(dataSource?: DataSourceProvider): ToolContext {
  return {
    app: { appName: "test" },
    signal: new AbortController().signal,
    dataSource,
  };
}

describe("runListDataSources", () => {
  it("returns all sources when no source param given", async () => {
    const ctx = mockCtx(mockProvider());
    const out = await runListDataSources({}, ctx);
    const parsed = JSON.parse(out.content) as SourceSummary[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("orders");
    expect(typeof parsed[0].fieldCount).toBe("number");
    expect(typeof parsed[0].fieldTypes).toBe("object");
  });

  it("the listing carries no field entries and no enum values", async () => {
    const ctx = mockCtx(mockProvider());
    const out = await runListDataSources({}, ctx);
    expect(out.content).not.toContain('"fields"');
    expect(out.content).not.toContain('"enumValues"');
    expect(out.content).not.toContain('"unsupportedFields"');
  });

  it("returns single source description when source param given", async () => {
    const ctx = mockCtx(mockProvider());
    const out = await runListDataSources({ source: "products" }, ctx);
    const parsed = JSON.parse(out.content) as SourceInfo;
    expect(parsed.name).toBe("products");
  });

  it("describing one source still returns its full field schemas", async () => {
    const ctx = mockCtx(mockProvider());
    const out = await runListDataSources({ source: "products" }, ctx);
    const parsed = JSON.parse(out.content) as SourceInfo;
    expect(Array.isArray(parsed.fields)).toBe(true);
    expect(parsed.fields[0].name).toBeDefined();
    expect(parsed.fields[0].type).toBeDefined();
  });

  it("returns error when dataSource not in context", async () => {
    const ctx = mockCtx(undefined);
    const out = await runListDataSources({}, ctx);
    expect(out.content).toContain("dataSource not available");
  });
});
