import { describe, it, expect, afterEach, vi } from "vitest";
import { createEsOrdersSource, ES_PROXY_ENDPOINT, ES_ORDERS_INDEX } from "./es-source";

describe("createEsOrdersSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("points at the proxy and the index", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{"error":"index_not_found_exception"}', { status: 404 }));
      }),
    );

    const source = createEsOrdersSource();
    await source.describe();

    expect(calls[0]).toBe("/api/es-orders/catstore-orders-v1/_mapping");
  });

  it("accepts an explicit index override", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{"error":"index_not_found_exception"}', { status: 404 }));
      }),
    );

    const source = createEsOrdersSource("wide-fixture-v1");
    await source.describe();

    expect(calls[0]).toBe("/api/es-orders/wide-fixture-v1/_mapping");
  });

  it("reads esIndex from window.location.search when present", async () => {
    const calls: string[] = [];
    vi.stubGlobal("window", {
      location: { search: "?esIndex=wide-fixture" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{"error":"index_not_found_exception"}', { status: 404 }));
      }),
    );

    const source = createEsOrdersSource();
    await source.describe();

    expect(calls[0]).toBe("/api/es-orders/wide-fixture/_mapping");
  });

  it("the module holds no credential", () => {
    expect(ES_PROXY_ENDPOINT).not.toMatch(/https?:\/\//);
    expect(ES_PROXY_ENDPOINT).not.toMatch(/:9200/);
    expect(ES_PROXY_ENDPOINT).not.toMatch(/Authorization/);
    expect(ES_ORDERS_INDEX).not.toMatch(/https?:\/\//);
    expect(ES_ORDERS_INDEX).not.toMatch(/:9200/);
    expect(ES_ORDERS_INDEX).not.toMatch(/Authorization/);
  });
});
