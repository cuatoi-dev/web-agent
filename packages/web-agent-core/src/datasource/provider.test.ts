import { describe, it, expect, vi } from "vitest";
import { createDataSourceProvider } from "./provider.js";
import type { SourceInfo, DataQuery, QueryResult, FieldAllowEntry, UnsupportedField } from "./types.js";
import type { SourceEntry } from "./registry.js";

const syncSource: SourceEntry = {
  describe(): SourceInfo {
    return {
      name: "products",
      description: "Product catalog",
      fields: [],
      rowCount: 10,
    };
  },
  query(q: DataQuery): Promise<QueryResult> {
    return Promise.resolve({
      source: q.source,
      rows: [{ id: "p1" }],
      fields: [],
      aggregated: false,
      page: { limit: 10, offset: 0, total: 1, hasMore: false },
    });
  },
};

const asyncSource: SourceEntry = {
  describe(): Promise<SourceInfo> {
    return Promise.resolve({
      name: "orders",
      description: "Historical customer orders",
      fields: [],
      rowCount: 200,
    });
  },
  query(q: DataQuery): Promise<QueryResult> {
    return Promise.resolve({
      source: q.source,
      rows: [{ id: "ORD-1" }],
      fields: [],
      aggregated: false,
      page: { limit: 10, offset: 0, total: 1, hasMore: false },
    });
  },
};

describe("DataSourceProvider async describe", () => {
  it("registers an async-describe source before any method touches the registry", async () => {
    const provider = createDataSourceProvider({ sources: [syncSource, asyncSource] });
    const res = await provider.query({ source: "orders" });
    expect(res.rows).toEqual([{ id: "ORD-1" }]);
  });

  it("listSources summarises every source, including async ones", async () => {
    const provider = createDataSourceProvider({ sources: [syncSource, asyncSource] });
    const sources = await provider.listSources();
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => typeof s.name === "string")).toBe(true);
    expect(sources.every((s) => !("then" in s))).toBe(true);
    expect(sources.every((s) => typeof s.fieldCount === "number")).toBe(true);
    expect(sources.every((s) => !("fields" in s))).toBe(true);
    expect(sources.find((s) => s.name === "orders")?.rowCount).toBe(200);
  });

  it("describeSource returns the resolved SourceInfo for an async source", async () => {
    const provider = createDataSourceProvider({ sources: [syncSource, asyncSource] });
    const info = await provider.describeSource("orders");
    expect(info.name).toBe("orders");
    expect(info.rowCount).toBe(200);
  });

  it("a source whose describe rejects is skipped, others still work", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenSource: SourceEntry = {
      async describe(): Promise<SourceInfo> {
        // `require-await`: dropping `async` would turn this into a
        // synchronous throw instead of a rejection — the whole point of
        // this test is exercising a REJECTING describe().
        await Promise.resolve();
        throw new Error("boom");
      },
      async query(): Promise<QueryResult> {
        await Promise.resolve();
        throw new Error("unreachable");
      },
    };

    const provider = createDataSourceProvider({ sources: [syncSource, brokenSource] });
    const sources = await provider.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("products");

    await expect(provider.query({ source: "broken" })).rejects.toThrow(/Unknown source/);
    expect((await provider.query({ source: "products" })).rows).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalledWith("Failed to describe source", expect.objectContaining({ message: "boom" }));

    consoleSpy.mockRestore();
  });

  it.each([
    new DOMException("The user aborted a request.", "AbortError"),
    Object.assign(new Error("Cancelled"), { name: "AbortError" }),
    { name: "AbortError" },
  ])("skips cancelled discovery without logging an error (%s)", async (abortError) => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const cancelledSource: SourceEntry = {
        ...asyncSource,
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Test cancellation errors from another JavaScript context.
        describe: () => Promise.reject(abortError),
      };
      const provider = createDataSourceProvider({ sources: [syncSource, cancelledSource] });
      expect((await provider.listSources()).map((source) => source.name)).toEqual(["products"]);
      expect(consoleSpy).not.toHaveBeenCalled();
      await expect(provider.describeSource("orders")).rejects.toThrow(/Unknown source/);
      expect((await provider.query({ source: "products" })).rows).toEqual([{ id: "p1" }]);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  const PRODUCT_ALLOW: FieldAllowEntry[] = [
    { name: "id", label: "Product code" },
    { name: "name", label: "Product name" },
    { name: "category", label: "Product type" },
    { name: "price", label: "Shelf price" },
  ];

  function allowListedSource(): SourceEntry {
    return {
      allowFields: PRODUCT_ALLOW,
      describe(): SourceInfo {
        return {
          name: "products",
          description: "Product catalog",
          fields: [
            { name: "id", type: "string" },
            { name: "name", type: "string" },
            { name: "category", type: "string" },
            { name: "price", type: "number" },
            { name: "inStock", type: "boolean" },
          ],
          rowCount: 1,
        };
      },
      query(q: DataQuery): Promise<QueryResult> {
        return Promise.resolve({
          source: q.source,
          aggregated: false,
          fields: [],
          rows: [{ id: "p1", name: "Salmon Pate", category: "Food", price: 5.99, inStock: true }],
          page: { limit: 10, offset: 0, total: 1, hasMore: false },
        });
      },
    };
  }

  it("narrows describeSource for an allow-listed source", async () => {
    const provider = createDataSourceProvider({ sources: [allowListedSource()] });
    const info = await provider.describeSource("products");
    expect(info.fields).toHaveLength(4);
    expect(info.fields.map((f) => f.name)).toEqual(["id", "name", "category", "price"]);
    expect(info.fields.every((f) => typeof f.label === "string")).toBe(true);
  });

  it("summarises an allow-listed source from its narrowed fields", async () => {
    const provider = createDataSourceProvider({ sources: [allowListedSource()] });
    const sources = await provider.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].fieldCount).toBe(4);
    expect(sources[0].fieldTypes).toEqual({ string: 3, number: 1 });
  });

  it("a source with no allow-list is summarised from every field it describes", async () => {
    const source: SourceEntry = { ...allowListedSource(), allowFields: [] };
    const provider = createDataSourceProvider({ sources: [source] });
    const sources = await provider.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].fieldCount).toBe(5);
    expect(sources[0].fieldTypes).toEqual({ string: 3, number: 1, boolean: 1 });
  });

  it("the summary carries a source-level error and no field detail", async () => {
    const broken: SourceEntry = {
      describe(): SourceInfo {
        return { name: "failed-source", description: "desc", rowCount: 0, fields: [], error: "discovery failed" };
      },
      query(): Promise<QueryResult> {
        return Promise.resolve({ source: "failed-source", rows: [], fields: [], aggregated: false, page: { limit: 10, offset: 0, total: 0, hasMore: false } });
      },
    };
    const provider = createDataSourceProvider({ sources: [broken] });
    const sources = await provider.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].error).toBe("discovery failed");
    expect(sources[0].fieldCount).toBe(0);
    expect("fields" in sources[0]).toBe(false);
  });

  it("unsupportedFields never reaches the listing but stays on describeSource", async () => {
    const unsuppSource: SourceEntry = {
      describe(): SourceInfo {
        return {
          name: "geo-source",
          description: "desc",
          rowCount: 5,
          fields: [{ name: "id", type: "string" }],
          unsupportedFields: [{ name: "geo", esType: "geo_point", reason: "spatial not supported" }],
        };
      },
      query(): Promise<QueryResult> {
        return Promise.resolve({ source: "geo-source", rows: [], fields: [], aggregated: false, page: { limit: 10, offset: 0, total: 0, hasMore: false } });
      },
    };
    const provider = createDataSourceProvider({ sources: [unsuppSource] });
    const sources = await provider.listSources();
    expect(sources).toHaveLength(1);
    expect("unsupportedFields" in sources[0]).toBe(false);
    const info = await provider.describeSource("geo-source");
    expect(info.unsupportedFields).toHaveLength(1);
  });

  it("leaves a source with no allowFields alone", async () => {
    const raw = syncSource;
    const provider = createDataSourceProvider({ sources: [raw] });
    const info = await provider.describeSource("products");
    expect(info).toEqual(await raw.describe());
    expect(info.fields.every((f) => f.label === undefined)).toBe(true);
  });

  it("rejects a hidden-field query through provider.query", async () => {
    const provider = createDataSourceProvider({ sources: [allowListedSource()] });
    await expect(
      provider.query({ source: "products", select: ["inStock"] })
    ).rejects.toThrow(/not available/);
  });

  it("allowFields: [] is treated as no allow-list", async () => {
    const source: SourceEntry = { ...allowListedSource(), allowFields: [] };
    const provider = createDataSourceProvider({ sources: [source] });
    const info = await provider.describeSource("products");
    expect(info.fields).toHaveLength(5);
    expect(info.fields.every((f) => f.label === undefined)).toBe(true);
  });

  it("getFieldDetails filters and pages source fields", async () => {
    const provider = createDataSourceProvider({ sources: [allowListedSource()] });
    const res = await provider.getFieldDetails({ source: "products", filter: "name", limit: 10 });
    expect(res.fields).toHaveLength(1);
    expect(res.fields[0].name).toBe("name");
    expect(res.fields[0].label).toBe("Product name");
    expect(res.total).toBe(1);
    expect(res.hasMore).toBe(false);
  });

  it("getFieldDetails pagination respects offset and limit", async () => {
    const provider = createDataSourceProvider({ sources: [allowListedSource()] });
    const page1 = await provider.getFieldDetails({ source: "products", offset: 0, limit: 2 });
    expect(page1.fields).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.total).toBe(4);

    const page2 = await provider.getFieldDetails({ source: "products", offset: 2, limit: 2 });
    expect(page2.fields).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
    expect(page1.fields[0].name).not.toBe(page2.fields[0].name);
  });

  describe("getFieldDetails unsupported fields", () => {
    // The reason text deliberately holds the words the caller filter must
    // never match ("selected", "filtered", "sorted", "grouped").
    const UNSUPPORTED: UnsupportedField[] = [
      {
        name: "geo",
        esType: "geo_point",
        reason: "geo_point has no equivalent query type, so it cannot be selected, filtered, sorted or grouped.",
      },
      {
        name: "span",
        esType: "integer_range",
        reason: "integer_range has no equivalent query type, so it cannot be selected, filtered, sorted or grouped.",
      },
    ];

    function unsupportedSource(allowFields?: FieldAllowEntry[]): SourceEntry {
      return {
        allowFields,
        describe(): SourceInfo {
          return {
            name: "geo-source",
            description: "Source with spatial and range columns",
            rowCount: 5,
            fields: [
              { name: "id", type: "string" },
              { name: "title", type: "string" },
              { name: "price", type: "number" },
              { name: "created", type: "date" },
            ],
            unsupportedFields: UNSUPPORTED,
          };
        },
        query(): Promise<QueryResult> {
          return Promise.resolve({ source: "geo-source", rows: [], fields: [], aggregated: false, page: { limit: 10, offset: 0, total: 0, hasMore: false } });
        },
      };
    }

    it("getFieldDetails reports unsupported fields with their reason", async () => {
      const provider = createDataSourceProvider({ sources: [unsupportedSource()] });
      const res = await provider.getFieldDetails({ source: "geo-source" });
      expect(res.fields.map((f) => f.name)).toEqual(["id", "title", "price", "created"]);
      expect(res.total).toBe(4);
      expect(res.unsupportedFields).toHaveLength(2);
      expect(res.unsupportedFields![0]).toEqual(UNSUPPORTED[0]);
      expect(res.unsupportedFields![1]).toEqual(UNSUPPORTED[1]);
    });

    it("getFieldDetails narrows unsupported fields with the caller's filter", async () => {
      const provider = createDataSourceProvider({ sources: [unsupportedSource()] });
      const res = await provider.getFieldDetails({ source: "geo-source", filter: "geo" });
      expect(res.fields).toEqual([]);
      expect(res.total).toBe(0);
      expect(res.unsupportedFields!.map((u) => u.name)).toEqual(["geo"]);
    });

    it("getFieldDetails matches an unsupported field by its esType", async () => {
      const provider = createDataSourceProvider({ sources: [unsupportedSource()] });
      const res = await provider.getFieldDetails({ source: "geo-source", filter: "integer_range" });
      expect(res.unsupportedFields!.map((u) => u.name)).toEqual(["span"]);
    });

    it("getFieldDetails does not match unsupported fields on their reason text", async () => {
      const provider = createDataSourceProvider({ sources: [unsupportedSource()] });
      const res = await provider.getFieldDetails({ source: "geo-source", filter: "sorted" });
      expect(res.fields).toEqual([]);
      expect("unsupportedFields" in res).toBe(false);
    });

    it("getFieldDetails omits the key when the source has none", async () => {
      const provider = createDataSourceProvider({ sources: [syncSource] });
      const res = await provider.getFieldDetails({ source: "products" });
      expect("unsupportedFields" in res).toBe(false);
      expect(JSON.stringify(res)).not.toContain("unsupportedFields");
    });

    it("getFieldDetails never reports an unsupported field the host hid", async () => {
      const allow: FieldAllowEntry[] = [
        { name: "id", label: "ID" },
        { name: "title", label: "Title" },
        { name: "span", label: "Span" },
      ];
      const provider = createDataSourceProvider({ sources: [unsupportedSource(allow)] });

      const unfiltered = await provider.getFieldDetails({ source: "geo-source" });
      expect(unfiltered.unsupportedFields!.map((u) => u.name)).toEqual(["span"]);

      const filtered = await provider.getFieldDetails({ source: "geo-source", filter: "geo" });
      expect("unsupportedFields" in filtered).toBe(false);
      expect(JSON.stringify(filtered)).not.toContain('"geo"');
      expect(JSON.stringify(unfiltered)).not.toContain('"geo"');
    });

    it("getFieldDetails keeps the unsupported report on a later page", async () => {
      const provider = createDataSourceProvider({ sources: [unsupportedSource()] });
      const res = await provider.getFieldDetails({ source: "geo-source", offset: 2, limit: 2 });
      expect(res.fields).toHaveLength(2);
      expect(res.unsupportedFields).toHaveLength(2);
    });
  });

  it("sampleValues returns distinct field values", async () => {
    const provider = createDataSourceProvider({ sources: [allowListedSource()] });
    const res = await provider.sampleValues({ source: "products", field: "category", limit: 5 });
    expect(res.values).toEqual(["Food"]);
    expect(res.hasMore).toBe(false);
  });

  it("sampleValues rejects non-allowed fields", async () => {
    const provider = createDataSourceProvider({ sources: [allowListedSource()] });
    await expect(
      provider.sampleValues({ source: "products", field: "inStock" })
    ).rejects.toThrow(/not available/);
  });
});
