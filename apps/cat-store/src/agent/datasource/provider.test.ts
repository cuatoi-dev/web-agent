import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDataSourceProvider } from "@cuatoi/web-agent-lit";
import type { DataQuery } from "@cuatoi/web-agent-lit";
import { PRODUCT_ALLOW_FIELDS, CART_FIELDS, getCatSources } from "../../web/orders-backend/datasource-sources";
import { OrdersStore } from "../../server/orders-store";
import { ES_SOURCE_DESCRIPTION } from "@cuatoi/web-agent-charting/datasource";
import type { RootState } from "../../web/store";

// Mock Redux state
function makeState(overrides?: Record<string, unknown>) {
  return {
    products: {
      items: [
        { id: "p1", name: "Salmon Pate", category: "Food", price: 5.99, cost: 3.89, inStock: true },
        { id: "p2", name: "Feather Wand", category: "Toys", price: 8.50, cost: 3.40, inStock: true },
        { id: "p3", name: "Donut Bed", category: "Beds", price: 45.00, cost: 18.90, inStock: false },
        { id: "p4", name: "Catnip Mouse", category: "Toys", price: 3.50, cost: 1.40, inStock: true },
      ],
    },
    cart: {
      items: [
        { productId: "p1", name: "Salmon Pate", price: 5.99, qty: 2 },
        { productId: "p4", name: "Catnip Mouse", price: 3.50, qty: 1 },
      ],
    },
    ...overrides,
  };
}

let currentState: Record<string, unknown>;

describe("DataSourceProvider", () => {
  let ordersStore: OrdersStore;

  beforeEach(() => {
    currentState = makeState();
    ordersStore = new OrdersStore(200);
    // Mock only the network boundary; the store/registry/provider run for real.
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/orders/describe") {
        return Promise.resolve(new Response(JSON.stringify(ordersStore.describe()), { status: 200 }));
      }
      if (url.startsWith("/api/orders?q=")) {
        const q = JSON.parse(decodeURIComponent(url.slice("/api/orders?q=".length))) as DataQuery;
        return Promise.resolve(
          new Response(JSON.stringify(ordersStore.query({ ...q, source: "orders" })), { status: 200 })
        );
      }
      // Elasticsearch absent: the proxy is unreachable. The provider must skip
      // the source, not fail the other three.
      if (url.startsWith("/api/es-orders")) {
        return Promise.resolve(new Response('{"error":"Elasticsearch is unreachable"}', { status: 502 }));
      }
      return Promise.resolve(new Response("not found", { status: 404, statusText: "Not Found" }));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createProvider() {
    return createDataSourceProvider({
      getState: () => currentState,
      sources: getCatSources(() => currentState as unknown as RootState),
    });
  }

  it("listSources summarises orders, products and cart", async () => {
    const provider = createProvider();
    const sources = await provider.listSources();
    expect(sources).toHaveLength(3);

    const names = sources.map(s => s.name).sort();
    expect(names).toEqual(["cart", "orders", "products"]);

    const orders = sources.find(s => s.name === "orders")!;
    expect(orders.fieldCount).toBeGreaterThan(0);
    expect(orders.rowCount).toBe(200);

    const products = sources.find(s => s.name === "products")!;
    expect(products.fieldCount).toBe(PRODUCT_ALLOW_FIELDS.length);
    expect(products.fieldTypes).toEqual({ string: 2, enum: 1, number: 2, boolean: 1 });
    expect(products.rowCount).toBe(4);

    const cart = sources.find(s => s.name === "cart")!;
    expect(cart.fieldCount).toBe(CART_FIELDS.length);
    expect(cart.fieldTypes).toEqual({ string: 2, number: 3 });
    expect(cart.rowCount).toBe(2);
  });

  it("query orders returns rows with correct total", async () => {
    const provider = createProvider();
    const result = await provider.query({ source: "orders", page: { limit: 5 } });
    expect(result.source).toBe("orders");
    expect(result.rows).toHaveLength(5);
    expect(result.page.total).toBe(200);
    expect(result.page.limit).toBe(5);
    expect(result.page.hasMore).toBe(true);
  });

  it("query products filters by category", async () => {
    const provider = createProvider();
    const result = await provider.query({
      source: "products",
      filter: { category: "Food" },
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Salmon Pate");
  });

  it("query cart returns computed lineTotal", async () => {
    const provider = createProvider();
    const result = await provider.query({ source: "cart" });
    expect(result.rows).toHaveLength(2);

    const p1 = result.rows.find(r => r.productId === "p1")!;
    expect(p1.lineTotal).toBe(5.99 * 2); // 11.98

    const p4 = result.rows.find(r => r.productId === "p4")!;
    expect(p4.lineTotal).toBe(3.50 * 1); // 3.50
  });

  it("cart reflects current Redux state changes", async () => {
    const provider = createProvider();
    let result = await provider.query({ source: "cart" });
    expect(result.rows).toHaveLength(2);

    // Update cart state
    currentState = makeState({
      ...currentState,
      cart: {
        items: [
          { productId: "p1", name: "Salmon Pate", price: 5.99, qty: 2 },
        ],
      },
    });

    result = await provider.query({ source: "cart" });
    expect(result.rows).toHaveLength(1);
  });

  it("unknown source throws descriptive error", async () => {
    const provider = createProvider();
    await expect(
      provider.query({ source: "nonexistent" }),
    ).rejects.toThrow(/Unknown source "nonexistent".*/);
  });

  it("aggregation over orders returns aggregated rows", async () => {
    const provider = createProvider();
    const result = await provider.query({
      source: "orders",
      aggregate: {
        groupBy: [{ field: "status" }],
        measures: [{ op: "count" }],
      },
    });
    expect(result.aggregated).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThanOrEqual(4); // status enum: 4 values
    const statuses = result.rows.map(r => r.status as string).sort();
    expect(statuses).toEqual(["cancelled", "delivered", "placed", "shipped"]);
  });

  it("describeSource returns info for a given source", async () => {
    const provider = createProvider();
    const info = await provider.describeSource("products");
    expect(info.name).toBe("products");
    expect(info.fields.map(f => f.name)).toEqual(["id", "name", "category", "price", "cost", "inStock"]);
    expect(info.rowCount).toBe(4);
  });

  it("describeSource for unknown source throws", async () => {
    const provider = createProvider();
    await expect(provider.describeSource("nope")).rejects.toThrow(/Unknown source "nope".*/);
  });

  it("cost and inStock are discoverable in the app, with their labels", async () => {
    const provider = createProvider();
    const info = await provider.describeSource("products");
    expect(info.fields.find(f => f.name === "cost")).toMatchObject({ type: "number", label: "Unit cost" });
    expect(info.fields.find(f => f.name === "inStock")).toMatchObject({ type: "boolean", label: "In stock" });
  });

  it("query_data selects cost and inStock and returns their values", async () => {
    const provider = createProvider();
    const res = await provider.query({ source: "products", select: ["name", "cost", "inStock"] });
    expect(res.rows).toHaveLength(4);
    const salmon = res.rows.find(r => r.name === "Salmon Pate")!;
    expect(salmon.cost).toBe(3.89);
    expect(salmon.inStock).toBe(true);
  });

  it("query_data filters on inStock and sorts by cost", async () => {
    const provider = createProvider();
    const out = await provider.query({ source: "products", filter: { inStock: false } });
    expect(out.rows.map(r => r.id)).toEqual(["p3"]);

    const sorted = await provider.query({
      source: "products",
      select: ["id", "cost"],
      sort: [{ field: "cost", dir: "desc" }],
    });
    expect(sorted.rows.map(r => r.id)).toEqual(["p3", "p1", "p2", "p4"]);
  });

  it("query_data groups by inStock and aggregates cost", async () => {
    const provider = createProvider();
    const res = await provider.query({
      source: "products",
      aggregate: {
        groupBy: [{ field: "inStock" }],
        measures: [{ op: "sum", field: "cost", as: "total_cost" }],
      },
    });
    const inStockRow = res.rows.find(r => r.inStock === true)!;
    expect(inStockRow.total_cost).toBeCloseTo(8.69, 2);
    const outRow = res.rows.find(r => r.inStock === false)!;
    expect(outRow.total_cost).toBeCloseTo(18.90, 2);
  });

  it("the other sources are unchanged — no allowFields", () => {
    const [ordersSource, , cartSource, esSource] = getCatSources(() => currentState as unknown as RootState);
    expect(ordersSource.allowFields).toBeUndefined();
    expect(cartSource.allowFields).toBeUndefined();
    expect(esSource.allowFields).toBeUndefined();
  });

  it("cart fields match CART_FIELDS", async () => {
    const provider = createProvider();
    const info = await provider.describeSource("cart");
    expect(info.fields).toEqual(CART_FIELDS);
  });
});

describe("DataSourceProvider — Elasticsearch source", () => {
  const ES_MAPPING = {
    "catstore-orders-v1": {
      mappings: { properties: { region: { type: "keyword" }, total: { type: "double" } } },
    },
  };
  const ES_SEARCH_RESULT = { hits: { total: { value: 72 } }, aggregations: {} };

  let ordersStore: OrdersStore;

  function ordersFetchArm(url: string): Response | undefined {
    if (url === "/api/orders/describe") {
      return new Response(JSON.stringify(ordersStore.describe()), { status: 200 });
    }
    if (url.startsWith("/api/orders?q=")) {
      const q = JSON.parse(decodeURIComponent(url.slice("/api/orders?q=".length))) as DataQuery;
      return new Response(JSON.stringify(ordersStore.query({ ...q, source: "orders" })), { status: 200 });
    }
    return undefined;
  }

  function createProvider() {
    return createDataSourceProvider({
      getState: () => currentState,
      sources: getCatSources(() => currentState as unknown as RootState),
    });
  }

  beforeEach(() => {
    currentState = makeState();
    ordersStore = new OrdersStore(200);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("es-orders appears with the mapped fields when the proxy answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const orders = ordersFetchArm(url);
        if (orders) return Promise.resolve(orders);
        if (url === "/api/es-orders/catstore-orders-v1/_mapping") {
          return Promise.resolve(new Response(JSON.stringify(ES_MAPPING), { status: 200 }));
        }
        if (url === "/api/es-orders/catstore-orders-v1/_search") {
          return Promise.resolve(new Response(JSON.stringify(ES_SEARCH_RESULT), { status: 200 }));
        }
        return Promise.resolve(new Response("not found", { status: 404, statusText: "Not Found" }));
      }),
    );

    const provider = createProvider();
    const sources = await provider.listSources();
    expect(sources).toHaveLength(4);

    const names = sources.map((s) => s.name).sort();
    expect(names).toEqual(["cart", "es-orders", "orders", "products"]);

    const es = sources.find((s) => s.name === "es-orders")!;
    expect(es.fieldCount).toBe(2);
    expect(es.fieldTypes).toEqual({ string: 1, number: 1 });
    expect(es.rowCount).toBe(72);
    expect(es.description).toBe(ES_SOURCE_DESCRIPTION);
  });

  it("es-orders is skipped and the other three survive when the proxy 502s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const orders = ordersFetchArm(url);
        if (orders) return Promise.resolve(orders);
        if (url.startsWith("/api/es-orders")) {
          return Promise.resolve(new Response('{"error":"Elasticsearch is unreachable"}', { status: 502 }));
        }
        return Promise.resolve(new Response("not found", { status: 404, statusText: "Not Found" }));
      }),
    );

    const provider = createProvider();
    const sources = await provider.listSources();
    expect(sources).toHaveLength(3);
    expect(sources.map((s) => s.name).sort()).toEqual(["cart", "orders", "products"]);

    const ordersResult = await provider.query({ source: "orders", page: { limit: 5 } });
    expect(ordersResult.rows).toHaveLength(5);
    expect(ordersResult.page.total).toBe(200);

    const cartResult = await provider.query({ source: "cart" });
    expect(cartResult.rows).toHaveLength(2);

    await expect(provider.describeSource("es-orders")).rejects.toThrow(
      /Unknown source "es-orders".*(cart|orders|products)/,
    );
  });

  it("the browser sends an Elasticsearch body, not a DataQuery", async () => {
    const capturedBodies: unknown[] = [];
    // The composite/terms-grouped response the actual aggregate query needs —
    // distinct from the plain probe response resolveSchema() uses first.
    const ES_AGGREGATED_RESULT = {
      hits: { total: { value: 72 } },
      aggregations: { g: { buckets: [{ key: { region: "east" }, doc_count: 18, revenue: { value: 1909.5 } }] } },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const orders = ordersFetchArm(url);
        if (orders) return Promise.resolve(orders);
        if (url === "/api/es-orders/catstore-orders-v1/_mapping") {
          return Promise.resolve(new Response(JSON.stringify(ES_MAPPING), { status: 200 }));
        }
        if (url === "/api/es-orders/catstore-orders-v1/_search") {
          const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
          if (body) capturedBodies.push(body);
          // Schema resolution's enum probe has no "g" aggregation; the actual
          // grouped query does.
          const isAggregateQuery = Boolean((body as { aggs?: { g?: unknown } } | undefined)?.aggs?.g);
          return Promise.resolve(new Response(
            JSON.stringify(isAggregateQuery ? ES_AGGREGATED_RESULT : ES_SEARCH_RESULT),
            { status: 200 },
          ));
        }
        return Promise.resolve(new Response("not found", { status: 404, statusText: "Not Found" }));
      }),
    );

    const provider = createProvider();
    await provider.query({
      source: "es-orders",
      aggregate: {
        groupBy: [{ field: "region" }],
        measures: [{ op: "sum", field: "total", as: "revenue" }],
      },
    });

    expect(capturedBodies.length).toBeGreaterThan(0);
    // The last captured body is the actual grouped query, not the schema
    // probe fired earlier by resolveSchema().
    const body = capturedBodies[capturedBodies.length - 1] as Record<string, unknown>;
    expect(body).toHaveProperty("aggs");
    expect(body).not.toHaveProperty("source");
    expect(body).not.toHaveProperty("aggregate");
    expect(body).not.toHaveProperty("groupBy");
  });
});
