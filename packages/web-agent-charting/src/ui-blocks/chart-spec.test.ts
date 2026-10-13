import { describe, it, expect } from "vitest";
import { sanitizeChartConfig, hasDataUrl, checkRowCountExceeded, checkAxisIdMismatch, transformFinancialConfig, payoffAt, payoffSeries, transformPayoffConfig, cumulativeSeries, pnlSeries, splitAtZero, runningPeak, drawdownSeries, transformPnlConfig, waterfallSeries, transformWaterfallConfig } from "./chart-spec.js";

/** The shape the tests below read off a `sanitizeChartConfig`/`transform*Config`
 *  result, now that those functions return `unknown`. Narrower than a real
 *  Chart.js config — just the fields these assertions actually check. `options`
 *  is declared non-optional so every read below type-checks; a test that
 *  expects it to be absent (`toBeUndefined()`) still passes at runtime — the
 *  static type only shapes what member access compiles, not what's really
 *  there. */
interface TestChartConfig {
  type: string;
  data: {
    datasets: Array<{
      data: Array<{ x?: unknown; y?: number }>;
      url?: string;
      _ohlc?: unknown[];
      _finKind?: string;
      pointRadius?: number;
      showLine?: boolean;
      fill?: unknown;
      backgroundColor?: unknown;
    }>;
  };
  options: {
    onClick?: unknown;
    title?: unknown;
    scales?: {
      xAxes?: Array<{ type?: string; time?: { unit?: string }; stacked?: boolean }>;
      yAxes?: Array<{ stacked?: boolean; ticks?: { suggestedMin?: number; suggestedMax?: number } }>;
    };
    annotation?: {
      lines?: Array<{ axis?: string; value?: unknown; label?: string; color?: string }>;
      boxes?: Array<{ axis?: string; from?: unknown; to?: unknown; color?: string }>;
    };
    payoff?: { legs?: unknown[] };
    pnl?: { returns?: unknown[] };
    waterfall?: { steps?: unknown[] };
    legend?: { display?: boolean };
  };
}

describe("chart-spec helpers", () => {
  describe("hasDataUrl", () => {
    it("detects data.url in Vega-style objects", () => {
      expect(hasDataUrl({ data: { url: "foo.json" } })).toBe(true);
      expect(hasDataUrl({ nested: { data: { url: "foo.json" } } })).toBe(true);
      expect(hasDataUrl({ data: { values: [1, 2, 3] } })).toBe(false);
      expect(hasDataUrl(null)).toBe(false);
      expect(hasDataUrl("not an object")).toBe(false);
    });

    it("detects data.url in Chart.js config datasets", () => {
      const config = {
        data: {
          datasets: [
            { data: [1, 2] },
            { url: "http://evil.json" },
          ],
        },
      };
      expect(hasDataUrl(config)).toBe(true);
    });
  });

  describe("checkRowCountExceeded", () => {
    it("returns true when Vega data.values exceeds 2000", () => {
      const hugeValues = Array.from({ length: 2001 }, (_, i) => i);
      expect(checkRowCountExceeded({ data: { values: hugeValues } })).toBe(true);
      expect(checkRowCountExceeded({ data: { values: [1, 2] } })).toBe(false);
    });

    it("returns true when Chart.js dataset data array exceeds 2000", () => {
      const huge = new Array(2001).fill(1);
      const config = { data: { datasets: [{ data: huge }] } };
      expect(checkRowCountExceeded(config)).toBe(true);
    });
  });

  describe("sanitizeChartConfig", () => {
    it("strips function/callback values via JSON clone", () => {
      const input = {
        type: "bar",
        data: { datasets: [{ data: [1, 2] }] },
        options: { onClick: () => {}, title: { display: true } },
      };
      const sanitized = sanitizeChartConfig(input) as TestChartConfig;
      expect(sanitized.options.onClick).toBeUndefined();
      expect(sanitized.options.title).toEqual({ display: true });
    });

    it("removes remote data.url", () => {
      const input = {
        type: "line",
        data: {
          datasets: [
            { data: [1], url: "http://evil.com/data.json" },
            { data: [2] },
          ],
        },
      };
      const sanitized = sanitizeChartConfig(input) as TestChartConfig;
      expect(sanitized.data.datasets[0].url).toBeUndefined();
      expect(sanitized.data.datasets[1].data).toEqual([2]);
    });

    it("caps datasets at 50", () => {
      const datasets = Array.from({ length: 60 }, (_, i) => ({ data: [i] }));
      const input = { type: "bar", data: { datasets } };
      const sanitized = sanitizeChartConfig(input) as TestChartConfig;
      expect(sanitized.data.datasets).toHaveLength(50);
    });

    it("caps each dataset's data array at 2000", () => {
      const huge = new Array(3000).fill(1);
      const input = { type: "bar", data: { datasets: [{ data: huge }] } };
      const sanitized = sanitizeChartConfig(input) as TestChartConfig;
      expect(sanitized.data.datasets[0].data).toHaveLength(2000);
    });

    it("preserves a time-scale x-axis", () => {
      const input = {
        type: "line",
        data: { datasets: [{ data: [{ x: "2026-01-15T08:00:00Z", y: 1 }] }] },
        options: { scales: { xAxes: [{ type: "time", time: { unit: "hour" } }] } },
      };
      const sanitized = sanitizeChartConfig(input) as TestChartConfig;
      expect(sanitized.options.scales!.xAxes![0].type).toBe("time");
      expect(sanitized.options.scales!.xAxes![0].time!.unit).toBe("hour");
    });
  });

  describe("checkAxisIdMismatch", () => {
    it("returns null for config with no xAxisID/yAxisID on any dataset", () => {
      const config = {
        type: "bar",
        data: {
          labels: ["A", "B"],
          datasets: [{ label: "Qty", data: [1, 2] }],
        },
      };
      expect(checkAxisIdMismatch(config)).toBeNull();
    });

    it("returns null for a valid dual-axis config where both yAxisIDs are declared in options.scales.yAxes", () => {
      const config = {
        type: "bar",
        data: {
          labels: ["A", "B"],
          datasets: [
            { label: "Quantity", data: [3, 1], yAxisID: "qty-axis" },
            { label: "Price", data: [12.99, 8.5], yAxisID: "price-axis" },
          ],
        },
        options: {
          scales: {
            yAxes: [
              { id: "qty-axis", position: "left" },
              { id: "price-axis", position: "right" },
            ],
          },
        },
      };
      expect(checkAxisIdMismatch(config)).toBeNull();
    });

    it("returns a string containing datasets[1].yAxisID and price-axis for repro config", () => {
      const config = {
        type: "bar",
        data: {
          labels: ["A", "B"],
          datasets: [
            { label: "Quantity", data: [3, 1], yAxisID: "qty-axis" },
            { label: "Price", data: [12.99, 8.5], yAxisID: "price-axis" },
          ],
        },
        options: {
          scales: {
            yAxes: [{ id: "qty-axis", position: "left" }],
          },
        },
      };
      const result = checkAxisIdMismatch(config);
      expect(result).toContain("data.datasets[1].yAxisID");
      expect(result).toContain("price-axis");
    });

    it("returns a string containing datasets[0].xAxisID for an analogous xAxisID mismatch", () => {
      const config = {
        type: "bar",
        data: {
          labels: ["A", "B"],
          datasets: [
            { label: "Quantity", data: [3, 1], xAxisID: "x-axis-missing" },
          ],
        },
        options: {
          scales: {
            xAxes: [{ id: "x-axis-exists" }],
          },
        },
      };
      const result = checkAxisIdMismatch(config);
      expect(result).toContain("data.datasets[0].xAxisID");
      expect(result).toContain("x-axis-missing");
    });

    it("returns null for invalid configs or missing datasets", () => {
      expect(checkAxisIdMismatch(null)).toBeNull();
      expect(checkAxisIdMismatch("not an object")).toBeNull();
      expect(checkAxisIdMismatch({})).toBeNull();
      expect(checkAxisIdMismatch({ data: {} })).toBeNull();
      expect(checkAxisIdMismatch({ data: { datasets: "not an array" } })).toBeNull();
    });
  });

  describe("transformFinancialConfig", () => {
    it("rewrites candlestick → scatter carrier", () => {
      const input = { type: "candlestick", data: { datasets: [{ data: [{ x: 1, o: 10, h: 12, l: 9, c: 11 }] }] } };
      const out = transformFinancialConfig(input) as TestChartConfig;
      expect(out.type).toBe("scatter");
      const ds = out.data.datasets[0];
      expect(ds._ohlc).toHaveLength(1);
      expect(ds._finKind).toBe("candlestick");
      expect(ds.data).toEqual([{ x: 1, y: 12 }, { x: 1, y: 9 }]);
      expect(ds.pointRadius).toBe(0);
      expect(ds.showLine).toBe(false);
    });

    it("preserves _finKind ohlc", () => {
      const input = { type: "ohlc", data: { datasets: [{ data: [{ x: 1, o: 10, h: 12, l: 9, c: 11 }] }] } };
      const out = transformFinancialConfig(input) as TestChartConfig;
      expect(out.data.datasets[0]._finKind).toBe("ohlc");
    });

    it("is a no-op for non-financial types", () => {
      const input = { type: "bar", data: { datasets: [{ data: [1, 2] }] } };
      const out = transformFinancialConfig(input) as TestChartConfig;
      expect(out.type).toBe("bar");
      expect(out.data.datasets[0]._ohlc).toBeUndefined();
    });

    it("sanitizeChartConfig preserves _ohlc and options.annotation", () => {
      const candlestick = { type: "candlestick", data: { datasets: [{ data: [{ x: 1, o: 10, h: 12, l: 9, c: 11 }] }] }, options: { annotation: { lines: [{ axis: "y", value: 10.5 }] } } };
      const transformed = transformFinancialConfig(candlestick);
      const sanitized = sanitizeChartConfig(transformed) as TestChartConfig;
      expect(sanitized.data.datasets[0]._ohlc).toEqual([{ x: 1, o: 10, h: 12, l: 9, c: 11 }]);
      expect(sanitized.options.annotation!.lines!).toEqual([{ axis: "y", value: 10.5 }]);
    });
  });

  describe("payoffSeries / transformPayoffConfig", () => {
    it("payoffAt: long call P/L", () => {
      const legs = [{ kind: "call" as const, strike: 100, premium: 5 }];
      expect(payoffAt(legs, 120)).toBe(15);
      expect(payoffAt(legs, 100)).toBe(-5);
    });

    it("payoffAt: short put keeps premium above strike, loses below", () => {
      const legs = [{ kind: "put" as const, strike: 100, premium: 4, side: "short" as const }];
      expect(payoffAt(legs, 110)).toBe(4);
      expect(payoffAt(legs, 90)).toBe(-6);
    });

    it("payoffSeries: bull call spread vertices, breakeven, strikes", () => {
      const legs = [
        { kind: "call" as const, strike: 100, premium: 5, side: "long" as const },
        { kind: "call" as const, strike: 110, premium: 2, side: "short" as const },
      ];
      const s = payoffSeries(legs, [90, 120]);
      expect(s.points).toEqual([
        { x: 90, y: -3 },
        { x: 100, y: -3 },
        { x: 110, y: 7 },
        { x: 120, y: 7 },
      ]);
      expect(s.breakevens).toHaveLength(1);
      expect(s.breakevens[0]).toBeCloseTo(103, 9);
      expect(s.strikes).toEqual([100, 110]);
    });

    it("payoffSeries: auto price range pads around strikes", () => {
      const legs = [{ kind: "call" as const, strike: 100, premium: 5 }];
      const s = payoffSeries(legs);
      expect(s.points[0].x).toBeLessThan(100);
      expect(s.points[s.points.length - 1].x).toBeGreaterThan(100);
    });

    const BULL_CALL_SPREAD = {
      type: "payoff",
      data: { datasets: [] },
      options: {
        payoff: {
          legs: [
            { kind: "call", strike: 100, premium: 5, qty: 1, side: "long" },
            { kind: "call", strike: 110, premium: 2, qty: 1, side: "short" },
          ],
          priceRange: [90, 120],
        },
      },
    };

    it("transformPayoffConfig: rewrites payoff → scatter + annotations", () => {
      const out = transformPayoffConfig(BULL_CALL_SPREAD) as TestChartConfig;
      expect(out.type).toBe("scatter");
      expect(out.data.datasets).toHaveLength(1);
      expect(out.data.datasets[0].showLine).toBe(true);
      expect(out.data.datasets[0].pointRadius).toBe(0);
      const lines = out.options.annotation!.lines!;
      expect(lines).toContainEqual(expect.objectContaining({ axis: "y", value: 0 }));
      expect(lines.filter((l) => l.axis === "x" && l.label?.startsWith("K "))).toHaveLength(2);
      expect(lines.filter((l) => l.axis === "x" && l.label?.startsWith("BE "))).toHaveLength(1);
      const boxes = out.options.annotation!.boxes!;
      expect(boxes).toHaveLength(2);
      expect(boxes[0].color).toContain("239,83,80"); // red first (loss)
      expect(boxes[1].color).toContain("38,166,154"); // green second (profit)
      expect(out.options.payoff).toBeUndefined();
      expect(out.options.scales!.yAxes![0].ticks!.suggestedMin).toBeLessThanOrEqual(0);
      expect(out.options.scales!.yAxes![0].ticks!.suggestedMax).toBeGreaterThanOrEqual(0);
    });

    it("transformPayoffConfig: points path (no legs)", () => {
      const input = {
        type: "payoff",
        data: { datasets: [] },
        options: { payoff: { points: [{ x: 80, y: -5 }, { x: 120, y: 15 }] } },
      };
      const out = transformPayoffConfig(input) as TestChartConfig;
      expect(out.type).toBe("scatter");
      expect(out.data.datasets[0].data).toEqual([{ x: 80, y: -5 }, { x: 120, y: 15 }]);
      expect(out.options.annotation!.lines!).toContainEqual(expect.objectContaining({ axis: "y", value: 0 }));
      expect(out.options.annotation!.boxes!).toHaveLength(2);
    });

    it("transformPayoffConfig: merges agent-supplied annotation", () => {
      const input = {
        ...BULL_CALL_SPREAD,
        options: {
          ...BULL_CALL_SPREAD.options,
          annotation: { lines: [{ axis: "x", value: 105, label: "target" }] },
        },
      };
      const out = transformPayoffConfig(input) as TestChartConfig;
      expect(out.options.annotation!.lines!).toContainEqual(expect.objectContaining({ label: "target" }));
    });

    it("transformPayoffConfig: no-op for non-payoff types", () => {
      const input = { type: "bar", data: { datasets: [{ data: [1, 2] }] } };
      const out = transformPayoffConfig(input) as TestChartConfig;
      expect(out.type).toBe("bar");
      expect(out.options).toBeUndefined();
    });

    it("sanitizeChartConfig preserves options.payoff.legs", () => {
      const sanitized = sanitizeChartConfig(BULL_CALL_SPREAD) as TestChartConfig;
      expect(sanitized.options.payoff!.legs!).toHaveLength(2);
    });
  });

  describe("pnl / equity / drawdown", () => {
    const RETURNS = [200, -150, -180, 120, 260, -90, 300];

    it("cumulativeSeries: running total + start offset", () => {
      const out = cumulativeSeries(RETURNS);
      expect(out.map((p) => p.y)).toEqual([200, 50, -130, -10, 250, 160, 460]);
      expect(out.map((p) => p.x)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      const shifted = cumulativeSeries(RETURNS, { start: 1000 });
      expect(shifted.map((p) => p.y)).toEqual([1200, 1050, 870, 990, 1250, 1160, 1460]);
    });

    it("pnlSeries: equity levels pass through; returns become cumulative", () => {
      const eq = pnlSeries({ equity: [10, 20] });
      expect(eq.points.map((p) => p.y)).toEqual([10, 20]);
      const ret = pnlSeries({ returns: [10, 10] });
      expect(ret.points.map((p) => p.y)).toEqual([10, 20]);
    });

    it("pnlSeries: temporal true for ISO x, false for numeric", () => {
      const iso = pnlSeries({ equity: [10, 20], x: ["2026-01-01", "2026-01-02"] });
      expect(iso.temporal).toBe(true);
      const numeric = pnlSeries({ equity: [10, 20], x: [0, 1] });
      expect(numeric.temporal).toBe(false);
    });

    it("splitAtZero: inserts an interpolated zero crossing", () => {
      const { line, positive, negative } = splitAtZero([{ x: 0, y: 10 }, { x: 2, y: -10 }]);
      expect(line).toEqual([{ x: 0, y: 10 }, { x: 1, y: 0 }, { x: 2, y: -10 }]);
      expect(positive.map((p) => p.y)).toEqual([10, 0, 0]);
      expect(negative.map((p) => p.y)).toEqual([0, 0, -10]);
    });

    it("splitAtZero: all-positive series has no crossing, negative carrier all 0", () => {
      const { line, negative } = splitAtZero([{ x: 0, y: 10 }, { x: 1, y: 20 }]);
      expect(line).toHaveLength(2);
      expect(negative.every((p) => p.y === 0)).toBe(true);
    });

    it("drawdownSeries: absolute and percent", () => {
      const points = [100, 120, 90, 130].map((y, x) => ({ x, y }));
      const abs = drawdownSeries(points);
      expect(abs.map((p) => p.y)).toEqual([0, 0, -30, 0]);
      const pct = drawdownSeries(points, { percent: true });
      expect(pct.map((p) => p.y)).toEqual([0, 0, -25, 0]);
    });

    it("runningPeak: high-water mark", () => {
      expect(runningPeak([100, 120, 90, 130])).toEqual([100, 120, 120, 130]);
    });

    const EQUITY_CONFIG = {
      type: "equity",
      data: { datasets: [] },
      options: {
        pnl: {
          returns: RETURNS,
          x: ["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30", "2026-02-06", "2026-02-13"],
        },
      },
    };

    it("transformPnlConfig: equity → scatter + split fills + zero line", () => {
      const out = transformPnlConfig(EQUITY_CONFIG) as TestChartConfig;
      expect(out.type).toBe("scatter");
      expect(out.data.datasets).toHaveLength(3);
      expect(out.data.datasets[0].fill).toBe("origin");
      expect(out.data.datasets[1].fill).toBe("origin");
      expect(out.data.datasets[2].fill).toBe(false);
      expect(out.options.annotation!.lines!).toContainEqual(expect.objectContaining({ axis: "y", value: 0 }));
      expect(out.options.scales!.yAxes![0].ticks!.suggestedMin).toBeLessThanOrEqual(0);
      expect(out.options.scales!.yAxes![0].ticks!.suggestedMax).toBeGreaterThanOrEqual(0);
      expect(out.options.legend!.display!).toBe(false);
      expect(out.options.pnl).toBeUndefined();
      expect(out.options.scales!.xAxes![0].type).toBe("time");
    });

    it("transformPnlConfig: drawdown → single red underwater fill", () => {
      const input = {
        type: "drawdown",
        data: { datasets: [] },
        options: { pnl: { equity: [10000, 10250, 10120, 9800, 9950, 10400, 10150, 10600], percent: true } },
      };
      const out = transformPnlConfig(input) as TestChartConfig;
      expect(out.type).toBe("scatter");
      expect(out.data.datasets).toHaveLength(1);
      expect(out.data.datasets[0].fill).toBe("origin");
      expect(out.data.datasets[0].data.every((d) => (d.y ?? 0) <= 0)).toBe(true);
      expect(out.options.annotation!.lines!).toContainEqual(expect.objectContaining({ axis: "y", value: 0 }));
      expect(out.options.pnl).toBeUndefined();
    });

    it("transformPnlConfig: merges agent-supplied annotation", () => {
      const input = {
        ...EQUITY_CONFIG,
        options: {
          ...EQUITY_CONFIG.options,
          annotation: { lines: [{ axis: "x", value: 2, label: "entry" }] },
        },
      };
      const out = transformPnlConfig(input) as TestChartConfig;
      expect(out.options.annotation!.lines!).toContainEqual(expect.objectContaining({ label: "entry" }));
      expect(out.options.annotation!.lines!).toContainEqual(expect.objectContaining({ axis: "y", value: 0 }));
    });

    it("transformPnlConfig: no-op for non-pnl types", () => {
      const input = { type: "bar", data: { datasets: [{ data: [1, 2] }] } };
      const out = transformPnlConfig(input) as TestChartConfig;
      expect(out.type).toBe("bar");
      expect(out.options).toBeUndefined();
    });

    it("sanitizeChartConfig preserves options.pnl.returns", () => {
      const sanitized = sanitizeChartConfig(EQUITY_CONFIG) as TestChartConfig;
      expect(sanitized.options.pnl!.returns!).toHaveLength(7);
    });
  });

  describe("waterfall", () => {
    it("waterfallSeries: mixed steps → base/delta/cumulative/kind", () => {
      const { bars, total } = waterfallSeries([
        { label: "Open", value: 1000 },
        { label: "Fees", value: -120 },
        { label: "Gains", value: 640 },
      ]);
      expect(bars[0]).toMatchObject({ base: 0, delta: 1000, cumulative: 1000, kind: "increase" });
      expect(bars[1]).toMatchObject({ base: 880, delta: 120, cumulative: 880, kind: "decrease" });
      expect(bars[2]).toMatchObject({ base: 880, delta: 640, cumulative: 1520, kind: "increase" });
      expect(total).toBe(1520);
    });

    it("waterfallSeries: auto total + start offset", () => {
      const { bars, labels, total } = waterfallSeries(
        [{ label: "Open", value: 1000 }, { label: "Fees", value: -120 }],
        { start: 500, total: "Net" },
      );
      expect(bars[0].base).toBe(500);
      const last = bars[bars.length - 1];
      expect(last).toMatchObject({ label: "Net", base: 0, delta: total, kind: "total" });
      expect(labels[labels.length - 1]).toBe("Net");
    });

    it("waterfallSeries: isTotal step spans 0..cumulative", () => {
      const { bars } = waterfallSeries([
        { label: "Open", value: 1000 },
        { label: "Running total", value: 0, isTotal: true },
        { label: "Fees", value: -120 },
      ]);
      expect(bars[1]).toMatchObject({ base: 0, delta: 1000, kind: "total" });
      expect(bars[2]).toMatchObject({ base: 880, delta: 120, kind: "decrease" });
    });

    const WATERFALL_CONFIG = {
      type: "waterfall",
      data: { datasets: [] },
      options: {
        waterfall: {
          start: 0,
          steps: [
            { label: "Open", value: 1000 },
            { label: "Fees", value: -120 },
            { label: "Gains", value: 640 },
            { label: "Slippage", value: -80 },
          ],
          total: "Net P&L",
        },
      },
    };

    it("transformWaterfallConfig: rewrites → stacked bar, 2 datasets, colors", () => {
      const out = transformWaterfallConfig(WATERFALL_CONFIG) as TestChartConfig;
      expect(out.type).toBe("bar");
      expect(out.data.datasets).toHaveLength(2);
      expect(out.data.datasets[0].backgroundColor).toBe("rgba(0,0,0,0)");
      const colors = out.data.datasets[1].backgroundColor;
      expect(Array.isArray(colors)).toBe(true);
      expect(colors).toEqual(["#26a69a", "#ef5350", "#26a69a", "#ef5350", "#546e7a"]);
      expect(out.options.scales!.xAxes![0].stacked).toBe(true);
      expect(out.options.scales!.yAxes![0].stacked).toBe(true);
      expect(out.options.legend!.display!).toBe(false);
      expect(out.options.waterfall).toBeUndefined();
    });

    it("transformWaterfallConfig: showTotalLine adds one y annotation line", () => {
      const withLine = transformWaterfallConfig({
        ...WATERFALL_CONFIG,
        options: { waterfall: { ...WATERFALL_CONFIG.options.waterfall, showTotalLine: true } },
      }) as TestChartConfig;
      expect(withLine.options.annotation!.lines!).toHaveLength(1);
      // start(0) + 1000 - 120 + 640 - 80 = 1440, then the auto-appended "Net P&L" total bar also = 1440.
      expect(withLine.options.annotation!.lines![0]).toMatchObject({ axis: "y", value: 1440 });

      const withoutLine = transformWaterfallConfig(WATERFALL_CONFIG) as TestChartConfig;
      expect(withoutLine.options.annotation).toBeUndefined();
    });

    it("transformWaterfallConfig: no-op for non-waterfall types", () => {
      const input = { type: "bar", data: { datasets: [{ data: [1, 2] }] } };
      const out = transformWaterfallConfig(input) as TestChartConfig;
      expect(out).toEqual(input);
    });

    it("sanitizeChartConfig preserves options.waterfall.steps", () => {
      const sanitized = sanitizeChartConfig(WATERFALL_CONFIG) as TestChartConfig;
      expect(sanitized.options.waterfall!.steps!).toHaveLength(4);
    });
  });

});
