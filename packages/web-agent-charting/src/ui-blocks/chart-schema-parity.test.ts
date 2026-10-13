/**
 * Parity between the hand-written JSON Schema (candidate) and the
 * pre-migration zod schema (baseline), following task 006's form
 * (web-agent-core/src/ui-blocks/schema-parity.test.ts). The baseline is
 * embedded inline as it stood before this task — not a frozen copy of the
 * emitted candidate schema — so a change on either side surfaces here.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildTools } from "@cuatoi/web-agent-core";
import type { ToolContext, CustomToolDef } from "@cuatoi/web-agent-core";
import { validateChartBlock } from "./validate-chart.js";
import { SHOW_CHART_SCHEMA } from "../tools/show-chart.js";
import { SHOW_LIVE_CHART_SCHEMA } from "../tools/show-live-chart.js";

// ── Pre-migration baseline (zod), as chart-schema.ts stood before this task ──

function baselineUnwrapXmlText(val: unknown): unknown {
  if (typeof val === "object" && val !== null) {
    if (Array.isArray(val)) return val.map(baselineUnwrapXmlText);
    const keys = Object.keys(val);
    if (keys.length === 1 && (keys[0] === "$text" || keys[0] === "$" || keys[0] === "_")) {
      return baselineUnwrapXmlText((val as Record<string, unknown>)[keys[0]]);
    }
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = baselineUnwrapXmlText((val as Record<string, unknown>)[key]);
    return out;
  }
  return val;
}

function baselineCoerceDataPoint(val: unknown): unknown {
  val = baselineUnwrapXmlText(val);
  if (typeof val === "string") {
    const cleaned = val.trim().replace(/^\$/, "");
    const num = Number(cleaned);
    if (cleaned !== "" && Number.isFinite(num)) return num;
  }
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    const obj = { ...(val as Record<string, unknown>) };
    for (const key of ["y", "r", "o", "h", "l", "c"]) {
      if (typeof obj[key] === "string") {
        const cleaned = (obj[key]).trim().replace(/^\$/, "");
        const num = Number(cleaned);
        if (cleaned !== "" && Number.isFinite(num)) obj[key] = num;
      }
    }
    return obj;
  }
  return val;
}

function baselineCoerceOptions(val: unknown): unknown {
  if (typeof val === "object" && val !== null) {
    if (Array.isArray(val)) return val.map(baselineCoerceOptions);
    const keys = Object.keys(val);
    if (keys.length === 1 && (keys[0] === "$text" || keys[0] === "$" || keys[0] === "_")) {
      return baselineCoerceOptions((val as Record<string, unknown>)[keys[0]]);
    }
    const rec = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if ((key === "xAxes" || key === "yAxes") && typeof rec[key] === "object" && rec[key] !== null && !Array.isArray(rec[key])) {
        const inner = rec[key] as Record<string, unknown>;
        const innerKeys = Object.keys(inner);
        if (innerKeys.length === 1 && (innerKeys[0] === "item" || innerKeys[0] === "$text")) {
          const itemVal = inner[innerKeys[0]];
          out[key] = baselineCoerceOptions(Array.isArray(itemVal) ? itemVal : [itemVal]);
          continue;
        }
      }
      out[key] = baselineCoerceOptions((val as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    const num = Number(trimmed);
    if (trimmed !== "" && Number.isFinite(num)) return num;
  }
  return val;
}

const BaselineChartTypeSchema = z.enum([
  "line", "bar", "horizontalBar", "radar", "doughnut", "pie",
  "polarArea", "bubble", "scatter", "candlestick", "ohlc", "payoff",
  "equity", "drawdown", "waterfall",
]);

const BaselineChartDatasetSchema = z.object({
  data: z.array(
    z.preprocess(
      baselineCoerceDataPoint,
      z.union([
        z.number(),
        z.string(),
        z.null(),
        z.object({ x: z.union([z.number(), z.string()]), y: z.union([z.number(), z.string()]), r: z.number().optional() }).passthrough(),
        z.object({
          x: z.union([z.number(), z.string()]),
          o: z.number(), h: z.number(), l: z.number(), c: z.number(),
        }).passthrough(),
      ])
    )
  ),
  label: z.string().optional(),
  backgroundColor: z.union([z.string(), z.array(z.string())]).optional(),
  borderColor: z.union([z.string(), z.array(z.string())]).optional(),
  borderWidth: z.number().optional(),
  fill: z.boolean().optional(),
  type: z.string().optional(),
}).passthrough();

const BaselineChartDataSchema = z.object({
  labels: z.array(z.preprocess(baselineUnwrapXmlText, z.union([z.string(), z.number()]))).optional(),
  datasets: z.array(BaselineChartDatasetSchema).max(50),
}).passthrough();

const BaselineChartConfigSchema = z.preprocess(
  baselineUnwrapXmlText,
  z.object({
    type: BaselineChartTypeSchema,
    data: BaselineChartDataSchema,
    options: z.preprocess(baselineCoerceOptions, z.record(z.any())).optional(),
  }).passthrough()
);

const BaselineChartRefreshModeSchema = z.enum(["auto", "manual", "off"]);

const BaselineChartRefreshSchema = z.object({
  mode: BaselineChartRefreshModeSchema,
  intervalMs: z.number().int().positive().optional(),
});

const BaselineEncodingChannelSchema = z.object({
  field: z.string(),
  type: z.enum(["nominal", "ordinal", "quantitative", "temporal"]).optional(),
  title: z.string().optional(),
}).strict();

const BaselineEncodingSimpleChannelSchema = z.object({
  field: z.string(),
  title: z.string().optional(),
}).strict();

const BaselineChartEncodingSchema = z.object({
  mark: z.string().describe("bar/line/area/arc/pie/scatter/candlestick/ohlc"),
  x: BaselineEncodingChannelSchema.optional().describe("X-axis"),
  y: BaselineEncodingChannelSchema.optional().describe("Y-axis"),
  color: BaselineEncodingSimpleChannelSchema.optional().describe("multi-series grouping"),
  open: BaselineEncodingSimpleChannelSchema.optional().describe("candlestick/ohlc open"),
  high: BaselineEncodingSimpleChannelSchema.optional().describe("candlestick/ohlc high"),
  low: BaselineEncodingSimpleChannelSchema.optional().describe("candlestick/ohlc low"),
  close: BaselineEncodingSimpleChannelSchema.optional().describe("candlestick/ohlc close"),
  theta: BaselineEncodingSimpleChannelSchema.optional().describe("arc/pie slice value"),
  tooltip: z.union([z.array(z.string()), z.boolean()]).optional().describe("tooltip fields, or false to hide"),
  title: z.string().optional().describe("series title (candlestick/ohlc)"),
}).strict();

const BaselineChartBlockBase = z.object({
  type: z.literal("chart"),
  title: z.string().optional(),
  spec: z.record(z.any()).optional(),
  config: BaselineChartConfigSchema.optional(),
  query: z.record(z.any()).optional(),
  encoding: BaselineChartEncodingSchema.optional(),
  refresh: BaselineChartRefreshSchema.optional(),
});

const BaselineChartBlockSchema = BaselineChartBlockBase.refine(
  (val) => {
    const hasSpec = "spec" in val && val.spec !== undefined;
    const hasConfig = "config" in val && val.config !== undefined;
    const hasQuery = "query" in val && val.query !== undefined;
    return hasSpec || hasConfig || hasQuery;
  },
  {
    message:
      "ChartBlock must have one of: 'spec' (deprecated), 'config' (Chart.js), or 'query' (datasource).",
  }
);

const BaselineShowChartSchema = z
  .object({
    title: z.string().optional().describe("Optional chart title"),
    config: BaselineChartConfigSchema.describe(
      'Chart.js 2.x config object. Call load_skill("chart") for shape, types, and examples.',
    ),
  })
  .strict();

// ── Corpus — every raw input from chart-schema.test.ts, plus D1/D2 additions ──

interface Case {
  label: string;
  value: unknown;
  validBlock: boolean;
}

const CORPUS: Case[] = [
  // Block-level cases (chart-schema.test.ts "ChartBlockSchema" describe)
  { label: "legacy spec-only chart", value: { type: "chart", spec: { mark: "bar", data: { values: [] } } }, validBlock: true },
  {
    label: "query+encoding chart",
    value: {
      type: "chart",
      title: "Revenue by Month",
      query: { source: "orders", aggregate: { groupBy: [{ field: "month" }], measures: [{ op: "count" }] } },
      encoding: { mark: "bar", x: { field: "month", type: "nominal" }, y: { field: "count", type: "quantitative" } },
    },
    validBlock: true,
  },
  { label: "neither spec, config, nor query", value: { type: "chart", title: "Empty" }, validBlock: false },
  {
    label: "both spec and (query+encoding)",
    value: {
      type: "chart",
      spec: { mark: "bar" },
      query: { source: "orders" },
      encoding: { mark: "line", x: { field: "d", type: "temporal" }, y: { field: "v", type: "quantitative" } },
    },
    validBlock: true,
  },
  {
    label: "arc encoding with theta and color",
    value: {
      type: "chart",
      query: { source: "orders" },
      encoding: { mark: "arc", theta: { field: "count" }, color: { field: "category" } },
    },
    validBlock: true,
  },
  {
    label: "Chart.js config-only chart",
    value: { type: "chart", config: { type: "bar", data: { labels: ["A", "B"], datasets: [{ data: [1, 2] }] } } },
    validBlock: true,
  },
  {
    label: "scatter config with point-object data",
    value: { type: "chart", config: { type: "scatter", data: { datasets: [{ data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }] } } },
    validBlock: true,
  },
  {
    label: "bubble config with point-object data including r",
    value: { type: "chart", config: { type: "bubble", data: { datasets: [{ data: [{ x: 1, y: 2, r: 5 }, { x: 3, y: 4, r: 8 }] }] } } },
    validBlock: true,
  },
  {
    label: "candlestick config with OHLC data points",
    value: { type: "chart", config: { type: "candlestick", data: { datasets: [{ data: [{ x: "2026-01-05", o: 100, h: 104, l: 99, c: 103 }] }] } } },
    validBlock: true,
  },
  {
    label: "ohlc type",
    value: { type: "chart", config: { type: "ohlc", data: { datasets: [{ data: [{ x: "2026-01-05", o: 100, h: 104, l: 99, c: 103 }] }] } } },
    validBlock: true,
  },
  {
    label: "options.annotation passthrough",
    value: { type: "chart", config: { type: "bar", data: { labels: ["A"], datasets: [{ data: [1] }] }, options: { annotation: { lines: [{ axis: "y", value: 5 }] } } } },
    validBlock: true,
  },
  {
    label: "payoff config with options.payoff.legs",
    value: { type: "chart", config: { type: "payoff", data: { datasets: [] }, options: { payoff: { legs: [{ kind: "call", strike: 100, premium: 5, side: "long" }] } } } },
    validBlock: true,
  },
  {
    label: "equity config with options.pnl.returns",
    value: { type: "chart", config: { type: "equity", data: { datasets: [] }, options: { pnl: { returns: [200, -150, -180, 120, 260, -90, 300] } } } },
    validBlock: true,
  },
  {
    label: "drawdown config with options.pnl.equity",
    value: { type: "chart", config: { type: "drawdown", data: { datasets: [] }, options: { pnl: { equity: [10000, 10250, 10120, 9800], percent: true } } } },
    validBlock: true,
  },
  {
    label: "waterfall config with options.waterfall.steps",
    value: {
      type: "chart",
      config: {
        type: "waterfall",
        data: { datasets: [] },
        options: { waterfall: { steps: [{ label: "Open", value: 1000 }, { label: "Fees", value: -120 }] } },
      },
    },
    validBlock: true,
  },
  {
    label: "dual-axis volume config (bar+line, two yAxes)",
    value: {
      type: "chart",
      config: {
        type: "bar",
        data: {
          labels: ["Mon", "Tue"],
          datasets: [
            { type: "line", label: "Price", yAxisID: "price", data: [101, 103] },
            { type: "bar", label: "Volume", yAxisID: "volume", data: [1200, 1800] },
          ],
        },
        options: { scales: { yAxes: [{ id: "price", position: "left" }, { id: "volume", position: "right" }] } },
      },
    },
    validBlock: true,
  },
  {
    label: "area mark query+encoding chart",
    value: {
      type: "chart",
      query: { source: "orders" },
      encoding: { mark: "area", x: { field: "d", type: "temporal" }, y: { field: "v", type: "quantitative" } },
    },
    validBlock: true,
  },
  {
    label: "query+encoding chart without deprecation warnings",
    value: {
      type: "chart",
      query: { source: "products" },
      encoding: { mark: "bar", x: { field: "category" }, y: { field: "price", title: "Shelf price" } },
    },
    validBlock: true,
  },

  // Encoding-validity cases, wrapped into a block via `query` (chart-schema.test.ts "ChartEncodingSchema")
  {
    label: "encoding: unknown top-level channel",
    value: { type: "chart", query: { source: "orders" }, encoding: { mark: "bar", x: { field: "category" }, bogus: { field: "nope" } } },
    validBlock: false,
  },
  {
    label: "encoding: channel with unknown key",
    value: { type: "chart", query: { source: "orders" }, encoding: { mark: "bar", x: { field: "category", bogus: true } } },
    validBlock: false,
  },

  // Preprocess / wrapped-scalar cases (chart-schema.test.ts "wrapped scalar and label unwrapping")
  {
    label: "$text wrapped data scalars",
    value: { type: "chart", config: { type: "bar", data: { labels: ["Q1", "Q2"], datasets: [{ data: [{ $text: "45" }, { $text: "60" }] }] } } },
    validBlock: true,
  },
  {
    label: "$text wrapped decimal scalars",
    value: { type: "chart", config: { type: "bar", data: { labels: ["Salmon Pâté", "Tuna Crunch"], datasets: [{ data: [{ $text: "3.99" }, { $text: "12.50" }] }] } } },
    validBlock: true,
  },
  {
    label: "string dataset label and category labels preserved",
    value: { type: "chart", config: { type: "bar", data: { labels: ["2024", "2025"], datasets: [{ label: "2024", data: [100, 200] }] } } },
    validBlock: true,
  },
  {
    label: "plain numeric arrays unchanged",
    value: { type: "chart", config: { type: "line", data: { datasets: [{ data: [45, 60] }] } } },
    validBlock: true,
  },
  {
    label: "point and OHLC objects unchanged",
    value: {
      type: "chart",
      config: {
        type: "scatter",
        data: { datasets: [{ data: [{ x: 10, y: 20 }] }, { data: [{ x: "2026-01-01", o: 10, h: 15, l: 8, c: 12 }] }] },
      },
    },
    validBlock: true,
  },
  {
    label: "null data points for gaps",
    value: { type: "chart", config: { type: "line", data: { datasets: [{ data: [10, null, 30] }] } } },
    validBlock: true,
  },
  {
    label: "non-numeric strings preserved as category strings",
    value: { type: "chart", config: { type: "bar", data: { datasets: [{ data: ["categoryA", "categoryB"] }] } } },
    validBlock: true,
  },
  {
    label: "$text wrapped labels",
    value: { type: "chart", config: { type: "bar", data: { labels: [{ $text: "Mon" }, { $text: "Tue" }], datasets: [{ data: [100, 200] }] } } },
    validBlock: true,
  },

  // D1 — additional wrapped-scalar forms
  {
    label: "D1: nested wrapped point value ({x, y: {$text}})",
    value: { type: "chart", config: { type: "scatter", data: { datasets: [{ data: [{ x: "Q1", y: { $text: "45" } }] }] } } },
    validBlock: true,
  },
  {
    label: "D1: options.scales.yAxes wrapped as {item: [...]}",
    value: {
      type: "chart",
      config: {
        type: "bar",
        data: { datasets: [{ data: [1] }] },
        options: { scales: { yAxes: { item: [{ id: "a" }, { id: "b" }] } } },
      },
    },
    validBlock: true,
  },

  // D2 — the .refine() -> anyOf edge cases
  { label: "D2: spec explicitly undefined, no config/query", value: { type: "chart", spec: undefined }, validBlock: false },
  { label: "D2: extra unknown key plus config", value: { type: "chart", bogusExtra: true, config: { type: "bar", data: { datasets: [{ data: [1] }] } } }, validBlock: true },

  // Malformed values
  { label: "malformed: config missing data", value: { type: "chart", config: { type: "bar" } }, validBlock: false },
  { label: "malformed: config with unknown chart type", value: { type: "chart", config: { type: "donut", data: { datasets: [] } } }, validBlock: false },
  { label: "malformed: dataset count over 50", value: { type: "chart", config: { type: "bar", data: { datasets: Array.from({ length: 51 }, () => ({ data: [1] })) } } }, validBlock: false },
];

describe("chart-schema-parity — candidate vs pre-migration zod baseline", () => {
  for (const tc of CORPUS) {
    it(`${tc.label} — candidate matches expectation and baseline`, async () => {
      const baseline = BaselineChartBlockSchema.safeParse(tc.value).success;
      const candidate = (await validateChartBlock(tc.value)).ok;
      expect(candidate).toBe(tc.validBlock);
      expect(candidate).toBe(baseline);
    });
  }
});

// ── Emitted-schema equality for show_chart ──

function fakeToolDef(name: string, inputSchema: CustomToolDef["inputSchema"]): CustomToolDef {
  return { name, description: "", inputSchema, execute: () => Promise.resolve({ content: "" }) };
}

describe("show_chart — emitted schema parity", () => {
  it("candidate SHOW_CHART_SCHEMA emits the same schema as the baseline zod schema, plus the D1 wrapped-scalar anyOf arms", () => {
    const ctx = { app: {}, signal: new AbortController().signal } as ToolContext;

    const { tools: baselineTools } = buildTools(ctx, [fakeToolDef("show_chart", BaselineShowChartSchema)]);
    const { tools: candidateTools } = buildTools(ctx, [fakeToolDef("show_chart", SHOW_CHART_SCHEMA)]);

    const baselineSchema = baselineTools[0].input_schema;
    const candidateSchema = candidateTools[0].input_schema;

    // The D1 widening adds wrapped-scalar `anyOf` alternatives inside
    // config.data.datasets[].data[].{items} and inside x/y/r/o/h/l/c and
    // labels — everywhere a bare scalar was accepted before. Rather than
    // hand-maintain a diff of every such node, strip the WRAPPED_SCALAR
    // alternative recursively from the candidate and assert what remains
    // is exactly the baseline.
    const stripped = stripWrappedScalarArms(candidateSchema);
    expect(stripped).toEqual(baselineSchema);
  });
});

/** Removes any `anyOf` alternative that is the WRAPPED_SCALAR_SCHEMA shape
 *  (an object with $text/$/_ keys), recursively. Collapses what is left:
 *  a single remaining alternative replaces the `anyOf` node outright, and
 *  remaining alternatives that are ALL bare `{ type: "<primitive>" }` nodes
 *  collapse into zod-to-json-schema's own shorthand for a primitive-type
 *  union, `{ type: [...] }` — matching how the baseline emits
 *  `z.union([z.number(), z.string()])`, so this only removes exactly the D1
 *  widening and nothing else. */
function stripWrappedScalarArms(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripWrappedScalarArms);
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.anyOf)) {
      const kept = (obj.anyOf as Record<string, unknown>[])
        .filter((alt) => {
          const props = alt.properties as Record<string, unknown> | undefined;
          return !(alt.type === "object" && props && "$text" in props && "$" in props && "_" in props);
        })
        .map(stripWrappedScalarArms) as Record<string, unknown>[];

      const isBareType = (alt: Record<string, unknown>) =>
        Object.keys(alt).length === 1 && typeof alt.type === "string";

      let replacement: unknown;
      if (kept.length === 1) {
        replacement = kept[0];
      } else if (kept.every(isBareType)) {
        replacement = { type: kept.map((alt) => alt.type) };
      } else {
        replacement = { anyOf: kept };
      }

      const siblings: Record<string, unknown> = {};
      for (const key of Object.keys(obj)) {
        if (key !== "anyOf") siblings[key] = obj[key];
      }
      const replacementObj = (replacement && typeof replacement === "object" ? replacement : { value: replacement }) as Record<string, unknown>;
      return { ...siblings, ...replacementObj };
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) out[key] = stripWrappedScalarArms(obj[key]);
    return out;
  }
  return node;
}

// ── show_live_chart — verdict parity only ──
//
// Deep-equal is not possible: today's emitted schema carries six
// zod-to-json-schema dedup `$ref` pointers ($ref: "#/properties/encoding/
// properties/x" and five "#/properties/encoding/properties/color") that a
// hand-written schema expresses as inlined objects instead (D5). Only the
// accept/reject verdict is compared.

const BaselineShowLiveChartSchema = z
  .object({
    title: z.string().optional().describe("Chart title"),
    query: z.record(z.string(), z.unknown()).describe("DataQuery targeting a registered data source"),
    encoding: BaselineChartEncodingSchema.describe(
      'Field-to-chart mapping. Call load_skill("chart") for marks, channels, examples.'
    ),
    refresh: BaselineChartRefreshSchema.optional().describe("Default: auto-refresh every 60s when visible."),
  })
  .strict();

const LIVE_CHART_CORPUS: { label: string; value: unknown; valid: boolean }[] = [
  {
    label: "valid query + encoding",
    value: { query: { source: "orders" }, encoding: { mark: "bar", x: { field: "month" }, y: { field: "count" } } },
    valid: true,
  },
  {
    label: "missing query",
    value: { encoding: { mark: "bar", x: { field: "month" }, y: { field: "count" } } },
    valid: false,
  },
  {
    label: "missing encoding",
    value: { query: { source: "orders" } },
    valid: false,
  },
  {
    label: "encoding with unknown channel",
    value: { query: { source: "orders" }, encoding: { mark: "bar", bogus: { field: "x" } } },
    valid: false,
  },
  {
    label: "refresh with bad mode",
    value: { query: { source: "orders" }, encoding: { mark: "bar" }, refresh: { mode: "never" } },
    valid: false,
  },
  {
    label: "refresh with intervalMs 0",
    value: { query: { source: "orders" }, encoding: { mark: "bar" }, refresh: { mode: "auto", intervalMs: 0 } },
    valid: false,
  },
  {
    label: "extra unknown top-level key",
    value: { query: { source: "orders" }, encoding: { mark: "bar" }, bogus: true },
    valid: false,
  },
];

describe("show_live_chart — verdict parity only (not deep-equal; see comment above)", () => {
  for (const tc of LIVE_CHART_CORPUS) {
    it(`${tc.label}`, async () => {
      const baseline = BaselineShowLiveChartSchema.safeParse(tc.value).success;
      const { validateChartSchema } = await import("./validate-chart.js");
      const candidate = (await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, tc.value)) === null;
      expect(candidate).toBe(tc.valid);
      expect(candidate).toBe(baseline);
    });
  }
});
