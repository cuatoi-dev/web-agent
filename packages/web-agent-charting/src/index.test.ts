import { describe, it, expect } from "vitest";
import { chartingTools } from "./index.js";

describe("Charting Package Entrypoint", () => {
  it("chartingTools() returns show_chart and show_live_chart tool configs", () => {
    const tools = chartingTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("show_chart");
    expect(names).toContain("show_live_chart");

    const showChart = tools.find((t) => t.name === "show_chart")!;
    expect(showChart.promptSnippet).toBeUndefined();
    expect(showChart.description).toContain('load_skill("chart")');
    // 005: the description must warn that the config is a snapshot and point
    // at a live chart tool for data-source data.
    expect(showChart.description).toMatch(/never refreshes/i);
    expect(showChart.description).toMatch(/live chart tool/i);

    const showLiveChart = tools.find((t) => t.name === "show_live_chart")!;
    expect(showLiveChart.description).toContain('load_skill("chart")');
    expect(showLiveChart.description).toMatch(/self-refreshing/i);
    expect(showLiveChart.description).toMatch(/data source/i);
  });
});
