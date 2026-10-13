import { describe, it, expect } from "vitest";
import { normalizeChartConfig } from "./chart-normalize.js";

describe("normalizeChartConfig", () => {
  it("applies coercions in order: whole-config unwrap, then labels, then data points, then options", () => {
    const raw = {
      $text: {
        type: "bar",
        data: {
          labels: [{ $text: "Q1" }, { $text: "Q2" }],
          datasets: [{ data: [{ $text: "45" }, { $text: "60" }] }],
        },
        options: { $text: "true" },
      },
    };
    const normalized = normalizeChartConfig(raw) as {
      type: string;
      data: { labels: unknown[]; datasets: { data: unknown[] }[] };
      options: unknown;
    };
    expect(normalized.type).toBe("bar");
    expect(normalized.data.labels).toEqual(["Q1", "Q2"]);
    expect(normalized.data.datasets[0].data).toEqual([45, 60]);
    expect(normalized.options).toBe(true);
  });

  it("is idempotent — normalizing an already-normalized config changes nothing", () => {
    const raw = {
      type: "bar",
      data: {
        labels: ["Q1", "Q2"],
        datasets: [{ data: [45, 60] }],
      },
      options: { scales: { yAxes: [{ id: "a" }] } },
    };
    const once = normalizeChartConfig(raw);
    const twice = normalizeChartConfig(once);
    expect(twice).toEqual(once);
  });

  it("leaves a config with no wrapped values byte-identical", () => {
    const raw = {
      type: "line",
      data: {
        labels: ["Mon", "Tue"],
        datasets: [{ data: [1, 2], label: "series" }],
      },
      options: { annotation: { lines: [] } },
    };
    expect(normalizeChartConfig(raw)).toEqual(raw);
  });
});
