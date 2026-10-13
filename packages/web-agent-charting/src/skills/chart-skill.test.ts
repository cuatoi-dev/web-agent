import { describe, it, expect } from "vitest";
import { chartSkill } from "./chart-skill.js";
import { SHOW_LIVE_CHART_SCHEMA } from "../tools/show-live-chart.js";
import { validateChartSchema } from "../ui-blocks/validate-chart.js";
import { runQuery } from "@cuatoi/web-agent-core";
import type { FieldSchema } from "@cuatoi/web-agent-core";

describe("chart skill live-vs-snapshot rule", () => {
  it("tells the model to use show_live_chart for data-source data", () => {
    expect(chartSkill.definition).toContain("show_live_chart");
    expect(chartSkill.definition).toMatch(/data source/i);
  });

  it("tells the model to use show_chart for non-data-source data", () => {
    expect(chartSkill.definition).toMatch(/data is not in a data source/i);
    expect(chartSkill.definition).toContain("show_chart");
  });

  it("says why a show_chart config goes stale", () => {
    expect(chartSkill.definition).toMatch(/never refreshes/i);
    expect(chartSkill.definition).toMatch(/snapshot/i);
  });

  it("still covers show_chart itself", () => {
    expect(chartSkill.definition).toContain("show_chart({ title?: string, config: ChartConfig })");
    expect(chartSkill.definition).toContain("## Sanitizer hard limits");
  });

  it("names no host tool other than the two shipped tools", () => {
    expect(chartSkill.definition).not.toContain("show_orders_revenue_chart");
  });
});

describe("chart skill show_live_chart documentation", () => {
  it("documents the show_live_chart signature", () => {
    expect(chartSkill.definition).toMatch(/show_live_chart\(\{/);
    expect(chartSkill.definition).toContain("query: DataQuery");
    expect(chartSkill.definition).toContain("encoding: ChartEncoding");
    expect(chartSkill.definition).toContain("refresh?:");
  });

  it("documents the encoding channel mapping", () => {
    for (const channel of ["mark", "x", "y", "color", "open", "high", "low", "close", "theta", "tooltip"]) {
      expect(chartSkill.definition).toContain(`\`${channel}\``);
    }
  });

  it("documents friendly label propagation and title overrides", () => {
    expect(chartSkill.definition).toMatch(/friendly/i);
    expect(chartSkill.definition).toMatch(/allow-list/i);
    expect(chartSkill.definition).toMatch(/title.*always wins over the field's label/i);
  });

  it("provides worked examples for show_live_chart", () => {
    expect(chartSkill.definition).toContain("Aggregated bar chart");
    expect(chartSkill.definition).toContain("Auto-refreshing line chart");
    expect(chartSkill.definition).toMatch(/\*\*Candlestick\*\*/);
  });
});

describe("chart skill aggregate guidance", () => {
  it("tells the model the no-argument listing has no field names", () => {
    expect(chartSkill.definition).toContain("returns counts only, never field names");
  });

  it("orders the model to discover the schema first", () => {
    expect(chartSkill.definition).toMatch(/get_field_details|list_data_sources/);
    expect(chartSkill.definition).toMatch(/in this turn, before your first[\s\S]{0,100}show_live_chart/i);
  });

  it("documents all four alias forms", () => {
    expect(chartSkill.definition).toContain("<field>_<granularity>");
    expect(chartSkill.definition).toContain("<op>_<field>");
    expect(chartSkill.definition).toContain("created_at_month");
    expect(chartSkill.definition).toContain("sum_total");
  });

  it("says a top-level sort is rejected, not dropped", () => {
    // The old wording claimed the drop was silent — that is no longer true.
    expect(chartSkill.definition).not.toMatch(/no error and no warning/i);
    expect(chartSkill.definition).toMatch(/top-level .*query\.sort.* is rejected/i);
    expect(chartSkill.definition).toMatch(/query\.select.*rejected/i);
    // The fix: move the sort inside aggregate, naming a result column.
    expect(chartSkill.definition).toMatch(/move the sort\s+inside `aggregate` and name one of those columns/);
  });

  it("says to sort on the alias, not the source field", () => {
    expect(chartSkill.definition).toMatch(/sort on the source field instead of the alias/i);
    expect(chartSkill.definition).toMatch(/result columns are the aliases/i);
    expect(chartSkill.definition).toMatch(/NOT the[\s\S]*?source fields/i);
  });

  it("says to use an ascending sort for date buckets", () => {
    expect(chartSkill.definition).toMatch(/ascending sort on the bucket\s+alias/i);
  });
});

describe("chart skill live-chart example validation", () => {
  function extractJsonExamples(): unknown[] {
    const showLiveStart = chartSkill.definition.indexOf("## show_live_chart");
    const showChartStart = chartSkill.definition.indexOf("## show_chart");
    const section = chartSkill.definition.slice(showLiveStart, showChartStart);
    const examples: unknown[] = [];
    const regex = /```json\n([\s\S]*?)```/g;
    let m;
    while ((m = regex.exec(section)) !== null) {
      try {
        examples.push(JSON.parse(m[1]));
      } catch {
        // skip non-JSON blocks
      }
    }
    return examples;
  }

  function buildSchema(example: Record<string, unknown>): FieldSchema[] {
    const query = example.query as Record<string, unknown>;
    const agg = query?.aggregate as Record<string, unknown> | undefined;
    if (!agg) return [];
    const schema: FieldSchema[] = [];
    const seen = new Set<string>();

    const groupBy = (agg.groupBy ?? []) as Array<Record<string, unknown>>;
    for (const g of groupBy) {
      const field = g.field as string;
      if (!seen.has(field)) {
        schema.push({ name: field, type: g.granularity ? "date" : "string" });
        seen.add(field);
      }
    }

    const measures = (agg.measures ?? []) as Array<Record<string, unknown>>;
    for (const m of measures) {
      const field = m.field as string | undefined;
      if (field && !seen.has(field)) {
        schema.push({ name: field, type: "number" });
        seen.add(field);
      }
    }

    const filter = query?.filter as Record<string, unknown> | undefined;
    if (filter?.field && !seen.has(filter.field as string)) {
      schema.push({ name: filter.field as string, type: "string" });
      seen.add(filter.field as string);
    }

    return schema;
  }

  it("finds at least two live-chart JSON examples", () => {
    const examples = extractJsonExamples();
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });

  it("every live-chart example is valid through SHOW_LIVE_CHART_SCHEMA", async () => {
    const examples = extractJsonExamples();
    for (const ex of examples) {
      const err = await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, ex);
      expect(err).toBeNull();
    }
  });

  it("no aggregating example puts sort at the query top level", () => {
    const examples = extractJsonExamples() as Array<Record<string, unknown>>;
    for (const ex of examples) {
      const query = ex.query as Record<string, unknown> | undefined;
      if (query?.aggregate) {
        expect(query.sort).toBeUndefined();
      }
    }
  });

  it("every aggregating example with a time bucket carries a non-empty aggregate.sort", () => {
    const examples = extractJsonExamples() as Array<Record<string, unknown>>;
    for (const ex of examples) {
      const query = ex.query as Record<string, unknown> | undefined;
      if (!query?.aggregate) continue;
      const agg = query.aggregate as Record<string, unknown>;
      const groupBy = (agg.groupBy ?? []) as Array<Record<string, unknown>>;
      const hasTimeBucket = groupBy.some((g) => g.granularity);
      if (hasTimeBucket) {
        expect(Array.isArray(agg.sort)).toBe(true);
        expect((agg.sort as unknown[]).length).toBeGreaterThan(0);
      }
    }
  });

  it("every live-chart example runs through the real query engine without error", () => {
    const examples = extractJsonExamples() as Array<Record<string, unknown>>;
    for (const ex of examples) {
      const schema = buildSchema(ex);
      if (schema.length === 0) continue;
      const query = ex.query as Record<string, unknown>;
      expect(() => runQuery([], schema, query as never)).not.toThrow();
    }
  });

  it("every encoding field is a result column from the engine", () => {
    const examples = extractJsonExamples() as Array<Record<string, unknown>>;
    for (const ex of examples) {
      const schema = buildSchema(ex);
      if (schema.length === 0) continue;
      const query = ex.query as Record<string, unknown>;
      const result = runQuery([], schema, query as never);
      const resultFields = new Set(result.fields.map((f) => f.name));
      const encoding = ex.encoding as Record<string, unknown> | undefined;
      if (!encoding) continue;
      for (const key of ["x", "y", "color", "theta", "tooltip"]) {
        const channel = encoding[key];
        if (channel && typeof channel === "object" && "field" in (channel as Record<string, unknown>)) {
          const field = (channel as Record<string, unknown>).field as string;
          expect(resultFields.has(field)).toBe(true);
        }
      }
    }
  });
});
