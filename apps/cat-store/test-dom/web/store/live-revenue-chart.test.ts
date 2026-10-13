import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { SourceInfo, QueryResult, DataQuery } from "@cuatoi/web-agent-lit";

// ---------------------------------------------------------------------------
// Polyfill ElementInternals for jsdom before importing material/lit components.
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  if (!window.ElementInternals) {
    window.ElementInternals = class {} as unknown as typeof ElementInternals;
  }
  const p = window.ElementInternals.prototype;
  if (!p.setFormValue) p.setFormValue = () => {};
  if (!p.setValidity) p.setValidity = () => {};
  if (!p.checkValidity) p.checkValidity = () => true;
  if (!p.reportValidity) p.reportValidity = () => true;
}

// ---------------------------------------------------------------------------
// Mock IntersectionObserver (chart-block.ts uses it for visibility pausing).
// ---------------------------------------------------------------------------
window.IntersectionObserver = class {
  private cb: (entries: { isIntersecting: boolean }[]) => void;
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    this.cb = cb;
  }
  observe() {
    // Immediately report in-view so the chart renders synchronously.
    this.cb([{ isIntersecting: true }]);
  }
  disconnect() {}
} as unknown as typeof IntersectionObserver;

/** The one corner of a Chart.js v2 instance chart-block.ts constructs and
 *  this file inspects — same shape as dom-types.ts's e2e counterpart. */
interface MockChartInstance {
  destroy: () => void;
  update: () => void;
  resize: () => void;
  data: { labels?: unknown[]; datasets?: { data?: unknown[] }[] };
}

// ---------------------------------------------------------------------------
// Mock Chart.js — exact pattern from chart-block.test.ts:79-90.
// `defaults` must carry `global` and `scale` because applyChartDefaults reads them.
// ---------------------------------------------------------------------------
vi.mock("chart.js", () => {
  const MockChart: unknown = vi.fn().mockImplementation((_ctx: unknown, config: { data?: unknown }): MockChartInstance => ({
    destroy: vi.fn(),
    update: vi.fn(),
    resize: vi.fn(),
    data: (config?.data as MockChartInstance["data"]) ?? {},
  }));
  (MockChart as { defaults?: unknown }).defaults = {
    global: { defaultFontColor: "#666", defaultFontFamily: "sans-serif" },
    scale: {
      ticks: {},
      gridLines: { color: "rgba(0,0,0,0.1)", zeroLineColor: "rgba(0,0,0,0.25)" },
    },
  };
  return { default: MockChart };
});

// chart.js@2.7.3 ships no bundled .d.ts, and cat-store carries no @types/chart.js
// of its own (web-agent-charting's copy isn't hoisted here) — the type is
// mocked above anyway.
// @ts-expect-error chart.js@2.7.3 ships no bundled .d.ts; the type is mocked anyway
import Chart from "chart.js";
import { createDataSourceProvider } from "@cuatoi/web-agent-lit";
import { AgentChartBlock } from "@cuatoi/web-agent-charting/lit";
import { runShowLiveChart } from "@cuatoi/web-agent-charting";
import { chartingTools } from "@cuatoi/web-agent-charting";
import type { ChartBlock } from "@cuatoi/web-agent-charting";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { getCatSources } from "../../../src/web/orders-backend/datasource-sources";
import { LIVE_REVENUE_CHART_ARGS } from "../../../src/web/store/live-revenue-chart.fixture";
import type { RootState } from "../../../src/web/store/index";

/** `Chart` is imported under `@ts-expect-error` (no usable .d.ts in this
 *  program), so `vi.mocked(Chart)` cannot resolve its type either — this is
 *  the one place that admits it really is the `vi.fn()` mock above. */
const MockedChart = Chart as unknown as Mock<[unknown, { data: MockChartInstance["data"] }], MockChartInstance>;

// Register the chart block element once.
if (!customElements.get("agent-chart-block")) {
  customElements.define("agent-chart-block", AgentChartBlock);
}

// ---------------------------------------------------------------------------
// Stub fetch so getCatSources' orders entry works offline.
// ---------------------------------------------------------------------------
const MOCK_DESCRIBE: SourceInfo = {
  name: "orders",
  description: "Orders",
  fields: [
    { name: "createdAt", type: "string" },
    { name: "total", type: "number" },
  ],
  rowCount: 2,
};

const MOCK_ROWS = [
  { createdAt_month: "2024-01", revenue: 100 },
  { createdAt_month: "2024-02", revenue: 200 },
];

const MOCK_QUERY_RESULT: QueryResult = {
  source: "orders",
  aggregated: true,
  fields: [
    { name: "createdAt_month", type: "string" },
    { name: "revenue", type: "number" },
  ],
  rows: MOCK_ROWS,
  page: { limit: 50, offset: 0, total: 2, hasMore: false },
};

function stubFetch() {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    // Byte-identical to the original `(input as Request).url` read: only a
    // `Request` has `.url`; anything else (e.g. a `URL` instance) stringifies
    // to the literal "undefined", matching `String((input as Request).url)`.
    const url = String(typeof input === "string" ? input : (input instanceof Request ? input.url : undefined));
    if (url.includes("/api/es-orders")) {
      return Promise.resolve(new Response('{"error":"Elasticsearch is unreachable"}', { status: 502 }));
    }
    if (url.includes("/describe")) {
      return Promise.resolve(new Response(JSON.stringify(MOCK_DESCRIBE), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(MOCK_QUERY_RESULT), { status: 200 }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("liveRevenueChart (migrated from showOrdersRevenueChartTool)", () => {
  beforeEach(() => {
    MockedChart.mockClear();
    document.body.innerHTML = "";
    stubFetch();
  });

  // -------------------------------------------------------------------------
  // A1 — show_live_chart accepts the migrated arguments.
  // -------------------------------------------------------------------------
  it("A1 — show_live_chart accepts the migrated arguments and returns a chart block", async () => {
    const outcome = await runShowLiveChart(LIVE_REVENUE_CHART_ARGS);

    expect(outcome.isError).toBeFalsy();
    const block = outcome.block as ChartBlock;
    expect(block.type).toBe("chart");
    expect(block.title).toBe("Monthly Order Revenue (Live Data)");
    expect(block.query!.source).toBe("orders");
    expect(block.encoding!.mark).toBe("line");
    expect(block.refresh!.intervalMs).toBe(30000);
  });

  // -------------------------------------------------------------------------
  // A2 — the migrated query resolves through a real provider (was B3).
  // -------------------------------------------------------------------------
  it("A2 — the migrated query resolves through the real provider", async () => {
    const outcome = await runShowLiveChart(LIVE_REVENUE_CHART_ARGS);
    const block = outcome.block as ChartBlock;

    const provider = createDataSourceProvider({
      getState: () => ({}),
      sources: getCatSources(() => ({} as RootState)),
    });
    const result = await provider.query(block.query as DataQuery);
    expect(result.rows).toEqual(MOCK_ROWS);
  });

  // -------------------------------------------------------------------------
  // A3 — the returned block renders in <agent-chart-block> — no error-card,
  //       Chart constructor called once, labels and data match stubbed rows (was B4).
  // -------------------------------------------------------------------------
  it("A3 — block renders in agent-chart-block without an error card", async () => {
    const outcome = await runShowLiveChart(LIVE_REVENUE_CHART_ARGS);
    const block = outcome.block as ChartBlock;

    const provider = createDataSourceProvider({
      getState: () => ({}),
      sources: getCatSources(() => ({} as RootState)),
    });

    const el = document.createElement("agent-chart-block");
    el.dataSource = provider;
    el.block = block;
    document.body.appendChild(el);

    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    // No error card.
    expect(el.renderRoot.querySelector(".error-card")).toBeNull();

    // Chart constructor called exactly once.
    expect(MockedChart).toHaveBeenCalledTimes(1);

    // Labels and data derive from the stubbed monthly rows.
    const passedConfig = MockedChart.mock.calls[0][1];
    expect(passedConfig.data.labels).toEqual(
      MOCK_ROWS.map((r) => r.createdAt_month)
    );
    expect(passedConfig.data.datasets![0].data).toEqual(
      MOCK_ROWS.map((r) => r.revenue)
    );
  });

  // -------------------------------------------------------------------------
  // A4 — the panel's registered tool is the one under test.
  // -------------------------------------------------------------------------
  it("A4 — chartingTools() includes show_live_chart and its execute matches A1", async () => {
    const tools = chartingTools();
    const liveTool = tools.find((t) => t.name === "show_live_chart");
    expect(liveTool).toBeDefined();

    const outcome = await liveTool!.execute(LIVE_REVENUE_CHART_ARGS, {} as unknown as ToolContext);
    const outcomeA1 = await runShowLiveChart(LIVE_REVENUE_CHART_ARGS);
    const blockA1 = outcomeA1.block as ChartBlock;
    expect((outcome.block as ChartBlock).query).toEqual(blockA1.query);
    expect((outcome.block as ChartBlock).encoding).toEqual(blockA1.encoding);
  });
});
