import { describe, it, expect } from "vitest";
import { runGetFieldDetails, serializeFieldDetailsResult } from "./get-field-details.js";
import type { ToolContext } from "./build-tools.js";
import type { DataSourceProvider } from "../datasource/provider.js";
import { createDataSourceProvider } from "../datasource/provider.js";
import type {
  FieldAllowEntry, FieldDetailsResult, FieldSchema, SourceInfo,
  UnsupportedField,
} from "../datasource/types.js";
import type { SourceEntry } from "../datasource/registry.js";

const TEST_FIELDS: FieldSchema[] = [
  { name: "id", type: "string", label: "Product ID", description: "Unique identifier" },
  { name: "name", type: "string", label: "Product name", description: "Item title" },
  { name: "category_code_01", type: "string", label: "Category", description: "Primary classification" },
  { name: "category_code_02", type: "string", label: "Subcategory", description: "Secondary classification" },
  { name: "price", type: "number", label: "Price", description: "Unit price in USD" },
  { name: "unindexed_notes", type: "string", limitation: "Cannot be sorted or grouped." },
  { name: "inStock", type: "boolean" },
];

const ALLOW: FieldAllowEntry[] = [
  { name: "id", label: "Product code" },
  { name: "name", label: "Product name" },
  { name: "category_code_01", label: "Category" },
  { name: "price", label: "Shelf price" },
];

function createMockSource(allowFields?: FieldAllowEntry[], unsupportedFields?: UnsupportedField[]): SourceEntry {
  return {
    allowFields,
    describe(): SourceInfo {
      const info: SourceInfo = {
        name: "products",
        description: "Product catalog",
        fields: TEST_FIELDS,
        rowCount: 10,
      };
      if (unsupportedFields) info.unsupportedFields = unsupportedFields;
      return info;
    },
    query() {
      return Promise.resolve({ source: "products", aggregated: false, fields: [], rows: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } });
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

describe("runGetFieldDetails", () => {
  it("returns field details for all fields when no filter given", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);
    const out = await runGetFieldDetails({ source: "products" }, ctx);
    const parsed = JSON.parse(out.content) as FieldDetailsResult;

    expect(parsed.source).toBe("products");
    expect(parsed.fields).toHaveLength(7);
    expect(parsed.total).toBe(7);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.fields[0].name).toBe("id");
    expect(parsed.fields[0].type).toBe("string");
    expect(parsed.fields[0].label).toBe("Product ID");
  });

  it("filters fields by name substring case-insensitively", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);
    const out = await runGetFieldDetails({ source: "products", filter: "category" }, ctx);
    const parsed = JSON.parse(out.content) as FieldDetailsResult;

    expect(parsed.fields).toHaveLength(2);
    expect(parsed.total).toBe(2);
    expect(parsed.fields.map((f: { name: string }) => f.name)).toEqual(["category_code_01", "category_code_02"]);
  });

  it("filters fields by description and label", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);

    const descOut = await runGetFieldDetails({ source: "products", filter: "item title" }, ctx);
    const descParsed = JSON.parse(descOut.content) as FieldDetailsResult;
    expect(descParsed.fields).toHaveLength(1);
    expect(descParsed.fields[0].name).toBe("name");

    const labelOut = await runGetFieldDetails({ source: "products", filter: "product id" }, ctx);
    const labelParsed = JSON.parse(labelOut.content) as FieldDetailsResult;
    expect(labelParsed.fields).toHaveLength(1);
    expect(labelParsed.fields[0].name).toBe("id");
  });

  it("supports pagination with offset and limit", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);

    const page1 = await runGetFieldDetails({ source: "products", offset: 0, limit: 3 }, ctx);
    const p1 = JSON.parse(page1.content) as FieldDetailsResult;
    expect(p1.fields).toHaveLength(3);
    expect(p1.hasMore).toBe(true);
    expect(p1.offset).toBe(0);
    expect(p1.limit).toBe(3);
    expect(p1.total).toBe(7);

    const page2 = await runGetFieldDetails({ source: "products", offset: 3, limit: 3 }, ctx);
    const p2 = JSON.parse(page2.content) as FieldDetailsResult;
    expect(p2.fields).toHaveLength(3);
    expect(p2.hasMore).toBe(true);
    expect(p2.offset).toBe(3);

    const page3 = await runGetFieldDetails({ source: "products", offset: 6, limit: 3 }, ctx);
    const p3 = JSON.parse(page3.content) as FieldDetailsResult;
    expect(p3.fields).toHaveLength(1);
    expect(p3.hasMore).toBe(false);

    // Verify slices do not overlap
    const allNames = [...p1.fields, ...p2.fields, ...p3.fields].map((f: { name: string }) => f.name);
    expect(new Set(allNames).size).toBe(7);
  });

  it("honours allow-list and excludes hidden fields", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource(ALLOW)] });
    const ctx = mockCtx(provider);
    const out = await runGetFieldDetails({ source: "products" }, ctx);
    const parsed = JSON.parse(out.content) as FieldDetailsResult;

    expect(parsed.fields).toHaveLength(4);
    expect(parsed.total).toBe(4);
    const names = parsed.fields.map((f: { name: string }) => f.name);
    expect(names).toEqual(["id", "name", "category_code_01", "price"]);
    expect(names).not.toContain("inStock");
    expect(names).not.toContain("unindexed_notes");
  });

  it("returns limitation when present on a field", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);
    const out = await runGetFieldDetails({ source: "products", filter: "unindexed" }, ctx);
    const parsed = JSON.parse(out.content) as FieldDetailsResult;

    expect(parsed.fields[0].limitation).toBe("Cannot be sorted or grouped.");
  });

  it("returns error when source is unknown", async () => {
    const provider = createDataSourceProvider({ sources: [createMockSource()] });
    const ctx = mockCtx(provider);
    await expect(runGetFieldDetails({ source: "bogus" }, ctx)).rejects.toThrow(/Unknown source/);
  });

  it("returns error when dataSource is missing from context", async () => {
    const ctx = mockCtx(undefined);
    const out = await runGetFieldDetails({ source: "products" }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain("dataSource not available");
  });

  it("runGetFieldDetails serializes unsupported fields for the model", async () => {
    const unsupported: UnsupportedField[] = [
      { name: "location", esType: "geo_point", reason: "geo_point has no equivalent query type." },
    ];
    const provider = createDataSourceProvider({ sources: [createMockSource(undefined, unsupported)] });
    const ctx = mockCtx(provider);
    const out = await runGetFieldDetails({ source: "products", filter: "location" }, ctx);

    expect(out.isError).toBeUndefined();
    const parsed = JSON.parse(out.content) as FieldDetailsResult;
    expect(parsed.fields).toHaveLength(0);
    expect(parsed.unsupportedFields![0].reason).toBe("geo_point has no equivalent query type.");
    expect(parsed.unsupportedFields![0].esType).toBe("geo_point");
  });

  it("the budget counts unsupported entries and reports the drop", () => {
    const unsupported: UnsupportedField[] = [1, 2, 3, 4, 5].map((i) => ({
      name: `unusable_${i}`,
      esType: `special_type_${i}`,
      reason: `Type special_type_${i} has no equivalent query type, so it cannot be selected, filtered, sorted or grouped.`,
    }));
    const result: FieldDetailsResult = {
      source: "products",
      fields: TEST_FIELDS,
      total: TEST_FIELDS.length,
      offset: 0,
      limit: TEST_FIELDS.length,
      hasMore: false,
      unsupportedFields: unsupported,
    };

    // A budget under the compact size of the full payload forces a drop.
    const fullCompactChars = JSON.stringify(result).length;
    const maxChars = fullCompactChars - 20;
    const serialized = serializeFieldDetailsResult(result, maxChars);
    const parsed = JSON.parse(serialized) as FieldDetailsResult;

    expect(parsed.truncation!.requested).toBe(TEST_FIELDS.length + unsupported.length);
    expect(parsed.truncation!.included).toBe(
      parsed.fields.length + (parsed.unsupportedFields?.length ?? 0),
    );
    expect(parsed.truncation!.dropped).toBe(
      parsed.truncation!.requested - parsed.truncation!.included,
    );
    expect(parsed.truncation!.dropped).toBeGreaterThan(0);
    expect(serialized.length).toBeLessThanOrEqual(maxChars);
  });

  it("the budget drops unsupported entries before usable fields", () => {
    const unsupported: UnsupportedField[] = [1, 2, 3, 4, 5].map((i) => ({
      name: `unusable_${i}`,
      esType: `special_type_${i}`,
      reason: `Type special_type_${i} has no equivalent query type, so it cannot be selected, filtered, sorted or grouped.`,
    }));
    const result: FieldDetailsResult = {
      source: "products",
      fields: TEST_FIELDS,
      total: TEST_FIELDS.length,
      offset: 0,
      limit: TEST_FIELDS.length,
      hasMore: false,
      unsupportedFields: unsupported,
    };

    const fullCompactChars = JSON.stringify(result).length;
    const serialized = serializeFieldDetailsResult(result, fullCompactChars - 20);
    const parsed = JSON.parse(serialized) as FieldDetailsResult;

    // Every usable field survives; the drop comes out of the unsupported list.
    expect(parsed.fields).toHaveLength(TEST_FIELDS.length);
    expect((parsed.unsupportedFields ?? []).length).toBeLessThan(unsupported.length);
  });

  it("an extreme budget still returns valid JSON with no unsupported key", () => {
    const unsupported: UnsupportedField[] = [
      { name: "location", esType: "geo_point", reason: "no query type" },
    ];
    const result: FieldDetailsResult = {
      source: "products",
      fields: TEST_FIELDS,
      total: TEST_FIELDS.length,
      offset: 0,
      limit: TEST_FIELDS.length,
      hasMore: false,
      unsupportedFields: unsupported,
    };

    const serialized = serializeFieldDetailsResult(result, 50);
    const parsed = JSON.parse(serialized) as FieldDetailsResult;

    expect(parsed.fields).toEqual([]);
    expect("unsupportedFields" in parsed).toBe(false);
    expect(parsed.truncation!.requested).toBe(TEST_FIELDS.length + unsupported.length);
    expect(parsed.truncation!.dropped).toBe(parsed.truncation!.requested);
  });

  it("truncates result with TruncationReport when exceeding maxChars", () => {
    const bigResult = {
      source: "products",
      fields: TEST_FIELDS,
      total: TEST_FIELDS.length,
      offset: 0,
      limit: TEST_FIELDS.length,
      hasMore: false,
    };

    // Serialize with a 400 chars budget (full payload is ~960 chars pretty, ~660 compact)
    const serialized = serializeFieldDetailsResult(bigResult, 400);
    const parsed = JSON.parse(serialized) as FieldDetailsResult;

    expect(parsed.truncation).toBeDefined();
    expect(parsed.truncation!.requested).toBe(TEST_FIELDS.length);
    expect(parsed.truncation!.dropped).toBeGreaterThan(0);
    expect(parsed.truncation!.reason).toContain("exceeded character budget");
    expect(parsed.truncation!.fieldsTruncated).toBe(true);
    expect(serialized.length).toBeLessThanOrEqual(400);

    // Fallback on extreme small budget still returns valid JSON
    const extreme = serializeFieldDetailsResult(bigResult, 50);
    expect(() => JSON.parse(extreme) as unknown).not.toThrow();
  });
});
