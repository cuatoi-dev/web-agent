// ── P&L / equity curve + drawdown (072-4) ──

/** Cumulative running total of per-period P&L. y_i = start + Σ returns[0..i].
 *  x_i = opts.x?.[i] (numeric, or ISO/date string → ms) else the index i. */
export function cumulativeSeries(
  returns: number[],
  opts?: { x?: (number | string)[]; start?: number },
): { x: number; y: number }[] {
  const start = opts?.start ?? 0;
  const out: { x: number; y: number }[] = [];
  let acc = start;
  for (let i = 0; i < returns.length; i++) {
    acc += Number(returns[i]) || 0;
    out.push({ x: xToNum(opts?.x?.[i], i), y: acc });
  }
  return out;
}

/** ISO/date string → ms; finite number → itself; else the fallback index. */
function xToNum(x: number | string | undefined, index: number): number {
  if (typeof x === "string") { const t = Date.parse(x); return isFinite(t) ? t : index; }
  if (typeof x === "number" && isFinite(x)) return x;
  return index;
}

/** Normalize a returns[] / equity[] / points[] source into a numeric {x,y} level
 *  series. temporal=true when any supplied x was a date-like string (→ time axis). */
export function pnlSeries(src: {
  returns?: number[]; equity?: number[]; points?: { x: unknown; y: unknown }[];
  x?: (number | string)[]; start?: number;
}): { points: { x: number; y: number }[]; temporal: boolean } {
  const xs = src.x;
  const temporal =
    (Array.isArray(xs) && xs.some((v) => typeof v === "string")) ||
    (Array.isArray(src.points) && src.points.some((p) => typeof p?.x === "string"));
  let points: { x: number; y: number }[];
  if (Array.isArray(src.equity)) {
    points = src.equity.map((y, i) => ({ x: xToNum(xs?.[i], i), y: Number(y) }));
  } else if (Array.isArray(src.returns)) {
    points = cumulativeSeries(src.returns, { x: xs, start: src.start });
  } else if (Array.isArray(src.points)) {
    points = src.points.map((p, i) => ({
      x: xToNum((p?.x as number | string | undefined) ?? xs?.[i], i),
      y: Number(p?.y),
    }));
  } else {
    points = [];
  }
  return { points: points.filter((p) => isFinite(p.x) && isFinite(p.y)), temporal };
}

/** Split a level series at the zero line for signed area fill. Inserts an
 *  interpolated y=0 vertex at every strict sign change so the green (≥0) and red
 *  (≤0) fills meet exactly on the baseline. Returns the augmented line plus the two
 *  clamped carrier series (positive = max(y,0), negative = min(y,0)). */
export function splitAtZero(points: { x: number; y: number }[]): {
  line: { x: number; y: number }[];
  positive: { x: number; y: number }[];
  negative: { x: number; y: number }[];
} {
  const line: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const a = points[i - 1];
      if (a.y * p.y < 0) {                       // strict sign change → insert crossing
        const t = a.y / (a.y - p.y);             // exact for a linear segment
        line.push({ x: a.x + t * (p.x - a.x), y: 0 });
      }
    }
    line.push({ x: p.x, y: p.y });
  }
  return {
    line,
    positive: line.map((p) => ({ x: p.x, y: Math.max(p.y, 0) })),
    negative: line.map((p) => ({ x: p.x, y: Math.min(p.y, 0) })),
  };
}

/** Running high-water mark of a level series. */
export function runningPeak(ys: number[]): number[] {
  const out: number[] = [];
  let peak = -Infinity;
  for (const y of ys) { peak = Math.max(peak, y); out.push(peak); }
  return out;
}

/** Underwater / drawdown from a level series. Absolute: dd = level − peak (≤0).
 *  percent: (level/peak − 1)·100 when peak>0, else 0. */
export function drawdownSeries(
  points: { x: number; y: number }[],
  opts?: { percent?: boolean },
): { x: number; y: number }[] {
  const peaks = runningPeak(points.map((p) => p.y));
  return points.map((p, i) => {
    const peak = peaks[i];
    const y = opts?.percent
      ? (peak > 0 ? (p.y / peak - 1) * 100 : 0)
      : (p.y - peak);
    return { x: p.x, y };
  });
}
