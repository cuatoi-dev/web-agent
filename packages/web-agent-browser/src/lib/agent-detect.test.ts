import { describe, it, expect, beforeEach } from "vitest";
import { findForeignAgent } from "./agent-detect";

describe("findForeignAgent", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns null for a document with no agent element", () => {
    document.body.innerHTML = "<div><h1>Hello</h1><p>World</p></div>";
    expect(findForeignAgent(document, null)).toBeNull();
  });

  it("finds a web-agent-bubble in the light DOM", () => {
    const bubble = document.createElement("web-agent-bubble");
    document.body.appendChild(bubble);
    expect(findForeignAgent(document, null)).toBe(bubble);
  });

  it("finds a web-agent-bubble nested one open shadow root down", () => {
    const widget = document.createElement("host-agent-widget");
    document.body.appendChild(widget);
    const shadow = widget.attachShadow({ mode: "open" });
    const bubble = document.createElement("web-agent-bubble");
    shadow.appendChild(bubble);

    // Regression guard: flat querySelector fails on shadow root
    expect(document.querySelector("web-agent-bubble")).toBeNull();
    // findForeignAgent traverses open shadow root and finds it
    expect(findForeignAgent(document, null)).toBe(bubble);
  });

  it("finds an agent two shadow roots down", () => {
    const widget = document.createElement("host-agent-widget");
    document.body.appendChild(widget);
    const shadow1 = widget.attachShadow({ mode: "open" });
    const hostBubble = document.createElement("host-bubble-stub");
    shadow1.appendChild(hostBubble);
    const shadow2 = hostBubble.attachShadow({ mode: "open" });
    const panel = document.createElement("agent-chat-panel");
    shadow2.appendChild(panel);

    const found = findForeignAgent(document, null);
    expect(found).not.toBeNull();
    expect(found?.tagName).toBe("AGENT-CHAT-PANEL");
  });

  it("finds an agent-chat-panel with no bubble around it", () => {
    const panel = document.createElement("agent-chat-panel");
    document.body.appendChild(panel);
    expect(findForeignAgent(document, null)).toBe(panel);
  });

  it("returns null when the only match is own", () => {
    const ownBubble = document.createElement("web-agent-bubble");
    document.body.appendChild(ownBubble);
    expect(findForeignAgent(document, ownBubble)).toBeNull();
  });

  it("returns null when the only match is inside own shadow root", () => {
    const ownBubble = document.createElement("web-agent-bubble");
    document.body.appendChild(ownBubble);
    const shadow = ownBubble.attachShadow({ mode: "open" });
    const panel = document.createElement("agent-chat-panel");
    shadow.appendChild(panel);

    expect(findForeignAgent(document, ownBubble)).toBeNull();
  });

  it("ignores a closed shadow root where el.shadowRoot is null", () => {
    const host = document.createElement("closed-host");
    document.body.appendChild(host);
    // When mode is closed, attachShadow returns root but host.shadowRoot remains null
    const closedRoot = host.attachShadow({ mode: "closed" });
    closedRoot.appendChild(document.createElement("web-agent-bubble"));

    expect(host.shadowRoot).toBeNull();
    expect(findForeignAgent(document, null)).toBeNull();
  });
});
