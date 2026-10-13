import type { WaterfallBar, WaterfallStep } from "./types.js";

// ── Waterfall / P&L bridge (072-5) ──

/** Compute per-bar base/delta/color inputs for a waterfall from signed step
 *  deltas. Rising step → base=prev, delta=value; falling step → base=prev+value,
 *  delta=|value| (the visible bar hangs down from prev). A total step (isTotal or
 *  the auto total) spans 0..cumulative. Pure. */
export function waterfallSeries(
  steps: WaterfallStep[],
  opts?: { start?: number; total?: boolean | string },
): { bars: WaterfallBar[]; labels: string[]; total: number } {
  const bars: WaterfallBar[] = [];
  let running = opts?.start ?? 0;
  for (const s of steps) {
    if (s.isTotal) {
      bars.push({ label: s.label, base: 0, delta: running, cumulative: running, kind: "total" });
      continue;
    }
    const v = Number(s.value) || 0;
    const prev = running;
    running = prev + v;
    if (v >= 0) bars.push({ label: s.label, base: prev, delta: v, cumulative: running, kind: "increase" });
    else bars.push({ label: s.label, base: running, delta: -v, cumulative: running, kind: "decrease" });
  }
  if (opts?.total) {
    const label = typeof opts.total === "string" ? opts.total : "Total";
    bars.push({ label, base: 0, delta: running, cumulative: running, kind: "total" });
  }
  return { bars, labels: bars.map((b) => b.label), total: running };
}
