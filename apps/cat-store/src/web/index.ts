import "@cuatoi/web-agent-lit/themes/wa-tokens.css";
import "./store";
import "./router";
import "./components/app-root";
import "./components/landing-view";
import "./components/store-view";
import "./components/cart-view";
import "./components/toast-host";
import "./components/product-card";
import "./components/orders-page";
import "@material/web/button/filled-button.js";
import "@material/web/iconbutton/icon-button.js";
import { currentPath, navigate, registerOnNavigate } from "./router";
// Registers <web-agent-bubble>; it imports chat-panel.js, which registers <agent-chat-panel>.
import "@cuatoi/web-agent-lit/embed/web-agent-embed";
import type { AgentChatPanel } from "@cuatoi/web-agent-lit";
import { configureAgentPanel } from "./agent-panel-config";
import { enablePanelResize } from "./panel-resize";
import { ACME_PANEL_MD_STYLES } from "../acme-registry";
// 004: the shadow wrapper that hosts the bubble.
import { CatAgentWidget } from "./components/cat-agent-widget";
import { CAT_STORE_LAUNCHER_ICON } from "./dev/gallery-states";
import { THEME_CHANGE_EVENT } from "./theme";
import { loadCustomPromptConfig } from "./agent-prompt-config";
import { composeAppContext } from "./components/agent-page-support";

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `<app-root></app-root>`;
}

const app = document.getElementById("app");
if (app) {
  mountApp(app);
  navigate(currentPath());
}

const agentUi = document.querySelector("[data-agent-ui]");
if (agentUi) {
  agentUi.innerHTML = "";
  // 004: the bubble is hosted inside the widget's shadow root, not appended to
  // the light DOM. The widget renders synchronously on connect, so `bubble` is
  // already connected here and its own shadow root is live — which is what the
  // Material sheet append and enablePanelResize() below rely on.
  const widget = new CatAgentWidget();
  const panel = widget.bubble;
  // 003: the shared cat-store agent wiring. Configure BEFORE append so every
  // property is set before the element connects to the document.
  // WebAgentBubble is a panel-like proxy (web-agent-embed.ts), not the real
  // <agent-chat-panel> agent-page.ts builds — it forwards every property
  // configureAgentPanel writes onto its own internal panel, which is what
  // lets one function configure either host.
  configureAgentPanel(panel as unknown as AgentChatPanel, { domAccess: true, memory: false });
  window.addEventListener(THEME_CHANGE_EVENT, () => {
    if (panel.appContext) {
      panel.appContext = composeAppContext(panel.appContext, loadCustomPromptConfig());
    }
  });
  // cat-store vendors no Material Symbols icon font, so both glyphs must
  // render without one: an inline SVG for the launcher (B-2 — the previous
  // 🐱 emoji failed contrast, see gallery-blocks.ts), a plain "✕" for close.
  panel.launcherIcon = CAT_STORE_LAUNCHER_ICON;
  panel.closeIcon = "✕";
  agentUi.appendChild(widget);
  // 003: the panel now lives in the bubble's OPEN shadow root, so the
  // `agent-chat-panel md-*` rules that map Material Web onto --wa-* tokens
  // must live in that tree too. The document.head copy in acme-registry.ts
  // still serves the light-DOM panels (gallery, ?frame=).
  const mdStyle = document.createElement("style");
  mdStyle.setAttribute("data-wa-styles", "acme-md-tokens");
  mdStyle.textContent = ACME_PANEL_MD_STYLES;
  // Already connected (comment above) so the shadow root is live.
  panel.shadowRoot!.appendChild(mdStyle);
  // 003: host opt-in for the drag-to-resize grip. Must come after the append —
  // the bubble builds #panel-container in connectedCallback.
  enablePanelResize(panel);

  // 003a: one agent surface at a time. The full-page agent at #/agent already
  // hosts its own chat panel, so hide the floating bubble launcher there and
  // restore it on every shop route. The widget stays mounted — hiding is CSS
  // only, and closing an open panel before hiding keeps the launcher collapsed
  // when the visitor returns to a shop page.
  const updateBubbleVisibility = (path: string) => {
    const isAgentPage = path === "/agent" || path === "agent";
    if (isAgentPage) {
      // The panel container starts hidden and shows only after a launcher
      // click; on a visit that never opened the panel there is nothing to close.
      const container = widget.bubble.shadowRoot?.querySelector<HTMLElement>("#panel-container") ?? null;
      if (container && container.style.display !== "none") {
        widget.bubble.toggle();
      }
      (agentUi as HTMLElement).style.display = "none";
    } else {
      (agentUi as HTMLElement).style.display = "";
    }
  };

  registerOnNavigate(updateBubbleVisibility);
  // A direct load of #/agent fires no navigation event, so check the initial
  // path explicitly.
  updateBubbleVisibility(currentPath());
}

