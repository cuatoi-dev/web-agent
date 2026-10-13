import { describe, it, expect } from "vitest";
import { runShowChart, SHOW_CHART_SCHEMA } from "./show-chart.js";
import { validateChartSchema } from "../ui-blocks/validate-chart.js";
import type { RenderableBlock } from "@cuatoi/web-agent-core";

/** The shape the tests below read off `out.block` — narrower than the full
 *  `RenderableBlock` union, just the chart plugin's own fields. */
interface TestChartBlock {
  title?: string;
  config?: {
    type?: string;
    data?: { datasets?: Array<Record<string, unknown>> };
    options?: { scales?: { yAxes?: unknown[] } };
  };
  spec?: unknown;
}
function chartBlock(block: RenderableBlock | undefined): TestChartBlock {
  return block as unknown as TestChartBlock;
}

const BAR_CONFIG = {
  type: "bar",
  data: {
    labels: ["Jan", "Feb", "Mar"],
    datasets: [{ label: "Revenue", data: [100, 200, 150] }],
  },
};

const PIE_CONFIG = {
  type: "pie",
  data: {
    labels: ["A", "B"],
    datasets: [{ data: [60, 40] }],
  },
};

const SCATTER_CONFIG = {
  type: "scatter",
  data: {
    datasets: [{ label: "pts", data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
  },
};

describe("SHOW_CHART_SCHEMA", () => {
  it("accepts valid bar config", async () => {
    expect(await validateChartSchema("", SHOW_CHART_SCHEMA, { config: BAR_CONFIG })).toBeNull();
  });

  it("accepts config with optional title", async () => {
    expect(await validateChartSchema("", SHOW_CHART_SCHEMA, { title: "My Chart", config: BAR_CONFIG })).toBeNull();
  });

  it("rejects missing config", async () => {
    expect(await validateChartSchema("", SHOW_CHART_SCHEMA, { title: "No config" })).not.toBeNull();
  });

  it("rejects unknown type", async () => {
    const err = await validateChartSchema("", SHOW_CHART_SCHEMA, {
      config: { type: "heatmap", data: { datasets: [] } },
    });
    expect(err).not.toBeNull();
  });

  it("rejects extra top-level keys (additionalProperties: false)", async () => {
    const err = await validateChartSchema("", SHOW_CHART_SCHEMA, { config: BAR_CONFIG, extra: "bad" });
    expect(err).not.toBeNull();
  });
});

describe("runShowChart", () => {
  it("valid bar config — returns block with type chart and config", async () => {
    const out = await runShowChart({ config: BAR_CONFIG });
    expect(out.content).toBe("chart rendered");
    expect(out.isError).toBeFalsy();
    expect(out.block?.type).toBe("chart");
    expect(chartBlock(out.block).config?.type).toBe("bar");
  });

  it("valid pie config — returns block", async () => {
    const out = await runShowChart({ config: PIE_CONFIG });
    expect(out.content).toBe("chart rendered");
    expect(out.block?.type).toBe("chart");
  });

  it("valid scatter config — returns block", async () => {
    const out = await runShowChart({ config: SCATTER_CONFIG });
    expect(out.content).toBe("chart rendered");
    expect(out.block?.type).toBe("chart");
  });

  it("optional title propagated to block", async () => {
    const out = await runShowChart({ title: "Rev Chart", config: BAR_CONFIG });
    expect(chartBlock(out.block).title).toBe("Rev Chart");
  });

  it("missing title omitted from block", async () => {
    const out = await runShowChart({ config: BAR_CONFIG });
    expect(chartBlock(out.block).title).toBeUndefined();
  });

  it("invalid config type — returns isError with config path", async () => {
    const out = await runShowChart(
      { config: { type: "heatmap", data: { datasets: [] } } },
    );
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/config\./);
  });

  it("missing config field — returns isError", async () => {
    const out = await runShowChart({ config: { data: { datasets: [] } } });
    expect(out.isError).toBe(true);
  });

  it("blocks remote data URL in dataset", async () => {
    const cfg = {
      type: "bar",
      data: {
        labels: ["A"],
        datasets: [{ data: [1], url: "https://evil.example.com/data.json" }],
      },
    };
    const out = await runShowChart({ config: cfg });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/external data URLs/);
  });

  it("blocks dataset exceeding 2000 rows", async () => {
    const bigData = Array.from({ length: 2001 }, (_, i) => i);
    const cfg = {
      type: "bar",
      data: {
        labels: bigData.map(String),
        datasets: [{ data: bigData }],
      },
    };
    const out = await runShowChart({ config: cfg });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/2 000-row limit/);
  });

  it("sanitizer strips function values (JSON-clone)", async () => {
    const cfg = {
      type: "line",
      data: {
        labels: ["A"],
        datasets: [{ data: [1], customFn: () => "bad" }],
      },
    };
    const out = await runShowChart({ config: cfg });
    // Functions stripped by JSON.parse/stringify — chart still renders
    expect(out.content).toBe("chart rendered");
    expect(chartBlock(out.block).config?.data?.datasets?.[0]?.customFn).toBeUndefined();
  });

  it("config written to block.config, not block.spec", async () => {
    const out = await runShowChart({ config: BAR_CONFIG });
    expect(chartBlock(out.block).config).toBeDefined();
    expect(chartBlock(out.block).spec).toBeUndefined();
  });

  it("blocks dataset with undeclared yAxisID", async () => {
    const cfg = {
      type: "bar",
      data: {
        labels: ["Premium Cat Food", "Cat Toy Mouse"],
        datasets: [
          { label: "Quantity", data: [3, 1], yAxisID: "qty-axis" },
          { label: "Price ($)", data: [12.99, 8.5], yAxisID: "price-axis" }
        ]
      },
      options: {
        scales: { yAxes: [{ id: "qty-axis", position: "left" }] }
      }
    };
    const out = await runShowChart({ config: cfg });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/config\.data\.datasets\[1\]\.yAxisID.*price-axis/);
  });

  it("allows dual-axis config when both axes are declared", async () => {
    const cfg = {
      type: "bar",
      data: {
        labels: ["Premium Cat Food", "Cat Toy Mouse"],
        datasets: [
          { label: "Quantity", data: [3, 1], yAxisID: "qty-axis" },
          { label: "Price ($)", data: [12.99, 8.5], yAxisID: "price-axis" }
        ]
      },
      options: {
        scales: {
          yAxes: [
            { id: "qty-axis", position: "left" },
            { id: "price-axis", position: "right" }
          ]
        }
      }
    };
    const out = await runShowChart({ config: cfg });
    expect(out.content).toBe("chart rendered");
    expect(out.isError).toBeFalsy();
    expect(chartBlock(out.block).config?.options?.scales?.yAxes).toHaveLength(2);
  });
});