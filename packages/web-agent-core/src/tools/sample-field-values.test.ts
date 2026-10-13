import { describe, it, expect } from "vitest";
import { runSampleFieldValues, serializeFieldSampleResult } from "./sample-field-values.js";
import type { ToolContext } from "./build-tools.js";
import type { DataSourceProvider } from "../datasource/provider.js";
import { createDataSourceProvider } from "../datasource/provider.js";
import type { FieldAllowEntry, FieldSchema, SourceInfo, FieldSampleResult } from "../datasource/types.js";
import type { SourceEntry } from "../datasource/registry.js";

const TEST_FIELDS: FieldSchema[] = [
  { name: "id", type: "string" },
  { name: "category", type: "string" },
  { name: "inStock", type: "boolean" },
];

const TEST_ROWS = [
  { id: "1", category: "Food", inStock: true },
  { id: "2", category: "Toys", inStock: true },
  { id: "3", category: "Food", inStock: false },
  { id: "4", category: "Beds", inStock: true },
  { id: "5", category: "Toys", inStock: false },
];

const ALLOW: FieldAllowEntry[] = [
  { name: "id", label: "Product ID" },
  { name: "category", label: "Product Category" },
];

function createMockSource(allowFields?: FieldAllowEntry[]): SourceEntry {
  return {
    allowFields,
    describe(): SourceInfo {
      return {
        name: "products",
        description: "Product catalog",
        fields: TEST_FIELDS,
        rowCount: TEST_ROWS.length,
      };
    },
    query() {
      return Promise.resolve({ source: "products", aggregated: false, fields: [], rows: TEST_ROWS, page: { limit: 10, offset: 0, total: 5, hasMore: false } });
    },
    sampleValues(field: string, limit = 20) {
      const distinct = Array.from(new Set(TEST_ROWS.map((r) => r[field as keyof typeof TEST_ROWS[0]])));
      return Promise.resolve({
        values: distinct.slice(0, limit),
        hasMore: distinct.length > limit,
      });
    },
  };
}

function mockCtx(provider?: DataSourceProvider, queryResultMaxChars?: number): ToolContext {
  return {
    app: { appName: "test" },
    signal: new AbortController().signal,
    dataSource: provider,
    queryResultMaxChars,
  };
}

describe("runSampleFieldValues", () => {
  it("returns distinct values for a field with hasMore false when within limit", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);
    const out = await runSampleFieldValues({ source: "products", field: "category", limit: 10 }, ctx);
    const parsed = JSON.parse(out.content) as FieldSampleResult;

    expect(parsed.source).toBe("products");
    expect(parsed.field).toBe("category");
    expect(parsed.values).toEqual(["Food", "Toys", "Beds"]);
    expect(parsed.hasMore).toBe(false);
  });

  it("respects limit and sets hasMore true when more values exist", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);
    const out = await runSampleFieldValues({ source: "products", field: "category", limit: 2 }, ctx);
    const parsed = JSON.parse(out.content) as FieldSampleResult;

    expect(parsed.values).toHaveLength(2);
    expect(parsed.hasMore).toBe(true);
  });

  it("rejects sampling a field not present in allow-list", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource(ALLOW)] });
    const ctx = mockCtx(provider);
    await expect(
      runSampleFieldValues({ source: "products", field: "inStock" }, ctx),
    ).rejects.toThrow(/not available/);
  });

  it("rejects sampling on unknown source", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);
    await expect(
      runSampleFieldValues({ source: "nonexistent", field: "category" }, ctx),
    ).rejects.toThrow(/Unknown source/);
  });

  it("returns error when dataSource is missing from context", async () => {
    const ctx = mockCtx(undefined);
    const out = await runSampleFieldValues({ source: "products", field: "category" }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain("dataSource not available");
  });

  it("truncates result with TruncationReport when exceeding maxChars", () => {
    const bigResult = {
      source: "products",
      field: "category",
      values: Array.from({ length: 10 }, (_, i) => `Very long category name ${i + 1}`),
      hasMore: true,
      total: 10,
    };

    // Serialize with 250 chars budget (full pretty payload is ~430 chars)
    const serialized = serializeFieldSampleResult(bigResult, 250);
    const parsed = JSON.parse(serialized) as FieldSampleResult;

    expect(parsed.truncation).toBeDefined();
    expect(parsed.truncation!.requested).toBe(10);
    expect(parsed.truncation!.dropped).toBeGreaterThan(0);
    expect(parsed.truncation!.reason).toContain("exceeded character budget");
    expect(serialized.length).toBeLessThanOrEqual(250);

    // Fallback on extreme small budget still returns valid JSON
    const extreme = serializeFieldSampleResult(bigResult, 50);
    expect(() => JSON.parse(extreme) as unknown).not.toThrow();
  });
});
