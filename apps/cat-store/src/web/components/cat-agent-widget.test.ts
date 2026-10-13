import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./cat-agent-widget";
import type { CatAgentWidget } from "./cat-agent-widget";

// 004: unit tests for <cat-agent-widget> — the shadow wrapper that hosts the bubble.
describe("CatAgentWidget", () => {
  let widget: CatAgentWidget;

  beforeEach(() => {
    widget = document.createElement("cat-agent-widget") as CatAgentWidget;
  });

  afterEach(() => {
    widget.remove();
  });

  it("the element is registered", () => {
    expect(customElements.get("cat-agent-widget")).toBeDefined();
  });

  it("has a real open shadow root after append", () => {
    document.body.appendChild(widget);
    expect(widget.shadowRoot).not.toBeNull();
    expect(widget.shadowRoot!.mode).toBe("open");
  });

  it("the bubble is inside the shadow root, not the light DOM", () => {
    document.body.appendChild(widget);
    expect(widget.shadowRoot!.querySelector("web-agent-bubble")).not.toBeNull();
    // Light DOM must remain empty
    expect(widget.querySelector("web-agent-bubble")).toBeNull();
    expect(widget.children.length).toBe(0);
  });

  it("the bubble is live in the same task as the append", () => {
    // No await — must be synchronous (performUpdate() guarantee).
    document.body.appendChild(widget);
    expect(widget.bubble.isConnected).toBe(true);
    expect(widget.bubble.shadowRoot).not.toBeNull();
  });

  it("widget.bubble is the hosted node", () => {
    document.body.appendChild(widget);
    const fromRoot = widget.shadowRoot!.querySelector("web-agent-bubble")!;
    expect(widget.bubble).toBe(fromRoot);
    // Two reads must return the same node.
    expect(widget.bubble).toBe(widget.bubble);
  });

  it("a disconnect and reconnect keeps one bubble", () => {
    document.body.appendChild(widget);
    const firstBubble = widget.bubble;
    widget.remove();
    document.body.appendChild(widget);
    expect(widget.shadowRoot!.querySelectorAll("web-agent-bubble").length).toBe(1);
    expect(widget.bubble).toBe(firstBubble);
  });

  it("the widget adopts its own styles", () => {
    document.body.appendChild(widget);
    const sheetCount =
      (widget.shadowRoot!.adoptedStyleSheets?.length ?? 0) +
      widget.shadowRoot!.querySelectorAll("style").length;
    expect(sheetCount).toBeGreaterThan(0);
  });

  it("the widget writes nothing to the document head", () => {
    document.body.appendChild(widget);
    expect(
      document.head.querySelectorAll("style[data-wa-styles]").length
    ).toBe(0);
  });
});
