import { describe, it, expect } from "vitest";
import { ChartConfigSchema, ChartEncodingSchema } from "./chart-schema.js";
import { validateChartSchema, validateChartBlock } from "./validate-chart.js";
import { normalizeChartConfig } from "./chart-normalize.js";
import { validateRenderableBlock } from "@cuatoi/web-agent-core";

describe("ChartEncodingSchema", () => {
  it("accepts valid ChartEncoding with mark, x, y", async () => {
    const err = await validateChartSchema("", ChartEncodingSchema, {
      mark: "bar",
      x: { field: "category" },
      y: { field: "revenue", type: "quantitative", title: "Revenue" },
    });
    expect(err).toBeNull();
  });

  it("accepts encoding with color grouping channel", async () => {
    const err = await validateChartSchema("", ChartEncodingSchema, {
      mark: "line",
      x: { field: "month" },
      y: { field: "revenue" },
      color: { field: "region" },
    });
    expect(err).toBeNull();
  });

  it("accepts encoding with financial channels (open, high, low, close)", async () => {
    const err = await validateChartSchema("", ChartEncodingSchema, {
      mark: "candlestick",
      x: { field: "date" },
      open: { field: "open" },
      high: { field: "high" },
      low: { field: "low" },
      close: { field: "close" },
    });
    expect(err).toBeNull();
  });

  it("accepts encoding with theta channel for pie/arc", async () => {
    const err = await validateChartSchema("", ChartEncodingSchema, {
      mark: "arc",
      theta: { field: "count" },
      color: { field: "category" },
    });
    expect(err).toBeNull();
  });

  it("rejects encoding with unknown channels", async () => {
    const err = await validateChartSchema("", ChartEncodingSchema, {
      mark: "bar",
      x: { field: "category" },
      bogus: { field: "nope" },
    });
    expect(err).not.toBeNull();
  });

  it("rejects a channel with unknown keys", async () => {
    const err = await validateChartSchema("", ChartEncodingSchema, {
      mark: "bar",
      x: { field: "category", bogus: true },
    });
    expect(err).not.toBeNull();
  });

  it("ChartBlockSchema accepts query + encoding without deprecation warnings", async () => {
    const raw = {
      type: "chart",
      query: { source: "products" },
      encoding: { mark: "bar", x: { field: "category" }, y: { field: "price", title: "Shelf price" } },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });
});

describe("ChartBlockSchema", () => {
  it("accepts legacy spec-only chart", async () => {
    const raw = { type: "chart", spec: { mark: "bar", data: { values: [] } } };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts query+encoding chart", async () => {
    const raw = {
      type: "chart",
      title: "Revenue by Month",
      query: { source: "orders", aggregate: { groupBy: [{ field: "month" }], measures: [{ op: "count" }] } },
      encoding: { mark: "bar", x: { field: "month", type: "nominal" }, y: { field: "count", type: "quantitative" } },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("rejects chart with neither spec, config, nor query", async () => {
    const raw = { type: "chart", title: "Empty" };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(false);
  });

  it("accepts chart with both spec and (query+encoding) (deprecated fields)", async () => {
    const raw = {
      type: "chart",
      spec: { mark: "bar" },
      query: { source: "orders" },
      encoding: { mark: "line", x: { field: "d", type: "temporal" }, y: { field: "v", type: "quantitative" } },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts arc encoding with theta and color", async () => {
    // theta/color are EncodingSimpleChannelSchema (field + title only) — no `type` key.
    const raw = {
      type: "chart",
      query: { source: "orders" },
      encoding: {
        mark: "arc",
        theta: { field: "count" },
        color: { field: "category" }
      }
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts Chart.js config-only chart", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "bar",
        data: {
          labels: ["A", "B"],
          datasets: [{ data: [1, 2] }],
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts scatter config with point-object data", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "scatter",
        data: {
          datasets: [{ data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts bubble config with point-object data including r", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "bubble",
        data: {
          datasets: [{ data: [{ x: 1, y: 2, r: 5 }, { x: 3, y: 4, r: 8 }] }],
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts candlestick config with OHLC data points", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "candlestick",
        data: {
          datasets: [{ data: [{ x: "2026-01-05", o: 100, h: 104, l: 99, c: 103 }] }],
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts ohlc type", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "ohlc",
        data: {
          datasets: [{ data: [{ x: "2026-01-05", o: 100, h: 104, l: 99, c: 103 }] }],
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts options.annotation passthrough", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "bar",
        data: { labels: ["A"], datasets: [{ data: [1] }] },
        options: { annotation: { lines: [{ axis: "y", value: 5 }] } },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts a payoff config with options.payoff.legs", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "payoff",
        data: { datasets: [] },
        options: {
          payoff: {
            legs: [{ kind: "call", strike: 100, premium: 5, side: "long" }],
          },
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts an equity config with options.pnl.returns", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "equity",
        data: { datasets: [] },
        options: {
          pnl: { returns: [200, -150, -180, 120, 260, -90, 300] },
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts a drawdown config with options.pnl.equity", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "drawdown",
        data: { datasets: [] },
        options: {
          pnl: { equity: [10000, 10250, 10120, 9800], percent: true },
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts a waterfall config with options.waterfall.steps", async () => {
    const raw = {
      type: "chart",
      config: {
        type: "waterfall",
        data: { datasets: [] },
        options: {
          waterfall: {
            steps: [
              { label: "Open", value: 1000 },
              { label: "Fees", value: -120 },
            ],
          },
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("accepts a dual-axis volume config (bar+line, two yAxes)", async () => {
    const raw = {
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
        options: {
          scales: {
            yAxes: [
              { id: "price", position: "left" },
              { id: "volume", position: "right" },
            ],
          },
        },
      },
    };
    const res = await validateChartBlock(raw);
    expect(res.ok).toBe(true);
  });

  it("a query+encoding chart validates through core's RenderableBlockSchema (plugin passthrough)", async () => {
    const raw = { type: "chart", query: { source: "orders" },
      encoding: { mark: "area", x: { field: "d", type: "temporal" }, y: { field: "v", type: "quantitative" } } };
    const r = await validateRenderableBlock(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("chart");
  });

  describe("wrapped scalar and label unwrapping", () => {
    it("unwraps {$text: '45'} wrapped data scalars into numbers", async () => {
      const raw = {
        type: "bar",
        data: {
          labels: ["Q1", "Q2"],
          datasets: [{ data: [{ $text: "45" }, { $text: "60" }] }],
        },
      };
      const normalized = normalizeChartConfig(raw) as { data: { datasets: { data: unknown[] }[] } };
      expect(normalized.data.datasets[0].data).toEqual([45, 60]);
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });

    it("unwraps {$text: '3.99'} wrapped decimal scalars into decimal numbers", async () => {
      const raw = {
        type: "bar",
        data: {
          labels: ["Salmon Pâté", "Tuna Crunch"],
          datasets: [{ data: [{ $text: "3.99" }, { $text: "12.50" }] }],
        },
      };
      const normalized = normalizeChartConfig(raw) as { data: { datasets: { data: unknown[] }[] } };
      const d0 = normalized.data.datasets[0].data[0];
      const d1 = normalized.data.datasets[0].data[1];
      expect(d0).toBe(3.99);
      expect(typeof d0).toBe("number");
      expect(d1).toBe(12.5);
      expect(typeof d1).toBe("number");
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });

    it("asserts parsed value and typeof 'number' for wrapped integers and decimals", async () => {
      const raw = {
        type: "bar",
        data: {
          labels: ["Product A", "Product B"],
          datasets: [{ data: [{ $text: "3.99" }, { $text: "45" }] }],
        },
      };
      const normalized = normalizeChartConfig(raw) as { data: { datasets: { data: unknown[] }[] } };
      const d0 = normalized.data.datasets[0].data[0];
      const d1 = normalized.data.datasets[0].data[1];
      expect(d0).toBe(3.99);
      expect(typeof d0).toBe("number");
      expect(d1).toBe(45);
      expect(typeof d1).toBe("number");
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });

    it("preserves string dataset label and category labels without forcing numbers", async () => {
      const raw = {
        type: "bar",
        data: {
          labels: ["2024", "2025"],
          datasets: [{ label: "2024", data: [100, 200] }],
        },
      };
      const normalized = normalizeChartConfig(raw) as {
        data: { labels: unknown[]; datasets: { label: unknown }[] };
      };
      expect(normalized.data.datasets[0].label).toBe("2024");
      expect(typeof normalized.data.datasets[0].label).toBe("string");
      expect(normalized.data.labels).toEqual(["2024", "2025"]);
      expect(typeof normalized.data.labels[0]).toBe("string");
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });

    it("validates plain numeric arrays unchanged", async () => {
      const raw = {
        type: "line",
        data: {
          datasets: [{ data: [45, 60] }],
        },
      };
      const normalized = normalizeChartConfig(raw) as { data: { datasets: { data: unknown[] }[] } };
      expect(normalized.data.datasets[0].data).toEqual([45, 60]);
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });

    it("validates point objects and OHLC objects unchanged", async () => {
      const raw = {
        type: "scatter",
        data: {
          datasets: [
            { data: [{ x: 10, y: 20 }] },
            { data: [{ x: "2026-01-01", o: 10, h: 15, l: 8, c: 12 }] },
          ],
        },
      };
      const normalized = normalizeChartConfig(raw) as { data: { datasets: { data: unknown[] }[] } };
      expect(normalized.data.datasets[0].data).toEqual([{ x: 10, y: 20 }]);
      expect(normalized.data.datasets[1].data).toEqual([{ x: "2026-01-01", o: 10, h: 15, l: 8, c: 12 }]);
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });

    it("validates null data points for gaps", async () => {
      const raw = {
        type: "line",
        data: {
          datasets: [{ data: [10, null, 30] }],
        },
      };
      const normalized = normalizeChartConfig(raw) as { data: { datasets: { data: unknown[] }[] } };
      expect(normalized.data.datasets[0].data).toEqual([10, null, 30]);
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });

    it("preserves non-numeric strings as category strings", async () => {
      const raw = {
        type: "bar",
        data: {
          datasets: [{ data: ["categoryA", "categoryB"] }],
        },
      };
      const normalized = normalizeChartConfig(raw) as { data: { datasets: { data: unknown[] }[] } };
      expect(normalized.data.datasets[0].data).toEqual(["categoryA", "categoryB"]);
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });

    it("unwraps {$text: '...'} wrapped labels", async () => {
      const raw = {
        type: "bar",
        data: {
          labels: [{ $text: "Mon" }, { $text: "Tue" }],
          datasets: [{ data: [100, 200] }],
        },
      };
      const normalized = normalizeChartConfig(raw) as { data: { labels: unknown[] } };
      expect(normalized.data.labels).toEqual(["Mon", "Tue"]);
      expect(await validateChartSchema("", ChartConfigSchema, normalized)).toBeNull();
    });
  });
});
