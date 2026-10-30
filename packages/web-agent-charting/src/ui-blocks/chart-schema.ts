import type { JsonSchemaObject } from "@cuatoi/web-agent-core";
import type {
  ChartBlockFields, ChartConfigFields, ChartDataFields, ChartDatasetFields,
  ChartEncoding, ChartRefresh, ChartRefreshMode, ChartType,
  EncodingChannel, EncodingSimpleChannel,
} from "./types.js";

export type {
  ChartBlock, ChartConfig, ChartData, ChartDataset, ChartEncoding,
  ChartRefresh, ChartRefreshMode, ChartType, EncodingChannel,
  EncodingSimpleChannel,
} from "./types.js";

// ── Chart.js config schema ──

/** An XML-wrapped scalar, as it arrives BEFORE unwrapXmlText runs:
 *  exactly one of $text / $ / _ carrying the real value. Mirrors the
 *  single-key check in unwrapXmlText (chart-normalize.ts). */
export const WRAPPED_SCALAR_SCHEMA = {
  type: "object",
  properties: {
    $text: { type: ["string", "number"] },
    $: { type: ["string", "number"] },
    _: { type: ["string", "number"] },
  },
  minProperties: 1,
  maxProperties: 1,
  additionalProperties: false,
};

export const ChartTypeSchema = {
  type: "string",
  enum: [
    "line", "bar", "horizontalBar", "radar", "doughnut", "pie",
    "polarArea", "bubble", "scatter", "candlestick", "ohlc", "payoff",
    "equity", "drawdown", "waterfall",
  ],
} as const;

/** Drift guard — see chart-schema-drift.test.ts. */
export const CHART_TYPE_MEMBERS: Record<ChartType, true> = {
  line: true, bar: true, horizontalBar: true, radar: true, doughnut: true,
  pie: true, polarArea: true, bubble: true, scatter: true, candlestick: true,
  ohlc: true, payoff: true, equity: true, drawdown: true, waterfall: true,
};

const DATA_POINT_SCALAR_OR_WRAPPED = {
  anyOf: [{ type: "number" }, { type: "string" }, WRAPPED_SCALAR_SCHEMA],
};

/** `r`, `o`, `h`, `l` and `c` all accept the same pair, so they share one
 *  object. Shared identity is what lets the ajv compile step hoist it into a
 *  single `$defs` entry instead of inlining it five times. */
const DATA_POINT_NUMBER_OR_WRAPPED = {
  anyOf: [{ type: "number" }, WRAPPED_SCALAR_SCHEMA],
};

export const ChartDatasetSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: {
        anyOf: [
          { type: "number" },
          { type: "string" },
          { type: "null" },
          {
            type: "object",
            properties: {
              x: DATA_POINT_SCALAR_OR_WRAPPED,
              y: DATA_POINT_SCALAR_OR_WRAPPED,
              r: DATA_POINT_NUMBER_OR_WRAPPED,
            },
            required: ["x", "y"],
            additionalProperties: true,
          },
          {
            type: "object",
            properties: {
              x: DATA_POINT_SCALAR_OR_WRAPPED,
              o: DATA_POINT_NUMBER_OR_WRAPPED,
              h: DATA_POINT_NUMBER_OR_WRAPPED,
              l: DATA_POINT_NUMBER_OR_WRAPPED,
              c: DATA_POINT_NUMBER_OR_WRAPPED,
            },
            required: ["x", "o", "h", "l", "c"],
            additionalProperties: true,
          },
          WRAPPED_SCALAR_SCHEMA,
        ],
      },
    },
    label: { type: "string" },
    backgroundColor: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    borderColor: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    borderWidth: { type: "number" },
    fill: { type: "boolean" },
    type: { type: "string" },
  },
  required: ["data"],
  additionalProperties: true,
};

export const CHART_DATASET_KEYS: Record<keyof ChartDatasetFields, true> = {
  data: true, label: true, backgroundColor: true, borderColor: true,
  borderWidth: true, fill: true, type: true,
};

export const ChartDataSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: { anyOf: [{ type: "string" }, { type: "number" }, WRAPPED_SCALAR_SCHEMA] },
    },
    datasets: { type: "array", items: ChartDatasetSchema, maxItems: 50 },
  },
  required: ["datasets"],
  additionalProperties: true,
};

export const CHART_DATA_KEYS: Record<keyof ChartDataFields, true> = {
  labels: true, datasets: true,
};

export const ChartConfigSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    type: ChartTypeSchema,
    data: ChartDataSchema,
    options: { type: "object", additionalProperties: {} },
  },
  required: ["type", "data"],
  additionalProperties: true,
};

export const CHART_CONFIG_KEYS: Record<keyof ChartConfigFields, true> = {
  type: true, data: true, options: true,
};

// ── Chart refresh ──

export const ChartRefreshModeSchema = { type: "string", enum: ["auto", "manual", "off"] } as const;
export const CHART_REFRESH_MODE_MEMBERS: Record<ChartRefreshMode, true> = {
  auto: true, manual: true, off: true,
};

export const ChartRefreshSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    mode: ChartRefreshModeSchema,
    intervalMs: { type: "integer", exclusiveMinimum: 0 },
  },
  required: ["mode"],
  additionalProperties: false,
};
export const CHART_REFRESH_KEYS: Record<keyof ChartRefresh, true> = {
  mode: true, intervalMs: true,
};

// ── Base chart block ──

export const EncodingChannelSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    field: { type: "string" },
    type: { type: "string", enum: ["nominal", "ordinal", "quantitative", "temporal"] },
    title: { type: "string" },
  },
  required: ["field"],
  additionalProperties: false,
};
export const ENCODING_CHANNEL_KEYS: Record<keyof EncodingChannel, true> = {
  field: true, type: true, title: true,
};

export const EncodingSimpleChannelSchema: JsonSchemaObject = {
  type: "object",
  properties: { field: { type: "string" }, title: { type: "string" } },
  required: ["field"],
  additionalProperties: false,
};
export const ENCODING_SIMPLE_CHANNEL_KEYS: Record<keyof EncodingSimpleChannel, true> = {
  field: true, title: true,
};

export const ChartEncodingSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    mark: { type: "string", description: "bar/line/area/arc/pie/scatter/candlestick/ohlc" },
    x: { ...EncodingChannelSchema, description: "X-axis" },
    y: { ...EncodingChannelSchema, description: "Y-axis" },
    color: { ...EncodingSimpleChannelSchema, description: "multi-series grouping" },
    open: { ...EncodingSimpleChannelSchema, description: "candlestick/ohlc open" },
    high: { ...EncodingSimpleChannelSchema, description: "candlestick/ohlc high" },
    low: { ...EncodingSimpleChannelSchema, description: "candlestick/ohlc low" },
    close: { ...EncodingSimpleChannelSchema, description: "candlestick/ohlc close" },
    theta: { ...EncodingSimpleChannelSchema, description: "arc/pie slice value" },
    tooltip: {
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "boolean" }],
      description: "tooltip fields, or false to hide",
    },
    title: { type: "string", description: "series title (candlestick/ohlc)" },
  },
  required: ["mark"],
  additionalProperties: false,
};

export const CHART_ENCODING_KEYS: Record<keyof ChartEncoding, true> = {
  mark: true, x: true, y: true, color: true, open: true, high: true,
  low: true, close: true, theta: true, tooltip: true, title: true,
};

const CHART_BLOCK_PROPERTIES = {
  type: { const: "chart" },
  title: { type: "string" },
  /** @deprecated Use `config` instead. */
  spec: { type: "object", additionalProperties: {} },
  config: ChartConfigSchema,
  query: { type: "object", additionalProperties: {} },
  encoding: ChartEncodingSchema,
  refresh: ChartRefreshSchema,
};

/** The block object WITHOUT the "one of spec/config/query" rule — the
 *  discriminated-union discriminant. */
export const ChartBlockDiscriminant: JsonSchemaObject = {
  type: "object",
  properties: CHART_BLOCK_PROPERTIES,
  required: ["type"],
  additionalProperties: true,
};

/** The chart block. The `anyOf` replaces the pre-migration `.refine()` that
 *  rejected a block carrying none of spec / config / query. Ajv's `required`
 *  treats an explicitly-undefined key as absent, matching the old
 *  `val.spec !== undefined` check. */
export const ChartBlockSchema: JsonSchemaObject = {
  type: "object",
  properties: CHART_BLOCK_PROPERTIES,
  required: ["type"],
  anyOf: [{ required: ["spec"] }, { required: ["config"] }, { required: ["query"] }],
  additionalProperties: true,
};

export const CHART_BLOCK_KEYS: Record<keyof ChartBlockFields, true> = {
  type: true, title: true, spec: true, config: true, query: true,
  encoding: true, refresh: true,
};
