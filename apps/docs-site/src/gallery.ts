import '@cuatoi/web-agent-lit/themes/wa-tokens.css';
import '@cuatoi/web-agent-lit/embed/web-agent-embed';
import { genuiRenderers, createConfirmScrim } from '@cuatoi/web-agent-lit';
import type { AgentChatPanel } from '@cuatoi/web-agent-lit';
import type { AgentSession, AvailableTool, SessionState } from '@cuatoi/web-agent-core';
import { GALLERY_STATES, type GalleryState } from './gallery-states';
import { resolveTheme, applyTheme, mountThemeSwitcher, type GalleryTheme } from './gallery-theme';
import { requiresCharting } from './gallery-filter';
import type { PanelAppContext } from './types';

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

function makeFakeSession(state: SessionState): AgentSession {
  return {
    getState: () => state,
    subscribe: (cb) => {
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
    todos: () => [],
    availableTools: () => DEMO_AVAILABLE_TOOLS.map((t) => ({ ...t })),
  };
}

function mountPanel(state: SessionState, gs?: GalleryState): AgentChatPanel {
  const panel = document.createElement('agent-chat-panel');
  panel.appContext = { appName: 'Web Agent Docs' };
  panel.config = { persist: false };
  panel.renderers = [...genuiRenderers];
  panel.imageInput = false;

  if (gs?.userName) {
    const currentAppContext = panel.appContext as PanelAppContext;
    panel.appContext = { ...currentAppContext, userName: gs.userName };
  }
  if (gs?.agentName) panel.agentName = gs.agentName;
  if (gs?.userAvatar) panel.userAvatar = gs.userAvatar;
  if (gs?.agentAvatar) panel.agentAvatar = gs.agentAvatar;
  if (gs?.debug) panel.debug = true;
  if (gs?.models) panel.models = gs.models;
  if (gs?.hideHeader) panel.hideHeader = true;

  panel.session = makeFakeSession(state);
  return panel;
}

function renderFrameMode(gs: GalleryState) {
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
    const bubble = document.createElement('web-agent-bubble');
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
    if (requiresCharting(gs)) continue;
    if (gs.mount) continue;
    const figure = document.createElement('figure');
    figure.dataset.state = gs.id;
    figure.style.cssText = 'margin:0;';

    if (gs.kind === 'bubble') {
      const bubble = document.createElement('web-agent-bubble');
      if (gs.agentShortName) bubble.agentShortName = gs.agentShortName;
      if (gs.agentAvatar) bubble.agentAvatar = gs.agentAvatar;
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'height:120px;position:relative;display:flex;align-items:center;justify-content:center;background:var(--wa-background-color-300, #f5f5f5);border-radius: var(--wa-border-radius-l, 8px);';
      wrapper.appendChild(bubble);
      figure.appendChild(wrapper);
    } else if (gs.state) {
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
}

const params = new URLSearchParams(location.search);
const frameId = params.get('frame');
const theme = resolveTheme(location.search, 'wa2-light');
applyTheme(theme);

if (frameId) {
  const gs = GALLERY_STATES.find(s => s.id === frameId || (frameId === 'cues-demo' && s.id === 'demo-cues'));
  if (gs && !requiresCharting(gs)) {
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
