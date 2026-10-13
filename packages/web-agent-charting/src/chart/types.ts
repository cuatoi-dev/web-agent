/** `Chart.defaults` types only `.global`; `.scale` falls through the type's
 *  index signature as `any` (@types/chart.js@2.9.41). Declare the two scale
 *  branches `applyChartDefaults` writes. */
export interface ChartScaleDefaults {
  ticks: { fontColor?: string };
  gridLines: { color?: string; zeroLineColor?: string };
}

/** The Chart.js 2.x runtime surface this plugin reads.
 *  `@types/chart.js@2.9.41` declares neither `chart.scales` nor a scale's
 *  `getPixelForValue` (checked 2026-09-01), so the shape is declared here
 *  rather than read off `any`. Types only — nothing is emitted. */
export interface FinanceScale {
  getPixelForValue(value: unknown): number;
}
export interface FinanceChart {
  ctx: CanvasRenderingContext2D;
  chartArea?: { left: number; right: number; top: number; bottom: number };
  scales: Record<string, FinanceScale | undefined>;
  getDatasetMeta?(index: number): { xAxisID?: string; yAxisID?: string };
  data?: { datasets?: unknown[] };
  options?: {
    annotation?: {
      lines?: { axis?: unknown; value?: unknown; color?: string; dash?: number[]; label?: string }[];
      boxes?: { axis?: unknown; from?: unknown; to?: unknown; color?: string }[];
    };
  };
}

/** One candle as `transformFinancialConfig` stashes it in `_ohlc`. */
export interface OhlcPoint { x: unknown; o: number; h: number; l: number; c: number }
