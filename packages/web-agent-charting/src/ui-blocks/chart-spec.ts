import type { OptionLeg, WaterfallStep } from "./types.js";
import { isObj, get, arr } from "./chart-config-utils.js";
import { payoffAt, payoffSeries, yAtPoints } from "./chart-payoff-series.js";
import { pnlSeries, splitAtZero, drawdownSeries } from "./chart-pnl-series.js";
import { waterfallSeries } from "./chart-waterfall-series.js";

export type { OptionLeg, PayoffSeries, WaterfallBar, WaterfallStep } from "./types.js";

// The helpers this module used to hold now live in one module per group. Every
// symbol that was importable from `chart-spec.js` before is re-exported here,
// so the module's public surface is unchanged.
export * from "./chart-sanitize.js";
export * from "./chart-financial.js";
export { payoffAt, payoffSeries } from "./chart-payoff-series.js";
export * from "./chart-pnl-series.js";
export * from "./chart-waterfall-series.js";

const PROFIT_FILL = "rgba(38,166,154,0.10)";  // green band
const LOSS_FILL   = "rgba(239,83,80,0.10)";   // red band
const LINE_COLOR  = "#37474f";                 // payoff line
const ZERO_COLOR  = "#888";
const STRIKE_COLOR = "#9e9e9e";
const BE_COLOR    = "#455a64";

/** Rewrite a payoff config → scatter line + reference-line/box annotations.
 *  Pure; returns the config unchanged for any other type. */
export function transformPayoffConfig(config: unknown): unknown {
  if (!isObj(config) || config.type !== "payoff") return config;
  const configData = config.data;
  const configOptions = config.options;
  const p = get(configOptions, "payoff");
  const legs = arr(get(p, "legs")) as OptionLeg[];

  // Source the curve: legs → compute, else payoff.points, else the first dataset's data.
  let points: { x: number; y: number }[];
  let breakevens: number[];
  let strikes: number[];
  let minY: number, maxY: number;
  if (legs.length > 0) {
    const priceRange = get(p, "priceRange") as [number, number] | undefined;
    const s = payoffSeries(legs, priceRange);
    ({ points, breakevens, strikes, minY, maxY } = s);
  } else {
    const rawPoints = get(p, "points");
    const raw = Array.isArray(rawPoints)
      ? rawPoints
      : arr(get(arr(get(configData, "datasets"))[0], "data"));
    points = raw
      .map((d) => ({ x: Number(get(d, "x")), y: Number(get(d, "y")) }))
      .filter((d) => isFinite(d.x) && isFinite(d.y))
      .sort((a, b) => a.x - b.x);
    breakevens = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (a.y === 0) { breakevens.push(a.x); continue; }
      if ((a.y < 0 && b.y > 0) || (a.y > 0 && b.y < 0)) {
        breakevens.push(a.x + (a.y / (a.y - b.y)) * (b.x - a.x));
      }
    }
    const rawStrikes = get(p, "strikes");
    strikes = Array.isArray(rawStrikes) ? (rawStrikes as number[]) : [];
    const ys = points.map((d) => d.y);
    minY = Math.min(0, ...(ys.length ? ys : [0]));
    maxY = Math.max(0, ...(ys.length ? ys : [0]));
  }

  const xMin = points.length ? points[0].x : 0;
  const xMax = points.length ? points[points.length - 1].x : 1;

  // Region boxes: partition [xMin..xMax] at breakevens; color by sign at midpoint.
  const bounds = [xMin, ...breakevens.filter((b) => b > xMin && b < xMax), xMax];
  const boxes: Record<string, unknown>[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const from = bounds[i - 1], to = bounds[i];
    const mid = (from + to) / 2;
    const y = legs.length > 0 ? payoffAt(legs, mid) : yAtPoints(points, mid);
    boxes.push({ axis: "x", from, to, color: y >= 0 ? PROFIT_FILL : LOSS_FILL });
  }
  const lines: Record<string, unknown>[] = [{ axis: "y", value: 0, color: ZERO_COLOR }];
  for (const k of strikes) lines.push({ axis: "x", value: k, color: STRIKE_COLOR, dash: [4, 4], label: `K ${k}` });
  for (const be of breakevens) lines.push({ axis: "x", value: be, color: BE_COLOR, dash: [2, 2], label: `BE ${Number(be.toFixed(2))}` });

  const out: Record<string, unknown> = { ...config, type: "scatter" };
  const data: Record<string, unknown> = { ...(isObj(configData) ? configData : {}) };
  out.data = data;
  data.datasets = [{
    label: get(arr(get(configData, "datasets"))[0], "label") ?? "Payoff",
    data: points,
    showLine: true,
    fill: false,
    borderColor: LINE_COLOR,
    borderWidth: 2,
    pointRadius: 0,
    pointHitRadius: 0,
    lineTension: 0,
  }];
  const options: Record<string, unknown> = { ...(isObj(configOptions) ? configOptions : {}) };
  out.options = options;
  // Merge auto annotations under any agent-supplied ones (agent wins on conflict).
  const existing = options.annotation;
  options.annotation = {
    lines: [...lines, ...arr(get(existing, "lines"))],
    boxes: [...boxes, ...arr(get(existing, "boxes"))],
  };
  // Guarantee 0 is visible on the y-axis.
  const scales: Record<string, unknown> = { ...(isObj(options.scales) ? options.scales : {}) };
  options.scales = scales;
  scales.yAxes = [{ ticks: { suggestedMin: minY, suggestedMax: maxY } }];
  delete options.payoff; // consumed
  return out;
}

const PNL_TYPES = new Set(["equity", "drawdown"]);
const EQUITY_LINE = "#37474f";                    // neutral equity line over the split fill
const POS_FILL    = "rgba(38,166,154,0.15)";      // green (profit) band
const NEG_FILL    = "rgba(239,83,80,0.15)";       // red (loss) band
const DD_LINE     = "#ef5350";                     // drawdown outline
const DD_FILL     = "rgba(239,83,80,0.20)";        // underwater fill
const PNL_ZERO    = "#888";                         // zero baseline / high-water line

/** Rewrite an equity/drawdown config → scatter line(s) + zero-line annotation.
 *  Pure; returns the config unchanged for any other type. */
export function transformPnlConfig(config: unknown): unknown {
  if (!isObj(config) || !PNL_TYPES.has(config.type as string)) return config;
  const configData = config.data;
  const configOptions = config.options;
  const p = get(configOptions, "pnl");
  const rawPoints = get(p, "points");
  const { points, temporal } = pnlSeries({
    returns: get(p, "returns") as number[] | undefined,
    equity: get(p, "equity") as number[] | undefined,
    points: (Array.isArray(rawPoints)
      ? rawPoints
      : arr(get(arr(get(configData, "datasets"))[0], "data"))) as { x: unknown; y: unknown }[],
    x: get(p, "x") as (number | string)[] | undefined,
    start: get(p, "start") as number | undefined,
  });

  const out: Record<string, unknown> = { ...config, type: "scatter" };
  const data: Record<string, unknown> = { ...(isObj(configData) ? configData : {}) };
  out.data = data;
  const options: Record<string, unknown> = { ...(isObj(configOptions) ? configOptions : {}) };
  out.options = options;

  let ys: number[];
  if (config.type === "drawdown") {
    const percent = get(p, "percent");
    const dd = drawdownSeries(points, { percent: !!percent });
    ys = dd.map((d) => d.y);
    data.datasets = [{
      label: get(arr(get(configData, "datasets"))[0], "label") ?? (percent ? "Drawdown %" : "Drawdown"),
      data: dd, showLine: true, fill: "origin",
      borderColor: DD_LINE, backgroundColor: DD_FILL, borderWidth: 1.5,
      pointRadius: 0, pointHitRadius: 0, lineTension: 0,
    }];
  } else { // equity
    const { line, positive, negative } = splitAtZero(points);
    ys = line.map((d) => d.y);
    data.datasets = [
      { label: "", data: positive, showLine: true, fill: "origin",
        backgroundColor: POS_FILL, borderColor: "transparent", borderWidth: 0,
        pointRadius: 0, pointHitRadius: 0, lineTension: 0 },
      { label: "", data: negative, showLine: true, fill: "origin",
        backgroundColor: NEG_FILL, borderColor: "transparent", borderWidth: 0,
        pointRadius: 0, pointHitRadius: 0, lineTension: 0 },
      { label: get(arr(get(configData, "datasets"))[0], "label") ?? "Equity", data: line, showLine: true,
        fill: false, borderColor: EQUITY_LINE, borderWidth: 2,
        pointRadius: 0, pointHitRadius: 0, lineTension: 0 },
    ];
  }

  // Zero baseline (drawdown: the high-water mark). Merge under agent-supplied lines.
  const existing = options.annotation;
  options.annotation = {
    lines: [{ axis: "y", value: 0, color: PNL_ZERO }, ...arr(get(existing, "lines"))],
    boxes: [...arr(get(existing, "boxes"))],
  };

  // y-range includes 0 + the data extremes; PRESERVE any supplied xAxes (temporal).
  const yMin = Math.min(0, ...(ys.length ? ys : [0]));
  const yMax = Math.max(0, ...(ys.length ? ys : [0]));
  const scales: Record<string, unknown> = { ...(isObj(options.scales) ? options.scales : {}) };
  options.scales = scales;
  scales.yAxes = [{ ticks: { suggestedMin: yMin, suggestedMax: yMax } }];
  if (temporal && !scales.xAxes) scales.xAxes = [{ type: "time" }];

  // Equity draws 3 datasets (2 are internal fill carriers) → hide the legend by default.
  const legend: Record<string, unknown> = { ...(isObj(options.legend) ? options.legend : {}) };
  options.legend = legend;
  if (config.type === "equity" && legend.display === undefined) {
    legend.display = false;
  }
  delete options.pnl; // consumed
  return out;
}

const WF_UP    = "#26a69a";                    // increase (green)
const WF_DOWN  = "#ef5350";                    // decrease (red)
const WF_TOTAL = "#546e7a";                    // total (neutral blue-grey)
const WF_TOTAL_LINE = "#546e7a";

/** Rewrite a waterfall config → native stacked bar (transparent base carrier +
 *  colored delta series). Optional total reference line reuses the existing
 *  annotation primitive. Pure; no-op for any other type. */
export function transformWaterfallConfig(config: unknown): unknown {
  if (!isObj(config) || config.type !== "waterfall") return config;
  const configData = config.data;
  const configOptions = config.options;
  const w = get(configOptions, "waterfall");
  const rawSteps = get(w, "steps");
  const steps = (Array.isArray(rawSteps) ? rawSteps : []) as WaterfallStep[];
  const wStart = get(w, "start") as number | undefined;
  const wTotal = get(w, "total") as boolean | string | undefined;
  const { bars, labels, total } = waterfallSeries(steps, { start: wStart, total: wTotal });

  const colors = bars.map((b) =>
    b.kind === "total" ? WF_TOTAL : b.kind === "increase" ? WF_UP : WF_DOWN);

  const out: Record<string, unknown> = { ...config, type: "bar" };
  const data: Record<string, unknown> = { ...(isObj(configData) ? configData : {}) };
  out.data = data;
  data.labels = labels;
  data.datasets = [
    { label: "", data: bars.map((b) => b.base),
      backgroundColor: "rgba(0,0,0,0)", borderColor: "rgba(0,0,0,0)", borderWidth: 0 },
    { label: get(arr(get(configData, "datasets"))[0], "label") ?? "Bridge",
      data: bars.map((b) => b.delta), backgroundColor: colors, borderWidth: 0 },
  ];

  const options: Record<string, unknown> = { ...(isObj(configOptions) ? configOptions : {}) };
  out.options = options;
  const scales: Record<string, unknown> = { ...(isObj(options.scales) ? options.scales : {}) };
  options.scales = scales;
  const xAxes0 = arr(get(scales, "xAxes"))[0];
  scales.xAxes = [{ stacked: true, ...(isObj(xAxes0) ? xAxes0 : {}) }];
  const yAxes0 = arr(get(scales, "yAxes"))[0];
  scales.yAxes = [{ stacked: true, ...(isObj(yAxes0) ? yAxes0 : {}) }];

  // Base dataset is an internal carrier → hide legend by default.
  const legend: Record<string, unknown> = { display: false, ...(isObj(options.legend) ? options.legend : {}) };
  options.legend = legend;

  // Optional total reference line — reuses financePlugin's annotation primitive.
  if (get(w, "showTotalLine")) {
    const existing = options.annotation;
    options.annotation = {
      lines: [{ axis: "y", value: total, color: WF_TOTAL_LINE, dash: [4, 4], label: `Total ${total}` },
              ...arr(get(existing, "lines"))],
      boxes: [...arr(get(existing, "boxes"))],
    };
  }
  delete options.waterfall; // consumed
  return out;
}
