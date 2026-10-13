import type { RenderableBlock } from "@cuatoi/web-agent-core";
import type { BlockRenderer, RenderCtx } from "@cuatoi/web-agent-lit";
import "./chart-block.js";

export const chartRenderer: BlockRenderer = {
  types: ["chart"],
  render(block: RenderableBlock, ctx: RenderCtx): Node {
    const disabled = !!ctx.disabled;
    const dataSource = ctx.dataSource;
    // The element is registered by the side-effect import above; describe only
    // the three properties written here, so this module needs no value import
    // of AgentChartBlock.
    const el = document.createElement("agent-chart-block") as HTMLElement & {
      block: RenderableBlock;
      dataSource: RenderCtx["dataSource"];
      disabled: boolean;
    };
    el.block = block;
    el.dataSource = dataSource;
    el.disabled = disabled;
    return el;
  },
  promptSnippet: `
- Chart: { "type": "chart", "title": string (optional), "config": <Chart.js 2.x config> }
  For data that is not in a data source, use the show_chart tool or emit the block directly.
  For data from a data source, prefer the host's live chart tool when one covers it — a
  show_chart config is a snapshot and never refreshes.
  Call load_skill("chart") for the full Chart.js config schema and examples.
- Use a chart when comparing or showing trends over more than ~5 data points; prefer text or a table otherwise.
`.trim(),
};
