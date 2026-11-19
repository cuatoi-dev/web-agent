import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
// Registers <web-agent-bubble>; it imports chat-panel, which registers <agent-chat-panel>.
import "@cuatoi/web-agent-lit/embed/web-agent-embed";
import type { WebAgentBubble } from "@cuatoi/web-agent-lit";

/**
 * Host wrapper that proves the nested shadow-DOM pattern on docs-site.
 *
 * Mirrors cat-store's CatAgentWidget: a Lit element with a real
 * shadow root that hosts <web-agent-bubble>, so the nesting is
 * widget shadow -> bubble shadow -> panel. docs-site uses the DEFAULT UI
 * registry (unlike cat-store, which aliases it to Material), so this is the
 * app that proves the package's own `.wa-*` CSS rules apply through two
 * nested open shadow boundaries.
 *
 * There is deliberately NO createRenderRoot() override. Returning `this` would
 * render into the light DOM and prove nothing.
 */
@customElement("docs-agent-widget")
export class DocsAgentWidget extends LitElement {
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

  private readonly _bubble = document.createElement("web-agent-bubble");

  constructor() {
    super();
    // Forward web-agent-bubble's ::part() names through this element's
    // own shadow boundary, so a host stylesheet can still write
    // `docs-agent-widget::part(launcher-icon)` etc. — a ::part() selector only
    // pierces the one shadow root of the element it names, and the bubble now
    // sits one boundary further from the document than before this wrapper.
    this._bubble.setAttribute("exportparts", "launcher, launcher-icon, panel-container");
  }

  /** The hosted bubble. Live from the moment this element is connected, so the
   *  host can configure it and read `bubble.shadowRoot` in the same task as the
   *  append. */
  get bubble(): WebAgentBubble {
    return this._bubble;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Lit schedules its first update on a microtask. docs-embed.ts wires the
    // bubble immediately after locating this element, so render now.
    // performUpdate() is a no-op on a re-connect (no update pending), so the
    // same bubble node is reused and no second one is created.
    this.performUpdate();
  }

  render() {
    return html`<div class="agent-host">${this._bubble}</div>`;
  }
}
