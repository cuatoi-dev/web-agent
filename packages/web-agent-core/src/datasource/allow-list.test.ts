import { describe, it, expect, vi } from "vitest";
import { applyAllowList, assertQueryAllowed, withAllowList } from "./allow-list.js";
import { runQuery } from "./query-engine.js";
import type { SourceEntry } from "./registry.js";
import type { DataQuery, FieldAllowEntry, FieldSchema, QueryResult, SourceInfo } from "./types.js";

const FIELDS: FieldSchema[] = [
  { name: "id", type: "string" },
  { name: "name", type: "string" },
  { name: "category", type: "enum", enumValues: ["Food", "Toys", "Beds"] },
  { name: "price", type: "number" },
  { name: "inStock", type: "boolean" },
];

const ROWS: Record<string, unknown>[] = [
  { id: "p1", name: "Salmon Pate", category: "Food", price: 5.99, inStock: true },
  { id: "p2", name: "Feather Wand", category: "Toys", price: 8.5, inStock: true },
  { id: "p3", name: "Donut Bed", category: "Beds", price: 45, inStock: false },
];

// Deliberately out of source order, to prove applyAllowList/narrowResult order
// by the allow-list, not by the source's field order.
const ALLOW: FieldAllowEntry[] = [
  { name: "id", label: "Product code" },
  { name: "name", label: "Product name" },
  { name: "category", label: "Product type" },
  { name: "price", label: "Shelf price" },
];

function makeSource(): SourceEntry {
  return {
    describe(): SourceInfo {
      return { name: "products", description: "Product catalog", fields: FIELDS, rowCount: ROWS.length };
    },
    async query(q: DataQuery): Promise<QueryResult> {
      // `require-await`: no internal await, but runQuery can throw, so
      // dropping `async` would turn that into a synchronous throw instead
      // of a rejection.
      await Promise.resolve();
      return runQuery(ROWS, FIELDS, q);
    },
  };
}

describe("applyAllowList", () => {
  it("narrows and orders fields by the allow-list, not the source", () => {
    const info: SourceInfo = { name: "products", description: "d", fields: FIELDS, rowCount: 3 };
    const narrowed = applyAllowList(info, ALLOW);
    expect(narrowed.fields).toHaveLength(4);
    expect(narrowed.fields.map((f) => f.name)).toEqual(["id", "name", "category", "price"]);
    expect(narrowed.fields[2].label).toBe("Product type");
  });

  it("keeps the rest of SourceInfo unchanged", () => {
    const info: SourceInfo = { name: "products", description: "Product catalog", fields: FIELDS, rowCount: 3 };
    const narrowed = applyAllowList(info, ALLOW);
    expect(narrowed.name).toBe("products");
    expect(narrowed.description).toBe("Product catalog");
    expect(narrowed.rowCount).toBe(3);
  });

  it("skips an allow-list entry the source does not describe", () => {
    const info: SourceInfo = { name: "products", description: "d", fields: FIELDS, rowCount: 3 };
    const allowWithUnknown = [...ALLOW, { name: "sku", label: "SKU" }];
    const narrowed = applyAllowList(info, allowWithUnknown);
    expect(narrowed.fields).toHaveLength(4);
  });

  it("preserves field detail such as enumValues alongside the new label", () => {
    const info: SourceInfo = { name: "products", description: "d", fields: FIELDS, rowCount: 3 };
    const narrowed = applyAllowList(info, ALLOW);
    const category = narrowed.fields.find((f) => f.name === "category")!;
    expect(category.enumValues).toEqual(["Food", "Toys", "Beds"]);
    expect(category.label).toBe("Product type");
  });

  it("duplicate labels are accepted", () => {
    const info: SourceInfo = { name: "products", description: "d", fields: FIELDS, rowCount: 3 };
    const dupAllow: FieldAllowEntry[] = [
      { name: "id", label: "Same label" },
      { name: "name", label: "Same label" },
    ];
    const narrowed = applyAllowList(info, dupAllow);
    expect(narrowed.fields).toHaveLength(2);
    expect(narrowed.fields.every((f) => f.label === "Same label")).toBe(true);
  });

  it("applyAllowList drops an unsupported field that is not allowed", () => {
    const info: SourceInfo = {
      name: "products",
      description: "d",
      fields: FIELDS,
      rowCount: 3,
      unsupportedFields: [{ name: "geo", esType: "geo_point", reason: "unsupported" }],
    };
    const narrowed = applyAllowList(info, ALLOW);
    expect(narrowed.unsupportedFields).toBeUndefined();
  });

  it("applyAllowList keeps an unsupported field that is allowed", () => {
    const info: SourceInfo = {
      name: "products",
      description: "d",
      fields: FIELDS,
      rowCount: 3,
      unsupportedFields: [
        { name: "geo", esType: "geo_point", reason: "unsupported" },
        { name: "price", esType: "unsupported_type", reason: "unsupported" },
      ],
    };
    const narrowed = applyAllowList(info, ALLOW);
    expect(narrowed.unsupportedFields).toEqual([
      { name: "price", esType: "unsupported_type", reason: "unsupported" },
    ]);
  });

  it("applyAllowList preserves a source-level error", () => {
    const info: SourceInfo = {
      name: "products",
      description: "d",
      fields: [],
      rowCount: 0,
      error: "Elasticsearch schema discovery failed",
    };
    const narrowed = applyAllowList(info, ALLOW);
    expect(narrowed.error).toBe("Elasticsearch schema discovery failed");
  });
});

describe("assertQueryAllowed", () => {
  it("accepts a query using select, filter, sort and an aggregate over allowed fields only", () => {
    expect(() =>
      assertQueryAllowed(
        {
          source: "products",
          select: ["name", "price"],
          filter: { category: "Food" },
          sort: [{ field: "price" }],
          aggregate: { groupBy: [{ field: "category" }], measures: [{ op: "sum", field: "price" }] },
        },
        ALLOW
      )
    ).not.toThrow();
  });

  const cases: { label: string; query: DataQuery }[] = [
    { label: "select", query: { source: "products", select: ["inStock"] } },
    { label: "filter", query: { source: "products", filter: { inStock: true } } },
    { label: "sort", query: { source: "products", sort: [{ field: "inStock" }] } },
    {
      label: "groupBy",
      query: { source: "products", aggregate: { groupBy: [{ field: "inStock" }], measures: [{ op: "count" }] } },
    },
    {
      label: "measure",
      query: {
        source: "products",
        aggregate: { groupBy: [{ field: "category" }], measures: [{ op: "sum", field: "inStock" }] },
      },
    },
  ];

  for (const { label, query } of cases) {
    it(`rejects a hidden field referenced in ${label}`, () => {
      expect(() => assertQueryAllowed(query, ALLOW)).toThrow(
        /inStock.*Available fields: id, name, category, price/s
      );
    });
  }

  it("walks nested $and/$or/$not filters", () => {
    const and: DataQuery = {
      source: "products",
      filter: { $and: [{ price: { $gt: 1 } }, { $not: { inStock: true } }] },
    };
    expect(() => assertQueryAllowed(and, ALLOW)).toThrow(/inStock/);

    const or: DataQuery = { source: "products", filter: { $or: [{ inStock: true }, { price: { $gt: 1 } }] } };
    expect(() => assertQueryAllowed(or, ALLOW)).toThrow(/inStock/);

    const not: DataQuery = { source: "products", filter: { $not: { inStock: true } } };
    expect(() => assertQueryAllowed(not, ALLOW)).toThrow(/inStock/);
  });

  it("ignores aggregate.sort and aggregate.having — they address result aliases", () => {
    const query: DataQuery = {
      source: "products",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count", as: "count" }],
        sort: [{ field: "count" }],
        having: { count: { $gt: 1 } },
      },
    };
    expect(() => assertQueryAllowed(query, ALLOW)).not.toThrow();
  });
});

describe("withAllowList().query", () => {
  it("narrows rows to the allowed columns when there is no select", async () => {
    const wrapped = withAllowList(makeSource(), ALLOW);
    const result = await wrapped.query({ source: "products" });
    for (const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual(["category", "id", "name", "price"]);
      expect("inStock" in row).toBe(false);
    }
  });

  it("labels result fields", async () => {
    const wrapped = withAllowList(makeSource(), ALLOW);
    const result = await wrapped.query({ source: "products" });
    expect(result.fields.find((f) => f.name === "price")?.label).toBe("Shelf price");
  });

  it("leaves aggregate columns intact, labelling only the allowed alias", async () => {
    const wrapped = withAllowList(makeSource(), ALLOW);
    const result = await wrapped.query({
      source: "products",
      aggregate: { groupBy: [{ field: "category" }], measures: [{ op: "count" }] },
    });
    expect(result.fields).toHaveLength(2);
    expect(result.fields.find((f) => f.name === "category")?.label).toBe("Product type");
    expect(result.fields.find((f) => f.name === "count")?.label).toBeUndefined();
  });

  it("labels a renamed measure alias by the source field it was computed from", async () => {
    const wrapped = withAllowList(makeSource(), ALLOW);
    const result = await wrapped.query({
      source: "products",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ field: "price", op: "avg", as: "avg_price" }],
      },
    });
    expect(result.fields.find((f) => f.name === "avg_price")?.label).toBe("Shelf price");
  });

  it("rejects before calling the wrapped source's query", async () => {
    const queryFn = vi.fn(() => Promise.resolve({
      source: "products",
      aggregated: false,
      fields: [],
      rows: [],
      page: { limit: 10, offset: 0, total: 0, hasMore: false },
    }));
    const source: SourceEntry = { describe: () => ({ name: "products", description: "d", fields: FIELDS, rowCount: 0 }), query: queryFn };
    const wrapped = withAllowList(source, ALLOW);
    await expect(wrapped.query({ source: "products", select: ["inStock"] })).rejects.toThrow();
    expect(queryFn).not.toHaveBeenCalled();
  });
});

describe("withAllowList().sampleValues", () => {
  it("delegates to wrapped sampleValues for an allowed field", async () => {
    const raw = makeSource();
    const sampleValuesSpy = vi.fn(() => Promise.resolve({ values: ["Food", "Toys"], hasMore: false }));
    raw.sampleValues = sampleValuesSpy;
    const wrapped = withAllowList(raw, ALLOW);
    const res = await wrapped.sampleValues!("category", 10);
    expect(res.values).toEqual(["Food", "Toys"]);
    expect(res.hasMore).toBe(false);
    expect(sampleValuesSpy).toHaveBeenCalledWith("category", 10);
  });

  it("rejects sampling a field not in the allow-list before calling wrapped source", async () => {
    const raw = makeSource();
    const sampleValuesSpy = vi.fn();
    raw.sampleValues = sampleValuesSpy;
    const wrapped = withAllowList(raw, ALLOW);
    await expect(wrapped.sampleValues!("inStock", 10)).rejects.toThrow(/not available/);
    expect(sampleValuesSpy).not.toHaveBeenCalled();
  });
});

describe("withAllowList().query — projection guardrail criterion 5", () => {
  it('rejects a select naming a field the host did not allow-list, with the task 001 message', async () => {
    const querySpy = vi.fn(() => Promise.resolve({
      source: "s",
      aggregated: false,
      fields: [],
      rows: [],
      page: { limit: 10, offset: 0, total: 0, hasMore: false },
    }));
    const source: SourceEntry = {
      describe: () => ({ name: "s", description: "d", fields: [{ name: "a", type: "string" }, { name: "b", type: "string" }], rowCount: 0 }),
      query: querySpy,
    };
    const wrapped = withAllowList(source, [{ name: "a", label: "A" }]);
    await expect(wrapped.query({ source: "s", select: ["a", "b"] })).rejects.toThrow(
      /Field "b" is not available on source "s" \(referenced in select\)\. Available fields: a\./,
    );
    expect(querySpy).not.toHaveBeenCalled();
  });
});
