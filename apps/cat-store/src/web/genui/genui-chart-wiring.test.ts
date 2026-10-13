import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wireChartBlocks, waitForChartsSettled } from "./genui-chart-wiring";

// Stub element that mimics the public surface of <agent-chart-block>
class StubChartBlock extends HTMLElement {
  block: unknown = undefined;
  dataSource: unknown = undefined;
  error: string | null = null;
  lastUpdated: number | null = null;
}


beforeEach(() => {
  // Register the stub element if not already registered
  if (!customElements.get("agent-chart-block")) {
    customElements.define("agent-chart-block", StubChartBlock);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  // Reset window.parent mock
  delete (window as unknown as Record<string, unknown>).__WA_GENUI_DATA_SOURCE_MOCK__;
});

function makeRoot(html: string): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

function makeBlock(jsonText: string): string {
  return `<agent-chart-block><script type="application/json">${jsonText}</script></agent-chart-block>`;
}

describe("wireChartBlocks", () => {
  it("reads the JSON child and sets block", () => {
    const root = makeRoot(makeBlock('{"type":"chart","title":"Revenue"}'));
    wireChartBlocks(root);
    const el = root.querySelector("agent-chart-block") as StubChartBlock;
    expect(el.block).toEqual({ type: "chart", title: "Revenue" });
  });

  it("sets dataSource from the parent global", () => {
    const fakeProvider = { query: vi.fn() };
    // Mock window.parent.__WA_GENUI_DATA_SOURCE__
    Object.defineProperty(window, "parent", {
      value: { __WA_GENUI_DATA_SOURCE__: fakeProvider },
      configurable: true,
    });
    const root = makeRoot(makeBlock('{"type":"chart"}'));
    wireChartBlocks(root);
    const el = root.querySelector("agent-chart-block") as StubChartBlock;
    expect(el.dataSource).toBe(fakeProvider);
    // Restore
    Object.defineProperty(window, "parent", { value: window, configurable: true });
  });

  it("wires every block in the tree", () => {
    const root = makeRoot(
      makeBlock('{"a":1}') + makeBlock('{"b":2}') + makeBlock('{"c":3}'),
    );
    wireChartBlocks(root);
    const els = root.querySelectorAll("agent-chart-block") as NodeListOf<StubChartBlock>;
    expect(els[0].block).toEqual({ a: 1 });
    expect(els[1].block).toEqual({ b: 2 });
    expect(els[2].block).toEqual({ c: 3 });
  });

  it("malformed JSON does not throw", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = makeRoot(makeBlock("{ not json }"));
    expect(() => wireChartBlocks(root)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain("not valid JSON");
  });

  it("malformed JSON leaves block unset", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const root = makeRoot(makeBlock("{ not json }"));
    wireChartBlocks(root);
    const el = root.querySelector("agent-chart-block") as StubChartBlock;
    expect(el.block).toBeUndefined();
  });

  it("missing JSON child logs error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = makeRoot("<agent-chart-block></agent-chart-block>");
    wireChartBlocks(root);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain('no <script type="application/json"> child');
  });
});

describe("waitForChartsSettled", () => {
  it("no charts at all resolves immediately with total:0", async () => {
    wireChartBlocks(makeRoot("")); // clear pending
    const result = await waitForChartsSettled(1000);
    expect(result).toEqual({ total: 0, drawn: 0, failed: 0, timedOut: false });
  });

  it("a settled-on-arrival block (config path) does not hold the wait", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A block with no `query` field is a config block — settled immediately
    const root = makeRoot(makeBlock('{"type":"chart","config":{}}'));
    wireChartBlocks(root);
    const result = await waitForChartsSettled(1000);
    expect(result.total).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("query path waits for lastUpdated", async () => {
    const root = makeRoot(makeBlock('{"query":{"source":"orders"},"encoding":{"x":"month"}}'));
    wireChartBlocks(root);
    const el = root.querySelector("agent-chart-block") as StubChartBlock;

    const settlePromise = waitForChartsSettled(2000);
    let resolved = false;
    void settlePromise.then(() => { resolved = true; });

    // Should still be pending after 200ms
    await new Promise((r) => setTimeout(r, 200));
    expect(resolved).toBe(false);

    // Simulate chart drawn
    el.lastUpdated = Date.now();
    const result = await settlePromise;
    expect(result.drawn).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("query path settles on error", async () => {
    const root = makeRoot(makeBlock('{"query":{"source":"orders"},"encoding":{"x":"month"}}'));
    wireChartBlocks(root);
    const el = root.querySelector("agent-chart-block") as StubChartBlock;

    const settlePromise = waitForChartsSettled(2000);
    await new Promise((r) => setTimeout(r, 50));
    el.error = "Query failed";

    const result = await settlePromise;
    expect(result.failed).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("the bound is honoured and console.warn is called exactly once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = makeRoot(makeBlock('{"query":{"source":"orders"},"encoding":{"x":"month"}}'));
    wireChartBlocks(root);
    // Never set lastUpdated — the chart never settles

    const result = await waitForChartsSettled(100);
    expect(result.timedOut).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("1 chart(s) still unsettled");
  });
});
