// gallery-demos-chart.ts — the chart datasource demo extracted from gallery-demos.ts.

import { createDataSourceProvider } from "@cuatoi/web-agent-lit";
import type { ChartBlock } from "@cuatoi/web-agent-charting";
import { store } from "../store";
import { getCatSources } from "../orders-backend/datasource-sources";

// ============================================================================
// 3b. CHART DATASOURCE DEMO
// ============================================================================

export function mountChartDatasourceDemo(host: HTMLElement): void {
  const dataSource = createDataSourceProvider({
    getState: () => store.getState(),
    sources: getCatSources(() => store.getState()),
  });

  const chartBlock: ChartBlock = {
    type: "chart",
    title: "Monthly Order Revenue (Live Data)",
    refresh: { mode: "auto", intervalMs: 30000 },
    query: {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "createdAt", granularity: "month" as const, as: "createdAt_month" }],
        measures: [{ op: "sum" as const, field: "total", as: "revenue" }],
        sort: [{ field: "createdAt_month", dir: "asc" }],
      },
    },
    encoding: {
      mark: "line",
      x: { field: "createdAt_month", type: "temporal" },
      y: { field: "revenue", type: "quantitative" },
      tooltip: ["createdAt_month", "revenue"],
    },
  };

  const wrap = document.createElement("div");
  wrap.id = "chart-mount";
  wrap.style.cssText = "height: 420px; padding: var(--wa-padding-xl, 16px);";

  const chartEl = document.createElement("agent-chart-block") as HTMLElement & {
    block: ChartBlock;
    dataSource: unknown;
  };
  chartEl.block = chartBlock;
  chartEl.dataSource = dataSource;

  wrap.appendChild(chartEl);
  host.appendChild(wrap);
}
