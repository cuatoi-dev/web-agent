import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { queryOrders, describeOrders, createOrder } from "./backend";
import { ORDER_FIELDS, generateOrders, type Order } from "../../shared/orders";

const SEED = generateOrders(200);

function jsonResponse(body: unknown, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

/** The exact shape backend.ts passes as the second `fetch` argument — a plain
 *  object literal, never a `Headers`/`Request` instance — so the mock's calls
 *  can be asserted on without falling back to `any`. */
type FetchInit = { method: string; headers: Record<string, string>; body: string };

let fetchMock: Mock<[string, FetchInit?], Promise<Response>>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queryOrders", () => {
  it("GETs /api/orders with the query url-encoded in q and returns the parsed QueryResult", async () => {
    const payload = {
      source: "orders",
      rows: SEED.slice(0, 10),
      aggregated: false,
      page: { limit: 10, offset: 0, total: 200, hasMore: true },
    };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const q = { source: "orders", search: "Alice", page: { limit: 10 } };
    const res = await queryOrders(q);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url: string = fetchMock.mock.calls[0][0];
    expect(url.startsWith("/api/orders?q=")).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.slice("/api/orders?q=".length)))).toEqual(q);
    expect(res).toEqual(payload);
  });

  it("throws with the server error message on a non-ok response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Invalid q parameter: not valid JSON" }, 400, "Bad Request")
    );
    await expect(queryOrders({ source: "orders" })).rejects.toThrow(
      /HTTP 400 Bad Request: Invalid q parameter: not valid JSON/
    );
  });
});

describe("describeOrders", () => {
  it("GETs /api/orders/describe and resolves the SourceInfo", async () => {
    const info = {
      name: "orders",
      description: "Historical customer orders",
      fields: ORDER_FIELDS,
      rowCount: 200,
    };
    fetchMock.mockResolvedValue(jsonResponse(info));

    const res = await describeOrders();
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/describe");
    expect(res).toEqual(info);
    expect(res.rowCount).toBe(200);
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500, statusText: "Server Error" }));
    await expect(describeOrders()).rejects.toThrow(/HTTP 500 Server Error/);
  });
});

describe("createOrder", () => {
  it("POSTs JSON to /api/orders and returns the created order", async () => {
    const created: Order = {
      id: "ORD-1201",
      createdAt: "2026-08-05T00:00:00.000Z",
      customer: "Guest",
      category: "Food",
      total: 12.5,
      status: "placed",
      itemCount: 3,
      items: "Salmon Pate, Feather Wand",
    };
    fetchMock.mockResolvedValue(jsonResponse(created, 201, "Created"));

    const res = await createOrder({ total: 12.5, itemCount: 3, items: "Salmon Pate, Feather Wand" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/orders");
    expect(init!.method).toBe("POST");
    expect(init!.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init!.body)).toEqual({
      total: 12.5,
      itemCount: 3,
      items: "Salmon Pate, Feather Wand",
    });
    expect(res).toEqual(created);
  });

  it("throws with the server error message when the body is rejected", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "total: Expected number, received string" }, 400, "Bad Request")
    );
    await expect(createOrder({ total: 1 })).rejects.toThrow(/total: Expected number/);
  });
});
