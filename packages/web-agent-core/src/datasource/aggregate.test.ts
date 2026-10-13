import { describe, it, expect } from "vitest";
import { FieldSchema } from "./types.js";
import { aggregate } from "./aggregate.js";

const schema: FieldSchema[] = [
  { name: "id", type: "string" },
  { name: "category", type: "enum", enumValues: ["Food", "Toys", "Beds", "Grooming", "Health"] },
  { name: "status", type: "enum", enumValues: ["placed", "shipped", "delivered", "cancelled"] },
  { name: "total", type: "number" },
  { name: "customer", type: "string" },
  { name: "createdAt", type: "date" },
];

const rows = [
  { id: "1", category: "Food", status: "delivered", total: 20, customer: "Alice", createdAt: "2026-01-15T08:00:00Z" },
  { id: "2", category: "Food", status: "delivered", total: 35, customer: "Bob", createdAt: "2026-02-10T12:00:00Z" },
  { id: "3", category: "Toys", status: "shipped", total: 15, customer: "Alice", createdAt: "2026-03-01T15:30:00Z" },
  { id: "4", category: "Toys", status: "delivered", total: 50, customer: "Charlie", createdAt: "2026-03-15T09:00:00Z" },
  { id: "5", category: "Food", status: "placed", total: 8, customer: "Bob", createdAt: "2026-04-01T08:00:00Z" },
  { id: "6", category: "Beds", status: "cancelled", total: 120, customer: "David", createdAt: "2026-04-20T10:00:00Z" },
  { id: "7", category: "Food", status: "delivered", total: 45, customer: "Alice", createdAt: "2026-05-05T12:00:00Z" },
  { id: "8", category: "Beds", status: "delivered", total: 80, customer: "Eve", createdAt: "2026-06-10T14:00:00Z" },
];

describe("aggregate", () => {
  it("count by category — one row per category with correct counts", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }],
      measures: [{ op: "count" }],
    });
    expect(result.rows).toHaveLength(3);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]).toEqual({ name: "category", type: "enum", description: undefined });
    expect(result.fields[1]).toEqual({ name: "count", type: "number", description: undefined });

    const food = result.rows.find(r => r.category === "Food")!;
    expect(food).toBeDefined();
    expect(food.count).toBe(4);

    const toys = result.rows.find(r => r.category === "Toys")!;
    expect(toys.count).toBe(2);

    const beds = result.rows.find(r => r.category === "Beds")!;
    expect(beds.count).toBe(2);
  });

  it("sum / avg / min / max of total by category", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }],
      measures: [
        { op: "sum", field: "total" },
        { op: "avg", field: "total" },
        { op: "min", field: "total" },
        { op: "max", field: "total" },
      ],
    });
    const food = result.rows.find(r => r.category === "Food")!;
    expect(food.sum_total).toBe(20 + 35 + 8 + 45); // 108
    expect(food.avg_total).toBeCloseTo(108 / 4);
    expect(food.min_total).toBe(8);
    expect(food.max_total).toBe(45);

    const toys = result.rows.find(r => r.category === "Toys")!;
    expect(toys.sum_total).toBe(15 + 50); // 65
    expect(toys.min_total).toBe(15);

    const beds = result.rows.find(r => r.category === "Beds")!;
    expect(beds.sum_total).toBe(120 + 80); // 200
  });

  it("countDistinct of customer by category", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }],
      measures: [{ op: "countDistinct", field: "customer" }],
    });
    const food = result.rows.find(r => r.category === "Food")!;
    expect(food.countDistinct_customer).toBe(2); // Alice, Bob

    const toys = result.rows.find(r => r.category === "Toys")!;
    expect(toys.countDistinct_customer).toBe(2); // Alice, Charlie
  });

  it("date granularity month buckets correctly", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "createdAt", granularity: "month" }],
      measures: [{ op: "count" }],
    });
    // 2026-01 = 1 row, 2026-02 = 1, 2026-03 = 2, 2026-04 = 2, 2026-05 = 1, 2026-06 = 1
    expect(result.rows).toHaveLength(6);

    const jan = result.rows.find(r => r.createdAt_month === "2026-01-01")!;
    expect(jan).toBeDefined();
    expect(jan.count).toBe(1);

    const mar = result.rows.find(r => r.createdAt_month === "2026-03-01")!;
    expect(mar.count).toBe(2);

    expect(result.fields[0]).toEqual({ name: "createdAt_month", type: "string", description: undefined });
  });

  it("date granularity year/quarter bucket correctly", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "createdAt", granularity: "quarter" }],
      measures: [{ op: "count" }],
    });
    // All rows are Q1 2026 (Jan-Mar) or Q2 2026 (Apr-Jun)
    expect(result.rows).toHaveLength(2);
    const q1 = result.rows.find(r => r.createdAt_quarter === "2026-Q1")!;
    expect(q1.count).toBe(4); // Jan 1, Feb 1, Mar 2
    const q2 = result.rows.find(r => r.createdAt_quarter === "2026-Q2")!;
    expect(q2.count).toBe(4); // Apr 2, May 1, Jun 1

    const yearResult = aggregate(rows, schema, {
      groupBy: [{ field: "createdAt", granularity: "year" }],
      measures: [{ op: "count" }],
    });
    expect(yearResult.rows).toHaveLength(1);
    expect(yearResult.rows[0].createdAt_year).toBe("2026");
    expect(yearResult.rows[0].count).toBe(8);
  });

  it("multi-dimension groupBy — category + status", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }, { field: "status" }],
      measures: [{ op: "count" }],
    });
    // Food/delivered = 3, Food/placed = 1, Toys/shipped = 1, Toys/delivered = 1, Beds/cancelled = 1, Beds/delivered = 1
    expect(result.rows).toHaveLength(6);

    const foodDel = result.rows.find(r => r.category === "Food" && r.status === "delivered")!;
    expect(foodDel.count).toBe(3);
  });

  it("having filters groups by measure alias", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }],
      measures: [{ op: "sum", field: "total", as: "revenue" }],
      having: { revenue: { $gt: 100 } },
    });
    // Sums: Food=108, Toys=65, Beds=200.
    // Food and Beds pass $gt 100; Toys does not.
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every(r => r.category === "Food" || r.category === "Beds")).toBe(true);
  });

  it("sort by measure alias desc + limit caps groups", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }],
      measures: [{ op: "sum", field: "total", as: "revenue" }],
      sort: [{ field: "revenue", dir: "desc" }],
      limit: 2,
    });
    // Beds=200, Food=108, Toys=65 → top 2: Beds, Food
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].category).toBe("Beds");
    expect(result.rows[1].category).toBe("Food");
  });

  it("errors: granularity on a non-date field", () => {
    expect(() =>
      aggregate(rows, schema, {
        groupBy: [{ field: "total", granularity: "month" }],
        measures: [{ op: "count" }],
      })
    ).toThrow('granularity "month" is only valid on date fields, but "total" is number.');
  });

  it("errors: sum without field", () => {
    expect(() =>
      aggregate(rows, schema, {
        groupBy: [{ field: "category" }],
        measures: [{ op: "sum" }],
      })
    ).toThrow('Measure "sum" requires a "field".');
  });

  it("errors: unknown measure field", () => {
    expect(() =>
      aggregate(rows, schema, {
        groupBy: [{ field: "category" }],
        measures: [{ op: "sum", field: "nonexistent" }],
      })
    ).toThrow('Unknown measure field "nonexistent".');
  });

  it("errors: unknown groupBy field", () => {
    expect(() =>
      aggregate(rows, schema, {
        groupBy: [{ field: "nope" }],
        measures: [{ op: "count" }],
      })
    ).toThrow('Unknown groupBy field "nope".');
  });

  it("default aliases work for measures and dimensions", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }],
      measures: [
        { op: "count" },
        { op: "sum", field: "total" },
      ],
    });
    expect(result.fields[0].name).toBe("category");
    expect(result.fields[1].name).toBe("count");
    expect(result.fields[2].name).toBe("sum_total");
    expect(Object.prototype.hasOwnProperty.call(result.rows[0], "count")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result.rows[0], "sum_total")).toBe(true);
  });

  it("custom aliases for dimensions and measures", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category", as: "cat" }],
      measures: [{ op: "count", as: "orders" }],
    });
    expect(result.fields[0].name).toBe("cat");
    expect(result.fields[1].name).toBe("orders");
    expect(Object.prototype.hasOwnProperty.call(result.rows[0], "cat")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result.rows[0], "orders")).toBe(true);
  });

  it("week granularity buckets correctly", () => {
    // Own rows with known weekdays, so the Monday week start is checked
    // directly.
    const dateRows = [
      { id: "a", total: 10, createdAt: "2026-01-05T00:00:00Z" }, // Mon Jan 5
      { id: "b", total: 20, createdAt: "2026-01-07T00:00:00Z" }, // Wed Jan 7 → same week
      { id: "c", total: 30, createdAt: "2026-01-12T00:00:00Z" }, // Mon Jan 12 → next week
    ];
    const result = aggregate(dateRows, schema, {
      groupBy: [{ field: "createdAt", granularity: "week" }],
      measures: [{ op: "sum", field: "total" }],
    });
    expect(result.rows).toHaveLength(2);
    const w1 = result.rows.find(r => r.createdAt_week === "2026-01-05")!;
    expect(w1).toBeDefined();
    expect(w1.sum_total).toBe(10 + 20); // 30
    const w2 = result.rows.find(r => r.createdAt_week === "2026-01-12")!;
    expect(w2).toBeDefined();
    expect(w2.sum_total).toBe(30);
  });

  it("day granularity buckets correctly", () => {
    const dateRows = [
      { id: "a", total: 10, createdAt: "2026-01-05T08:00:00Z" },
      { id: "b", total: 20, createdAt: "2026-01-05T18:00:00Z" },
      { id: "c", total: 30, createdAt: "2026-01-06T00:00:00Z" },
    ];
    const result = aggregate(dateRows, schema, {
      groupBy: [{ field: "createdAt", granularity: "day" }],
      measures: [{ op: "sum", field: "total" }],
    });
    expect(result.rows).toHaveLength(2);
    const d1 = result.rows.find(r => r.createdAt_day === "2026-01-05")!;
    expect(d1.sum_total).toBe(30);
    const d2 = result.rows.find(r => r.createdAt_day === "2026-01-06")!;
    expect(d2.sum_total).toBe(30);
  });

  it("empty groupBy groups all into one row (grand total)", () => {
    const result = aggregate(rows, schema, {
      groupBy: [],
      measures: [{ op: "count" }, { op: "sum", field: "total" }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].count).toBe(8);
    expect(result.rows[0].sum_total).toBe(20 + 35 + 15 + 50 + 8 + 120 + 45 + 80); // 373
  });

  it("sort by dimension alias desc", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }],
      measures: [{ op: "count" }],
      sort: [{ field: "category", dir: "desc" }],
    });
    // Toys, Food, Beds (alphabetical desc)
    expect(result.rows[0].category).toBe("Toys");
    expect(result.rows[1].category).toBe("Food");
    expect(result.rows[2].category).toBe("Beds");
  });

  it("first/last return open/close ordered by the date dimension", () => {
    const result = aggregate(rows, schema, {
      groupBy: [{ field: "category" }],
      measures: [
        { op: "first", field: "total" },
        { op: "last", field: "total" },
      ],
    });
    const food = result.rows.find(r => r.category === "Food")!;
    expect(food.first_total).toBe(20); // 2026-01-15, earliest
    expect(food.last_total).toBe(45); // 2026-05-05, latest

    const beds = result.rows.find(r => r.category === "Beds")!;
    expect(beds.first_total).toBe(120); // 2026-04-20, earliest
    expect(beds.last_total).toBe(80); // 2026-06-10, latest
  });

  it("first/last are deterministic regardless of input row order", () => {
    const reversed = [...rows].reverse();
    const result = aggregate(reversed, schema, {
      groupBy: [{ field: "category" }],
      measures: [
        { op: "first", field: "total" },
        { op: "last", field: "total" },
      ],
    });
    const food = result.rows.find(r => r.category === "Food")!;
    expect(food.first_total).toBe(20);
    expect(food.last_total).toBe(45);

    const beds = result.rows.find(r => r.category === "Beds")!;
    expect(beds.first_total).toBe(120);
    expect(beds.last_total).toBe(80);
  });

  it("first/last fall back to source order when no date dimension", () => {
    const noDateSchema: FieldSchema[] = [
      { name: "grp", type: "string" },
      { name: "val", type: "number" },
    ];
    const noDateRows = [
      { grp: "a", val: 1 },
      { grp: "a", val: 2 },
      { grp: "a", val: 3 },
    ];
    const result = aggregate(noDateRows, noDateSchema, {
      groupBy: [{ field: "grp" }],
      measures: [
        { op: "first", field: "val" },
        { op: "last", field: "val" },
      ],
    });
    expect(result.rows[0].first_val).toBe(1);
    expect(result.rows[0].last_val).toBe(3);
  });

  it("first/last with hour granularity give intraday open/close", () => {
    const tickSchema: FieldSchema[] = [
      { name: "ts", type: "date" },
      { name: "price", type: "number" },
    ];
    const tickRows = [
      { ts: "2026-01-15T08:05:00Z", price: 100 },
      { ts: "2026-01-15T08:15:00Z", price: 101 },
      { ts: "2026-01-15T08:45:00Z", price: 102 },
    ];
    const result = aggregate(tickRows, tickSchema, {
      groupBy: [{ field: "ts", granularity: "hour" }],
      measures: [
        { op: "first", field: "price" },
        { op: "last", field: "price" },
      ],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].first_price).toBe(100);
    expect(result.rows[0].last_price).toBe(102);
  });

  it("first/last skip null/NaN boundary values", () => {
    const tickSchema: FieldSchema[] = [
      { name: "ts", type: "date" },
      { name: "price", type: "number" },
    ];
    const tickRows = [
      { ts: "2026-01-15T08:05:00Z", price: null },
      { ts: "2026-01-15T08:15:00Z", price: 101 },
      { ts: "2026-01-15T08:45:00Z", price: 102 },
    ];
    const result = aggregate(tickRows, tickSchema, {
      groupBy: [],
      measures: [{ op: "first", field: "price" }],
    });
    expect(result.rows[0].first_price).toBe(101);
  });

  it("first/last on a non-numeric field throws", () => {
    expect(() =>
      aggregate(rows, schema, {
        groupBy: [{ field: "category" }],
        measures: [{ op: "first", field: "category" }],
      })
    ).toThrow('Measure "first" on field "category" requires a number type, but it is enum.');
  });

  it("hour granularity buckets correctly", () => {
    const tickSchema: FieldSchema[] = [
      { name: "ts", type: "date" },
      { name: "price", type: "number" },
    ];
    const tickRows = [
      { ts: "2026-01-15T08:05:00Z", price: 100 },
      { ts: "2026-01-15T09:15:00Z", price: 101 },
    ];
    const result = aggregate(tickRows, tickSchema, {
      groupBy: [{ field: "ts", granularity: "hour" }],
      measures: [{ op: "count" }],
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(r => r.ts_hour === "2026-01-15 08:00")).toBeDefined();
    expect(result.rows.find(r => r.ts_hour === "2026-01-15 09:00")).toBeDefined();
    expect(result.fields[0]).toEqual({ name: "ts_hour", type: "string", description: undefined });
  });

  it("minute granularity buckets correctly", () => {
    const tickSchema: FieldSchema[] = [
      { name: "ts", type: "date" },
      { name: "price", type: "number" },
    ];
    const tickRows = [
      { ts: "2026-01-15T08:00:00Z", price: 100 },
      { ts: "2026-01-15T08:30:00Z", price: 101 },
    ];
    const result = aggregate(tickRows, tickSchema, {
      groupBy: [{ field: "ts", granularity: "minute" }],
      measures: [{ op: "count" }],
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(r => r.ts_minute === "2026-01-15 08:00")).toBeDefined();
    expect(result.rows.find(r => r.ts_minute === "2026-01-15 08:30")).toBeDefined();
  });
});
