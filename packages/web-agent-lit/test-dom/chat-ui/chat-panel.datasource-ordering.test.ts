import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import type { BlockRenderer, RenderCtx } from "../../src/ui-blocks/renderer/types.js";
import type { AgentSession, SessionState, DataSourceProvider, RenderableBlock } from "@cuatoi/web-agent-core";

// Register the element once for the whole file.
if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeSource(name: string) {
  return {
    describe: () => ({
      name,
      description: `${name} stub`,
      fields: [
        { name: "m", type: "string" as const },
        { name: "revenue", type: "number" as const },
      ],
      rowCount: 2,
    }),
    query: () => Promise.resolve({
      rows: [
        { m: "Jan", revenue: 10 },
        { m: "Feb", revenue: 20 },
      ],
      page: { limit: 50, offset: 0, total: 2, hasMore: false },
    }),
  };
}

/** Captures the DataSourceProvider each rendered block receives. */
const seen: (DataSourceProvider | undefined)[] = [];
const captureRenderer: BlockRenderer = {
  types: ["chart"],
  render(_block: RenderableBlock, ctx: RenderCtx) {
    seen.push(ctx.dataSource);
    const el = document.createElement("div");
    el.className = "captured";
    return el;
  },
};

const chartBlock = {
  type: "chart",
  query: { source: "orders" },
  encoding: {
    mark: "line",
    x: { field: "m", type: "nominal" },
    y: { field: "revenue", type: "quantitative" },
  },
};

/** Build a minimal fake session so the panel does not try to create a transport. */
function makeMockSession() {
  return {
    getState: () => ({
      activeSessionId: "s1",
      sessions: [
        {
          id: "s1",
          title: "T",
          titleManual: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
        },
      ],
      messages: [],
      running: false,
      compacting: false,
      canCompact: false,
      error: null,
      contextWindow: { used: 0, total: 128000, percent: 0 },
      queuedMessages: [],
    }),
    subscribe: (cb: (s: SessionState) => void) => {
      cb({
        activeSessionId: "s1",
        sessions: [
          {
            id: "s1",
            title: "T",
            titleManual: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
          },
        ],
        messages: [],
        running: false,
        compacting: false,
        canCompact: false,
        error: null,
        contextWindow: { used: 0, total: 128000, percent: 0 },
        queuedMessages: [],
      });
      return () => {};
    },
    subscribeEvents: () => () => {},
    updateConfig: () => {},
    dispose: () => {},
    availableTools: () => [],
  };
}

/** Two awaits: panel + message-view's microtask update. Same idiom as
 *  chart-block.test.ts:185-186. */
async function flushUpdates(el: AgentChatPanel) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat-panel datasource ordering (003b)", () => {
  let element: AgentChatPanel;
  let element2: AgentChatPanel;

  beforeEach(() => {
    seen.length = 0;
    element = document.createElement("agent-chat-panel");
    element.session = makeMockSession() as unknown as AgentSession;
    element.renderers = [captureRenderer];
    // panel.sources is NOT set here — that is the bug scenario.
  });

  afterEach(() => {
    element.remove();
    element2?.remove();
    seen.length = 0;
  });

  // -------------------------------------------------------------------------
  // A1 — `sources` assigned AFTER connect reaches rendered blocks.
  // This test must fail against unmodified chat-panel.ts.
  // -------------------------------------------------------------------------
  it("A1 — sources assigned after connect reaches rendered blocks (regression)", async () => {
    document.body.appendChild(element);
    await element.updateComplete;

    // Assign sources after the element is already connected.
    element.sources = [makeSource("orders")];
    element.messages = [
      { role: "assistant", text: "", blocks: [chartBlock] },
    ];

    await flushUpdates(element);

    expect(seen.length).toBeGreaterThan(0);
    await expect(
      seen.at(-1)!.query({ source: "orders" })
    ).resolves.toMatchObject({
      rows: [{ m: "Jan", revenue: 10 }, { m: "Feb", revenue: 20 }],
    });
  });

  // -------------------------------------------------------------------------
  // A2 — a second assignment is picked up (not just the first after connect).
  // -------------------------------------------------------------------------
  it("A2 — a second sources assignment is picked up", async () => {
    document.body.appendChild(element);
    await element.updateComplete;

    // First assignment.
    element.sources = [makeSource("orders")];
    element.messages = [
      { role: "assistant", text: "", blocks: [chartBlock] },
    ];
    await flushUpdates(element);

    // Second assignment with a different source name.
    element.sources = [makeSource("invoices")];
    await flushUpdates(element);

    const latest = seen.at(-1)!;
    await expect(
      latest.query({ source: "invoices" })
    ).resolves.toMatchObject({
      rows: [{ m: "Jan", revenue: 10 }, { m: "Feb", revenue: 20 }],
    });
    // The old source name should now throw.
    await expect(
      latest.query({ source: "orders" })
    ).rejects.toThrow(/Unknown source "orders"/);
  });

  // -------------------------------------------------------------------------
  // A3 — configure-before-connect still works (cat-store production ordering).
  // -------------------------------------------------------------------------
  it("A3 — configure before append still works", async () => {
    element2 = document.createElement("agent-chat-panel");
    element2.session = makeMockSession() as unknown as AgentSession;
    element2.renderers = [captureRenderer];
    // Set sources BEFORE appending.
    element2.sources = [makeSource("orders")];
    document.body.appendChild(element2);
    await element2.updateComplete;

    element2.messages = [
      { role: "assistant", text: "", blocks: [chartBlock] },
    ];
    await flushUpdates(element2);

    expect(seen.length).toBeGreaterThan(0);
    await expect(
      seen.at(-1)!.query({ source: "orders" })
    ).resolves.toMatchObject({
      rows: [{ m: "Jan", revenue: 10 }, { m: "Feb", revenue: 20 }],
    });
  });

  // -------------------------------------------------------------------------
  // A4 — the provider identity changes on each `sources` set (lit-html
  // dirty-checks with !==, so identity change is required for re-propagation).
  // -------------------------------------------------------------------------
  it("A4 — provider identity changes after sources reassignment", async () => {
    document.body.appendChild(element);
    await element.updateComplete;

    // First assignment.
    element.sources = [makeSource("orders")];
    element.messages = [
      { role: "assistant", text: "", blocks: [chartBlock] },
    ];
    await flushUpdates(element);
    expect(seen.length).toBeGreaterThan(0);
    const first = seen.at(-1)!;
    expect(first).not.toBeUndefined();

    // Second assignment.
    element.sources = [makeSource("invoices")];
    await flushUpdates(element);
    const second = seen.at(-1)!;
    expect(second).not.toBeUndefined();

    // Identity must differ so lit-html re-sets the property.
    expect(second).not.toBe(first);
  });

  // -------------------------------------------------------------------------
  // A5 — with NO `sources` at all the panel still supplies a provider (never
  // `undefined`), and the block shows the "Unknown source" error from the
  // provider rather than the "no dataSource" message from chart-block.ts.
  // -------------------------------------------------------------------------
  it("A5 — no sources still yields a provider (not undefined)", async () => {
    // No sources set.
    document.body.appendChild(element);
    await element.updateComplete;

    element.messages = [
      { role: "assistant", text: "", blocks: [chartBlock] },
    ];
    await flushUpdates(element);

    expect(seen.length).toBeGreaterThan(0);
    const provider = seen.at(-1)!;
    expect(provider).not.toBeUndefined();
    // Provider has no sources, so querying "orders" should throw the registry
    // error — not a crash on an undefined provider.
    await expect(
      provider.query({ source: "orders" })
    ).rejects.toThrow(/Unknown source "orders"/);
  });
});
