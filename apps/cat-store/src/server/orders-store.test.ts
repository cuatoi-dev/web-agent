// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { OrdersStore } from "./orders-store.js";
import { ORDER_FIELDS } from "../shared/orders.js";

describe("OrdersStore", () => {
  let store: OrdersStore;

  beforeEach(() => {
    store = new OrdersStore();
  });

  it("seeds deterministically", () => {
    const a = new OrdersStore();
    const b = new OrdersStore();
    expect(a.size).toBe(200);
    expect(
      a.query({ source: "orders", page: { limit: 200 } }).rows
    ).toEqual(
      b.query({ source: "orders", page: { limit: 200 } }).rows
    );
  });

  it("describe() returns correct metadata", () => {
    expect(store.describe()).toEqual({
      name: "orders",
      description: "Historical customer orders",
      fields: ORDER_FIELDS,
      rowCount: 200,
    });
  });

  it("paging: limit 10", () => {
    const result = store.query({ source: "orders", page: { limit: 10 } });
    expect(result.rows.length).toBe(10);
    expect(result.page.total).toBe(200);
    expect(result.page.hasMore).toBe(true);
    expect(result.page.limit).toBe(10);
    expect(result.page.offset).toBe(0);
  });

  it("default page size is 50", () => {
    const result = store.query({ source: "orders" });
    expect(result.rows.length).toBe(50);
    expect(result.page.limit).toBe(50);
  });

  it("filter by status=delivered", () => {
    const result = store.query({ source: "orders", filter: { status: "delivered" } });
    expect(result.rows.every((r) => r.status === "delivered")).toBe(true);
    expect(result.page.total).toBeGreaterThan(0);
    expect(result.page.total).toBeLessThan(200);
  });

  it("sort desc by total", () => {
    const result = store.query({
      source: "orders",
      sort: [{ field: "total", dir: "desc" }],
    });
    const totals = result.rows.map((r) => r.total as number);
    for (let i = 0; i < totals.length - 1; i++) {
      expect(totals[i]).toBeGreaterThanOrEqual(totals[i + 1]);
    }
  });

  it("sort asc by createdAt", () => {
    const result = store.query({
      source: "orders",
      sort: [{ field: "createdAt", dir: "asc" }],
    });
    const first = result.rows[0].createdAt as string;
    const last = result.rows.at(-1)!.createdAt as string;
    expect(first < last).toBe(true);
  });

  it("search prefilter is case-insensitive", () => {
    const needle = store.query({ source: "orders", page: { limit: 1 } }).rows[0].customer as string;
    const lower = store.query({ source: "orders", search: needle, page: { limit: 200 } });
    const upper = store.query({ source: "orders", search: needle.toUpperCase(), page: { limit: 200 } });
    expect(lower.page.total).toBe(upper.page.total);
    const needleLower = needle.toLowerCase();
    for (const row of lower.rows) {
      // runQuery searches every string and enum field of ORDER_FIELDS —
      // id, customer, category, status, items (filter.ts:243-264).
      const matches = ORDER_FIELDS
        .filter((f) => f.type === "string" || f.type === "enum")
        .some((f) => String((row[f.name] as string | undefined) ?? "").toLowerCase().includes(needleLower));
      expect(matches).toBe(true);
    }
  });

  it("search matches the status field too", () => {
    const result = store.query({ source: "orders", search: "shipped", page: { limit: 200 } });
    expect(result.page.total).toBeGreaterThan(0);
    for (const row of result.rows) {
      const matches =
        row.status === "shipped" ||
        ORDER_FIELDS
          .filter((f) => (f.type === "string" || f.type === "enum") && f.name !== "status")
          .some((f) => String((row[f.name] as string | undefined) ?? "").toLowerCase().includes("shipped"));
      expect(matches).toBe(true);
    }
  });

  it("search + filter compose", () => {
    const needle = store.query({ source: "orders", page: { limit: 1 } }).rows[0].customer as string;
    const searchOnly = store.query({ source: "orders", search: needle, page: { limit: 200 } });
    const both = store.query({ source: "orders", search: needle, filter: { status: "placed" }, page: { limit: 200 } });
    expect(both.page.total).toBeLessThanOrEqual(searchOnly.page.total);
    expect(both.rows.every((r) => r.status === "placed")).toBe(true);
  });

  it("aggregate passthrough", () => {
    const result = store.query({
      source: "orders",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count", as: "n" }],
      },
    });
    expect(result.aggregated).toBe(true);
    const sum = result.rows.reduce((acc, r) => acc + (r.n as number), 0);
    expect(sum).toBe(200);
  });

  it("unknown select field throws", () => {
    expect(() =>
      store.query({ source: "orders", select: ["nope"] })
    ).toThrow(/Unknown field "nope"/);
  });

  it("create() defaults", () => {
    const o = store.create();
    expect(o.id).toBe("ORD-1201");
    expect(o.customer).toBe("Guest");
    expect(o.category).toBe("Food");
    expect(o.status).toBe("placed");
    expect(o.total).toBe(0);
    expect(o.itemCount).toBe(1);
    expect(o.items).toBe("");
    expect(Number.isFinite(Date.parse(o.createdAt))).toBe(true);
  });

  it("create() honours input", () => {
    const o = store.create({
      customer: "Zoe",
      category: "Toys",
      total: 42.5,
      itemCount: 2,
      items: "Feather Wand Toy, Squeaking Ball",
    });
    expect(o.customer).toBe("Zoe");
    expect(o.category).toBe("Toys");
    expect(o.total).toBe(42.5);
    expect(o.itemCount).toBe(2);
    expect(o.items).toBe("Feather Wand Toy, Squeaking Ball");
  });

  it("create() unshifts and is visible to query", () => {
    const created = store.create();
    expect(store.size).toBe(201);
    const result = store.query({ source: "orders", page: { limit: 1 } });
    expect(result.rows[0].id).toBe(created.id);
    expect(result.page.total).toBe(201);
  });

  it("ids keep incrementing", () => {
    const first = store.create();
    const second = store.create();
    expect(first.id).toBe("ORD-1201");
    expect(second.id).toBe("ORD-1202");
  });

  it("instances are isolated", () => {
    const a = new OrdersStore();
    const b = new OrdersStore();
    a.create();
    expect(b.size).toBe(200);
  });

  it("custom seed count", () => {
    const small = new OrdersStore(5);
    expect(small.size).toBe(5);
    const o = small.create();
    expect(o.id).toBe("ORD-1006");
  });
});
