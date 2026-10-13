import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
// Registers <web-agent-bubble>; it imports chat-panel.js, which registers <agent-chat-panel>.
// Kept as its own side-effect-only import: WebAgentBubble below is used only in
// type position, and a bundler that sees no value usage of a named import can
// elide the whole import — which would silently drop this registration.
import "@cuatoi/web-agent-lit/embed/web-agent-embed";
import type { WebAgentBubble } from "@cuatoi/web-agent-lit/embed/web-agent-embed";

/**
 * 004 — the host wrapper that proves the nested shadow-DOM hosting pattern.
 *
 * It mirrors the internal `dracoda-widget`: a Lit element with a real shadow
 * root that holds <web-agent-bubble> inside it, so the nesting is
 * widget shadow -> bubble shadow -> panel.
 *
 * There is deliberately NO createRenderRoot() override. Returning `this` would
 * render into the light DOM and prove nothing.
 */
@customElement("cat-agent-widget")
export class CatAgentWidget extends LitElement {
  /** `display: contents` on purpose. The launcher, the panel container and the
   *  resize grip are all `position: fixed`, and a fixed descendant resolves
   *  against the nearest ancestor that establishes a containing block. Never
   *  give this element `transform`, `filter`, `backdrop-filter`, `perspective`,
   *  `will-change` or `contain: paint` — any of them would trap the launcher
   *  and the grip inside this element's box instead of the viewport. */
  static styles = css`
    :host {
      display: contents;
    }
    .agent-host {
      display: contents;
    }
  `;

  // "web-agent-bubble" is not in lib.dom's HTMLElementTagNameMap, so
  // createElement returns a plain HTMLElement; WebAgentBubble is the real
  // registered class (web-agent-embed.ts:418).
  private readonly _bubble = document.createElement("web-agent-bubble") as WebAgentBubble;

  /** The hosted bubble. Live from the moment this element is connected, so the
   *  host can configure it and read `bubble.shadowRoot` in the same task as the
   *  append. */
  get bubble(): WebAgentBubble {
    return this._bubble;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Lit schedules its first update on a microtask. index.ts configures the
    // bubble, appends the Material sheet to its shadow root and wires the
    // resize grip immediately after appending this element, so render now.
    // performUpdate() is a no-op on a re-connect (no update pending), so the
    // same bubble node is reused and no second one is created.
    this.performUpdate();
  }

  render() {
    return html`<div class="agent-host">${this._bubble}</div>`;
  }
}
