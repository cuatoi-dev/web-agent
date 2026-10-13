import { describe, it, expect } from "vitest";
import { runQuery } from "@cuatoi/web-agent-core";
import type { DataQuery } from "@cuatoi/web-agent-core";
import { toEsSearchBody, nextEsCompositeBody } from "./es-request.js";
import type { EsSchema } from "./types.js";

/** The shape the tests below read off `plan.body.aggs` — `plan.body` is a
 *  `Record<string, unknown>` in the real return type, so every read needs a
 *  narrower local view. */
interface AggsShape {
  g: {
    composite?: { sources: Record<string, unknown>[]; after?: unknown };
    aggs?: Record<string, unknown>;
  };
}

const SCHEMA: EsSchema = {
  fields: [
    { name: "customer", type: "string" },
    { name: "notes", type: "string", limitation: "Free-text search only: this is a text field with no keyword subfield" },
    { name: "status", type: "enum", enumValues: ["placed", "shipped", "cancelled"] },
    { name: "total", type: "number" },
    { name: "active", type: "boolean" },
    { name: "createdAt", type: "date" },
    { name: "region", type: "string" },
    { name: "aliasCustomer", type: "string" },
    { name: "nested.field", type: "string" },
  ],
  byName: {
    customer: { name: "customer", type: "string", esType: "text", termPath: "customer.keyword" },
    notes: {
      name: "notes",
      type: "string",
      esType: "text",
      termPath: undefined,
      limitation: "Free-text search only: this is a text field with no keyword subfield",
    },
    status: { name: "status", type: "enum", esType: "keyword", termPath: "status" },
    total: { name: "total", type: "number", esType: "double", termPath: "total" },
    active: { name: "active", type: "boolean", esType: "boolean", termPath: "active" },
    createdAt: { name: "createdAt", type: "date", esType: "date", termPath: "createdAt" },
    region: { name: "region", type: "string", esType: "keyword", termPath: "region" },
    aliasCustomer: { name: "aliasCustomer", type: "string", esType: "alias", termPath: "region", sourcePath: "region" },
    "nested.field": { name: "nested.field", type: "string", esType: "keyword", termPath: "nested.field" },
  },
  unsupported: [],
};

function q(filter: unknown, extra: Record<string, unknown> = {}): DataQuery {
  return { source: "es-orders", filter: filter as DataQuery["filter"], ...extra };
}

describe("toEsSearchBody — row path, operator table", () => {
  it("$eq (bare scalar)", () => {
    expect(toEsSearchBody(q({ status: "placed" }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ term: { status: "placed" } }] },
    });
  });
  it("$eq (explicit)", () => {
    expect(toEsSearchBody(q({ status: { $eq: "placed" } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ term: { status: "placed" } }] },
    });
  });
  it("$ne", () => {
    expect(toEsSearchBody(q({ status: { $ne: "placed" } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ bool: { must_not: [{ term: { status: "placed" } }] } }] },
    });
  });
  it("$gt/$gte/$lt/$lte", () => {
    expect(toEsSearchBody(q({ total: { $gt: 5 } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ range: { total: { gt: 5 } } }] },
    });
    expect(toEsSearchBody(q({ total: { $gte: 5 } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ range: { total: { gte: 5 } } }] },
    });
    expect(toEsSearchBody(q({ total: { $lt: 5 } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ range: { total: { lt: 5 } } }] },
    });
    expect(toEsSearchBody(q({ total: { $lte: 5 } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ range: { total: { lte: 5 } } }] },
    });
  });
  it("$between", () => {
    expect(toEsSearchBody(q({ total: { $between: [1, 9] } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ range: { total: { gte: 1, lte: 9 } } }] },
    });
  });
  it("$in / $nin", () => {
    expect(toEsSearchBody(q({ status: { $in: ["placed", "shipped"] } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ terms: { status: ["placed", "shipped"] } }] },
    });
    expect(toEsSearchBody(q({ status: { $nin: ["placed"] } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ bool: { must_not: [{ terms: { status: ["placed"] } }] } }] },
    });
  });
  it("$contains is case-sensitive — no case_insensitive key", () => {
    const body = toEsSearchBody(q({ customer: { $contains: "Salmon" } }), SCHEMA).body;
    expect(body.query).toEqual({
      bool: { filter: [{ wildcard: { "customer.keyword": { value: "*Salmon*" } } }] },
    });
  });
  it("$startsWith / $endsWith", () => {
    expect(toEsSearchBody(q({ customer: { $startsWith: "Al" } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ prefix: { "customer.keyword": { value: "Al" } } }] },
    });
    expect(toEsSearchBody(q({ customer: { $endsWith: "ce" } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ wildcard: { "customer.keyword": { value: "*ce" } } }] },
    });
  });
  it("$exists / $isNull", () => {
    expect(toEsSearchBody(q({ region: { $exists: true } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ exists: { field: "region" } }] },
    });
    expect(toEsSearchBody(q({ region: { $exists: false } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ bool: { must_not: [{ exists: { field: "region" } }] } }] },
    });
    expect(toEsSearchBody(q({ region: { $isNull: true } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ bool: { must_not: [{ exists: { field: "region" } }] } }] },
    });
    expect(toEsSearchBody(q({ region: { $isNull: false } }), SCHEMA).body.query).toEqual({
      bool: { filter: [{ exists: { field: "region" } }] },
    });
  });
  it("search emits case_insensitive: true", () => {
    const body = toEsSearchBody({ source: "x", search: "salmon" }, SCHEMA).body;
    const clause = (body.query as { bool: { filter: unknown[] } }).bool.filter[0] as {
      bool: { should: { wildcard: Record<string, { case_insensitive: boolean }> }[] };
    };
    for (const s of clause.bool.should) {
      const [[, v]] = Object.entries(s.wildcard);
      expect(v.case_insensitive).toBe(true);
    }
  });
});

describe("$regex wrapping", () => {
  const clause = (pattern: string) =>
    (toEsSearchBody(q({ customer: { $regex: pattern } }), SCHEMA).body.query as {
      bool: { filter: [{ regexp: Record<string, { value: string; case_insensitive: boolean }> }] };
    }).bool.filter[0].regexp["customer.keyword"];

  it('"li" -> .*li.*', () => {
    expect(clause("li").value).toBe(".*li.*");
  });
  it('"^Ali" -> Ali.*', () => {
    expect(clause("^Ali").value).toBe("Ali.*");
  });
  it('"ce$" -> .*ce', () => {
    expect(clause("ce$").value).toBe(".*ce");
  });
  it('"/ALI/i" -> .*ALI.* case_insensitive', () => {
    const c = clause("/ALI/i");
    expect(c.value).toBe(".*ALI.*");
    expect(c.case_insensitive).toBe(true);
  });
  it("a 201-character pattern throws", () => {
    expect(() => clause("a".repeat(201))).toThrow(/exceeds limit of 200/);
  });
});

describe("wildcard escaping", () => {
  it("escapes a literal * or ? so it matches literally", () => {
    const body = toEsSearchBody(q({ customer: { $contains: "a*st?r" } }), SCHEMA).body;
    expect(body.query).toEqual({
      bool: { filter: [{ wildcard: { "customer.keyword": { value: "*a\\*st\\?r*" } } }] },
    });
  });
});

describe("nested boolean logic", () => {
  it("$and / $or / $not three levels deep", () => {
    const filter = {
      $and: [
        { $or: [{ $not: { status: "cancelled" } }, { region: "north" }] },
        { total: { $gte: 50 } },
      ],
    };
    expect(toEsSearchBody(q(filter), SCHEMA).body.query).toEqual({
      bool: {
        filter: [
          {
            bool: {
              filter: [
                {
                  bool: {
                    should: [
                      { bool: { must_not: [{ term: { status: "cancelled" } }] } },
                      { term: { region: "north" } },
                    ],
                    minimum_should_match: 1,
                  },
                },
                { range: { total: { gte: 50 } } },
              ],
            },
          },
        ],
      },
    });
  });
});

describe("unknown field — byte-identical message", () => {
  it("matches the message runQuery throws for the same input", () => {
    const filter = { bogus: "y" };
    let esMsg = "";
    try {
      toEsSearchBody(q(filter), SCHEMA);
    } catch (e) {
      esMsg = (e as Error).message;
    }
    let memMsg = "";
    try {
      // A non-empty row array is required: matchesFilter only runs inside the
      // .filter() callback, so an empty array would never invoke it.
      runQuery([{ bogus: "z" }], SCHEMA.fields, q(filter));
    } catch (e) {
      memMsg = (e as Error).message;
    }
    expect(esMsg).not.toBe("");
    expect(esMsg).toBe(memMsg);
  });
});

describe("operator type guards", () => {
  it("a string operator on a number field throws", () => {
    expect(() => toEsSearchBody(q({ total: { $contains: "5" } }), SCHEMA)).toThrow(
      /Operator \$contains is not valid for number field "total"/,
    );
  });
  it("a range operator on a boolean field throws", () => {
    expect(() => toEsSearchBody(q({ active: { $gt: true } }), SCHEMA)).toThrow(
      /Operator \$gt is not valid for boolean field "active"/,
    );
  });
});

describe("fields with no termPath and limitations", () => {
  it("throws for $eq with limitation and alternatives", () => {
    expect(() => toEsSearchBody(q({ notes: "hello" }), SCHEMA)).toThrow(
      /Field "notes" cannot be filtered, sorted or grouped/,
    );
  });
  it("throws for sort with limitation and alternatives", () => {
    expect(() => toEsSearchBody({ source: "x", sort: [{ field: "notes" }] }, SCHEMA)).toThrow(
      /Field "notes" cannot be filtered, sorted or grouped/,
    );
  });
  it("throws for groupBy with limitation and alternatives", () => {
    expect(() =>
      toEsSearchBody(
        { source: "x", aggregate: { groupBy: [{ field: "notes" }], measures: [{ op: "count" }] } },
        SCHEMA,
      ),
    ).toThrow(/Field "notes" cannot be filtered, sorted or grouped/);
  });
  it("sorting a limited field throws with the reason and an alternative", () => {
    try {
      toEsSearchBody({ source: "x", sort: [{ field: "notes" }] }, SCHEMA);
      expect.fail("should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("notes");
      expect(message).toContain("Free-text search only");
      expect(message).toContain("region");
    }
  });
  it("the alternatives list is capped at 10 with a remainder count", () => {
    const fields: EsSchema["fields"] = [];
    const byName: EsSchema["byName"] = {};
    for (let i = 0; i < 300; i++) {
      const name = `f_${String(i).padStart(3, "0")}`;
      fields.push({ name, type: "string" });
      byName[name] = { name, type: "string", esType: "keyword", termPath: name };
    }
    fields.push({ name: "limited", type: "string", limitation: "Cannot sort" });
    byName["limited"] = { name: "limited", type: "string", esType: "text", termPath: undefined, limitation: "Cannot sort" };
    const hugeSchema: EsSchema = { fields, byName, unsupported: [] };

    expect(() =>
      toEsSearchBody({ source: "x", sort: [{ field: "limited" }] }, hugeSchema),
    ).toThrow(/\(and 290 more\)/);
  });
  it("is silently skipped by search", () => {
    const body = toEsSearchBody({ source: "x", search: "hi" }, SCHEMA).body;
    const clause = (body.query as { bool: { filter: unknown[] } }).bool.filter[0] as {
      bool: { should: { wildcard: Record<string, unknown> }[] };
    };
    const fieldsUsed = clause.bool.should.map((s) => Object.keys(s.wildcard)[0]);
    expect(fieldsUsed).not.toContain("notes");
  });
  it("select of an alias field asks Elasticsearch for the target path", () => {
    const body = toEsSearchBody({ source: "x", select: ["aliasCustomer"] }, SCHEMA).body;
    expect(body._source).toEqual({ includes: ["region"] });
  });
  it("select of a nested field is unchanged", () => {
    const body = toEsSearchBody({ source: "x", select: ["nested.field"] }, SCHEMA).body;
    expect(body._source).toEqual({ includes: ["nested.field"] });
  });
  it("sort on an alias field uses the target's termPath", () => {
    const body = toEsSearchBody({ source: "x", sort: [{ field: "aliasCustomer" }] }, SCHEMA).body;
    expect(body.sort).toEqual([{ region: { order: "asc", missing: "_first" } }]);
  });
});

describe("page-size parity with runQuery", () => {
  // runQuery's page.limit reports rows actually delivered (query-engine.ts),
  // so this needs a backing set at least as large as the biggest expected
  // clamp (500) for the delivered count to equal the clamped size rather
  // than being capped by data exhaustion.
  const manyRows = Array.from({ length: 500 }, (_, i) => ({ id: String(i) }));

  it.each([
    [undefined, 50],
    [0, 1],
    [-5, 1],
    [1, 1],
    [50, 50],
    [500, 500],
    [501, 500],
    [10000, 500],
  ])("limit %s -> %s", (limit, expected) => {
    const query = { source: "x", page: limit === undefined ? undefined : { limit } } as DataQuery;
    const esBody = toEsSearchBody(query, SCHEMA).body as { size: number };
    expect(esBody.size).toBe(expected);
    expect(runQuery(manyRows, SCHEMA.fields, query).page.limit).toBe(expected);
  });
});

describe("sort", () => {
  it('emits missing: "_first" for asc and "_last" for desc', () => {
    const body = toEsSearchBody({ source: "x", sort: [{ field: "total", dir: "asc" }] }, SCHEMA).body;
    expect(body.sort).toEqual([{ total: { order: "asc", missing: "_first" } }]);
    const body2 = toEsSearchBody({ source: "x", sort: [{ field: "total", dir: "desc" }] }, SCHEMA).body;
    expect(body2.sort).toEqual([{ total: { order: "desc", missing: "_last" } }]);
  });
});

describe("aggregated plan", () => {
  it("sources named d0.., date_histogram has calendar_interval/time_zone, no format", () => {
    const query = {
      source: "x",
      aggregate: {
        groupBy: [{ field: "region" }, { field: "createdAt", granularity: "month" }],
        measures: [{ op: "count", as: "n" }],
      },
    } as DataQuery;
    const plan = toEsSearchBody(query, SCHEMA);
    const composite = (plan.body.aggs as AggsShape).g.composite!;
    expect(composite.sources).toEqual([
      { d0: { terms: { field: "region", missing_bucket: true } } },
      {
        d1: {
          date_histogram: { field: "createdAt", calendar_interval: "month", time_zone: "UTC", missing_bucket: true },
        },
      },
    ]);
    const d1 = composite.sources[1] as { d1: { date_histogram: { format?: string } } };
    expect(d1.d1.date_histogram.format).toBeUndefined();
  });

  it("measures named m0.., count produces no sub-agg", () => {
    const query = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "count", as: "n" }] },
    } as DataQuery;
    const plan = toEsSearchBody(query, SCHEMA);
    const aggs = (plan.body.aggs as AggsShape).g.aggs!;
    expect(aggs.m0).toBeUndefined();
    expect(plan.measureAliases).toEqual(["n"]);
  });

  it("first/last produce a filter + top_hits pair sorted by the first date field", () => {
    const query = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "first", field: "total", as: "open" }] },
    } as DataQuery;
    const plan = toEsSearchBody(query, SCHEMA);
    const aggs = (plan.body.aggs as AggsShape).g.aggs!;
    expect(aggs.m0).toEqual({
      filter: { exists: { field: "total" } },
      aggs: { h: { top_hits: { size: 1, sort: [{ createdAt: { order: "asc" } }], _source: ["total"] } } },
    });
  });

  it("countDistinct carries precision_threshold", () => {
    const query = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "countDistinct", field: "customer", as: "u" }] },
    } as DataQuery;
    const plan = toEsSearchBody(query, SCHEMA);
    const aggs = (plan.body.aggs as AggsShape).g.aggs!;
    expect(aggs.m0).toEqual({ cardinality: { field: "customer.keyword", precision_threshold: 40000 } });
  });
});

describe("having", () => {
  it("becomes a bucket_selector whose buckets_path names every referenced measure", () => {
    const query = {
      source: "x",
      aggregate: {
        groupBy: [{ field: "region" }],
        measures: [
          { op: "count", as: "n" },
          { op: "sum", field: "total", as: "revenue" },
        ],
        having: { $and: [{ n: { $gt: 1 } }, { revenue: { $gte: 100 } }] },
      },
    } as DataQuery;
    const plan = toEsSearchBody(query, SCHEMA);
    const aggs = (plan.body.aggs as AggsShape).g.aggs!;
    const h = aggs.h as { bucket_selector: { buckets_path: unknown; script: string } };
    expect(h.bucket_selector.buckets_path).toEqual({ n: "_count", revenue: "m1" });
    expect(h.bucket_selector.script).toContain("params.n > 1");
    expect(h.bucket_selector.script).toContain("params.revenue >= 100");
  });
});

describe("select push-down — task 009 regression", () => {
  it("select produces _source.includes with exactly the selected fields' source paths", () => {
    const body = toEsSearchBody({ source: "x", select: ["customer", "total"] }, SCHEMA).body;
    expect(body._source).toEqual({ includes: ["customer", "total"] });
  });
  it("an aliased field in select contributes its sourcePath, not its alias name", () => {
    const body = toEsSearchBody({ source: "x", select: ["aliasCustomer", "total"] }, SCHEMA).body;
    expect(body._source).toEqual({ includes: ["region", "total"] });
  });
  it("no select produces no _source key at all", () => {
    const body = toEsSearchBody({ source: "x" }, SCHEMA).body;
    expect(body).not.toHaveProperty("_source");
  });
  it("an aggregate plan has no _source and keeps size: 0", () => {
    const query = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "count", as: "n" }] },
    } as DataQuery;
    const body = toEsSearchBody(query, SCHEMA).body as { size: number };
    expect(body).not.toHaveProperty("_source");
    expect(body.size).toBe(0);
  });
});

describe("nextEsCompositeBody", () => {
  it("copies the body and sets aggs.g.composite.after", () => {
    const query = {
      source: "x",
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "count", as: "n" }] },
    } as DataQuery;
    const plan = toEsSearchBody(query, SCHEMA);
    const next = nextEsCompositeBody(plan, { d0: "north" });
    expect((next.aggs as AggsShape).g.composite!.after).toEqual({ d0: "north" });
    // original plan body is untouched
    expect((plan.body.aggs as AggsShape).g.composite!.after).toBeUndefined();
  });

  it("throws for a non-aggregated plan", () => {
    const plan = toEsSearchBody({ source: "x" }, SCHEMA);
    expect(() => nextEsCompositeBody(plan, {})).toThrow(/not an aggregated plan/);
  });
});

describe("top-level sort/select on an aggregate (task 002)", () => {
  // The guard throws before either engine touches the data, so empty rows
  // are enough for the in-memory half.
  const queries: Record<string, DataQuery> = {
    sort: {
      source: "x",
      sort: [{ field: "total", dir: "desc" }],
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "sum", field: "total" }] },
    },
    select: {
      source: "x",
      select: ["region"],
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "sum", field: "total" }] },
    },
    both: {
      source: "x",
      sort: [{ field: "total", dir: "desc" }],
      select: ["region"],
      aggregate: { groupBy: [{ field: "region" }], measures: [{ op: "sum", field: "total" }] },
    },
  };

  function caughtMessage(run: () => unknown): string {
    try {
      run();
    } catch (e) {
      return (e as Error).message;
    }
    return "";
  }

  it.each(["sort", "select", "both"] as const)(
    "aggregate + top-level %s — byte-identical message from both engines",
    (key) => {
      const esMsg = caughtMessage(() => toEsSearchBody(queries[key], SCHEMA));
      expect(esMsg).toContain('Top-level');
      const memMsg = caughtMessage(() => runQuery([], SCHEMA.fields, queries[key]));
      expect(memMsg).not.toBe("");
      // Two guard copies — core's and charting's — because this subpath must
      // reach zero bare specifiers at runtime. Equality of the two thrown
      // strings, not two regexes, is what pins the engines together.
      expect(esMsg).toBe(memMsg);
    },
  );

  it("an aggregated plan with no top-level sort/select is unchanged", () => {
    const plan = toEsSearchBody(
      {
        source: "x",
        aggregate: {
          groupBy: [{ field: "region" }, { field: "createdAt", granularity: "month" }],
          measures: [{ op: "count", as: "n" }],
        },
      },
      SCHEMA,
    );
    expect(plan.aggregated).toBe(true);
    expect(plan.body.size).toBe(0);
    expect((plan.body.aggs as AggsShape).g.composite!.sources).toEqual([
      { d0: { terms: { field: "region", missing_bucket: true } } },
      {
        d1: {
          date_histogram: { field: "createdAt", calendar_interval: "month", time_zone: "UTC", missing_bucket: true },
        },
      },
    ]);
  });
});
