import type { OptionLeg, PayoffSeries } from "./types.js";

// ── Option payoff series math ──

/** P/L at expiry for one leg at underlying price S. long = +(intrinsic - premium),
 *  short = -(intrinsic - premium), scaled by qty. */
function legPnl(leg: OptionLeg, S: number): number {
  const qty = leg.qty ?? 1;
  const sign = (leg.side ?? "long") === "short" ? -1 : 1;
  const intrinsic = leg.kind === "put"
    ? Math.max(0, leg.strike - S)
    : Math.max(0, S - leg.strike);
  return sign * (intrinsic - leg.premium) * qty;
}

/** Total strategy P/L at price S (sum of legs). */
export function payoffAt(legs: OptionLeg[], S: number): number {
  let sum = 0;
  for (const leg of legs) sum += legPnl(leg, S);
  return sum;
}

/** Build the payoff curve, breakevens and strikes from option legs across a price
 *  range. Vertices sit at every strike inside the range plus the two endpoints, so
 *  the returned points reproduce the exact piecewise-linear payoff. */
export function payoffSeries(
  legs: OptionLeg[],
  range?: [number, number],
): PayoffSeries {
  const strikes = Array.from(new Set(legs.map((l) => l.strike))).sort((a, b) => a - b);
  // Auto range: pad 30% below min strike / above max strike (no strikes: min 0, max 100).
  let [lo, hi] = range ?? [];
  if (lo === undefined || hi === undefined) {
    const kMin = strikes[0] ?? 0;
    const kMax = strikes[strikes.length - 1] ?? 100;
    const pad = Math.max(1, (kMax - kMin) * 0.3 || kMax * 0.3 || 10);
    lo = Math.max(0, kMin - pad);
    hi = kMax + pad;
  }
  if (hi <= lo) hi = lo + 1;
  const xs = Array.from(new Set([lo, ...strikes.filter((k) => k > lo && k < hi), hi]))
    .sort((a, b) => a - b);
  const points = xs.map((x) => ({ x, y: payoffAt(legs, x) }));
  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if ((a.y <= 0 && b.y > 0) || (a.y >= 0 && b.y < 0) || (a.y === 0)) {
      if (a.y === 0) { breakevens.push(a.x); continue; }
      const t = a.y / (a.y - b.y);           // exact for a linear segment
      breakevens.push(a.x + t * (b.x - a.x));
    }
  }
  const ys = points.map((p) => p.y);
  return { points, breakevens, strikes, minY: Math.min(0, ...ys), maxY: Math.max(0, ...ys) };
}

/** Linear-interpolate y at price S over ascending {x,y} points (for the points path). */
export function yAtPoints(points: { x: number; y: number }[], S: number): number {
  if (points.length === 0) return 0;
  if (S <= points[0].x) return points[0].y;
  if (S >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (S >= a.x && S <= b.x) {
      const t = (S - a.x) / (b.x - a.x || 1);
      return a.y + t * (b.y - a.y);
    }
  }
  return points[points.length - 1].y;
}
