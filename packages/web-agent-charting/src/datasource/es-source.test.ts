import { describe, it, expect, vi } from "vitest";
import { createEsSourceEntry, ES_SOURCE_NAME } from "./es-source.js";

// The network boundary is the only thing mocked (the fetchImpl option), per
// the repo rule: mock external network calls, run in-memory components for
// real. The translator, the schema reader and the response decoder all run
// for real.

const MAPPING_BODY = {
  "catstore-orders-v1": {
    mappings: {
      properties: {
        total: { type: "double" },
        status: { type: "keyword" },
        createdAt: { type: "date" },
        unindexed_notes_01: { type: "text" },
      },
    },
  },
};

const PROBE_BODY = {
  hits: { total: { value: 42 } },
  aggregations: {
    status: { buckets: [{ key: "placed", doc_count: 20 }, { key: "shipped", doc_count: 22 }], sum_other_doc_count: 0 },
  },
};

const MISSING_INDEX_BODY = JSON.stringify({
  error: { root_cause: [{ type: "index_not_found_exception", reason: "no such index [catstore-orders-v1]" }], status: 404 },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch;
}

/** The shape the tests below read off a captured Elasticsearch request body. */
interface EsSearchRequestBody {
  size?: number;
  track_total_hits?: boolean;
  aggs?: {
    distinct_values?: { terms?: { field?: string; size?: number } };
    g?: { composite?: { after?: unknown } };
  };
}
function parseBody(raw: string): EsSearchRequestBody {
  return JSON.parse(raw) as EsSearchRequestBody;
}

describe("createEsSourceEntry — describe()", () => {
  it("discovers fields from the mapping and rowCount without enum probe", async () => {
    const calls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      calls.push(url);
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      return jsonResponse(200, { hits: { total: { value: 42 } } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });

    const info = await source.describe();

    expect(info.name).toBe(ES_SOURCE_NAME);
    expect(info.rowCount).toBe(42);
    const status = info.fields.find((f) => f.name === "status");
    expect(status?.type).toBe("string");
    expect(calls).toEqual([
      "/api/es-orders/catstore-orders-v1/_mapping",
      "/api/es-orders/catstore-orders-v1/_search",
    ]);
  });

  it("issues exactly GET .../_mapping and POST .../_search, with size:0 and track_total_hits:true and no aggs", async () => {
    let searchInit: RequestInit | undefined;
    const fetchImpl = stubFetch((url, init) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      searchInit = init;
      return jsonResponse(200, { hits: { total: { value: 42 } } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await source.describe();

    expect(searchInit?.method).toBe("POST");
    const body = parseBody(searchInit!.body as string);
    expect(body.size).toBe(0);
    expect(body.track_total_hits).toBe(true);
    expect(body.aggs).toBeUndefined();
  });

  it("a second describe() issues no further fetch — cache is used", async () => {
    const fetchImpl = stubFetch((url) => (url.endsWith("/_mapping") ? jsonResponse(200, MAPPING_BODY) : jsonResponse(200, { hits: { total: { value: 42 } } })));
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });

    await source.describe();
    const callCountAfterFirst = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await source.describe();
    const callCountAfterSecond = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    expect(callCountAfterSecond).toBe(callCountAfterFirst);
  });

  it("a healthy source carries neither error nor unsupportedFields", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      return jsonResponse(200, { hits: { total: { value: 42 } } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    const info = await source.describe();
    expect(info.error).toBeUndefined();
    expect(info.unsupportedFields).toBeUndefined();
  });

  it("an alias target resolves the schema", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      return jsonResponse(200, { hits: { total: { value: 42 } } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders", fetchImpl });
    const info = await source.describe();
    expect(info.fields).toHaveLength(4);
  });

  it("a missing index -> an error naming the index, and the empty answer is NOT cached", async () => {
    let indexExists = false;
    const fetchImpl = stubFetch((url) => {
      if (!indexExists) return new Response(MISSING_INDEX_BODY, { status: 404 });
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      return jsonResponse(200, { hits: { total: { value: 42 } } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });

    const first = await source.describe();
    expect(first.fields).toEqual([]);
    expect(first.rowCount).toBe(0);
    expect(first.error).toContain("catstore-orders-v1");
    expect(first.error).toMatch(/does not exist/);

    indexExists = true;
    const second = await source.describe();
    expect(second.rowCount).toBe(42);
    expect(second.error).toBeUndefined();
  });

  it("a mapping whose every property is unsupported -> error plus unsupportedFields", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) {
        return jsonResponse(200, {
          "unsupported-idx": { mappings: { properties: { geo: { type: "geo_point" } } } },
        });
      }
      return jsonResponse(200, { hits: { total: { value: 0 } } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "unsupported-idx", fetchImpl });
    const info = await source.describe();
    expect(info.fields).toHaveLength(0);
    expect(info.error).toContain("unsupported-idx");
    expect(info.error).toContain("none of which has a usable query type");
    const expected: Array<{ name: string; esType: string; reason: unknown }> = [
      { name: "geo", esType: "geo_point", reason: expect.stringContaining("geo_point") },
    ];
    expect(info.unsupportedFields).toEqual(expected);
  });

  it("a rejected fetch -> throws, naming the endpoint", async () => {
    const fetchImpl = stubFetch(() => {
      throw new Error("connect ECONNREFUSED");
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await expect(source.describe()).rejects.toThrow("/api/es-orders");
  });

  it("a 500 not-configured body -> throws", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(500, { error: "Elasticsearch is not configured. Set CATSTORE_ES_URL." }));
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await expect(source.describe()).rejects.toThrow(/500/);
  });
});

describe("createEsSourceEntry — sampleValues()", () => {
  it("runs a single terms aggregation on the field's termPath", async () => {
    let searchInit: RequestInit | undefined;
    const fetchImpl = stubFetch((url, init) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      if (url.endsWith("/_search") && init?.body && parseBody(init.body as string).aggs) {
        searchInit = init;
        return jsonResponse(200, {
          aggregations: {
            distinct_values: {
              buckets: [{ key: "placed" }, { key: "shipped" }],
              sum_other_doc_count: 0,
            },
          },
        });
      }
      return jsonResponse(200, { hits: { total: { value: 42 } } });
    });

    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    const res = await source.sampleValues!("status", 10);

    expect(res.values).toEqual(["placed", "shipped"]);
    expect(res.hasMore).toBe(false);

    expect(searchInit).toBeDefined();
    const body = parseBody(searchInit!.body as string);
    expect(body.size).toBe(0);
    expect(body.aggs!.distinct_values!.terms!.field).toBe("status");
    expect(body.aggs!.distinct_values!.terms!.size).toBe(11);
  });

  it("throws when field is unknown", async () => {
    const fetchImpl = stubFetch((url) => (url.endsWith("/_mapping") ? jsonResponse(200, MAPPING_BODY) : jsonResponse(200, { hits: { total: { value: 42 } } })));
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await expect(source.sampleValues!("nonexistent")).rejects.toThrow(/Unknown field/);
  });

  it("rejects fields without termPath with limitation error", async () => {
    const fetchImpl = stubFetch((url) => (url.endsWith("/_mapping") ? jsonResponse(200, MAPPING_BODY) : jsonResponse(200, { hits: { total: { value: 42 } } })));
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await expect(source.sampleValues!("unindexed_notes_01")).rejects.toThrow(
      /Field "unindexed_notes_01" cannot be sampled\. Free-text search only/,
    );
  });
});

describe("createEsSourceEntry — query()", () => {
  it("sends the body toEsSearchBody produced, to the _search URL", async () => {
    let capturedUrl = "";
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      capturedUrl = url;
      return jsonResponse(200, { hits: { total: { value: 0 }, hits: [] } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await source.query({ source: ES_SOURCE_NAME, page: { limit: 5 } });
    expect(capturedUrl).toBe("/api/es-orders/catstore-orders-v1/_search");
  });

  it("pages a composite aggregation until after_key is absent, decoding both responses into one result", async () => {
    let compositePage = 0;
    const fetchImpl = stubFetch((url, init) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      const body = parseBody((init?.body as string) ?? "{}");
      // schema discovery's row-count probe (no aggs.g) — not part of the paging loop
      if (!body.aggs?.g) return jsonResponse(200, PROBE_BODY);
      if (compositePage === 0) {
        compositePage++;
        expect(body.aggs.g.composite!.after).toBeUndefined();
        return jsonResponse(200, {
          aggregations: {
            g: {
              after_key: { d0: "placed" },
              buckets: [{ key: { d0: "placed" }, doc_count: 5 }],
            },
          },
        });
      }
      expect(body.aggs.g.composite!.after).toEqual({ d0: "placed" });
      return jsonResponse(200, {
        aggregations: { g: { buckets: [{ key: { d0: "shipped" }, doc_count: 7 }] } },
      });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });

    const result = await source.query({
      source: ES_SOURCE_NAME,
      aggregate: { groupBy: [{ field: "status" }], measures: [{ op: "count" }] },
    });

    expect(result.aggregated).toBe(true);
    expect(result.rows).toHaveLength(2);
  });

  it("an unknown field throws the translator's message, issuing no fetch beyond schema discovery", async () => {
    let searchCalls = 0;
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      searchCalls++;
      // schema discovery's own row-count probe — the only search call expected
      return jsonResponse(200, PROBE_BODY);
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });

    await expect(source.query({ source: ES_SOURCE_NAME, filter: { bogus: "x" } })).rejects.toThrow(/Unknown field/);
    // Exactly one search: the schema-discovery probe. None for the query
    // itself, because the translator throws before any request is sent.
    expect(searchCalls).toBe(1);
  });

  it("an aggregate carrying a top-level sort throws before any _search fetch", async () => {
    let searchCalls = 0;
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      searchCalls++;
      // schema discovery's own row-count probe — the only search call expected
      return jsonResponse(200, PROBE_BODY);
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });

    await expect(
      source.query({
        source: ES_SOURCE_NAME,
        sort: [{ field: "total", dir: "desc" }],
        aggregate: { groupBy: [{ field: "status" }], measures: [{ op: "count" }] },
      }),
    ).rejects.toThrow(/Top-level "sort" does not apply to an aggregate query/);
    expect(searchCalls).toBe(1);
  });

  it("a rejected fetch on the search call -> throws, and the result has no rows", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      throw new Error("boom");
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await expect(source.query({ source: ES_SOURCE_NAME })).rejects.toThrow("boom");
  });

  it("index missing on the search call -> throws, naming the index", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) return new Response(MISSING_INDEX_BODY, { status: 404 });
      return new Response(MISSING_INDEX_BODY, { status: 404 });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await expect(source.query({ source: ES_SOURCE_NAME })).rejects.toThrow(/catstore-orders-v1/);
  });

  it("no request carries an Authorization header, and no option can supply one", async () => {
    const headersSeen: (Headers | Record<string, string> | undefined)[] = [];
    const fetchImpl = stubFetch((url, init) => {
      headersSeen.push(init?.headers as Record<string, string> | undefined);
      if (url.endsWith("/_mapping")) return jsonResponse(200, MAPPING_BODY);
      return jsonResponse(200, { hits: { total: { value: 0 }, hits: [] } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await source.query({ source: ES_SOURCE_NAME });

    for (const h of headersSeen) {
      expect(h && (h as Record<string, string>)["Authorization"]).toBeUndefined();
    }
  });

  it("query() against a zero-field source rejects with the discovery error", async () => {
    let searchCalls = 0;
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith("/_mapping")) return new Response(MISSING_INDEX_BODY, { status: 404 });
      searchCalls++;
      return jsonResponse(200, { hits: { total: { value: 0 }, hits: [] } });
    });
    const source = createEsSourceEntry({ endpoint: "/api/es-orders", index: "catstore-orders-v1", fetchImpl });
    await expect(source.query({ source: ES_SOURCE_NAME })).rejects.toThrow(/found no usable fields/);
    expect(searchCalls).toBe(0);
  });
});
