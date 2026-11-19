import Chart from "chart.js";
import type { FinanceChart, OhlcPoint } from "./types.js";

export type { FinanceChart, FinanceScale } from "./types.js";

const UP = "#26a69a";     // close ≥ open
const DOWN = "#ef5350";   // close < open

/** Global Chart.js 2.7.3 plugin: renders candlestick/OHLC datasets (from the
 *  _ohlc stashed by transformFinancialConfig) and declarative reference
 *  lines/boxes (options.annotation). No-ops on charts that use neither. */
export const financePlugin = {
  id: "finance",
  afterDatasetsDraw(chart: FinanceChart) {
    const ctx = chart.ctx;
    const area = chart.chartArea;
    const meta0 = chart.getDatasetMeta ? chart.getDatasetMeta(0) : null;
    const xScale = meta0 ? chart.scales[meta0.xAxisID as string] : chart.scales["x-axis-0"];
    const yScale = meta0 ? chart.scales[meta0.yAxisID as string] : chart.scales["y-axis-0"];

    // ── 1. candlestick / OHLC bodies ──
    (chart.data?.datasets ?? []).forEach((ds) => {
      const rec = ds as { _ohlc?: unknown; _finKind?: unknown } | null | undefined;
      const ohlc = rec?._ohlc as OhlcPoint[] | undefined;
      if (!Array.isArray(ohlc) || ohlc.length === 0 || !xScale || !yScale) return;
      const xs2 = xScale;
      const ys2 = yScale;
      // Candle width: 60% of the min gap between adjacent x pixels, min 3px.
      const xs = ohlc.map((d) => xs2.getPixelForValue(d.x));
      let gap = Infinity;
      for (let i = 1; i < xs.length; i++) gap = Math.min(gap, Math.abs(xs[i] - xs[i - 1]));
      const w = Math.max(3, (isFinite(gap) ? gap : 12) * 0.6);
      ohlc.forEach((d, i) => {
        const x = xs[i];
        const yO = ys2.getPixelForValue(d.o);
        const yH = ys2.getPixelForValue(d.h);
        const yL = ys2.getPixelForValue(d.l);
        const yC = ys2.getPixelForValue(d.c);
        const up = d.c >= d.o;
        ctx.save();
        ctx.strokeStyle = up ? UP : DOWN;
        ctx.fillStyle = up ? UP : DOWN;
        ctx.lineWidth = 1.5;
        if (rec?._finKind === "ohlc") {
          ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();       // range
          ctx.beginPath(); ctx.moveTo(x - w / 2, yO); ctx.lineTo(x, yO); ctx.stroke(); // open tick (left)
          ctx.beginPath(); ctx.moveTo(x, yC); ctx.lineTo(x + w / 2, yC); ctx.stroke(); // close tick (right)
        } else { // candlestick
          ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();        // wick
          const top = Math.min(yO, yC), h = Math.max(1, Math.abs(yC - yO));
          ctx.fillRect(x - w / 2, top, w, h);
          ctx.strokeRect(x - w / 2, top, w, h);
        }
        ctx.restore();
      });
    });

    // ── 2. reference lines / boxes ──
    const ann = chart.options?.annotation;
    if (ann && area && xScale && yScale) {
      const pix = (axis: string, v: unknown) => (axis === "x" ? xScale : yScale).getPixelForValue(v);
      for (const line of ann.lines ?? []) {
        const axis = line.axis === "x" ? "x" : "y";
        const p = pix(axis, line.value);
        ctx.save();
        ctx.strokeStyle = line.color ?? "#888";
        ctx.lineWidth = 1;
        if (Array.isArray(line.dash)) ctx.setLineDash(line.dash);
        ctx.beginPath();
        if (axis === "y") { ctx.moveTo(area.left, p); ctx.lineTo(area.right, p); }
        else { ctx.moveTo(p, area.top); ctx.lineTo(p, area.bottom); }
        ctx.stroke();
        if (line.label) {
          // Label text is chrome: fall back to the themed canvas text colour and
          // family that applyChartDefaults() resolved from --wa-* before the
          // chart was built. A caller-supplied line.color still wins.
          const d = Chart.defaults.global;
          ctx.setLineDash([]);
          // `defaultFontColor` is `ChartColor | undefined`; canvas takes
          // string | CanvasGradient | CanvasPattern. Assigning undefined is a
          // no-op on canvas, which is the current behaviour — keep it.
          ctx.fillStyle = (line.color ?? d.defaultFontColor) as string;
          ctx.font = `11px ${String(d.defaultFontFamily)}`;
          if (axis === "y") ctx.fillText(line.label, area.left + 4, p - 3);
          else ctx.fillText(line.label, p + 3, area.top + 12);
        }
        ctx.restore();
      }
      for (const box of ann.boxes ?? []) {
        const axis = box.axis === "x" ? "x" : "y";
        const a = pix(axis, box.from), b = pix(axis, box.to);
        ctx.save();
        ctx.fillStyle = box.color ?? "rgba(136,136,136,0.15)";
        if (axis === "y") ctx.fillRect(area.left, Math.min(a, b), area.right - area.left, Math.abs(b - a));
        else ctx.fillRect(Math.min(a, b), area.top, Math.abs(b - a), area.bottom - area.top);
        ctx.restore();
      }
    }
  },
};
