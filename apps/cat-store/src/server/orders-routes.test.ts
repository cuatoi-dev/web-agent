// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SourceInfo, QueryResult } from "@cuatoi/web-agent-core";
import { createApp } from "./app.js";
import { OrdersStore } from "./orders-store.js";
import { ordersOpenApiSpec } from "./openapi.js";
import { ORDER_FIELDS } from "../shared/orders.js";
import type { Order } from "../shared/orders.js";
import { startTestServer, readJson, type TestServer } from "./test-helpers.js";

/** The error envelope every 4xx route in this app returns. */
interface ErrorBody {
  error: string;
}

describe("orders routes", () => {
  let srv: TestServer;

  beforeEach(async () => {
    srv = await startTestServer(createApp(new OrdersStore()));
  });

  afterEach(async () => {
    await srv.close();
  });

  const get = (q?: object) =>
    fetch(
      `${srv.url}/api/orders${
        q ? `?q=${encodeURIComponent(JSON.stringify(q))}` : ""
      }`
    );

  it("describe route", async () => {
    const res = await fetch(`${srv.url}/api/orders/describe`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await readJson<SourceInfo>(res);
    const expected = new OrdersStore().describe();
    expect(body).toEqual(expected);
  });

  it("openapi.json route", async () => {
    const res = await fetch(`${srv.url}/api/orders/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await readJson<{ openapi: string; paths: Record<string, unknown> }>(res);
    expect(body.paths["/api/orders"]).toBeDefined();
    expect(body.paths["/api/orders/describe"]).toBeDefined();
    expect(body.paths["/api/orders/openapi.json"]).toBeDefined();
  });

  it("OpenAPI schema stays in step with ORDER_FIELDS", () => {
    const orderSchemaProps = ordersOpenApiSpec.components.schemas.Order.properties;
    for (const field of ORDER_FIELDS) {
      const prop = (orderSchemaProps as Record<string, { type?: string; enum?: string[] }>)[field.name];
      expect(prop).toBeDefined();
      if (field.type === "enum" && field.enumValues) {
        expect(prop.enum).toEqual(field.enumValues);
      }
    }
  });

  it("query, no params → 50 rows, total 200", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await readJson<QueryResult>(res);
    expect(body.rows.length).toBe(50);
    expect(body.page.total).toBe(200);
    expect(body.page.limit).toBe(50);
    expect(body.page.hasMore).toBe(true);
    expect(body.aggregated).toBe(false);
    expect(body.source).toBe("orders");
  });

  it("query with limit 5", async () => {
    const res = await get({ page: { limit: 5 } });
    expect(res.status).toBe(200);
    const body = await readJson<QueryResult>(res);
    expect(body.rows.length).toBe(5);
    expect(body.page.total).toBe(200);
  });

  it("query with filter=delivered", async () => {
    const res = await get({ filter: { status: "delivered" } });
    expect(res.status).toBe(200);
    const body = await readJson<QueryResult>(res);
    expect(body.rows.every((r) => r.status === "delivered")).toBe(true);
  });

  it("query with sort desc by total", async () => {
    const res = await get({ sort: [{ field: "total", dir: "desc" }] });
    expect(res.status).toBe(200);
    const body = await readJson<QueryResult>(res);
    const totals = body.rows.map((r) => r.total as number);
    for (let i = 0; i < totals.length - 1; i++) {
      expect(totals[i]).toBeGreaterThanOrEqual(totals[i + 1]);
    }
  });

  it("query with search=ORD-1005", async () => {
    const res = await get({ search: "ORD-1005" });
    expect(res.status).toBe(200);
    const body = await readJson<QueryResult>(res);
    expect(body.page.total).toBe(1);
    expect(body.rows[0].id).toBe("ORD-1005");
  });

  it("query with aggregate by category", async () => {
    const res = await get({
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count", as: "n" }],
      },
    });
    expect(res.status).toBe(200);
    const body = await readJson<QueryResult>(res);
    expect(body.aggregated).toBe(true);
  });

  it("client-supplied source is ignored", async () => {
    const res = await get({ source: "hackers" });
    expect(res.status).toBe(200);
    const body = await readJson<QueryResult>(res);
    expect(body.source).toBe("orders");
  });

  it("malformed q → 400 not valid JSON", async () => {
    const res = await fetch(`${srv.url}/api/orders?q=%7Bbroken`);
    expect(res.status).toBe(400);
    const body = await readJson<ErrorBody>(res);
    expect(body.error).toMatch(/not valid JSON/);
  });

  it("array q → 400 expected a JSON object", async () => {
    const res = await fetch(`${srv.url}/api/orders?q=%5B1%2C2%5D`);
    expect(res.status).toBe(400);
    const body = await readJson<ErrorBody>(res);
    expect(body.error).toMatch(/expected a JSON object/);
  });

  it("repeated q → 400 expected a single JSON string", async () => {
    const res = await fetch(`${srv.url}/api/orders?q=a&q=b`);
    expect(res.status).toBe(400);
    const body = await readJson<ErrorBody>(res);
    expect(body.error).toMatch(/expected a single JSON string/);
  });

  it("runQuery error surfaces as 400", async () => {
    const res = await get({ select: ["nope"] });
    expect(res.status).toBe(400);
    const body = await readJson<ErrorBody>(res);
    expect(body.error).toMatch(/^Unknown field "nope"/);
  });

  it("create order", async () => {
    // each test starts from a clean store — confirm baseline
    const desc = await readJson<SourceInfo>(await fetch(`${srv.url}/api/orders/describe`));
    expect(desc.rowCount).toBe(200);

    const res = await fetch(`${srv.url}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer: "Zoe",
        category: "Toys",
        total: 42.5,
        itemCount: 2,
        items: "Feather Wand Toy",
      }),
    });
    expect(res.status).toBe(201);
    const body = await readJson<Order>(res);
    expect(body.customer).toBe("Zoe");
    expect(body.category).toBe("Toys");
    expect(body.total).toBe(42.5);
    expect(body.itemCount).toBe(2);
    expect(body.items).toBe("Feather Wand Toy");
    expect(body.id).toBe("ORD-1201");
    expect(Number.isFinite(Date.parse(body.createdAt))).toBe(true);
  });

  it("create then query reflects it", async () => {
    await fetch(`${srv.url}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer: "Zoe" }),
    });
    const res = await get({ page: { limit: 1 } });
    const body = await readJson<QueryResult>(res);
    expect(body.page.total).toBe(201);
    expect(body.rows[0].id).toBe("ORD-1201");
  });

  it("create with empty body uses defaults", async () => {
    const res = await fetch(`${srv.url}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = await readJson<Order>(res);
    expect(body.customer).toBe("Guest");
    expect(body.category).toBe("Food");
    expect(body.status).toBe("placed");
    expect(body.total).toBe(0);
    expect(body.itemCount).toBe(1);
    expect(body.items).toBe("");
  });

  it("create rejects wrong-typed field", async () => {
    const res = await fetch(`${srv.url}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ total: "free" }),
    });
    expect(res.status).toBe(400);
    const body = await readJson<ErrorBody>(res);
    expect(body.error).toContain("total");

    // store size unchanged
    const desc = await readJson<SourceInfo>(await fetch(`${srv.url}/api/orders/describe`));
    expect(desc.rowCount).toBe(200);
  });

  it("create rejects malformed JSON body", async () => {
    const res = await fetch(`${srv.url}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"',
    });
    expect(res.status).toBe(400);
  });

  it("unknown path → 404", async () => {
    const res = await fetch(`${srv.url}/api/nope`);
    expect(res.status).toBe(404);
  });

  it("each test starts from a clean store (beforeEach isolation)", async () => {
    const desc = await readJson<SourceInfo>(await fetch(`${srv.url}/api/orders/describe`));
    expect(desc.rowCount).toBe(200);
  });
});
