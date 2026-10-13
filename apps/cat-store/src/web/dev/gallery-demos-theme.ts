// gallery-demos-theme.ts — the theme showcase demo extracted from gallery-demos.ts.

import { genuiRenderers, type AgentChatPanel } from "@cuatoi/web-agent-lit";
import type { AgentSession, SessionState } from "@cuatoi/web-agent-core";
import { store } from "../store";
import { applyTheme, resolveTheme } from "./gallery-theme";
import {
  getShowcaseThemes,
  frameUrl,
  buildShowcaseState,
  type ShowcaseTheme,
} from "./theme-showcase-data";

// ============================================================================
// 3c. THEME SHOWCASE DEMO
// ============================================================================

function makeFakeSession(sessionState: SessionState): AgentSession {
  return {
    getState: () => sessionState,
    subscribe: (cb: (s: SessionState) => void) => { cb(sessionState); return () => {}; },
    send: async () => {}, abort: () => {}, compact: async () => {}, reset: async () => {},
    createSession: async () => {}, switchSession: async () => {}, deleteSession: async () => {},
    setTitle: async () => {}, refreshSessions: async () => {}, updateConfig: () => {},
    setModel: () => {}, autoTitle: async () => {}, dispose: () => {},
    subscribeEvents: () => () => {}, retryLast: async () => {}, cancelQueued: () => {},
    popLastQueued: () => undefined, clearQueue: () => {}, clearAllSessions: async () => {},
    initPromise: Promise.resolve(),
    getAttachmentProviders: () => [],
    commands: () => [],
    resolveCommand: () => undefined,
    enqueueCommand: () => {},
    runCommand: () => Promise.resolve({ ran: true, startedTurn: false }),
    pendingCounts: () => ({ schedules: 0, reminders: 0, total: 0 }),
    todos: () => [],
    availableTools: () => [],
  };
}

function renderShowcaseFrame(host: HTMLElement, theme: ShowcaseTheme) {
  applyTheme(theme === "provided" ? "wa2-light" : theme);
  host.style.cssText = "margin:0;padding:0;background:var(--wa-background-color)";

  const panel = document.createElement("agent-chat-panel");
  panel.store = store as unknown as AgentChatPanel["store"];
  panel.appContext = { appName: "Cat Store", appDescription: "A pet store selling organic cat food products." };
  panel.config = { persist: false };
  panel.renderers = [...genuiRenderers];
  panel.imageInput = false;
  panel.session = makeFakeSession(buildShowcaseState());
  panel.style.cssText = "height:auto;border-radius:0;box-shadow:none";

  if (theme === "provided") {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-theme", "provided");
    wrapper.style.cssText =
      "--wa-action-color-info:#c2185b;" +
      "--wa-border-color:#e0e0e0;" +
      "--md-filled-button-container-color:#c2185b;" +
      "--md-filled-button-label-text-color:#ffffff";
    wrapper.appendChild(panel);
    host.appendChild(wrapper);
  } else {
    host.appendChild(panel);
  }

  // Measure the intrinsic panel height after rendering and width changes.
  // Observe the panel instead of the document to avoid iframe-height feedback.
  const frame = window.frameElement as HTMLIFrameElement | null;
  if (frame) {
    const observer = new ResizeObserver(() => {
      frame.style.height = `${Math.ceil(panel.getBoundingClientRect().height)}px`;
    });
    observer.observe(panel);
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  }
}

export function mountThemeShowcaseDemo(host: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  if (params.get("showcase") === "1") {
    const requested = params.get("theme");
    const theme: ShowcaseTheme = requested === "provided" ? "provided" : resolveTheme(location.search, "wa2-dark");
    renderShowcaseFrame(host, theme);
    return;
  }

  host.innerHTML = `
    <style>
      .theme-showcase-container {
        margin: 0;
        padding: var(--wa-padding-xl, 16px);
        font-family: var(--wa-font-family, system-ui, -apple-system, sans-serif);
        background: var(--wa-background-color, #fafafa);
        color: var(--wa-text-color, #333);
      }
      .theme-showcase-container h1 { font-size: 1.4rem; margin: 0 0 var(--wa-padding-m, 8px); }
      .theme-showcase-container p.lead {
        margin: 0 0 var(--wa-padding-xl, 16px);
        color: var(--wa-label-color, #555);
        font-size: var(--wa-font-size-m, 0.95rem);
      }
      #frames {
        display: grid;
        gap: var(--wa-padding-xl, 16px);
        grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      }
      @media (max-width: 1180px) { #frames { grid-template-columns: 1fr; } }
      .frame-card {
        margin: 0;
        background: var(--wa-smart-list-background-color, #fff);
        border: 1px solid var(--wa-border-color, #e0e0e0);
        border-radius: var(--wa-border-radius-l, 8px);
        box-shadow: var(--wa-elevation-m, none);
        padding: var(--wa-padding-m, 8px);
        box-sizing: border-box;
      }
      .frame-card iframe {
        display: block;
        width: 100%;
        height: auto;
        border: 0;
        border-radius: var(--wa-border-radius-l, 8px);
      }
      .frame-card figcaption {
        padding: var(--wa-padding-m, 8px) var(--wa-padding-s, 4px) 0;
        font-size: var(--wa-font-size-s, 0.85rem);
        color: var(--wa-label-color, #555);
      }
    </style>
    <div class="theme-showcase-container">
      <h1>Agent theme showcase</h1>
      <p class="lead">The same agent panel, same canned conversation, rendered in each registered theme plus a <em>host-provided</em> (<code>provided</code>) card. Each panel is its own document, so each carries its own <code>data-theme</code>. The <code>provided</code> card demonstrates a host supplying its own <code>--wa-*</code> values while unset tokens inherit the <code>wa2-light</code> base theme.</p>
      <div id="frames"></div>
    </div>
  `;

  const grid = host.querySelector("#frames");
  if (!grid) return;
  for (const { id: theme, label } of getShowcaseThemes()) {
    const figure = document.createElement("figure");
    figure.className = "frame-card";
    figure.dataset.theme = theme;

    const frame = document.createElement("iframe");
    frame.src = frameUrl(theme);
    frame.title = `Agent panel — ${label}`;
    frame.setAttribute("data-theme-frame", theme);

    const caption = document.createElement("figcaption");
    caption.textContent = `${label} — ${theme}`;

    figure.appendChild(frame);
    figure.appendChild(caption);
    grid.appendChild(figure);
  }
}
