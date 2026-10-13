import { describe, it, expect } from "vitest";
import { validateDataQuery } from "@cuatoi/web-agent-core";
import { SHOW_LIVE_CHART_SCHEMA, validateChartSchema } from "@cuatoi/web-agent-charting";
import { dataAnalysisDemoSkill } from "./data-analysis-skill";

const def = dataAnalysisDemoSkill.definition;

/** One `groupBy`/`measures` entry inside an `aggregate` block — enough to
 *  compute the alias `aliasesOf` derives (see chart-skill.ts:57-62). */
interface AggDim {
  as?: string;
  field?: string;
  granularity?: string;
  op?: string;
}
interface AggregateSpec {
  groupBy?: AggDim[];
  measures?: AggDim[];
  sort?: { field: string }[];
}
/** The shape a fenced example's `query` (or a bare non-chart block) can take. */
interface QueryLike {
  source?: string;
  aggregate?: AggregateSpec;
  sort?: unknown;
}
/** A fenced example that is a show_live_chart argument object. */
interface ChartArgsLike {
  query?: QueryLike;
  encoding?: {
    x?: { field: string };
    y?: { field: string };
    color?: { field: string };
    tooltip?: string[];
  };
}

/** Every fenced ```json block in the skill text, parsed. */
function jsonBlocks(): unknown[] {
  const out: unknown[] = [];
  const re = /```json\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(def)) !== null) {
    out.push(JSON.parse(m[1]));
  }
  return out;
}

/** True when the object is a show_live_chart argument object. */
function isChartArgs(v: unknown): v is ChartArgsLike {
  return !!v && typeof v === "object" && "encoding" in v;
}

/** Every key name that appears anywhere in the object tree. */
function allKeys(v: unknown, acc: string[] = []): string[] {
  if (Array.isArray(v)) { v.forEach((x) => allKeys(x, acc)); return acc; }
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) { acc.push(k); allKeys(val, acc); }
  }
  return acc;
}

/** The result-column names an aggregate query produces (see chart-skill.ts:57-62). */
function aliasesOf(query: QueryLike | undefined): string[] {
  const agg = query?.aggregate;
  if (!agg) return [];
  const dims = (agg.groupBy ?? []).map((d) =>
    d.as ?? (d.granularity ? `${d.field}_${d.granularity}` : d.field));
  const meas = (agg.measures ?? []).map((m) =>
    m.as ?? (m.op === "count" && !m.field ? "count" : `${m.op}_${m.field}`));
  return [...dims, ...meas] as string[];
}

describe("dataAnalysisDemoSkill", () => {
  it("is named data-analysis and does not document an /analysis command trigger", () => {
    expect(dataAnalysisDemoSkill.description).not.toContain("/analysis");
    expect(dataAnalysisDemoSkill.command).toBeUndefined();
  });

  it("every fenced JSON block in the skill text is parseable JSON", () => {
    expect(() => jsonBlocks()).not.toThrow();
  });

  it("every chart argument object validates against SHOW_LIVE_CHART_SCHEMA", async () => {
    const charts = jsonBlocks().filter(isChartArgs);
    expect(charts.length).toBeGreaterThan(0);
    for (const c of charts) {
      const err = await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, c);
      expect(err).toBeNull();
    }
  });

  it("every non-chart query block validates against DataQuerySchema", async () => {
    const queries = jsonBlocks().filter((b) => !isChartArgs(b));
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      const r = await validateDataQuery(q);
      expect(r.ok, r.ok ? "" : r.message).toBe(true);
    }
  });

  it("no chart step carries a literal data or labels array", () => {
    for (const c of jsonBlocks().filter(isChartArgs)) {
      const keys = allKeys(c);
      expect(keys).not.toContain("data");
      expect(keys).not.toContain("labels");
      expect(keys).not.toContain("datasets");
    }
  });

  it("the skill never mentions show_chart", () => {
    expect(def).not.toContain("show_chart");
    expect(def).toContain("show_live_chart");
  });

  // The failure this catches is a real one: an encoding that names a source
  // field instead of the aggregate's alias is rejected with HTTP 400 and no
  // chart renders (chart-skill.ts:64-73).
  it("every encoding channel names a result column of its own query", () => {
    for (const c of jsonBlocks().filter(isChartArgs)) {
      const aliases = aliasesOf(c.query);
      expect(aliases.length).toBeGreaterThan(0);
      for (const ch of ["x", "y", "color"] as const) {
        if (c.encoding?.[ch]) expect(aliases).toContain(c.encoding[ch].field);
      }
      for (const t of c.encoding?.tooltip ?? []) expect(aliases).toContain(t);
    }
  });

  // Same rule for the sort: it must sit inside `aggregate` and name an alias.
  it("every aggregate sort sits inside aggregate and names a result column", () => {
    for (const b of jsonBlocks()) {
      const query = isChartArgs(b) ? b.query : (b as QueryLike);
      if (!query?.aggregate) continue;
      expect(query.sort).toBeUndefined();
      const aliases = aliasesOf(query);
      for (const s of query.aggregate.sort ?? []) expect(aliases).toContain(s.field);
    }
  });

  it("every query reads a source the Cat Store registers", () => {
    for (const b of jsonBlocks()) {
      const query = isChartArgs(b) ? b.query : (b as QueryLike);
      expect(["es-orders", "products"]).toContain(query?.source);
    }
  });

  it("discovery comes before the first query", () => {
    expect(def.indexOf('list_data_sources({ source: "es-orders" })'))
      .toBeLessThan(def.indexOf("show_live_chart"));
    expect(def.indexOf('load_skill("chart")')).toBeLessThan(def.indexOf("show_live_chart"));
  });

  it("keeps the do-not-stop-early and no-invented-numbers guards", () => {
    expect(def).toContain("CRITICAL — do not stop early");
    expect(def).toContain("Steps 1-7 run back-to-back in ONE turn");
    expect(def).toContain("never state a number");
  });

  it("bases restock on the queried stock status instead of declaring stock unavailable", () => {
    expect(def).not.toContain("does not expose a stock level");
    expect(def).toContain('"inStock"');
    expect(def).toContain("stock status exactly as the query returned it");
  });

  it("tells the agent not to invent a category match across the two sources", () => {
    expect(def).toContain("do not invent a match");
  });

  // Same reason as demo-skill.test.ts:114 — the model imitates bold markers it
  // sees in the script and leaks them into its narration.
  it("the script text contains no bold-asterisk markers", () => {
    expect(def).not.toContain("**");
  });
});
