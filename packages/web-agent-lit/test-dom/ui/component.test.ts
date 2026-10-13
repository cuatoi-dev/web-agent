import { describe, it, expect } from "vitest";
import { Component } from "../../src/ui/component.js";
import { html } from "../../src/ui/template.js";

class TestComponent extends Component {
  count = 0;
  renders = 0;

  template() {
    this.renders++;
    return html`<div>Count: ${this.count}</div>`;
  }
}

if (!customElements.get("test-component")) {
  customElements.define("test-component", TestComponent);
}

describe("Component Base Class", () => {
  it("batches requestUpdate and resolves updateComplete", async () => {
    const el = document.createElement("test-component") as TestComponent;
    document.body.appendChild(el);

    // Initial render scheduled on connect
    await el.updateComplete;
    expect(el.renders).toBe(1);
    expect(el.textContent).toBe("Count: 0");

    // Multiple synchronous updates should be batched
    el.count = 5;
    el.requestUpdate();
    el.count = 10;
    el.requestUpdate();

    expect(el.renders).toBe(1); // Not rendered yet

    await el.updateComplete;
    expect(el.renders).toBe(2);
    expect(el.textContent).toBe("Count: 10");
  });
});
