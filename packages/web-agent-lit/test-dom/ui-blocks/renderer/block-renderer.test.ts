import { describe, it, expect, beforeEach } from "vitest";
import { renderBlocks } from "../../../src/ui-blocks/renderer/block-renderer.js";
import { RenderableBlock } from "@cuatoi/web-agent-core";
import { Component } from "../../../src/ui/component.js";
import { html } from "../../../src/ui/template.js";

class TestBlockContainer extends Component {
  private _blocks: RenderableBlock[] = [];
  private _disabled = false;

  get blocks() { return this._blocks; }
  set blocks(v) { this._blocks = v; this.requestUpdate(); }

  get disabled() { return this._disabled; }
  set disabled(v) { this._disabled = !!v; this.requestUpdate(); }

  template() {
    return html`
      <div>
        ${renderBlocks(this.blocks, { disabled: this.disabled })}
      </div>
    `;
  }
}

if (!customElements.get("test-block-container")) {
  customElements.define("test-block-container", TestBlockContainer);
}

describe("block-renderer renderBlocks", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders mixed blocks in order and handles error card", async () => {
    const el = document.createElement("test-block-container") as TestBlockContainer;
    el.blocks = [
      {
        type: "buttons",
        options: [{ label: "Btn 1", prompt: "p1" }],
      },
      {
        type: "error_card",
        error: "test schema validation failed",
        raw: '{"type": "form", "id": "f1"}',
      },
      {
        type: "form",
        id: "form-1",
        fields: [{ kind: "text", name: "n1", label: "L1" }],
      },
    ];
    document.body.appendChild(el);
    await el.updateComplete;

    const container = el.renderRoot.querySelector("div");
    expect(container).toBeTruthy();

    const children = container?.children;
    // Filter style and div elements (since error fallback returns wrapped div)
    const activeElements = Array.from(children || []).filter(
      (c) => c.tagName.toLowerCase() !== "style"
    );

    expect(activeElements.length).toBe(3);
    expect(activeElements[0].tagName.toLowerCase()).toBe("agent-buttons-block");
    
    // Check error_card structure: it wraps in a div container.
    // The inner class is error-card-renderer.
    const errorWrapper = activeElements[1] as HTMLElement;
    const errorCard = errorWrapper.querySelector(".error-card-renderer");
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain("test schema validation failed");
    expect(errorCard?.querySelector("pre")?.textContent).toBe('{"type": "form", "id": "f1"}');

    expect(activeElements[2].tagName.toLowerCase()).toBe("agent-form-block");
  });
});
