import { describe, it, expect } from "vitest";
import { runShowLiveChart, SHOW_LIVE_CHART_SCHEMA } from "./show-live-chart.js";
import { validateChartSchema } from "../ui-blocks/validate-chart.js";
import type { RenderableBlock } from "@cuatoi/web-agent-core";

/** The shape the tests below read off `out.block` — narrower than the full
 *  `RenderableBlock` union, just the chart plugin's own fields. */
interface TestChartBlock {
  title?: string;
  query?: unknown;
  encoding?: unknown;
  refresh?: unknown;
}
function chartBlock(block: RenderableBlock | undefined): TestChartBlock {
  return block as unknown as TestChartBlock;
}

const VALID_QUERY = {
  source: "products",
  aggregate: {
    groupBy: [{ field: "category" }],
    measures: [{ field: "price", op: "avg", as: "avg_price" }],
  },
};

const VALID_ENCODING = {
  mark: "bar",
  x: { field: "category" },
  y: { field: "avg_price" },
};

describe("SHOW_LIVE_CHART_SCHEMA", () => {
  it("accepts valid query and encoding", async () => {
    expect(await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, { query: VALID_QUERY, encoding: VALID_ENCODING })).toBeNull();
  });

  it("accepts optional title and refresh", async () => {
    const err = await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, {
      title: "Avg price by category",
      query: VALID_QUERY,
      encoding: VALID_ENCODING,
      refresh: { mode: "auto", intervalMs: 30000 },
    });
    expect(err).toBeNull();
  });

  it("rejects unknown top-level keys", async () => {
    const err = await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, {
      query: VALID_QUERY,
      encoding: VALID_ENCODING,
      extra: 123,
    });
    expect(err).not.toBeNull();
  });

  it("rejects missing query", async () => {
    expect(await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, { encoding: VALID_ENCODING })).not.toBeNull();
  });

  it("rejects missing encoding", async () => {
    expect(await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, { query: VALID_QUERY })).not.toBeNull();
  });

  it("rejects invalid encoding channel", async () => {
    const err = await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, {
      query: VALID_QUERY,
      encoding: { mark: "bar", x: { field: "category", bogus: true } },
    });
    expect(err).not.toBeNull();
  });
});

describe("runShowLiveChart", () => {
  it("returns renderable chart block on valid input", async () => {
    const out = await runShowLiveChart({ query: VALID_QUERY, encoding: VALID_ENCODING });
    expect(out.content).toBe("live chart rendered");
    expect(out.isError).toBeFalsy();
    expect(out.block?.type).toBe("chart");
    expect(chartBlock(out.block).query).toEqual(VALID_QUERY);
    expect(chartBlock(out.block).encoding).toEqual(VALID_ENCODING);
  });

  it("propagates optional title and refresh", async () => {
    const out = await runShowLiveChart(
      {
        title: "Avg price by category",
        query: VALID_QUERY,
        encoding: VALID_ENCODING,
        refresh: { mode: "auto", intervalMs: 30000 },
      },
    );
    expect(chartBlock(out.block).title).toBe("Avg price by category");
    expect(chartBlock(out.block).refresh).toEqual({ mode: "auto", intervalMs: 30000 });
  });

  it("omits refresh from block when not provided", async () => {
    const out = await runShowLiveChart({ query: VALID_QUERY, encoding: VALID_ENCODING });
    expect(chartBlock(out.block).refresh).toBeUndefined();
  });

  it("returns isError with field path on missing query", async () => {
    const out = await runShowLiveChart({ encoding: VALID_ENCODING });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/query/);
  });

  it("returns isError with field path on missing encoding mark", async () => {
    const out = await runShowLiveChart({ query: VALID_QUERY, encoding: { x: { field: "category" } } });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/encoding\.mark/);
  });

  it("rejects a malformed query body through validateDataQuery", async () => {
    const out = await runShowLiveChart({ query: { source: 42 }, encoding: VALID_ENCODING });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^query: /);
  });

  it("rejects a filter nested deeper than the bound (depth 4)", async () => {
    const out = await runShowLiveChart({
      query: {
        source: "products",
        filter: { $and: [{ $and: [{ $and: [{ $and: [{ price: { $gt: 1 } }] }] }] }] },
      },
      encoding: VALID_ENCODING,
    });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^query: /);
  });
});

