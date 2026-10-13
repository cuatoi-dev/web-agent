/** The exact arguments cat-store's demo skill tells the agent to send to
 *  show_live_chart. Migrated 1:1 from the deleted showOrdersRevenueChartTool. */
export const LIVE_REVENUE_CHART_ARGS = {
  title: "Monthly Order Revenue (Live Data)",
  query: {
    source: "orders",
    aggregate: {
      groupBy: [{ field: "createdAt", granularity: "month", as: "createdAt_month" }],
      measures: [{ op: "sum", field: "total", as: "revenue" }],
      sort: [{ field: "createdAt_month", dir: "asc" }],
    },
  },
  encoding: {
    mark: "line",
    x: { field: "createdAt_month", type: "temporal" },
    y: { field: "revenue", type: "quantitative" },
    tooltip: ["createdAt_month", "revenue"],
  },
  refresh: { mode: "auto", intervalMs: 30000 },
};
