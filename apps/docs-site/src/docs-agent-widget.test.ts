// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "./docs-agent-widget";
import type { DocsAgentWidget } from "./docs-agent-widget";

describe("DocsAgentWidget", () => {
  let widget: DocsAgentWidget;

  beforeEach(() => {
    widget = document.createElement("docs-agent-widget");
  });

  afterEach(() => {
    widget.remove();
  });

  it("registers <docs-agent-widget> element", () => {
    expect(customElements.get("docs-agent-widget")).toBeDefined();
  });

  it("creates an open shadow root on append", () => {
    document.body.appendChild(widget);
    expect(widget.shadowRoot).not.toBeNull();
    expect(widget.shadowRoot!.mode).toBe("open");
  });

  it("hosts <web-agent-bubble> inside shadow root", () => {
    document.body.appendChild(widget);
    expect(widget.shadowRoot!.querySelector("web-agent-bubble")).not.toBeNull();
    expect(widget.querySelector("web-agent-bubble")).toBeNull();
  });

  it("exposes live bubble synchronously on append", () => {
    document.body.appendChild(widget);
    expect(widget.bubble.isConnected).toBe(true);
    expect(widget.bubble.shadowRoot).not.toBeNull();
  });

  it("reuses same bubble instance across reconnects", () => {
    document.body.appendChild(widget);
    const initialBubble = widget.bubble;
    widget.remove();
    document.body.appendChild(widget);
    expect(widget.shadowRoot!.querySelectorAll("web-agent-bubble").length).toBe(1);
    expect(widget.bubble).toBe(initialBubble);
  });
});
