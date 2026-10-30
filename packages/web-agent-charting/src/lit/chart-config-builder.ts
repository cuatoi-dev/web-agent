import type { FieldSchema } from "@cuatoi/web-agent-core";
import type { ChartEncoding } from "../ui-blocks/chart-schema.js";
import { CHART_PALETTE } from "../chart/chart-palette.js";

/** Builds a Chart.js config from a `ChartEncoding` and the rows a data source
 *  returned. Moved out of `chart-block.ts` unchanged; `AgentChartBlock` still
 *  calls it through its own `_buildChartJsConfig` method. */
export function buildChartJsConfig(
  encoding: ChartEncoding,
  rows: Record<string, unknown>[],
  fields?: FieldSchema[],
): Record<string, unknown> {
  const fieldLabels = new Map((fields ?? []).filter((f) => f.label).map((f) => [f.name, f.label!]));
  const mark = encoding.mark;

  if (mark === "candlestick" || mark === "ohlc") {
    const xF = encoding.x?.field ?? "x";
    const oF = encoding.open?.field ?? "open";
    const hF = encoding.high?.field ?? "high";
    const lF = encoding.low?.field ?? "low";
    const cF = encoding.close?.field ?? "close";
    const datasetLabel = encoding.title ?? fieldLabels.get(cF) ?? "OHLC";
    return {
      type: mark,
      data: {
        datasets: [{
          label: datasetLabel,
          data: rows.map(r => ({ x: r[xF], o: Number(r[oF]), h: Number(r[hF]), l: Number(r[lF]), c: Number(r[cF]) })),
        }],
      },
      // `animation: { duration: 0 }`: Chart.js defaults the entry animation to
      // 1000 ms, which drives a 60-frame requestAnimationFrame canvas redraw
      // loop for a chart that is correct from its first frame.
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 0 } },
    };
  }

  if (mark === "arc" || mark === "pie" || mark === "doughnut") {
    const labelField = encoding.color?.field ?? encoding.x?.field ?? "label";
    const dataField = encoding.theta?.field ?? encoding.y?.field ?? "value";
    const chartType = mark === "arc" ? "pie" : mark;
    return {
      type: chartType,
      data: {
        labels: rows.map(r => r[labelField]),
        datasets: [{
          data: rows.map(r => r[dataField]),
          backgroundColor: CHART_PALETTE.slice(0, rows.length),
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 0 } },
    };
  }

  const chartType = mark === "area" ? "line" : mark;
  const xField = encoding.x?.field ?? "x";
  const yField = encoding.y?.field ?? "y";
  const labels = rows.map(r => r[xField]);

  const xTitle = encoding.x?.title ?? fieldLabels.get(xField);
  const yTitle = encoding.y?.title ?? fieldLabels.get(yField);
  const scales: Record<string, unknown> = {};
  if (xTitle) {
    scales.xAxes = [{ scaleLabel: { display: true, labelString: xTitle } }];
  }
  if (yTitle) {
    const yScale: Record<string, unknown> = { scaleLabel: { display: true, labelString: yTitle } };
    if (chartType === "bar") yScale.ticks = { beginAtZero: true };
    scales.yAxes = [yScale];
  } else if (chartType === "bar") {
    scales.yAxes = [{ ticks: { beginAtZero: true } }];
  }

  if (encoding.color?.field) {
    const colorField = encoding.color.field;
    // Chart.js draws dataset[i] at labels[i]. Aggregated rows are long
    // format — one row per (x, color) pair — so the labels must be the
    // UNIQUE x values and every group's data must be re-indexed onto
    // them (null where the group has no row for an x). Mapping rows
    // 1:1 would draw each group's values under the wrong labels.
    const labels: unknown[] = [];
    const labelIndex = new Map<string, number>();
    const groups = new Map<string, Map<number, unknown>>();
    rows.forEach(r => {
      const xKey = String(r[xField]);
      if (!labelIndex.has(xKey)) {
        labelIndex.set(xKey, labels.length);
        labels.push(r[xField]);
      }
      const xIdx = labelIndex.get(xKey)!;
      const groupKey = String(r[colorField]);
      if (!groups.has(groupKey)) groups.set(groupKey, new Map());
      groups.get(groupKey)!.set(xIdx, r[yField]);
    });
    const datasets = Array.from(groups.entries()).map(([key, vals], i) => ({
      label: key,
      data: labels.map((_, idx) => (vals.has(idx) ? vals.get(idx) : null)),
      backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
      borderColor: CHART_PALETTE[i % CHART_PALETTE.length],
      fill: mark === "area",
    }));
    return {
      type: chartType,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        ...(Object.keys(scales).length ? { scales } : {}),
      },
    };
  }

  const datasetLabel = encoding.y?.title ?? fieldLabels.get(yField) ?? yField;

  return {
    type: chartType,
    data: {
      labels,
      datasets: [{
        label: datasetLabel,
        data: rows.map(r => r[yField]),
        backgroundColor: CHART_PALETTE[0],
        borderColor: CHART_PALETTE[0],
        fill: mark === "area",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      ...(Object.keys(scales).length ? { scales } : {}),
    },
  };
}
