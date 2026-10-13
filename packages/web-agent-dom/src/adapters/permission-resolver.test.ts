import { describe, it, expect, beforeEach } from "vitest";
import { resolveAgentPermission } from "./permission-resolver.js";

function setupHtml(html: string): void {
  document.body.innerHTML = html;
}

describe("resolveAgentPermission", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns allow when no data-agent-permission attribute exists", () => {
    setupHtml("<button id='btn'>Click</button>");
    const btn = document.getElementById("btn")!;
    expect(resolveAgentPermission(btn)).toEqual({ permission: "allow" });
  });

  it("returns allow for self attribute value 'allow'", () => {
    setupHtml('<button data-agent-permission="allow">Click</button>');
    const btn = document.querySelector("button")!;
    expect(resolveAgentPermission(btn)).toEqual({ permission: "allow" });
  });

  it("returns ask for self attribute value 'ask'", () => {
    setupHtml('<button data-agent-permission="ask">Delete</button>');
    const btn = document.querySelector("button")!;
    expect(resolveAgentPermission(btn)).toEqual({ permission: "ask" });
  });

  it("returns block for self attribute value 'block'", () => {
    setupHtml('<button data-agent-permission="block">Sensitive</button>');
    const btn = document.querySelector("button")!;
    expect(resolveAgentPermission(btn)).toEqual({ permission: "block" });
  });

  it("returns allow when attribute value is unrecognized", () => {
    setupHtml('<button data-agent-permission="invalid">Click</button>');
    const btn = document.querySelector("button")!;
    expect(resolveAgentPermission(btn)).toEqual({ permission: "allow" });
  });

  it("inherits from nearest ancestor when element itself lacks attribute", () => {
    setupHtml(`
      <div data-agent-permission="block">
        <div id="child">
          <button id="btn">Nested</button>
        </div>
      </div>
    `);
    const btn = document.getElementById("btn")!;
    expect(resolveAgentPermission(btn)).toEqual({ permission: "block" });
  });

  it("nearest ancestor takes precedence over farther ancestors", () => {
    setupHtml(`
      <div data-agent-permission="allow">
        <div data-agent-permission="block">
          <button id="btn">Nested</button>
        </div>
      </div>
    `);
    const btn = document.getElementById("btn")!;
    expect(resolveAgentPermission(btn)).toEqual({ permission: "block" });
  });

  it("extracts reason from data-agent-permission-reason", () => {
    setupHtml(`
      <div data-agent-permission="block" data-agent-permission-reason="User data">
        <button id="btn">Export</button>
      </div>
    `);
    const btn = document.getElementById("btn")!;
    expect(resolveAgentPermission(btn)).toEqual({
      permission: "block",
      reason: "User data",
    });
  });

  it("resolves a marker on an open shadow-root host from the inner control", () => {
    const host = document.createElement("md-icon-button");
    host.setAttribute("data-agent-permission", "ask");
    host.setAttribute("data-agent-permission-reason", "host is gated");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    inner.textContent = "Inner";
    shadow.appendChild(inner);

    expect(resolveAgentPermission(inner)).toEqual({
      permission: "ask",
      reason: "host is gated",
    });
  });

  it("resolves a marker on a light-DOM ancestor of an open shadow-root host", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-agent-permission", "block");
    document.body.appendChild(wrapper);
    const host = document.createElement("md-icon-button");
    wrapper.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    inner.textContent = "Inner";
    shadow.appendChild(inner);

    expect(resolveAgentPermission(inner)).toEqual({ permission: "block" });
  });

  it("returns allow for a marker on a closed shadow-root host", () => {
    const host = document.createElement("md-icon-button");
    host.setAttribute("data-agent-permission", "ask");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "closed" });
    const inner = document.createElement("button");
    inner.textContent = "Inner";
    shadow.appendChild(inner);

    expect(resolveAgentPermission(inner)).toEqual({ permission: "allow" });
  });
});
