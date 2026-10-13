import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/** The jsdom test window, widened for the globals this file polyfills/mocks.
 *  Everything below reads/writes through this instead of `window as any`. */
type ElementInternalsCtor = { new (): Record<string, unknown>; prototype: Record<string, unknown> };
const testWindow = window as unknown as Window & {
  ElementInternals?: ElementInternalsCtor;
  IntersectionObserver?: unknown;
  ResizeObserver?: unknown;
};

// Polyfill ElementInternals and Web Animations API for material web components inside jsdom before imports
if (typeof window !== "undefined") {
  if (!testWindow.ElementInternals) {
    testWindow.ElementInternals = class {} as unknown as ElementInternalsCtor;
  }
  const internalsProto = testWindow.ElementInternals.prototype;
  if (!internalsProto.setFormValue) internalsProto.setFormValue = () => {};
  if (!internalsProto.setValidity) internalsProto.setValidity = () => {};
  if (!internalsProto.checkValidity) internalsProto.checkValidity = () => true;
  if (!internalsProto.reportValidity) internalsProto.reportValidity = () => true;

  if (!Element.prototype.animate) {
    Element.prototype.animate = function() {
      return {
        finished: Promise.resolve(),
        play: () => {},
        pause: () => {},
        cancel: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as Animation;
    };
  }
}

// Mock IntersectionObserver
let intersectionCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;

class MockIntersectionObserver {
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    intersectionCallback = callback;
  }
  observe() {}
  disconnect() {
    intersectionCallback = null;
  }
}

testWindow.IntersectionObserver = MockIntersectionObserver;

// Mock ResizeObserver (003: chart-block.ts drives Chart.js's resize() from one).
// NOT installed globally by default — jsdom has no native ResizeObserver, and
// that absence is itself the "no-ResizeObserver path" the guard in
// connectedCallback must keep working against. Only the dedicated describe
// block below installs/removes it, so every other test in this file keeps
// exercising the real default (unavailable) environment.
let resizeObserverCallback: ((entries: unknown[]) => void) | null = null;
let resizeObserveTarget: Element | null = null;
let resizeDisconnectCalls = 0;

class MockResizeObserver {
  constructor(callback: (entries: unknown[]) => void) {
    resizeObserverCallback = callback;
  }
  observe(target: Element) {
    resizeObserveTarget = target;
  }
  disconnect() {
    resizeDisconnectCalls++;
    resizeObserverCallback = null;
  }
  unobserve() {}
}

// Mock Chart.js
let mockChartInstance: { destroy: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; data: unknown } | null = null;

vi.mock("chart.js", () => {
  const MockChart = vi.fn().mockImplementation((_ctx: unknown, config: unknown) => {
    const cfg = config as { data?: unknown } | null | undefined;
    mockChartInstance = { destroy: vi.fn(), update: vi.fn(), resize: vi.fn(), data: cfg?.data ?? {} };
    return mockChartInstance;
  });
  (MockChart as unknown as { defaults: unknown }).defaults = {
    global: { defaultFontColor: "#666", defaultFontFamily: "sans-serif" },
    scale: { ticks: {}, gridLines: { color: "rgba(0, 0, 0, 0.1)", zeroLineColor: "rgba(0,0,0,0.25)" } },
  };
  return { default: MockChart };
});

import Chart from "chart.js";
import { AgentChartBlock } from "../../src/lit/chart-block.js";
import { applyChartDefaults } from "../../src/chart/chart-theme.js";
import type { QueryResult, FieldSchema, DataSourceProvider } from "@cuatoi/web-agent-core";

if (!customElements.get("agent-chart-block")) {
  customElements.define("agent-chart-block", AgentChartBlock);
}

/** The shape the tests below read off a config handed to the mocked `Chart`
 *  constructor. Narrower than a real `Chart.ChartConfiguration` — just the
 *  fields these assertions actually check. */
interface MockChartConfig {
  type: string;
  data: {
    labels?: unknown[];
    datasets: Array<{
      label?: string;
      data: unknown[];
      _ohlc?: unknown;
    }>;
  };
  options: {
    responsive?: boolean;
    maintainAspectRatio?: boolean;
    legend?: { display?: boolean };
    scales?: {
      yAxes?: Array<{ ticks?: { beginAtZero?: boolean }; scaleLabel?: { labelString?: string } }>;
    };
    annotation?: { lines?: unknown[] };
  };
}

/** The config passed as the Nth (default: first) call's second constructor
 *  argument to the mocked `Chart`. */
function chartCallConfig(callIndex = 0): MockChartConfig {
  return vi.mocked(Chart).mock.calls[callIndex][1] as unknown as MockChartConfig;
}

/** `Chart.defaults`, widened for the `.scale` branch `@types/chart.js@2.9.41`
 *  types as `any` via an index signature — same gap `chart-theme.ts` declares
 *  around for the production code. */
interface MockChartDefaults {
  global: { defaultFontColor?: string; defaultFontFamily?: string };
  scale: {
    ticks: { fontColor?: string };
    gridLines: { color?: string; zeroLineColor?: string };
  };
}
function chartDefaults(): MockChartDefaults {
  return Chart.defaults as unknown as MockChartDefaults;
}

// Helper to trigger in-view state
function setInView(inView: boolean) {
  if (intersectionCallback) {
    intersectionCallback([{ isIntersecting: inView }]);
  }
}

// Helper to set visibility state
function setVisibility(visible: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: visible,
    configurable: true,
    writable: true,
  });
}

describe("AgentChartBlock", () => {
  beforeEach(() => {
    vi.mocked(Chart).mockClear();
    mockChartInstance = null;
    document.body.innerHTML = "";
    intersectionCallback = null;
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders block.config and calls new Chart(ctx, config)", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      title: "Valid Chart",
      config: {
        type: "bar",
        data: { labels: ["A", "B"], datasets: [{ data: [1, 2] }] },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).toHaveBeenCalled();
    const passedConfig = chartCallConfig();
    expect(passedConfig.type).toBe("bar");
    expect(passedConfig.data.labels).toEqual(["A", "B"]);
  });

  it("applies responsive:true and maintainAspectRatio:false when options not set", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
        type: "line",
        data: { labels: ["X"], datasets: [{ data: [5] }] },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).toHaveBeenCalled();
    const opts = chartCallConfig().options;
    expect(opts.responsive).toBe(true);
    expect(opts.maintainAspectRatio).toBe(false);
  });

  it("preserves user-supplied options if already set", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
        type: "bar",
        data: { labels: ["X"], datasets: [{ data: [1] }] },
        options: { responsive: false, maintainAspectRatio: true, legend: { display: false } },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).toHaveBeenCalled();
    const opts = chartCallConfig().options;
    expect(opts.responsive).toBe(false);
    expect(opts.maintainAspectRatio).toBe(true);
    expect(opts.legend).toEqual({ display: false });
  });

  it("rejects block.config where a dataset has a url field (CB2)", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
        type: "bar",
        data: { datasets: [{ data: [1], url: "https://evil.com/data.json" }], labels: [] },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).not.toHaveBeenCalled();
    const errorCard = el.renderRoot.querySelector(".error-card");
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain("chart used a forbidden data.url");
  });

  it("rejects block.config where a dataset has >2000 rows (CB3)", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
        type: "bar",
        data: { datasets: [{ data: Array.from({ length: 2001 }, (_, i) => i) }], labels: [] },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).not.toHaveBeenCalled();
    const errorCard = el.renderRoot.querySelector(".error-card");
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain("chart exceeded 2000-row cap");
  });

  it("rejects block.config with an undeclared yAxisID (CB axis-mismatch)", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
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
      }
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).not.toHaveBeenCalled();
    const errorCard = el.renderRoot.querySelector(".error-card");
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain('price-axis" is not defined in options.scales.yAxes');
  });

  it("catches a Chart.js constructor throw and shows error-card instead of propagating", async () => {
    vi.mocked(Chart).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
        type: "bar",
        data: { labels: ["A"], datasets: [{ data: [1] }] },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const errorCard = el.renderRoot.querySelector(".error-card");
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain("boom");
  });

  it("shows deprecated-spec error for block.spec", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      spec: { data: { values: [{ x: 1, y: 2 }] }, mark: "bar" },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).not.toHaveBeenCalled();
    const errorCard = el.renderRoot.querySelector(".error-card");
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain("Deprecated");
  });

  it("destroys existing chart instance before re-render on block change", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: { type: "bar", data: { labels: ["A"], datasets: [{ data: [1] }] } },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).toHaveBeenCalledTimes(1);
    const firstInstance = mockChartInstance!;

    // Change the block — triggers updated() → destroys old + creates new Chart
    el.block = {
      type: "chart",
      config: { type: "line", data: { labels: ["B"], datasets: [{ data: [2] }] } },
    };
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(firstInstance.destroy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Chart)).toHaveBeenCalledTimes(2);
  });

  it("calls chart.destroy on disconnectedCallback", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: { type: "bar", data: { labels: ["A"], datasets: [{ data: [1] }] } },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).toHaveBeenCalledTimes(1);
    const instance = mockChartInstance!;

    document.body.removeChild(el);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it("dispatches chart-error event when render fails", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
        type: "bar",
        data: { datasets: [{ data: [1], url: "https://evil.com" }], labels: [] },
      },
    };
    const errorListener = vi.fn<[CustomEvent<{ error: string; block: unknown }>], void>();
    el.addEventListener("chart-error", errorListener as unknown as EventListener);

    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorListener).toHaveBeenCalled();
    const event = errorListener.mock.calls[0][0];
    expect(event.detail.error).toContain("chart used a forbidden data.url");
    expect(event.detail.block).toBe(el.block);
  });

  describe("query+encoding datasource path", () => {
    function makeMockProvider(): DataSourceProvider {
      return {
        listSources() { return Promise.resolve([]); },
        describeSource() {
          return Promise.resolve({ name: "test", description: "", fields: [] as FieldSchema[], rowCount: 0 });
        },
        getFieldDetails() {
          return Promise.resolve({ source: "test", fields: [] as FieldSchema[], total: 0, offset: 0, limit: 0, hasMore: false });
        },
        sampleValues() {
          return Promise.resolve({ source: "test", field: "", values: [], hasMore: false });
        },
        query(): Promise<QueryResult> {
          return Promise.resolve({
            source: "orders",
            aggregated: true,
            fields: [{ name: "month", type: "string" as const }, { name: "revenue", type: "number" as const }],
            rows: [
              { month: "Jan", revenue: 100 },
              { month: "Feb", revenue: 150 },
              { month: "Mar", revenue: 80 },
            ],
            page: { limit: 50, offset: 0, total: 3, hasMore: false },
          });
        },
      };
    }

    it("calls dataSource.query and renders Chart.js chart from encoding", async () => {
      const el = document.createElement("agent-chart-block");
      el.dataSource = makeMockProvider();
      el.block = {
        type: "chart",
        title: "Query Chart",
        query: { source: "orders", aggregate: { groupBy: [{ field: "month" }], measures: [{ op: "sum", field: "total", as: "revenue" }] } },
        encoding: { mark: "bar", x: { field: "month", type: "nominal" }, y: { field: "revenue", type: "quantitative" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(Chart)).toHaveBeenCalled();
      const passedConfig = chartCallConfig();
      expect(passedConfig.type).toBe("bar");
      expect(passedConfig.data.labels).toEqual(["Jan", "Feb", "Mar"]);
      expect(passedConfig.data.datasets[0].data).toEqual([100, 150, 80]);
    });

    it("groups datasets by color.field when encoding.color set", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [],
        rows: [
          { month: "Jan", revenue: 100, category: "A" },
          { month: "Jan", revenue: 50, category: "B" },
          { month: "Feb", revenue: 120, category: "A" },
          { month: "Feb", revenue: 60, category: "B" },
        ],
        page: { limit: 50, offset: 0, total: 4, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: {
          mark: "bar",
          x: { field: "month", type: "nominal" },
          y: { field: "revenue", type: "quantitative" },
          color: { field: "category" },
        },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(Chart)).toHaveBeenCalled();
      const passedConfig = chartCallConfig();
      expect(passedConfig.data.datasets.length).toBeGreaterThan(1);
    });

    it("aligns color-grouped datasets to unique x labels when rows are long format", async () => {
      // Chart.js draws dataset[i] at labels[i]. One row per (month, category)
      // pair must pivot to unique month labels with each category's values
      // re-indexed onto them — otherwise bars land under the wrong labels.
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [],
        rows: [
          { month: "Jan", revenue: 100, category: "A" },
          { month: "Jan", revenue: 50, category: "B" },
          { month: "Feb", revenue: 120, category: "A" },
          { month: "Feb", revenue: 60, category: "B" },
        ],
        page: { limit: 50, offset: 0, total: 4, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: {
          mark: "bar",
          x: { field: "month", type: "nominal" },
          y: { field: "revenue", type: "quantitative" },
          color: { field: "category" },
        },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const passedConfig = chartCallConfig();
      expect(passedConfig.data.labels).toEqual(["Jan", "Feb"]);
      const byLabel = new Map(passedConfig.data.datasets.map((d) => [d.label, d.data]));
      expect(byLabel.get("A")).toEqual([100, 120]);
      expect(byLabel.get("B")).toEqual([50, 60]);
    });

    it("leaves a null where a color group has no row for an x label", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [],
        rows: [
          { month: "Jan", revenue: 100, category: "A" },
          { month: "Feb", revenue: 120, category: "A" },
          { month: "Feb", revenue: 60, category: "B" },
        ],
        page: { limit: 50, offset: 0, total: 3, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: {
          mark: "bar",
          x: { field: "month", type: "nominal" },
          y: { field: "revenue", type: "quantitative" },
          color: { field: "category" },
        },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const passedConfig = chartCallConfig();
      expect(passedConfig.data.labels).toEqual(["Jan", "Feb"]);
      const byLabel = new Map(passedConfig.data.datasets.map((d) => [d.label, d.data]));
      expect(byLabel.get("B")).toEqual([null, 60]);
    });

    it("applies friendly label from result.fields to dataset label and scale label", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [
          { name: "month", type: "string" },
          { name: "rev", type: "number", label: "Gross Revenue ($)" },
        ],
        rows: [
          { month: "Jan", rev: 100 },
          { month: "Feb", rev: 150 },
        ],
        page: { limit: 50, offset: 0, total: 2, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: { mark: "bar", x: { field: "month" }, y: { field: "rev" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const passedConfig = chartCallConfig();
      expect(passedConfig.data.datasets[0].label).toBe("Gross Revenue ($)");
      expect(passedConfig.options.scales!.yAxes![0].scaleLabel!.labelString).toBe("Gross Revenue ($)");
    });

    it("explicit encoding title overrides friendly label", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [
          { name: "month", type: "string" },
          { name: "rev", type: "number", label: "Gross Revenue ($)" },
        ],
        rows: [{ month: "Jan", rev: 100 }],
        page: { limit: 50, offset: 0, total: 1, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: { mark: "bar", x: { field: "month" }, y: { field: "rev", title: "Custom Revenue" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const passedConfig = chartCallConfig();
      expect(passedConfig.data.datasets[0].label).toBe("Custom Revenue");
      expect(passedConfig.options.scales!.yAxes![0].scaleLabel!.labelString).toBe("Custom Revenue");
    });

    it("falls back to field name when no label is present", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [{ name: "rev", type: "number" }],
        rows: [{ month: "Jan", rev: 100 }],
        page: { limit: 50, offset: 0, total: 1, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: { mark: "bar", x: { field: "month" }, y: { field: "rev" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const passedConfig = chartCallConfig();
      expect(passedConfig.data.datasets[0].label).toBe("rev");
    });

    it("BAR mark sets beginAtZero on y-axis", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [{ name: "orders", type: "number" }],
        rows: [
          { region: "east", channel: "phone", orders: 6 },
          { region: "east", channel: "store", orders: 6 },
        ],
        page: { limit: 50, offset: 0, total: 2, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: {
          mark: "bar",
          x: { field: "region", type: "nominal", title: "Region" },
          y: { field: "orders", type: "quantitative", title: "Orders" },
          color: { field: "channel", title: "Channel" },
        },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const passedConfig = chartCallConfig();
      const yAxes = passedConfig.options.scales!.yAxes;
      expect(yAxes).toBeDefined();
      expect(yAxes![0].ticks!.beginAtZero).toBe(true);
    });

    it("BAR mark sets beginAtZero even without y-axis title", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [{ name: "count", type: "number" }],
        rows: [{ a: "x", count: 5 }],
        page: { limit: 50, offset: 0, total: 1, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: { mark: "bar", x: { field: "a", type: "nominal" }, y: { field: "count", type: "quantitative" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const passedConfig = chartCallConfig();
      const yAxes = passedConfig.options.scales!.yAxes;
      expect(yAxes).toBeDefined();
      expect(yAxes![0].ticks!.beginAtZero).toBe(true);
    });

    it("LINE mark does NOT set beginAtZero on y-axis", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.resolve({
        source: "orders",
        aggregated: true,
        fields: [{ name: "rev", type: "number" }],
        rows: [{ month: "Jan", rev: 100 }],
        page: { limit: 50, offset: 0, total: 1, hasMore: false },
      });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: { mark: "line", x: { field: "month" }, y: { field: "rev", title: "Revenue" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      const passedConfig = chartCallConfig();
      const yAxes = passedConfig.options.scales!.yAxes;
      expect(yAxes).toBeDefined();
      expect(yAxes![0].ticks?.beginAtZero).toBeUndefined();
    });

    it("shows loading state while query is pending", async () => {
      const provider = makeMockProvider();
      let resolveQuery: (v: QueryResult) => void;
      provider.query = () => new Promise((r) => { resolveQuery = r; });

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: { mark: "bar", x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(el.renderRoot.textContent).toContain("Loading chart data");

      const result: QueryResult = { source: "orders", aggregated: false, fields: [], rows: [{ a: "x", b: 1 }], page: { limit: 50, offset: 0, total: 1, hasMore: false } };
      resolveQuery!(result);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(vi.mocked(Chart)).toHaveBeenCalled();
    });

    it("shows error when dataSource.query throws", async () => {
      const provider = makeMockProvider();
      provider.query = () => Promise.reject(new Error("Datasource timeout"));

      const el = document.createElement("agent-chart-block");
      el.dataSource = provider;
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: { mark: "bar", x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(Chart)).not.toHaveBeenCalled();
      const errorCard = el.renderRoot.querySelector(".error-card");
      expect(errorCard).toBeTruthy();
      expect(errorCard?.textContent).toContain("Datasource timeout");
    });

    it("shows error when no dataSource configured", async () => {
      const el = document.createElement("agent-chart-block");
      el.block = {
        type: "chart",
        query: { source: "orders" },
        encoding: { mark: "bar", x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(Chart)).not.toHaveBeenCalled();
      const errorCard = el.renderRoot.querySelector(".error-card");
      expect(errorCard).toBeTruthy();
      expect(errorCard?.textContent).toContain("dataSource");
    });

    describe("refresh controller", () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      function makeTickProvider() {
        let callCount = 0;
        const provider = makeMockProvider();
        const query = vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            source: "orders",
            aggregated: true,
            fields: [{ name: "month", type: "string" }, { name: "revenue", type: "number" }],
            rows: [
              { month: "Jan", revenue: 100 + callCount },
              { month: "Feb", revenue: 150 + callCount },
              { month: "Mar", revenue: 80 + callCount },
            ],
            page: { limit: 50, offset: 0, total: 3, hasMore: false },
          });
        });
        provider.query = query as DataSourceProvider["query"];
        return { provider, query };
      }

      /** A provider whose query resolves only when the test says so, so a tick
       *  can be fired while a query is genuinely still in flight. */
      function makeDeferredProvider() {
        const pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
        const provider = makeMockProvider();
        const query = vi.fn().mockImplementation(
          () =>
            new Promise((resolve, reject) => {
              pending.push({
                resolve: () =>
                  resolve({
                    source: "orders",
                    aggregated: true,
                    fields: [{ name: "month", type: "string" }, { name: "revenue", type: "number" }],
                    rows: [{ month: "Jan", revenue: 1 }],
                    page: { limit: 50, offset: 0, total: 1, hasMore: false },
                  }),
                reject,
              });
            })
        );
        provider.query = query as DataSourceProvider["query"];
        return { provider, query, pending };
      }

      function createRefreshChart(mode: "auto" | "manual" | "off" = "auto", intervalMs?: number) {
        const { provider, query } = makeTickProvider();
        const el = document.createElement("agent-chart-block");
        el.dataSource = provider;
        el.block = {
          type: "chart",
          query: { source: "orders" },
          encoding: { mark: "bar", x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
          refresh: { mode, intervalMs },
        };
        return { el, provider, query };
      }

      it("auto-refresh re-queries on interval when in-view + visible", async () => {
        const { el, query } = createRefreshChart("auto", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);

        setInView(true);

        await vi.advanceTimersByTimeAsync(59999);
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(10);
        expect(query).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(60000);
        expect(query).toHaveBeenCalledTimes(3);
      });

      it("out-of-view gating: no refresh when not in view", async () => {
        const { el, query } = createRefreshChart("auto", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(120000);
        expect(query).toHaveBeenCalledTimes(1);
      });

      it("hidden tab gating: no refresh on tick when tab hidden", async () => {
        const { el, query } = createRefreshChart("auto", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);

        setInView(true);
        setVisibility("hidden");

        await vi.advanceTimersByTimeAsync(120000);
        expect(query).toHaveBeenCalledTimes(1);
      });

      it("leaving view stops timer; re-entering restarts", async () => {
        const { el, query } = createRefreshChart("auto", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);
        expect(query).toHaveBeenCalledTimes(1);

        setInView(true);

        await vi.advanceTimersByTimeAsync(60000);
        expect(query).toHaveBeenCalledTimes(2);

        setInView(false);

        await vi.advanceTimersByTimeAsync(120000);
        expect(query).toHaveBeenCalledTimes(2);

        setInView(true);
        await vi.advanceTimersByTimeAsync(60000);
        expect(query).toHaveBeenCalledTimes(3);
      });

      it("manual mode: no timer, Refresh button click calls query", async () => {
        const { el, query } = createRefreshChart("manual", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(120000);
        expect(query).toHaveBeenCalledTimes(1);

        const refreshBtn = el.renderRoot.querySelector(".refresh-btn");
        expect(refreshBtn).toBeTruthy();
        (refreshBtn as HTMLElement).click();
        await vi.advanceTimersByTimeAsync(20);
        expect(query).toHaveBeenCalledTimes(2);
      });

      it("off mode: no timer, no Refresh button", async () => {
        const { el, query } = createRefreshChart("off", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(120000);
        expect(query).toHaveBeenCalledTimes(1);

        const refreshBtn = el.renderRoot.querySelector(".refresh-btn");
        expect(refreshBtn).toBeFalsy();
      });

      it("mode toggle cycles auto → manual → off → auto", async () => {
        const { el, query } = createRefreshChart("auto", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);

        const modeEl = el.renderRoot.querySelector(".mode-indicator") as HTMLElement;
        expect(modeEl).toBeTruthy();
        expect(modeEl.textContent).toBe("Auto");

        setInView(true);

        modeEl.click();
        await el.updateComplete;
        expect(el.renderRoot.querySelector(".mode-indicator")?.textContent).toBe("Manual");

        await vi.advanceTimersByTimeAsync(120000);
        expect(query).toHaveBeenCalledTimes(1);

        const modeEl2 = el.renderRoot.querySelector(".mode-indicator") as HTMLElement;
        modeEl2.click();
        await el.updateComplete;
        expect(el.renderRoot.querySelector(".mode-indicator")?.textContent).toBe("Off");

        const modeEl3 = el.renderRoot.querySelector(".mode-indicator") as HTMLElement;
        modeEl3.click();
        await el.updateComplete;
        expect(el.renderRoot.querySelector(".mode-indicator")?.textContent).toBe("Auto");

        await vi.advanceTimersByTimeAsync(60000);
        expect(query).toHaveBeenCalledTimes(2);
      });

      it("cleanup on disconnectedCallback clears timer and observer", async () => {
        const { el, query } = createRefreshChart("auto", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);
        setInView(true);

        document.body.removeChild(el);
        await vi.advanceTimersByTimeAsync(10);

        await vi.advanceTimersByTimeAsync(60000);
        expect(query).toHaveBeenCalledTimes(1);
      });

      it("disabled/stale suppresses auto-refresh", async () => {
        const { el, query } = createRefreshChart("auto", 60000);
        el.disabled = true;
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);
        setInView(true);

        await vi.advanceTimersByTimeAsync(120000);
        expect(query).toHaveBeenCalledTimes(1);
      });

      it("shows updated stamp after initial render", async () => {
        const { el } = createRefreshChart("auto", 60000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(30);

        const stamp = el.renderRoot.querySelector(".updated-stamp");
        expect(stamp).toBeTruthy();
        expect(stamp?.textContent).toMatch(/Updated \d{1,2}:\d{2}/);
      });

      it("clamps interval to minimum 5000ms", async () => {
        const { el, query } = createRefreshChart("auto", 100);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);

        expect(query).toHaveBeenCalledTimes(1);
        setInView(true);

        await vi.advanceTimersByTimeAsync(4999);
        expect(query).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(query).toHaveBeenCalledTimes(2);
      });

      it("skips a tick while the previous query is still running", async () => {
        const { provider, query, pending } = makeDeferredProvider();
        const el = document.createElement("agent-chart-block");
        el.dataSource = provider;
        el.block = {
          type: "chart",
          query: { source: "orders" },
          encoding: { mark: "bar", x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
          refresh: { mode: "auto", intervalMs: 5000 },
        };
        document.body.appendChild(el);
        await el.updateComplete;
        setInView(true);

        await vi.advanceTimersByTimeAsync(10);
        expect(query).toHaveBeenCalledTimes(1);
        expect(pending).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(1);
      });

      it("resumes on the next tick once the pending query settles", async () => {
        const { provider, query, pending } = makeDeferredProvider();
        const el = document.createElement("agent-chart-block");
        el.dataSource = provider;
        el.block = {
          type: "chart",
          query: { source: "orders" },
          encoding: { mark: "bar", x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
          refresh: { mode: "auto", intervalMs: 5000 },
        };
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);
        expect(query).toHaveBeenCalledTimes(1);

        setInView(true);
        pending[0].resolve();
        await vi.advanceTimersByTimeAsync(0);

        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(2);

        pending[1].resolve();
        await vi.advanceTimersByTimeAsync(0);

        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(3);
      });

      it("a rejected query releases the flag so the next tick still queries", async () => {
        const { el, query } = createRefreshChart("auto", 5000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);
        expect(query).toHaveBeenCalledTimes(1);

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          query.mockRejectedValueOnce(new Error("boom"));
          setInView(true);
          await vi.advanceTimersByTimeAsync(5000);
          expect(query).toHaveBeenCalledTimes(2);

          await vi.advanceTimersByTimeAsync(5000);
          expect(query).toHaveBeenCalledTimes(3);

          expect(errorSpy).toHaveBeenCalledWith("Auto-refresh query failed:", expect.any(Error));
        } finally {
          errorSpy.mockRestore();
        }
      });

      it("an aborted query releases the flag so the next tick still queries", async () => {
        const { el, query } = createRefreshChart("auto", 5000);
        document.body.appendChild(el);
        await el.updateComplete;
        await vi.advanceTimersByTimeAsync(10);
        expect(query).toHaveBeenCalledTimes(1);

        setInView(true);
        const abortError = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
        query.mockRejectedValueOnce(abortError);
        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(3);
      });

      it("swapping the block while a query is pending does not leave the flag stuck", async () => {
        const { provider, query, pending } = makeDeferredProvider();
        const el = document.createElement("agent-chart-block");
        el.dataSource = provider;
        el.block = {
          type: "chart",
          query: { source: "orders" },
          encoding: { mark: "bar", x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
          refresh: { mode: "auto", intervalMs: 5000 },
        };
        document.body.appendChild(el);
        await el.updateComplete;
        setInView(true);
        await vi.advanceTimersByTimeAsync(10);
        expect(query).toHaveBeenCalledTimes(1);
        expect(pending).toHaveLength(1);

        el.block = { ...el.block, refresh: { mode: "auto", intervalMs: 5000 } };
        await el.updateComplete;
        setInView(true);
        await vi.advanceTimersByTimeAsync(10);
        expect(query).toHaveBeenCalledTimes(2);
        expect(pending).toHaveLength(2);

        pending[1].resolve();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(3);
        expect(pending).toHaveLength(3);

        // Resolving the superseded first query must not release the flag that
        // now belongs to the in-flight tick query: the next tick is still
        // skipped.
        pending[0].resolve();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(3);

        // The genuinely in-flight query's resolve releases the flag, so a tick
        // fires again — the stale query neither blocked nor double-released.
        pending[2].resolve();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(query).toHaveBeenCalledTimes(4);
      });
    });
  });

  it("transforms a candlestick config before constructing Chart", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
        type: "candlestick",
        data: { datasets: [{ data: [{ x: "2026-01-05", o: 100, h: 104, l: 99, c: 103 }] }] },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).toHaveBeenCalled();
    const passedConfig = chartCallConfig();
    expect(passedConfig.type).toBe("scatter");
    expect(passedConfig.data.datasets[0]._ohlc).toBeDefined();
  });

  it("transforms a payoff config before constructing Chart", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: {
        type: "payoff",
        data: { datasets: [] },
        options: {
          payoff: {
            legs: [{ kind: "call", strike: 100, premium: 5 }],
          },
        },
      },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).toHaveBeenCalled();
    const passedConfig = chartCallConfig();
    expect(passedConfig.type).toBe("scatter");
    expect(passedConfig.options.annotation!.lines).toBeDefined();
  });

  it("U1: the block's own stylesheet is fully tokenised", async () => {
    const el = document.createElement("agent-chart-block");
    document.body.appendChild(el);
    await el.updateComplete;
    const text = el.querySelector("style")?.textContent ?? "";
    expect(text).toContain("background: var(--wa-background-color-300, white)");
    expect(text).toContain("border: 1px solid var(--wa-border-color, #e0e0e0)");
    expect(text).toContain("background: var(--wa-action-color-info, #6200ee)");
    expect(text).toContain("color: var(--wa-action-text-color-info, white)");
    expect(text).toContain("font-family: var(--wa-font-family,");
    expect(text).not.toContain("background: white");
    expect(text).not.toContain("background: #6200ee");
    expect(text).not.toContain("border-color: #6200ee");
  });

  it("renders its stylesheet as a child, with nothing in document.head", async () => {
    const el = document.createElement("agent-chart-block");
    document.body.appendChild(el);
    await el.updateComplete;
    const sheet = el.querySelector("style");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("agent-chart-block .chart-container");
    expect(document.getElementById("agent-chart-block-styles")).toBeNull();
  });

  it("the error branch still renders its stylesheet", async () => {
    const el = document.createElement("agent-chart-block");
    document.body.appendChild(el);
    el.error = "boom";
    await el.updateComplete;
    expect(el.querySelector("style")).not.toBeNull();
    expect(el.querySelector(".error-card")).not.toBeNull();
  });

  it("U2: applyChartDefaults writes every Chart.js global", () => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    window.getComputedStyle = vi.fn().mockReturnValue({
      color: "rgb(1, 2, 3)",
      getPropertyValue: (prop: string) => prop === "--wa-font-family" ? '"Public Sans"' : "",
    });

    try {
      const div = document.createElement("div");
      applyChartDefaults(div);
      const d = chartDefaults();
      expect(d.global.defaultFontColor).toBe("rgb(1, 2, 3)");
      expect(d.global.defaultFontFamily).toBe('"Public Sans", system-ui, sans-serif');
      expect(d.scale.ticks.fontColor).toBe("rgb(1, 2, 3)");
      expect(d.scale.gridLines.color).toBe("rgb(1, 2, 3)");
      expect(d.scale.gridLines.zeroLineColor).toBe("rgb(1, 2, 3)");
    } finally {
      window.getComputedStyle = originalGetComputedStyle;
    }
  });

  it("U3: defaults are written before chart construction", async () => {
    vi.mocked(Chart).mockClear();
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: { type: "line", data: { datasets: [] } },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(Chart)).toHaveBeenCalledTimes(1);
    const d = chartDefaults();
    expect(d.global.defaultFontColor).not.toBe("#666");
  });

  it("U4: data-theme flip rebuilds the chart", async () => {
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: { type: "line", data: { datasets: [] } },
    };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const oldChartInstance = mockChartInstance;

    vi.mocked(Chart).mockClear();

    document.documentElement.setAttribute("data-theme", "wa2-light");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await el.updateComplete;

    expect(vi.mocked(Chart)).toHaveBeenCalledTimes(1);
    expect(oldChartInstance?.destroy).toHaveBeenCalled();

    el.remove();
    vi.mocked(Chart).mockClear();
    document.documentElement.setAttribute("data-theme", "wa1-dark");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(Chart)).not.toHaveBeenCalled();
  });

  it("U6: a thrown non-Error during config render shows the fallback message", async () => {
    // errMessage() (Step 9) reads `.message` off an object; a thrown string has
    // none, so the naive `err instanceof Error ? err.message : String(err)`
    // rewrite this protects against would show the string instead of falling
    // back to "Failed to render chart".
    vi.mocked(Chart).mockImplementationOnce(() => {
      throw "not an Error object" as unknown;
    });
    const el = document.createElement("agent-chart-block");
    el.block = {
      type: "chart",
      config: { type: "bar", data: { labels: ["A"], datasets: [{ data: [1] }] } },
    };
    expect(() => document.body.appendChild(el)).not.toThrow();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const errorCard = el.renderRoot.querySelector(".error-card");
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain("Failed to render chart");
  });

  it("U7: options defaulting leaves a supplied responsive/maintainAspectRatio alone", async () => {
    const elWithOptions = document.createElement("agent-chart-block");
    elWithOptions.block = {
      type: "chart",
      config: {
        type: "bar",
        data: { labels: ["X"], datasets: [{ data: [1] }] },
        options: { responsive: false, maintainAspectRatio: true },
      },
    };
    document.body.appendChild(elWithOptions);
    await elWithOptions.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const optsWithOptions = chartCallConfig().options;
    expect(optsWithOptions.responsive).toBe(false);
    expect(optsWithOptions.maintainAspectRatio).toBe(true);

    vi.mocked(Chart).mockClear();
    const elNoOptions = document.createElement("agent-chart-block");
    elNoOptions.block = {
      type: "chart",
      config: { type: "bar", data: { labels: ["X"], datasets: [{ data: [1] }] } },
    };
    document.body.appendChild(elNoOptions);
    await elNoOptions.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const optsNoOptions = chartCallConfig().options;
    expect(optsNoOptions.responsive).toBe(true);
    expect(optsNoOptions.maintainAspectRatio).toBe(false);
  });

  // 003: chart-block.ts installs a ResizeObserver on itself so Chart.js
  // resizes across a shadow boundary (Chart.js 2.x's own resize detection is
  // a legacy hidden-iframe trick that does not fire there). Same shape as the
  // U4 theme-observer coverage above: assert the real behaviour an observer
  // produces, not that a field exists.
  describe("003: ResizeObserver drives Chart.js's resize() across the shadow boundary", () => {
    beforeEach(() => {
      resizeObserverCallback = null;
      resizeObserveTarget = null;
      resizeDisconnectCalls = 0;
      testWindow.ResizeObserver = MockResizeObserver;
    });

    afterEach(() => {
      delete testWindow.ResizeObserver;
    });

    it("observes the block's own host and calls chart.resize() when it fires", async () => {
      const el = document.createElement("agent-chart-block");
      el.block = {
        type: "chart",
        config: { type: "line", data: { datasets: [] } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(resizeObserveTarget).toBe(el);
      expect(mockChartInstance?.resize).not.toHaveBeenCalled();

      resizeObserverCallback?.([]);

      expect(mockChartInstance?.resize).toHaveBeenCalledTimes(1);
    });

    it("disconnects the ResizeObserver on disconnectedCallback", async () => {
      const el = document.createElement("agent-chart-block");
      el.block = {
        type: "chart",
        config: { type: "line", data: { datasets: [] } },
      };
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(resizeDisconnectCalls).toBe(0);

      el.remove();

      expect(resizeDisconnectCalls).toBe(1);

      // Disconnected: a callback fired after disposal (there shouldn't be one,
      // but even a stray call must not reach a destroyed chart) is a no-op.
      const chartAtRemoval = mockChartInstance;
      resizeObserverCallback?.([]);
      expect(chartAtRemoval?.resize).not.toHaveBeenCalled();
    });

    it("the no-ResizeObserver path still works: chart still renders, no crash", async () => {
      delete testWindow.ResizeObserver;

      const el = document.createElement("agent-chart-block");
      el.block = {
        type: "chart",
        config: { type: "line", data: { datasets: [] } },
      };
      expect(() => document.body.appendChild(el)).not.toThrow();
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(Chart)).toHaveBeenCalledTimes(1);
      expect(resizeObserveTarget).toBeNull();

      expect(() => el.remove()).not.toThrow();
    });
  });
});

