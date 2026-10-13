import { describe, it, expect } from "vitest";
import { runQuery } from "@cuatoi/web-agent-core";
import type { DataQuery, FieldSchema } from "@cuatoi/web-agent-core";
import { fromEsResponses, bucketDateUtc } from "./es-response.js";
import type { EsSchema, EsSearchPlan } from "./types.js";
import { ES_MAX_COMPOSITE_PAGES } from "./types.js";

const ROW_SCHEMA: EsSchema = {
  fields: [
    { name: "id", type: "number" },
    { name: "name", type: "string" },
  ],
  byName: {
    id: { name: "id", type: "number", esType: "integer", termPath: "id" },
    name: { name: "name", type: "string", esType: "text", termPath: "name.keyword" },
  },
  unsupported: [],
};

const ALIAS_ROW_SCHEMA: EsSchema = {
  fields: [
    { name: "aliasName", type: "string" },
    { name: "name", type: "string" },
  ],
  byName: {
    name: { name: "name", type: "string", esType: "text", termPath: "name.keyword" },
    aliasName: { name: "aliasName", type: "string", esType: "alias", termPath: "name.keyword", sourcePath: "name" },
  },
  unsupported: [],
};

describe("fromEsResponses — row path", () => {
  it("decodes hits, total, page and truncates long strings", () => {
    const plan: EsSearchPlan = { body: { from: 0, size: 2 }, aggregated: false };
    const q: DataQuery = { source: "x" };
    const response = {
      hits: {
        total: { value: 5 },
        hits: [{ _source: { id: 1, name: "a".repeat(400) } }, { _source: { id: 2, name: "b" } }],
      },
    };
    const result = fromEsResponses(plan, q, ROW_SCHEMA, [response]);
    expect(result.aggregated).toBe(false);
    expect(result.page).toEqual({ limit: 2, offset: 0, total: 5, hasMore: true });
    expect(result.rows[0].name).toBe("a".repeat(300) + "…");
    expect(result.rows[1]).toEqual({ id: 2, name: "b" });
  });

  it("page.limit and hasMore reflect delivered hits, not the requested size, when fewer hits come back than requested", () => {
    // size: 50 but only 3 hits returned — proves the honest-page fix
    // (limit: rows.length) rather than the old limit: body.size. total: 10
    // (larger than offset + hits.length) makes hasMore differ between the
    // two formulas too: old (buggy) computed offset + body.size (0 + 50 = 50)
    // < total (10) -> false; fixed computes offset + rows.length (0 + 3 = 3)
    // < total (10) -> true.
    const plan: EsSearchPlan = { body: { from: 0, size: 50 }, aggregated: false };
    const q: DataQuery = { source: "x" };
    const response = {
      hits: {
        total: { value: 10 },
        hits: [
          { _source: { id: 1, name: "a" } },
          { _source: { id: 2, name: "b" } },
          { _source: { id: 3, name: "c" } },
        ],
      },
    };
    const result = fromEsResponses(plan, q, ROW_SCHEMA, [response]);
    expect(result.rows).toHaveLength(3);
    expect(result.page.limit).toBe(result.rows.length);
    expect(result.page.limit).toBe(3);
    expect(result.page.hasMore).toBe(true);
  });

  it("select narrows both rows and fields", () => {
    const plan: EsSearchPlan = { body: { from: 0, size: 10 }, aggregated: false };
    const q: DataQuery = { source: "x", select: ["name"] };
    const response = { hits: { total: { value: 1 }, hits: [{ _source: { name: "only" } }] } };
    const result = fromEsResponses(plan, q, ROW_SCHEMA, [response]);
    expect(result.fields).toEqual([{ name: "name", type: "string" }]);
  });

  it("an alias field is filled from its target path", () => {
    const plan: EsSearchPlan = { body: { from: 0, size: 10 }, aggregated: false };
    const q: DataQuery = { source: "x" };
    const response = { hits: { total: { value: 1 }, hits: [{ _source: { name: "targetVal" } }] } };
    const result = fromEsResponses(plan, q, ALIAS_ROW_SCHEMA, [response]);
    expect(result.rows[0].aliasName).toBe("targetVal");
    expect(result.rows[0].name).toBe("targetVal");
  });

  it("selecting only the alias drops the target key", () => {
    const plan: EsSearchPlan = { body: { from: 0, size: 10 }, aggregated: false };
    const q: DataQuery = { source: "x", select: ["aliasName"] };
    const response = { hits: { total: { value: 1 }, hits: [{ _source: { name: "targetVal" } }] } };
    const result = fromEsResponses(plan, q, ALIAS_ROW_SCHEMA, [response]);
    expect(result.rows[0].aliasName).toBe("targetVal");
    expect("name" in result.rows[0]).toBe(false);
  });
});

describe("bucketDateUtc — parity with core's bucketDate", () => {
  const DATE_SCHEMA: FieldSchema[] = [{ name: "createdAt", type: "date" }];
  const SAMPLE_DATES = ["2026-01-15T10:30:00.000Z", "2026-04-02T23:59:00.000Z", "2026-12-31T00:00:00.000Z"];
  const GRANULARITIES = ["minute", "hour", "day", "week", "month", "quarter", "year"] as const;

  for (const granularity of GRANULARITIES) {
    it(`matches runQuery's label for granularity "${granularity}"`, () => {
      for (const raw of SAMPLE_DATES) {
        const result = runQuery([{ createdAt: raw }], DATE_SCHEMA, {
          source: "x",
          aggregate: {
            groupBy: [{ field: "createdAt", granularity, as: "bucket" }],
            measures: [{ op: "count", as: "n" }],
          },
        });
        const memLabel = result.rows[0].bucket as string;
        const esLabel = bucketDateUtc(Date.parse(raw), granularity);
        expect(esLabel).toBe(memLabel);
      }
    });
  }
});

describe("fromEsResponses — aggregation path", () => {
  const REGION_SCHEMA: FieldSchema[] = [
    { name: "region", type: "string" },
    { name: "total", type: "number" },
    { name: "aliasTotal", type: "number" },
  ];
  const REGION_ES_SCHEMA: EsSchema = {
    fields: REGION_SCHEMA,
    byName: {
      region: { name: "region", type: "string", esType: "keyword", termPath: "region" },
      total: { name: "total", type: "number", esType: "double", termPath: "total" },
      aliasTotal: { name: "aliasTotal", type: "number", esType: "alias", termPath: "total", sourcePath: "total" },
    },
    unsupported: [],
  };

  function buildRegionRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({ region: `r${i}`, total: i }));
  }
  function buildEsBuckets(count: number) {
    return Array.from({ length: count }, (_, i) => ({ key: { d0: `r${i}` }, doc_count: 1, m0: { value: i } }));
  }

  it.each([
    [undefined, 100],
    [0, 1],
    [501, 500],
  ])("sort/limit/paging parity — agg.limit %s -> %s, matches runQuery", (aggLimit, expectedLimit) => {
    void expectedLimit; // documents the pairing in the table; the body derives its own expectation
    const count = 600;
    const rows = buildRegionRows(count);
    const aggregate = {
      groupBy: [{ field: "region" }],
      measures: [{ op: "sum" as const, field: "total", as: "revenue" }],
      sort: [{ field: "revenue", dir: "desc" as const }],
      limit: aggLimit,
    };
    const q: DataQuery = { source: "x", aggregate, page: { limit: 500 } };

    const memResult = runQuery(rows, REGION_SCHEMA, q);

    const plan: EsSearchPlan = {
      body: {},
      aggregated: true,
      dimensionAliases: ["region"],
      measureAliases: ["revenue"],
    };
    const response = { aggregations: { g: { buckets: buildEsBuckets(count) } } };
    const esResult = fromEsResponses(plan, q, REGION_ES_SCHEMA, [response]);

    expect(esResult.rows).toEqual(memResult.rows);
    expect(esResult.page).toEqual(memResult.page);
  });

  it("a first measure on an alias decodes the real value", () => {
    const plan: EsSearchPlan = { body: {}, aggregated: true, dimensionAliases: ["region"], measureAliases: ["open"] };
    const q: DataQuery = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "first", field: "aliasTotal", as: "open" }] },
    };
    const response = {
      aggregations: {
        g: {
          buckets: [
            { key: { d0: "north" }, doc_count: 1, m0: { h: { hits: { hits: [{ _source: { total: 42 } }] } } } },
          ],
        },
      },
    };
    const result = fromEsResponses(plan, q, REGION_ES_SCHEMA, [response]);
    expect(result.rows[0].open).toBe(42);
  });

  it("a missing_bucket key of null produces undefined in the row, not null", () => {
    const plan: EsSearchPlan = { body: {}, aggregated: true, dimensionAliases: ["region"], measureAliases: ["n"] };
    const q: DataQuery = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "count", as: "n" }] },
    };
    const response = { aggregations: { g: { buckets: [{ key: { d0: null }, doc_count: 3 }] } } };
    const result = fromEsResponses(plan, q, REGION_ES_SCHEMA, [response]);
    expect(result.rows[0].region).toBeUndefined();
    expect(result.rows[0].n).toBe(3);
  });

  it("an empty sum bucket yields 0", () => {
    const plan: EsSearchPlan = {
      body: {},
      aggregated: true,
      dimensionAliases: ["region"],
      measureAliases: ["revenue"],
    };
    const q: DataQuery = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "sum", field: "total", as: "revenue" }] },
    };
    const response = { aggregations: { g: { buckets: [{ key: { d0: "north" }, doc_count: 0, m0: { value: null } }] } } };
    const result = fromEsResponses(plan, q, REGION_ES_SCHEMA, [response]);
    expect(result.rows[0].revenue).toBe(0);
  });

  it("a top_hits filter that matched nothing yields 0", () => {
    const plan: EsSearchPlan = { body: {}, aggregated: true, dimensionAliases: ["region"], measureAliases: ["open"] };
    const q: DataQuery = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "first", field: "total", as: "open" }] },
    };
    const response = {
      aggregations: { g: { buckets: [{ key: { d0: "north" }, doc_count: 2, m0: { h: { hits: { hits: [] } } } }] } },
    };
    const result = fromEsResponses(plan, q, REGION_ES_SCHEMA, [response]);
    expect(result.rows[0].open).toBe(0);
  });

  it("a non-aggregated response shape (aggregations: {}) returns empty rows instead of throwing", () => {
    // A response with aggregations:{} was observed once; its trigger is not
    // known (see the guard in es-response.ts). fromEsResponses must treat
    // a missing aggregations.g as zero buckets — not crash with a TypeError.
    const plan: EsSearchPlan = { body: {}, aggregated: true, dimensionAliases: ["region"], measureAliases: ["n"] };
    const q: DataQuery = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "count", as: "n" }] },
    };
    const nonAggregatedResponse = { hits: { total: { value: 72 } }, aggregations: {} };
    const result = fromEsResponses(plan, q, REGION_ES_SCHEMA, [nonAggregatedResponse]);
    expect(result.aggregated).toBe(true);
    expect(result.rows).toHaveLength(0);
    expect(result.page.total).toBe(0);
  });

  describe("composite page cap", () => {
    const plan: EsSearchPlan = { body: {}, aggregated: true, dimensionAliases: ["region"], measureAliases: ["n"] };
    const q: DataQuery = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "count", as: "n" }] },
    };
    const pageWithAfter = { aggregations: { g: { buckets: [{ key: { d0: "r" }, doc_count: 1 }], after_key: { d0: "r" } } } };
    const pageNoAfter = { aggregations: { g: { buckets: [{ key: { d0: "r" }, doc_count: 1 }] } } };

    it(`${ES_MAX_COMPOSITE_PAGES - 1} pages with an after_key on the last do NOT throw`, () => {
      const responses = Array.from({ length: ES_MAX_COMPOSITE_PAGES - 1 }, (_, i) =>
        i === ES_MAX_COMPOSITE_PAGES - 2 ? pageWithAfter : pageNoAfter,
      );
      expect(() => fromEsResponses(plan, q, REGION_ES_SCHEMA, responses)).not.toThrow();
    });

    it(`${ES_MAX_COMPOSITE_PAGES} pages with an after_key on the last DO throw`, () => {
      const responses = Array.from({ length: ES_MAX_COMPOSITE_PAGES }, (_, i) =>
        i === ES_MAX_COMPOSITE_PAGES - 1 ? pageWithAfter : pageNoAfter,
      );
      expect(() => fromEsResponses(plan, q, REGION_ES_SCHEMA, responses)).toThrow(/more than 10000 groups/);
    });
  });
});
