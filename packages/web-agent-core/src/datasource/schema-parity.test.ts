/**
 * Schema parity test: the migrated DataQuerySchema accepts and rejects
 * exactly the same queries as the pre-migration schema that buildTools()
 * emitted at commit 54a650a2.
 *
 * The fixture was captured from the live buildTools() output before
 * types.ts was changed, so the comparison is real — not a stored list
 * of expected booleans. This test fails when the migration changes the
 * accepted query language, which is exactly what it is for.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { DataQuerySchema } from "./types.js";
import Ajv2020 from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const preMigrationSchema = require("./pre-migration-schema.fixture.json") as object;

const Ctor = (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020;
const ajv = new (Ctor as unknown as new (opts: object) => {
  compile: (schema: object) => (data: unknown) => boolean;
})({ strict: false });

const baseline = ajv.compile(preMigrationSchema);
const candidate = ajv.compile(DataQuerySchema);

/** The 20 queries from the test plan. */
const QUERIES: { label: string; query: unknown }[] = [
  // 1 — golden query
  {
    label: "golden query",
    query: { source: "orders", select: ["id", "total"], filter: { status: "placed" }, search: "foo", sort: [{ field: "total", dir: "desc" }], page: { limit: 10, offset: 0 } },
  },
  // 2a — $and depth 1
  { label: "$and depth 1", query: { source: "t", filter: { $and: [{ total: { $gt: 1 } }] } } },
  // 2b — $and depth 2
  { label: "$and depth 2", query: { source: "t", filter: { $and: [{ $and: [{ total: { $gt: 1 } }] }] } } },
  // 2c — $and depth 3
  { label: "$and depth 3", query: { source: "t", filter: { $and: [{ $and: [{ $and: [{ total: { $gt: 1 } }] }] }] } } },
  // 3a — $and depth 4 (rejected)
  { label: "$and depth 4 (rejected)", query: { source: "t", filter: { $and: [{ $and: [{ $and: [{ $and: [{ total: { $gt: 1 } }] }] }] }] } } },
  // 3b — $and depth 5 (rejected)
  { label: "$and depth 5 (rejected)", query: { source: "t", filter: { $and: [{ $and: [{ $and: [{ $and: [{ $and: [{ total: { $gt: 1 } }] }] }] }] }] } } },
  // 4 — aggregate.having depth 3
  { label: "having depth 3", query: { source: "t", aggregate: { groupBy: [{ field: "x" }], measures: [{ op: "count" }], having: { $and: [{ $and: [{ $and: [{ total: { $gt: 1 } }] }] }] } } } },
  // 5 — aggregate.having depth 4 (rejected)
  { label: "having depth 4 (rejected)", query: { source: "t", aggregate: { groupBy: [{ field: "x" }], measures: [{ op: "count" }], having: { $and: [{ $and: [{ $and: [{ $and: [{ total: { $gt: 1 } }] }] }] }] } } } },
  // 6 — $or and $not mixed
  { label: "$or and $not mixed", query: { source: "t", filter: { $or: [{ $not: { status: "placed" } }, { total: { $gt: 50 } }] } } },
  // 7 — $between 2 elements (ok)
  { label: "$between 2 elements", query: { source: "t", filter: { total: { $between: [10, 100] } } } },
  // 8 — $between 3 elements (rejected)
  { label: "$between 3 elements (rejected)", query: { source: "t", filter: { total: { $between: [10, 50, 100] } } } },
  // 9 — unknown operator
  { label: "unknown operator $nope", query: { source: "t", filter: { t: { $nope: 1 } } } },
  // 10 — missing source
  { label: "missing source", query: { select: ["id"] } },
  // 11 — unknown top-level key
  { label: "unknown top-level key", query: { source: "t", nope: true } },
  // 12 — search: 42
  { label: "search: 42", query: { source: "t", search: 42 } },
  // 13 — bad sort dir
  { label: "bad sort dir", query: { source: "t", sort: [{ field: "a", dir: "sideways" }] } },
  // 14 — bad measure op
  { label: "bad measure op", query: { source: "t", aggregate: { groupBy: [{ field: "x" }], measures: [{ op: "median" }] } } },
  // 15 — missing measures
  { label: "aggregate missing measures", query: { source: "t", aggregate: { groupBy: [{ field: "x" }] } } },
  // 16 — groupBy with granularity, measure with as
  { label: "granularity + measure.as", query: { source: "t", aggregate: { groupBy: [{ field: "createdAt", granularity: "week" }], measures: [{ op: "sum", field: "total", as: "revenue" }] } } },
  // 20 — no $ref starting with #/properties
  { label: "no #/properties refs (meta)", query: { source: "t" } },
];

describe("schema-parity", () => {
  for (const { label, query } of QUERIES) {
    if (label === "no #/properties refs (meta)") continue; // handled separately

    it(`agrees on: ${label}`, () => {
      const baseResult = baseline(query);
      const candidateResult = candidate(query);
      expect(candidateResult, `candidate disagrees with baseline for "${label}" (baseline: ${baseResult}, candidate: ${candidateResult})`).toBe(baseResult);
    });
  }

  it("DataQuerySchema contains no #/properties refs", () => {
    const schema = JSON.stringify(DataQuerySchema);
    expect(schema).not.toContain("#/properties");
    expect(schema).toContain("#/$defs/");
  });
});
