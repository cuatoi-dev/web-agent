import { describe, it, expect } from "vitest";
import { FieldSchema, MeasureOp, QueryResult } from "./types.js";
import { runQuery, serializeResult } from "./query-engine.js";

const schema: FieldSchema[] = [
  { name: "id", type: "string" },
  { name: "name", type: "string" },
  { name: "category", type: "enum", enumValues: ["Food", "Pet"] },
  { name: "price", type: "number" },
  { name: "inStock", type: "boolean" },
  { name: "createdAt", type: "date" }
];

const rows = [
  { id: "1", name: "Catnip", category: "Food", price: 5.99, inStock: true, createdAt: "2026-01-15T08:00:00Z" },
  { id: "2", name: "Scratcher", category: "Pet", price: 25.00, inStock: true, createdAt: "2026-02-10T12:00:00Z" },
  { id: "3", name: "Feather Wand", category: "Pet", price: 4.50, inStock: false, createdAt: "2026-03-01T15:30:00Z" },
  { id: "4", name: "Salmon Treats", category: "Food", price: 8.50, inStock: true, createdAt: "2026-03-15T09:00:00Z" },
  { id: "5", name: "Toy Mouse", category: "Pet", price: 2.99, inStock: true, createdAt: "2026-03-20T10:00:00Z" },
  { id: "6", name: "Cat Bed", category: "Pet", price: 45.00, inStock: false, createdAt: "2026-04-01T08:00:00Z" }
];

describe("query-engine", () => {
  it("filters, sorts, and paginates correctly", () => {
    const q = {
      source: "products",
      filter: {
        category: "Pet"
      },
      sort: [
        { field: "price", dir: "asc" as const }
      ],
      page: {
        limit: 2,
        offset: 1
      }
    };
    const res = runQuery(rows, schema, q);
    expect(res.source).toBe("products");
    expect(res.aggregated).toBe(false);
    expect(res.page.total).toBe(4); // Feather Wand, Scratcher, Toy Mouse, Cat Bed are Pet
    expect(res.page.offset).toBe(1);
    expect(res.page.limit).toBe(2);
    expect(res.page.hasMore).toBe(true); // offset + limit (3) < total (4)
    // Sorted by price asc: Toy Mouse (2.99), Feather Wand (4.50), Scratcher (25.00), Cat Bed (45.00)
    // offset 1: Feather Wand (4.50), Scratcher (25.00)
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].name).toBe("Feather Wand");
    expect(res.rows[1].name).toBe("Scratcher");
  });

  it("clamps limit between 1 and 500, defaulting to 50", () => {
    // page.limit reports what the result actually delivers (see the
    // "honest page.limit" tests below), so proving the 1..500 clamp needs a
    // backing set large enough that delivery is never the bottleneck.
    const manyRows = Array.from({ length: 600 }, (_, i) => ({ id: String(i), name: `Item ${i}`, category: "Food", price: 1, inStock: true, createdAt: "2026-01-01T00:00:00Z" }));

    const res1 = runQuery(manyRows, schema, { source: "products", page: { limit: 999 } });
    expect(res1.page.limit).toBe(500);

    const res2 = runQuery(manyRows, schema, { source: "products", page: { limit: -10 } });
    expect(res2.page.limit).toBe(1);

    const res3 = runQuery(manyRows, schema, { source: "products" });
    expect(res3.page.limit).toBe(50);
  });

  it("honest page.limit: reports rows actually delivered, not the requested limit, when the source has fewer rows", () => {
    // Only 6 products exist; a limit of 50 cannot be honestly claimed.
    const res = runQuery(rows, schema, { source: "products", page: { limit: 50 } });
    expect(res.rows.length).toBe(rows.length);
    expect(res.page.limit).toBe(res.rows.length);
    expect(res.page.limit).toBe(rows.length);
    expect(res.page.hasMore).toBe(false);
  });

  it("honest page.limit: aggregation path also reports delivered group count, not the requested limit", () => {
    // Only 2 groups (Food, Pet) exist; a limit of 50 cannot be honestly claimed.
    const res = runQuery(rows, schema, {
      source: "products",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count" }]
      },
      page: { limit: 50 }
    });
    expect(res.aggregated).toBe(true);
    expect(res.page.limit).toBe(res.rows.length);
    expect(res.page.limit).toBe(2);
    expect(res.page.hasMore).toBe(false);
  });

  it("handles multi-key type-aware sorting", () => {
    const customRows = [
      { id: "1", price: 10, createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", price: 10, createdAt: "2026-01-02T00:00:00Z" },
      { id: "3", price: 5, createdAt: "2026-01-03T00:00:00Z" }
    ];
    const customSchema: FieldSchema[] = [
      { name: "id", type: "string" },
      { name: "price", type: "number" },
      { name: "createdAt", type: "date" }
    ];
    const q = {
      source: "custom",
      sort: [
        { field: "price", dir: "desc" as const },
        { field: "createdAt", dir: "asc" as const }
      ]
    };
    const res = runQuery(customRows, customSchema, q);
    // Descending price: price 10 first.
    // Ascending date: 2026-01-01 before 2026-01-02.
    // Price 5 last.
    expect(res.rows[0].id).toBe("1");
    expect(res.rows[1].id).toBe("2");
    expect(res.rows[2].id).toBe("3");
  });

  it("projects only selected fields", () => {
    const q = {
      source: "products",
      select: ["id", "price"]
    };
    const res = runQuery(rows, schema, q);
    expect(res.fields).toHaveLength(2);
    expect(res.fields[0].name).toBe("id");
    expect(res.fields[1].name).toBe("price");
    expect(res.rows[0]).toEqual({ id: "1", price: 5.99 });
  });

  it("truncates leaf strings longer than 300 characters", () => {
    const longString = "a".repeat(350);
    const testRows = [{ id: "1", name: longString }];
    const res = runQuery(testRows, schema, { source: "products" });
    expect(res.rows[0].name).toBe("a".repeat(300) + "…");
  });

  it("serializeResult formats output and respects maxChars with valid JSON", () => {
    const res = runQuery(rows, schema, { source: "products" });
    const output = serializeResult(res, 500);
    expect(output.length).toBeLessThanOrEqual(500);
    const parsed = JSON.parse(output) as QueryResult;
    expect(parsed.source).toBe("products");
    expect(parsed.rows.length).toBeLessThan(rows.length);
    expect(parsed.truncation).toBeDefined();
    expect(parsed.truncation!.requested).toBe(rows.length);
    expect(parsed.truncation!.included).toBe(parsed.rows.length);
    expect(parsed.truncation!.dropped).toBe(rows.length - parsed.rows.length);
    expect(parsed.page.limit).toBe(parsed.rows.length);
  });

  it("serializeResult returns full output without truncation report when within budget", () => {
    const res = runQuery(rows, schema, { source: "products" });
    const output = serializeResult(res, 10000);
    const parsed = JSON.parse(output) as QueryResult;
    expect(parsed.rows).toHaveLength(rows.length);
    expect(parsed.truncation).toBeUndefined();
    expect(parsed.page.limit).toBe(rows.length);
  });

  it("serializeResult handles wide schema with 0 rows fitting as valid JSON", () => {
    const wideFields: FieldSchema[] = Array.from({ length: 300 }, (_, i) => ({
      name: `field_${String(i + 1).padStart(3, "0")}`,
      type: "string",
      description: `Description for field ${i + 1}`,
      enumValues: ["value_a", "value_b", "value_c"],
    }));
    const wideRow: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) {
      wideRow[`field_${String(i + 1).padStart(3, "0")}`] = "x".repeat(30);
    }
    const wideRows = Array.from({ length: 50 }, () => ({ ...wideRow }));
    const wideResult: QueryResult = {
      source: "wide-fixture",
      aggregated: false,
      fields: wideFields,
      rows: wideRows,
      page: { limit: 50, offset: 0, total: 500, hasMore: true },
    };

    const output = serializeResult(wideResult, 6000);
    expect(output.length).toBeLessThanOrEqual(6000);
    const parsed = JSON.parse(output) as QueryResult;
    expect(parsed.source).toBe("wide-fixture");
    expect(parsed.rows).toEqual([]);
    expect(parsed.page.limit).toBe(0);
    expect(parsed.page.hasMore).toBe(true);
    expect(parsed.truncation).toBeDefined();
    expect(parsed.truncation!.requested).toBe(50);
    expect(parsed.truncation!.included).toBe(0);
    expect(parsed.truncation!.dropped).toBe(50);
    expect(parsed.truncation!.reason).toContain("Row width");
    expect(parsed.truncation!.hint).toContain("select");
  });

  it("serializeResult handles column projection on wide schema fitting rows", () => {
    const projectedFields: FieldSchema[] = [
      { name: "id", type: "string" },
      { name: "category_code_01", type: "string" },
      { name: "price_01", type: "number" },
    ];
    const projectedRows = Array.from({ length: 50 }, (_, i) => ({
      id: String(i + 1),
      category_code_01: "CAT_A",
      price_01: 19.99,
    }));
    const projectedResult: QueryResult = {
      source: "wide-fixture",
      aggregated: false,
      fields: projectedFields,
      rows: projectedRows,
      page: { limit: 50, offset: 0, total: 500, hasMore: true },
    };

    const output = serializeResult(projectedResult, 6000);
    expect(output.length).toBeLessThanOrEqual(6000);
    const parsed = JSON.parse(output) as QueryResult;
    expect(parsed.rows).toHaveLength(50);
    expect(parsed.truncation).toBeUndefined();
  });

  it("serializeResult parses as valid JSON across column counts 1 to 300 and row limits 1 to 500", () => {
    for (const colCount of [1, 10, 50, 100, 300]) {
      for (const rowCount of [1, 10, 50, 200, 500]) {
        const testFields: FieldSchema[] = Array.from({ length: colCount }, (_, i) => ({
          name: `col_${i}`,
          type: "string",
        }));
        const testRow: Record<string, unknown> = {};
        for (let i = 0; i < colCount; i++) {
          testRow[`col_${i}`] = `val_${i}`;
        }
        const testRows = Array.from({ length: Math.min(rowCount, 50) }, () => ({ ...testRow }));
        const testRes: QueryResult = {
          source: "matrix-test",
          aggregated: false,
          fields: testFields,
          rows: testRows,
          page: { limit: rowCount, offset: 0, total: rowCount, hasMore: false },
        };
        const out = serializeResult(testRes, 6000);
        expect(out.length).toBeLessThanOrEqual(6000);
        expect(() => JSON.parse(out) as unknown).not.toThrow();
      }
    }
  });

  it("serializeResult handles extreme small budget with valid JSON fallback", () => {
    const res = runQuery(rows, schema, { source: "products" });
    const output = serializeResult(res, 50);
    expect(() => JSON.parse(output) as unknown).not.toThrow();
  });

  // ─── Aggregation integration ────────────────────────────────────────

  it("aggregate: filter + aggregate returns aggregated:true with correct fields and total", () => {
    const q = {
      source: "products",
      filter: { inStock: true },
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count" as MeasureOp }]
      }
    };
    const res = runQuery(rows, schema, q);
    expect(res.aggregated).toBe(true);
    expect(res.source).toBe("products");
    // Filter to inStock=true: Catnip, Scratcher, Salmon Treats, Toy Mouse → 4 rows
    // Group by category: Food=2 (Catnip, Salmon Treats), Pet=2 (Scratcher, Toy Mouse)
    expect(res.rows).toHaveLength(2);
    expect(res.fields).toHaveLength(2);
    expect(res.fields[0].name).toBe("category");
    expect(res.fields[1].name).toBe("count");
    expect(res.page.total).toBe(2); // group count
    expect(res.page.hasMore).toBe(false);
  });

  it("aggregate: pagination over aggregated groups", () => {
    const q = {
      source: "products",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count" as MeasureOp }]
      },
      page: { limit: 1, offset: 1 }
    };
    const res = runQuery(rows, schema, q);
    expect(res.aggregated).toBe(true);
    expect(res.page.total).toBe(2); // Food, Pet
    expect(res.page.limit).toBe(1);
    expect(res.page.offset).toBe(1);
    expect(res.page.hasMore).toBe(false); // offset+limit = 2 = total
    expect(res.rows).toHaveLength(1);
    // offset 1, so second category
    expect(res.rows[0].count).toBe(4); // Pet has 4 items (Scratcher, Feather Wand, Toy Mouse, Cat Bed)
  });

  it("aggregate: sum measure in aggregate", () => {
    const q = {
      source: "products",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "sum" as MeasureOp, field: "price" }]
      }
    };
    const res = runQuery(rows, schema, q);
    expect(res.aggregated).toBe(true);
    const food = res.rows.find(r => r.category === "Food")!;
    expect(food).toBeDefined();
    expect(food.sum_price).toBeCloseTo(5.99 + 8.50); // 14.49
    const pet = res.rows.find(r => r.category === "Pet")!;
    expect(pet).toBeDefined();
    expect(pet.sum_price).toBeCloseTo(25.00 + 4.50 + 2.99 + 45.00); // 77.49
  });

  it("aggregate with having filters groups post-aggregation", () => {
    const q = {
      source: "products",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "sum" as MeasureOp, field: "price", as: "revenue" }],
        having: { revenue: { $gt: 20 } }
      }
    };
    const res = runQuery(rows, schema, q);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].category).toBe("Pet");
  });

  // ─── Top-level sort/select on aggregates ─────────────────

  it("aggregate + top-level sort throws instead of dropping it", () => {
    expect(() =>
      runQuery(rows, schema, {
        source: "products",
        sort: [{ field: "price", dir: "desc" }],
        aggregate: {
          groupBy: [{ field: "category" }],
          measures: [{ op: "sum", field: "price", as: "revenue" }],
        },
      }),
    ).toThrow(/Top-level "sort" does not apply to an aggregate query/);
    // The rejection names the sorted source field and this query's real
    // result columns.
    try {
      runQuery(rows, schema, {
        source: "products",
        sort: [{ field: "price" }],
        aggregate: { groupBy: [{ field: "category" }], measures: [{ op: "count" }] },
      });
      expect.fail("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('"price"');
      expect(msg).toContain("This query's result columns are: category, count.");
      expect(msg).toContain('"aggregate": { "sort": [{ "field": "count"');
    }
  });

  it("aggregate + top-level select throws instead of dropping it", () => {
    try {
      runQuery(rows, schema, {
        source: "products",
        select: ["category", "name"],
        aggregate: {
          groupBy: [{ field: "category" }],
          measures: [{ op: "sum", field: "price", as: "revenue" }],
        },
      });
      expect.fail("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('Top-level "select" does not apply to an aggregate query');
      expect(msg).toContain('"category"');
      expect(msg).toContain('"name"');
      expect(msg).toContain('"as"');
      expect(msg).toContain("This query's result columns are: category, revenue.");
    }
  });

  it("aggregate + select naming a result alias throws the aggregate message, not Unknown field", () => {
    // The guard must sit above the select validation: sum_price is a result
    // column, so the old validation would answer "Unknown field" and hide
    // the real problem.
    expect(() =>
      runQuery(rows, schema, {
        source: "products",
        select: ["sum_price"],
        aggregate: { groupBy: [{ field: "category" }], measures: [{ op: "sum", field: "price" }] },
      }),
    ).toThrow(/Top-level "select" does not apply to an aggregate query/);
    let msg = "";
    try {
      runQuery(rows, schema, {
        source: "products",
        select: ["sum_price"],
        aggregate: { groupBy: [{ field: "category" }], measures: [{ op: "sum", field: "price" }] },
      });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).not.toContain("Unknown field");
  });

  it("aggregate with sort: [] is identical to the same query with no sort", () => {
    const withEmpty = runQuery(rows, schema, {
      source: "products",
      sort: [],
      aggregate: { groupBy: [{ field: "category" }], measures: [{ op: "sum", field: "price" }] },
    });
    const without = runQuery(rows, schema, {
      source: "products",
      aggregate: { groupBy: [{ field: "category" }], measures: [{ op: "sum", field: "price" }] },
    });
    expect(withEmpty).toEqual(without);
  });

  // ─── Free-text search ──────────────────────────────────────────────

  it("search matches a term in any string field, case-insensitively", () => {
    const res = runQuery(rows, schema, { source: "products", search: "salmon" });
    expect(res.page.total).toBe(1);
    expect(res.rows[0].name).toBe("Salmon Treats");

    const upper = runQuery(rows, schema, { source: "products", search: "SALMON" });
    expect(upper.page.total).toBe(1);
    expect(upper.rows[0].name).toBe("Salmon Treats");

    const mixed = runQuery(rows, schema, { source: "products", search: "Salmon" });
    expect(mixed.page.total).toBe(1);
    expect(mixed.rows[0].name).toBe("Salmon Treats");

    expect(res.rows).toEqual(upper.rows);
    expect(res.rows).toEqual(mixed.rows);
  });

  it("search covers enum fields, not just declared strings", () => {
    const res = runQuery(rows, schema, { source: "products", search: "food" });
    expect(res.page.total).toBe(2);
    expect(res.rows.map((r) => r.name)).toEqual(["Catnip", "Salmon Treats"]);
  });

  it("search does not match numbers, booleans or dates as text", () => {
    // row 6 has price: 45.00 — searching "45" must not return it
    expect(runQuery(rows, schema, { source: "products", search: "45" }).page.total).toBe(0);
    // three rows have March dates — searching "2026-03" must not return them
    expect(runQuery(rows, schema, { source: "products", search: "2026-03" }).page.total).toBe(0);
    // four rows have inStock: true — searching "true" must not return them
    expect(runQuery(rows, schema, { source: "products", search: "true" }).page.total).toBe(0);
  });

  it("search combines with filter as AND", () => {
    const combined = runQuery(rows, schema, {
      source: "products",
      search: "cat",
      filter: { category: "Pet" }
    });
    expect(combined.page.total).toBe(1);
    expect(combined.rows[0].name).toBe("Cat Bed");

    // search alone returns 2 rows (Catnip, Cat Bed)
    const alone = runQuery(rows, schema, { source: "products", search: "cat" });
    expect(alone.page.total).toBe(2);
  });

  it("search applies before aggregation so bucket counts reflect it", () => {
    const res = runQuery(rows, schema, {
      source: "products",
      search: "cat",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count", as: "n" }]
      }
    });
    expect(res.aggregated).toBe(true);
    expect(res.rows.length).toBe(2);
    const petBucket = res.rows.find((r) => r.category === "Pet")!;
    const foodBucket = res.rows.find((r) => r.category === "Food")!;
    expect(petBucket.n).toBe(1); // Cat Bed only
    expect(foodBucket.n).toBe(1); // Catnip only
  });

  it("treats an empty or whitespace-only search as absent", () => {
    const noSearch = runQuery(rows, schema, { source: "products" });
    expect(runQuery(rows, schema, { source: "products", search: "" })).toEqual(noSearch);
    expect(runQuery(rows, schema, { source: "products", search: "   " })).toEqual(noSearch);
    expect(runQuery(rows, schema, { source: "products", search: "\t" })).toEqual(noSearch);
  });

  it("returns an empty page when nothing matches the search", () => {
    const res = runQuery(rows, schema, { source: "products", search: "zzzz" });
    expect(res.rows.length).toBe(0);
    expect(res.page.total).toBe(0);
    expect(res.page.hasMore).toBe(false);
  });
});
