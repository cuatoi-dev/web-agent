import { vi, describe, it, expect } from "vitest";

vi.mock("chart.js", () => {
  const MockChart = vi.fn().mockImplementation((_ctx: unknown, config: unknown) => {
    const cfg = config as { data?: unknown } | null | undefined;
    return { destroy: vi.fn(), update: vi.fn(), data: cfg?.data ?? {} };
  });
  (MockChart as unknown as { defaults: unknown }).defaults = {
    global: { defaultFontColor: "#666", defaultFontFamily: "sans-serif" },
    scale: { ticks: {}, gridLines: { color: "rgba(0, 0, 0, 0.1)", zeroLineColor: "rgba(0,0,0,0.25)" } },
  };
  return { default: MockChart };
});

import { BlockRendererRegistry, generativeUiRenderer } from "@cuatoi/web-agent-lit";
import { chartRenderer } from "./chart-renderer.js";
import { chartingTools, chartingSkills } from "../index.js";
import { SHOW_CHART_SCHEMA } from "../tools/show-chart.js";
import { chartingRenderers } from "./index.js";
import type { RenderableBlock, ToolContext } from "@cuatoi/web-agent-core";

const BAR_CONFIG = {
  type: "bar",
  data: {
    labels: ["Jan", "Feb", "Mar"],
    datasets: [{ label: "Revenue", data: [100, 200, 150] }],
  },
};

function mockCtx(): ToolContext {
  const ac = new AbortController();
  return {
    app: { appName: "test" },
    signal: ac.signal,
  };
}

describe("Chart Renderer & Round-Trip", () => {
  it("routes chart block to the chart renderer", () => {
    const registry = new BlockRendererRegistry([generativeUiRenderer, chartRenderer]);

    const chartBlock: RenderableBlock = {
      type: "chart",
      config: BAR_CONFIG,
    };

    const chartResult = registry.render(chartBlock, { disabled: false }) as HTMLElement;

    expect(chartResult).toBeDefined();
    expect(chartResult.tagName.toLowerCase()).toBe("agent-chart-block");
  });

  it("collects prompt snippets correctly including chart", () => {
    const registryBoth = new BlockRendererRegistry([generativeUiRenderer, chartRenderer]);
    const snippetsBoth = registryBoth.collectPromptSnippets();

    expect(snippetsBoth).toContain("Form:");
    expect(snippetsBoth).toContain("Buttons:");
    expect(snippetsBoth).toContain("Chart:");
  });

  it("every skill named by a prompt-facing string is registered by this package", () => {
    const registered = chartingSkills().map((s) => s.name);

    // Every string this package puts in front of the model.
    const surfaces = [
      chartRenderer.promptSnippet ?? "",
      chartingTools()[0].description,
      (SHOW_CHART_SCHEMA.properties as { config?: { description?: string } }).config?.description ?? "",
    ].join("\n");

    const named = [...surfaces.matchAll(/load_skill\("([^"]+)"\)/g)].map((m) => m[1]);

    // Guard the regex itself: if it stops matching, the test must not pass vacuously.
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      expect(registered).toContain(name);
    }
  });

  it("completes a round-trip from show_chart tool execution to block rendering", async () => {

    const tool = chartingTools()[0];
    expect(tool.name).toBe("show_chart");

    const outcome = await tool.execute({ config: BAR_CONFIG }, mockCtx());
    expect(outcome.block).toBeDefined();
    expect(outcome.block?.type).toBe("chart");

    const renderEl = chartingRenderers[0].render(outcome.block!, {}) as HTMLElement;
    expect(renderEl).toBeDefined();
    expect(renderEl.tagName.toLowerCase()).toBe("agent-chart-block");
  });
});
