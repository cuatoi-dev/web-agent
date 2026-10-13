import { describe, it, expect } from "vitest";
import Chart from "chart.js";
import { financePlugin } from "./finance-charts.js";
import type { FinanceChart } from "./finance-charts.js";

describe("financePlugin", () => {
  it("U5: annotation labels draw with the themed canvas text colour and family", () => {
    Chart.defaults = {
      global: {
        defaultFontColor: "rgb(9, 9, 9)",
        defaultFontFamily: '"Sentinel Sans", sans-serif',
      },
    } as typeof Chart.defaults;

    let setFillStyle = "";
    let setFont = "";
    let setStrokeStyle = "";
    const ctxRecorder: Partial<CanvasRenderingContext2D> & { lineWidth: number } = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fillText: () => {},
      setLineDash: () => {},
      set fillStyle(val: string) { setFillStyle = val; },
      get fillStyle() { return setFillStyle; },
      set font(val: string) { setFont = val; },
      get font() { return setFont; },
      set strokeStyle(val: string) { setStrokeStyle = val; },
      get strokeStyle() { return setStrokeStyle; },
      lineWidth: 1,
    };

    const fakeChart = {
      ctx: ctxRecorder,
      chartArea: { left: 0, right: 100, top: 0, bottom: 100 },
      scales: {
        "x-axis-0": { getPixelForValue: () => 50 },
        "y-axis-0": { getPixelForValue: () => 50 },
      },
      data: { datasets: [] },
      options: {
        annotation: {
          lines: [{ axis: "y", value: 1, label: "threshold" }] as { axis: string; value: number; label: string; color?: string }[],
        },
      },
    };

    financePlugin.afterDatasetsDraw(fakeChart as unknown as FinanceChart);

    expect(setFillStyle).toBe("rgb(9, 9, 9)");
    expect(setFont).toBe('11px "Sentinel Sans", sans-serif');
    expect(setStrokeStyle).toBe("#888");

    // Supplied line.color case
    fakeChart.options.annotation.lines[0].color = "#6200ee";
    financePlugin.afterDatasetsDraw(fakeChart as unknown as FinanceChart);
    expect(setFillStyle).toBe("#6200ee");
  });
});
