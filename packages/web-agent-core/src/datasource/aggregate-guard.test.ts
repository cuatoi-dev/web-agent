import { describe, it, expect } from "vitest";
import { assertNoTopLevelSortOrSelect } from "./aggregate-guard.js";
import type { DataQuery } from "./types.js";

const RESULT_COLUMNS_SENTENCE = "This query's result columns are:";

function aggQuery(overrides: Partial<DataQuery>): DataQuery {
  return {
    source: "orders",
    aggregate: {
      groupBy: [{ field: "region" }],
      measures: [{ op: "sum", field: "total" }],
    },
    ...overrides,
  };
}

function thrownMessage(q: DataQuery): string {
  try {
    assertNoTopLevelSortOrSelect(q);
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}

describe("assertNoTopLevelSortOrSelect", () => {
  it("a row query is untouched — no aggregate, no throw", () => {
    expect(() =>
      assertNoTopLevelSortOrSelect({
        source: "orders",
        select: ["total"],
        sort: [{ field: "total", dir: "desc" }],
      }),
    ).not.toThrow();
  });

  it("an aggregate with neither sort nor select does not throw", () => {
    expect(() => assertNoTopLevelSortOrSelect(aggQuery({}))).not.toThrow();
  });

  it("empty sort and empty select are treated as absent", () => {
    expect(() => assertNoTopLevelSortOrSelect(aggQuery({ sort: [], select: [] }))).not.toThrow();
    expect(() => assertNoTopLevelSortOrSelect(aggQuery({ sort: [] }))).not.toThrow();
    expect(() => assertNoTopLevelSortOrSelect(aggQuery({ select: [] }))).not.toThrow();
  });

  it("the sort message names every sorted field", () => {
    const msg = thrownMessage(
      aggQuery({
        sort: [
          { field: "total", dir: "desc" },
          { field: "shipped_at", dir: "asc" },
        ],
      }),
    );
    expect(msg).toContain('Top-level "sort" does not apply to an aggregate query');
    expect(msg).toContain('"total"');
    expect(msg).toContain('"shipped_at"');
  });

  it("the select message names every selected field and points at as", () => {
    const msg = thrownMessage(aggQuery({ select: ["region", "sum_total"] }));
    expect(msg).toContain('Top-level "select" does not apply to an aggregate query');
    expect(msg).toContain('"region"');
    expect(msg).toContain('"sum_total"');
    expect(msg).toContain('"as"');
  });

  it("both together produce one message with the sort part first", () => {
    const msg = thrownMessage(
      aggQuery({
        sort: [{ field: "total", dir: "desc" }],
        select: ["region"],
      }),
    );
    const sortPos = msg.indexOf('Top-level "sort" does not apply');
    const selectPos = msg.indexOf('Top-level "select" does not apply');
    expect(sortPos).toBeGreaterThanOrEqual(0);
    expect(selectPos).toBeGreaterThan(sortPos);
    expect(msg.split(RESULT_COLUMNS_SENTENCE).length).toBe(2);
  });

  it("result columns follow the alias rule", () => {
    const cases: { agg: DataQuery["aggregate"]; expected: string }[] = [
      {
        // dimension with granularity and no as -> createdAt_month
        agg: {
          groupBy: [{ field: "createdAt", granularity: "month" }],
          measures: [{ op: "count" }],
        },
        expected: "This query's result columns are: createdAt_month, count.",
      },
      {
        // dimension with no granularity and no as -> createdAt; measure with a field -> sum_total
        agg: {
          groupBy: [{ field: "createdAt" }],
          measures: [{ op: "sum", field: "total" }],
        },
        expected: "This query's result columns are: createdAt, sum_total.",
      },
      {
        // bare count -> count
        agg: { groupBy: [{ field: "region" }], measures: [{ op: "count" }] },
        expected: "This query's result columns are: region, count.",
      },
      {
        // as wins on both dimension and measure
        agg: {
          groupBy: [{ field: "createdAt", granularity: "month", as: "month_bucket" }],
          measures: [{ op: "avg", field: "price", as: "avg_price" }],
        },
        expected: "This query's result columns are: month_bucket, avg_price.",
      },
    ];
    for (const { agg, expected } of cases) {
      const msg = thrownMessage({ source: "o", aggregate: agg, sort: [{ field: "x" }] });
      expect(msg).toContain(expected);
    }
  });

  it("the sort example names a real result column of this query", () => {
    const msg = thrownMessage({
      source: "orders",
      aggregate: {
        groupBy: [{ field: "region", as: "area" }],
        measures: [{ op: "sum", field: "total", as: "revenue" }, { op: "count" }],
      },
      sort: [{ field: "revenue", dir: "desc" }],
    });
    const match = msg.match(/"aggregate": \{ "sort": \[\{ "field": "([^"]+)"/);
    expect(match).not.toBeNull();
    const suggested = match![1];
    const columnsLine = msg.split("This query's result columns are: ")[1];
    const columns = columnsLine.slice(0, columnsLine.indexOf(".")).split(", ");
    expect(columns).toContain(suggested);
    expect(columns).toEqual(["area", "revenue", "count"]);
  });
});
