import '@cuatoi/web-agent-lit/themes/wa-tokens.css';
import { genuiRenderers, createConfirmScrim, type AgentChatPanel, type WebAgentBubble } from '@cuatoi/web-agent-lit';
import { chartingRenderers } from '@cuatoi/web-agent-charting/lit';
import type { AgentSession, AvailableTool, SessionState, TodoItem } from '@cuatoi/web-agent-core';
import { store } from '../store';
import { GALLERY_STATES, type GalleryState, CAT_STORE_LAUNCHER_ICON } from './gallery-states';
import { DEMO_STATES } from './gallery-demos';
import { resolveTheme, applyTheme, mountThemeSwitcher, type GalleryTheme } from './gallery-theme';

/** A fixed, representative tool list for the gallery's debug tile. The
 *  gallery's session is entirely scripted — fake state, fake transcript — so
 *  its tool list is a fixture too. It must never be rebuilt from a
 *  `ToolContext`: only a live session can say what the model was really
 *  given. */
const DEMO_AVAILABLE_TOOLS: AvailableTool[] = [
  { name: 'wait', description: 'Pause for a number of seconds before the next step.' },
  { name: 'get_time', description: "Read the user's current local date and time." },
  { name: 'query_data', description: 'Query a registered data source and return matching rows.' },
  { name: 'show_generative_ui', description: 'Render an interactive block in the transcript.' },
  { name: 'compact_conversation', description: 'Compress older turns to free context room.' },
  { name: 'add_to_cart', description: 'Add a quantity of a product to the shopping cart.' },
];

function makeFakeSession(state: SessionState, todos: TodoItem[] = []): AgentSession {
  return {
    getState: () => state,
    subscribe: (cb: (s: SessionState) => void) => {
      cb(state);
      return () => {};
    },
    send: async () => {},
    abort: () => {},
    compact: async () => {},
    reset: async () => {},
    createSession: async () => {},
    switchSession: async () => {},
    deleteSession: async () => {},
    setTitle: async () => {},
    refreshSessions: async () => {},
    updateConfig: () => {},
    setModel: () => {},
    autoTitle: async () => {},
    dispose: () => {},
    subscribeEvents: () => () => {},
    retryLast: async () => {},
    cancelQueued: () => {},
    popLastQueued: () => undefined,
    clearQueue: () => {},
    clearAllSessions: async () => {},
    initPromise: Promise.resolve(),
    getAttachmentProviders: () => [],
    commands: () => [],
    resolveCommand: () => undefined,
    enqueueCommand: () => {},
    runCommand: () => Promise.resolve({ ran: true, startedTurn: false }),
    pendingCounts: () => ({ schedules: 0, reminders: 0, total: 0 }),
    todos: () => todos.map((t) => ({ ...t })),
    availableTools: () => DEMO_AVAILABLE_TOOLS.map((t) => ({ ...t })),
  };
}

function mountPanel(state: SessionState, gs?: GalleryState): AgentChatPanel {
  const panel = document.createElement('agent-chat-panel');
  // HostStore's index signature (chat-ui/types.ts:76-79) needs a cast for a
  // named type like the app's Redux store — see agent-panel-config.ts.
  panel.store = store as unknown as AgentChatPanel["store"];
  panel.appContext = {
    appName: "Cat Store",
    appDescription: "A pet store selling organic cat food products."
  };
  panel.config = { persist: false, todo: { enabled: (gs?.todos?.length ?? 0) > 0 } };
  panel.renderers = [...genuiRenderers, ...chartingRenderers];
  panel.imageInput = false;
  panel.session = makeFakeSession(state, gs?.todos ?? []);

  if (gs?.userName) panel.appContext = { ...panel.appContext, userName: gs.userName };
  if (gs?.agentName) panel.agentName = gs.agentName;
  if (gs?.userAvatar) panel.userAvatar = gs.userAvatar;
  if (gs?.agentAvatar) panel.agentAvatar = gs.agentAvatar;
  if (gs?.debug) panel.debug = true;
  if (gs?.models) panel.models = gs.models;
  if (gs?.hideHeader) panel.hideHeader = true;

  panel.addEventListener("block-button", ((e: CustomEvent<{ prompt: string }>) => {
    const logEl = document.getElementById("click-log");
    if (logEl) {
      const t = document.createElement("div");
      t.textContent = `[block-button] prompt="${e.detail.prompt}"`;
      logEl.appendChild(t);
    }
  }) as EventListener);

  return panel;
}

function renderFrameMode(gs: GalleryState) {
  // 009: a folded dev demo owns the whole page and needs to scroll, so it does
  // not get the panel frame's `overflow:hidden`.
  document.body.style.cssText = gs.mount
    ? 'margin:0;padding:0;'
    : 'margin:0;padding:0;overflow:hidden;';
  // Strip the static scaffold so only the panel is visible in the iframe.
  document.querySelector('h1')?.remove();
  document.querySelector('p.lead')?.remove();
  document.getElementById('theme-switcher')?.remove();
  document.getElementById('gallery')?.remove();

  if (gs.mount) {
    void gs.mount(document.body);
    return;
  }

  if (gs.kind === 'bubble') {
    const bubble = document.createElement('web-agent-bubble') as WebAgentBubble;
    if (gs.agentShortName) bubble.agentShortName = gs.agentShortName;
    if (gs.agentAvatar) bubble.agentAvatar = gs.agentAvatar;
    document.body.appendChild(bubble);
    return;
  }

  if (!gs.state) return;
  const panel = mountPanel(gs.state, gs);
  if (gs.retryAttempt) panel.retryAttempt = gs.retryAttempt;
  if (gs.composerText) panel.composerText = gs.composerText;
  if (gs.configOpen) {
    panel.cues = { enabled: true, speed: 'slow' };
    panel.configOpen = true;
  }
  if (gs.debugOpen) {
    panel.debugOpen = true;
  }
  if (gs.menuOpen) {
    panel.menuOpen = true;
  }
  // 002: the panel fills its container, so this page (the host) owns the
  // floating box it used to draw for itself.
  const frameBox = document.createElement('div');
  frameBox.style.cssText = 'position:fixed;right:20px;bottom:20px;width:480px;height:660px;';
  frameBox.appendChild(panel);
  document.body.appendChild(frameBox);

  // 010 — same ordering rule as the catalog: after the append.
  if (gs.demoWindow) panel.demoWindow = gs.demoWindow;

  if (gs.overlay === 'confirm' && gs.confirmDetail) {
    const detail = gs.confirmDetail;
    void Promise.resolve().then(() => {
      void createConfirmScrim(panel)(detail);
    });
  }
}

function renderCatalog(theme: GalleryTheme) {
  const gallery = document.getElementById('gallery');
  if (!gallery) return;
  const strip = gallery.querySelector('.strip');
  if (!strip) return;

  for (const gs of GALLERY_STATES) {
    // 009: folded dev demos render only in `?frame=` mode. Adding them as
    // tiles would put blocks-demo's two deliberate rejection charts on this
    // page, and finance-charts.mock.spec.ts:42 asserts it holds zero
    // `.error-card`.
    if (gs.id === 'present-demo' || gs.mount) continue;

    const figure = document.createElement('figure');
    figure.dataset.state = gs.id;
    figure.style.cssText = 'margin:0;';

    let panelEl: AgentChatPanel | undefined;

    if (gs.kind === 'bubble') {
      const bubble = document.createElement('web-agent-bubble') as WebAgentBubble;
      if (gs.agentShortName) bubble.agentShortName = gs.agentShortName;
      if (gs.agentAvatar) bubble.agentAvatar = gs.agentAvatar;
      // 008: cat-store vendors no icon font, so the component default
      // <i>chat</i> renders the icon NAME as text. Use the same glyph the
      // live launcher uses (index.ts). Guarded on agentAvatar because
      // launcherIcon takes precedence over the avatar in the component
      // (web-agent-embed.ts:323-329), and the branded-launcher tile exists
      // to show the avatar path. B-2: the SVG glyph, not the 🐱 emoji, which
      // failed contrast (see gallery-states.ts).
      if (!gs.agentAvatar) bubble.launcherIcon = CAT_STORE_LAUNCHER_ICON;
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'height:120px;position:relative;display:flex;align-items:center;justify-content:center;background:var(--wa-background-color-300, #f5f5f5);border-radius: var(--wa-border-radius-l, 8px);';
      wrapper.appendChild(bubble);
      figure.appendChild(wrapper);
    } else if (gs.state) {
      const panel = mountPanel(gs.state, gs);
      panelEl = panel;
      if (gs.retryAttempt) panel.retryAttempt = gs.retryAttempt;
      if (gs.composerText) panel.composerText = gs.composerText;
      if (gs.configOpen) {
        panel.cues = { enabled: true, speed: 'slow' };
        panel.configOpen = true;
      }
      if (gs.debugOpen) {
        panel.debugOpen = true;
      }
      if (gs.menuOpen) {
        panel.menuOpen = true;
      }
      const tileBox = document.createElement('div');
      tileBox.style.cssText = 'width:100%;height:600px;';
      tileBox.appendChild(panel);
      figure.appendChild(tileBox);

      if (gs.overlay === 'confirm' && gs.confirmDetail) {
        const detail = gs.confirmDetail;
        void Promise.resolve().then(() => {
          void createConfirmScrim(panel)(detail);
        });
      }
    }

    const caption = document.createElement('figcaption');
    caption.innerHTML = `<strong>${gs.title}</strong><br><small>${gs.caption}</small>`;
    caption.style.cssText = 'padding: var(--wa-padding-m, 8px) 0 var(--wa-padding-s, 4px);font-size:0.85rem;color:var(--wa-label-color, #555);';
    figure.appendChild(caption);
    strip.appendChild(figure);
    // 010 — after the append, never before: `demoWindow` parks the real list at
    // a scroll position, and a disconnected element has no layout, so an
    // earlier write would be clamped to 0.
    if (panelEl && gs.demoWindow) panelEl.demoWindow = gs.demoWindow;
  }

  const responsive = gallery.querySelector('.responsive-row');
  if (responsive) {
    const iframeDesktop = document.createElement('iframe');
    iframeDesktop.src = `gallery.html?frame=empty&vp=desktop&theme=${theme}`;
    iframeDesktop.className = 'vp-desktop';
    iframeDesktop.title = 'Panel — desktop floating';
    iframeDesktop.style.border = 'none';

    const iframeMobile = document.createElement('iframe');
    iframeMobile.src = `gallery.html?frame=empty&vp=mobile&theme=${theme}`;
    iframeMobile.className = 'vp-mobile';
    iframeMobile.title = 'Panel — mobile (≤375px)';
    iframeMobile.style.border = 'none';

    responsive.appendChild(iframeDesktop);
    responsive.appendChild(iframeMobile);
  }

  // 009 (AC 3): the six folded dev demos are frame-only states, so the catalog
  // links to them rather than tiling them.
  const demoNav = gallery.querySelector('.demo-links');
  if (demoNav) {
    for (const gs of DEMO_STATES) {
      const a = document.createElement('a');
      a.href = `gallery.html?frame=${gs.id}&theme=${theme}`;
      a.dataset.demo = gs.id;
      a.textContent = gs.title;
      a.title = gs.caption;
      a.style.cssText =
        'display:inline-block;margin: 0 var(--wa-padding-l, 12px) var(--wa-padding-m, 8px) 0;' +
        'color:var(--wa-action-color-info, #0b57d0);font-size:var(--wa-font-size-s, 0.9rem);';
      demoNav.appendChild(a);
    }
  }
}

const params = new URLSearchParams(location.search);
const frameId = params.get('frame');
const theme = resolveTheme(location.search, 'wa2-dark');
applyTheme(theme);

if (frameId) {
  const gs = [...GALLERY_STATES, ...DEMO_STATES].find(s => s.id === frameId);
  if (gs) {
    renderFrameMode(gs);
  }
} else {
  renderCatalog(theme);
  mountThemeSwitcher(document.getElementById('theme-switcher'), theme, (next) => {
    applyTheme(next);
    const url = new URL(location.href);
    url.searchParams.set('theme', next);
    history.replaceState(null, '', url);
    document.querySelectorAll<HTMLIFrameElement>('iframe.vp-desktop, iframe.vp-mobile')
      .forEach((f) => {
        const src = new URL(f.src, location.href);
        src.searchParams.set('theme', next);
        f.src = src.toString();
      });
  });
}
