import type { DataQuery } from "@cuatoi/web-agent-core";

// ── Chart.js config schema ──

export type ChartType =
  | "line" | "bar" | "horizontalBar" | "radar" | "doughnut" | "pie"
  | "polarArea" | "bubble" | "scatter" | "candlestick" | "ohlc" | "payoff"
  | "equity" | "drawdown" | "waterfall";

export interface ChartDatasetFields {
  data: (number | string | null | Record<string, unknown>)[];
  label?: string;
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  fill?: boolean;
  type?: string;
}
export interface ChartDataset extends ChartDatasetFields { [key: string]: unknown; }

export interface ChartDataFields {
  labels?: (string | number)[];
  datasets: ChartDataset[];
}
export interface ChartData extends ChartDataFields { [key: string]: unknown; }

export interface ChartConfigFields {
  type: ChartType;
  data: ChartData;
  options?: Record<string, unknown>;
}
export interface ChartConfig extends ChartConfigFields { [key: string]: unknown; }

// ── Chart refresh ──

export type ChartRefreshMode = "auto" | "manual" | "off";
export interface ChartRefresh { mode: ChartRefreshMode; intervalMs?: number; }

// ── Base chart block ──

export interface EncodingChannel {
  field: string;
  type?: "nominal" | "ordinal" | "quantitative" | "temporal";
  title?: string;
}

export interface EncodingSimpleChannel { field: string; title?: string; }

export interface ChartEncoding {
  mark: string;
  x?: EncodingChannel;
  y?: EncodingChannel;
  color?: EncodingSimpleChannel;
  open?: EncodingSimpleChannel;
  high?: EncodingSimpleChannel;
  low?: EncodingSimpleChannel;
  close?: EncodingSimpleChannel;
  theta?: EncodingSimpleChannel;
  tooltip?: string[] | boolean;
  title?: string;
}

export interface ChartBlockFields {
  type: "chart";
  title?: string;
  /** @deprecated Use `config` instead. */
  spec?: object;
  config?: ChartConfig;
  query?: DataQuery;
  encoding?: ChartEncoding;
  refresh?: ChartRefresh;
}
export interface ChartBlock extends ChartBlockFields { [key: string]: unknown; }

// ── Chart.js config sanitizer / spec builders (chart-spec.ts) ──

export interface OptionLeg {
  kind: "call" | "put";
  strike: number;
  premium: number;
  qty?: number;                 // default 1
  side?: "long" | "short";      // default "long"
}

export interface PayoffSeries {
  points: { x: number; y: number }[]; // piecewise-linear vertices, x ascending
  breakevens: number[];               // ascending zero-crossings within range
  strikes: number[];                  // sorted unique leg strikes
  minY: number;
  maxY: number;
}

// ── Waterfall / P&L bridge ──

export interface WaterfallStep {
  label: string;
  value: number;          // signed delta; ignored when isTotal
  isTotal?: boolean;      // render a full 0..cumulative "total" bar instead of a delta
}

export interface WaterfallBar {
  label: string;
  base: number;           // transparent carrier height
  delta: number;          // visible segment height (≥ 0, except a total below 0)
  cumulative: number;     // running total AFTER this step
  kind: "increase" | "decrease" | "total";
}

// ── ajv plumbing (validate-chart.ts) ──

export type Ajv2020Ctor = typeof import("ajv/dist/2020.js").default;
export type Ajv2020Instance = InstanceType<Ajv2020Ctor>;
export type CompiledValidator = ReturnType<Ajv2020Instance["compile"]>;
