import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { MockInstance } from "vitest";
import { runHooks, type AgentHooks, type ToolContext } from "@cuatoi/web-agent-core";
import { navigate } from "./router";
import type { WebAgentBubble } from "@cuatoi/web-agent-lit/embed/web-agent-embed";
import { setToast } from "./store/ui-slice";

// Cat-store wires all seven `panel.hooks` as console loggers. The
// per-tool completion toast was removed; `panel.notify` (the general toast
// channel) stays.
describe("web/index hooks wiring", () => {
  const EVENTS: (keyof AgentHooks)[] = [
    "onSessionStart",
    "onUserPrompt",
    "onPreTool",
    "onPostTool",
    "onTurnEnd",
    "onPreCompact",
    "onPostCompact",
  ];

  const PAYLOADS: Record<keyof AgentHooks, unknown> = {
    onSessionStart: { sessionId: "s-1" },
    onUserPrompt: { parts: [{ type: "text", text: "hi" }] },
    onPreTool: { name: "add_to_cart", input: { id: "p01" }, summary: "Add Salmon Pâté", ctx: {} },
    onPostTool: { name: "add_to_cart", input: {}, outcome: { content: "Added 1x Salmon Pâté" } },
    onTurnEnd: { result: { assistantText: "done", blocks: [], stopReason: "end_turn" }, stopReason: "end_turn" },
    onPreCompact: { tokens: 4000, percent: 0.8 },
    onPostCompact: { tokensBefore: 4000, tokensAfter: 1200 },
  };

  let bubble: WebAgentBubble;
  let spy: MockInstance;

  beforeAll(async () => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
    document.body.innerHTML = '<div id="app"></div><div data-agent-ui></div>';
    await import("./index");
    // The bubble now lives inside <cat-agent-widget>'s shadow root.
    const widget = document.querySelector("[data-agent-ui] cat-agent-widget");
    bubble = widget!.shadowRoot!.querySelector("web-agent-bubble") as WebAgentBubble;
  });

  afterAll(() => {
    spy.mockRestore();
  });

  it("wires all seven panel.hooks as functions", () => {
    expect(bubble).not.toBeNull();
    expect(bubble.hooks).toBeDefined();
    for (const evt of EVENTS) {
      expect(typeof bubble.hooks![evt]).toBe("function");
    }
    // notify stays wired — it's the panel's general toast channel (e.g. the
    // image-downscale hint), separate from the tool-lifecycle hooks.
    expect(typeof bubble.notify).toBe("function");
  });

  it("each hook logs exactly one line with the shared prefix and its own name", () => {
    for (const evt of EVENTS) {
      spy.mockClear();
      (bubble.hooks![evt] as (p: unknown) => void)(PAYLOADS[evt]);
      expect(spy).toHaveBeenCalledTimes(1);
      const line = String(spy.mock.calls[0][0]);
      expect(line).toContain("[cat-store hooks]");
      expect(line).toContain(evt);
    }
  });

  it("logs the payload detail that makes each line useful", () => {
    spy.mockClear();
    (bubble.hooks!.onSessionStart as (p: unknown) => void)(PAYLOADS.onSessionStart);
    expect(String(spy.mock.calls[0][0])).toContain("s-1");

    spy.mockClear();
    (bubble.hooks!.onPreTool as (p: unknown) => void)(PAYLOADS.onPreTool);
    expect(String(spy.mock.calls[0][0])).toContain("add_to_cart");

    spy.mockClear();
    (bubble.hooks!.onPostTool as (p: unknown) => void)(PAYLOADS.onPostTool);
    expect(String(spy.mock.calls[0][0])).toContain("add_to_cart");
    expect(String(spy.mock.calls[0][0])).toContain("isError=false");

    spy.mockClear();
    (bubble.hooks!.onTurnEnd as (p: unknown) => void)(PAYLOADS.onTurnEnd);
    expect(String(spy.mock.calls[0][0])).toContain("end_turn");

    spy.mockClear();
    (bubble.hooks!.onPreCompact as (p: unknown) => void)(PAYLOADS.onPreCompact);
    expect(String(spy.mock.calls[0][0])).toContain("80%");

    spy.mockClear();
    (bubble.hooks!.onPostCompact as (p: unknown) => void)(PAYLOADS.onPostCompact);
    expect(String(spy.mock.calls[0][0])).toContain("4000");
    expect(String(spy.mock.calls[0][0])).toContain("1200");
  });

  it("onPostTool no longer dispatches a completion toast", async () => {
    const { store } = await import("./store");
    store.dispatch(setToast(null));
    spy.mockClear();
    await (bubble.hooks!.onPostTool as (p: unknown) => Promise<void>)({
      name: "add_to_cart",
      input: {},
      outcome: { content: "Added 1x Salmon Pâté" },
    });
    expect(store.getState().ui.toast).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("onPostTool does not dispatch a toast for an error outcome either", async () => {
    const { store } = await import("./store");
    store.dispatch(setToast(null));
    spy.mockClear();
    await (bubble.hooks!.onPostTool as (p: unknown) => Promise<void>)({
      name: "add_to_cart",
      input: {},
      outcome: { content: "failed", isError: true },
    });
    expect(store.getState().ui.toast).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("isError=true");
  });

  it("panel.notify still dispatches to the toast state", async () => {
    const { store } = await import("./store");
    bubble.notify!("Image resized to fit size limits");
    expect(store.getState().ui.toast).toBe("Image resized to fit size limits");
  });

  it("observe-only result-bearing hooks return undefined", async () => {
    const call = (evt: keyof AgentHooks) => (bubble.hooks![evt] as (p: unknown) => Promise<unknown>)(PAYLOADS[evt]);
    expect(await call("onUserPrompt")).toBeUndefined();
    expect(await call("onPreTool")).toBeUndefined();
    expect(await call("onPostTool")).toBeUndefined();
    expect(await call("onPreCompact")).toBeUndefined();
  });

  it("theme change updates appContext.appInstructions with the new label and id", async () => {
    const { setStoredTheme } = await import("./theme");
    setStoredTheme("wa1-dark");
    expect(bubble.appContext?.appInstructions).toContain("wa1-dark");
    expect(bubble.appContext?.appInstructions).toContain("WA v1 (Dark)");

    setStoredTheme("wa2-light");
    expect(bubble.appContext?.appInstructions).toContain("wa2-light");
    expect(bubble.appContext?.appInstructions).toContain("WA v2 (Light)");
  });

  it("the merged onPreTool decision is still allow", async () => {
    const result = await runHooks(
      { onPreTool: bubble.hooks!.onPreTool },
      "onPreTool",
      { name: "click", input: { ref: "e1" }, ctx: {} as unknown as ToolContext },
    );
    expect(result).toEqual({ decision: "allow", reason: undefined, input: { ref: "e1" } });
  });

  it("the host mounts the widget, and the widget hosts the bubble", async () => {
    // Cat-agent-widget wraps the bubble inside its own shadow root.
    const widgetInDom = document.querySelector("[data-agent-ui] cat-agent-widget");
    expect(widgetInDom).not.toBeNull();
    // The bubble must NOT be a direct child of [data-agent-ui] (it lives in the shadow root).
    expect(document.querySelector("[data-agent-ui] web-agent-bubble")).toBeNull();
    // The bubble we resolved in beforeAll is not null and has the store wired.
    expect(bubble).not.toBeNull();
    const { store: appStore } = await import("./store");
    expect(bubble.store).toBe(appStore);
  });
});

describe("003a: bubble visibility on route change", () => {
  // jsdom dispatches `hashchange` asynchronously (queued via setTimeout(0)), so
  // each navigation needs one macrotask for the router listener to run it.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const agentUi = () => document.querySelector("[data-agent-ui]") as HTMLElement;
  const bubbleEl = () => {
    const widget = document.querySelector("[data-agent-ui] cat-agent-widget");
    return widget?.shadowRoot?.querySelector("web-agent-bubble") as WebAgentBubble | undefined;
  };

  it("hides [data-agent-ui] when route switches to /agent", async () => {
    navigate("/agent");
    await settle();
    expect(agentUi().style.display).toBe("none");
  });

  it("shows [data-agent-ui] when route switches to /store", async () => {
    navigate("/store");
    await settle();
    expect(agentUi().style.display).toBe("");
  });

  it("closes an open bubble panel before hiding on /agent", async () => {
    navigate("/store");
    await settle();
    const bubble = bubbleEl()!;
    bubble.toggle();
    const container = bubble.shadowRoot!.querySelector("#panel-container") as HTMLElement;
    expect(container.style.display).toBe("flex");

    navigate("/agent");
    await settle();
    expect(container.style.display).toBe("none");
    expect(agentUi().style.display).toBe("none");
  });

  it("preserves the widget element in the DOM on /agent", async () => {
    navigate("/agent");
    await settle();
    expect(document.querySelector("[data-agent-ui] cat-agent-widget")).not.toBeNull();
  });
});
