// Shared type declarations for the docs-site sources in this folder.
// Values (constants, functions, classes) stay in the module that owns them;
// only interfaces and type aliases live here.

import type { SessionState, ModelOption } from "@cuatoi/web-agent-core";

// --- gallery-states.ts ------------------------------------------------------

export type GalleryStateId =
  | 'launcher'
  | 'empty'
  | 'header-off'
  | 'mid'
  | 'tool-running'
  | 'charts'
  | 'candlestick'
  | 'payoff'
  | 'equity'
  | 'drawdown'
  | 'volume'
  | 'waterfall'
  | 'rich-table'
  | 'generative-ui'
  | 'multi-tool'
  | 'working-streaming'
  | 'working-thinking'
  | 'compacting'
  | 'confirm'
  | 'error'
  | 'failed-turn'
  | 'retrying'
  | 'queued'
  | 'send-while-running'
  | 'config'
  | 'chat-layout'
  | 'branded-launcher'
  | 'debug-screen'
  | 'choose-model'
  | 'pointed-sent'
  | 'present-demo'
  // Folded dev demo (task 010). Renders in `?frame=<id>` mode, skipped in catalog strip.
  | 'demo-cues'
  | 'cues-demo';

export interface GalleryState {
  id: GalleryStateId;
  title: string;
  caption: string;
  kind: 'bubble' | 'panel' | 'demo';
  /** Folded dev demo builds its own DOM inside host. Renders only in gallery.html?frame=<id>. */
  mount?: (host: HTMLElement) => void | Promise<void>;
  hideHeader?: boolean;
  state?: SessionState;
  overlay?: 'confirm';
  confirmDetail?: { tool: string; ref: string; name: string; action: string; reason?: string };
  retryAttempt?: { attempt: number; maxRetries: number; reason: string };
  /** Pre-fills the composer input — demo-only, seeds the send/stop icon-button state. */
  composerText?: string;
  /** Demo-only: opens the config screen for the capture. */
  configOpen?: boolean;
  /** Demo-only: opens the debug screen for the capture. */
  debugOpen?: boolean;
  /** Demo-only: enables the debug flag so the header kebab menu gains a Debug item. */
  debug?: boolean;
  /** Demo-only: host model list for the kebab "Choose model" group (067-ui). */
  models?: ModelOption[];
  /** Demo-only: opens the header kebab menu for the capture (067-ui). */
  menuOpen?: boolean;
  // 045b avatar/naming config (applied by the gallery host, not SessionState)
  agentName?: string;
  agentShortName?: string;
  userName?: string;
  userAvatar?: string;
  agentAvatar?: string;
}

// --- gallery-theme.ts -------------------------------------------------------

/** A registered theme id used by the gallery switcher. */
export type GalleryTheme = string;

// --- gallery.ts -------------------------------------------------------------

// The shape `gallery.ts` casts `AgentChatPanel.appContext` to before it merges
// in `userName`. The cast was added while the setter was typed `any`; the
// setter now takes web-agent-lit's own `PanelAppContext`, which also has
// `appInstructions` and `route`.
export interface PanelAppContext {
  appName?: string;
  appDescription?: string;
  userName?: string;
  userInfo?: string;
}

// --- panel-resize.ts --------------------------------------------------------

export interface Size {
  width: number;
  height: number;
}

// --- search-docs-tool.ts ----------------------------------------------------

export interface DocsPage {
  slug: string;
  title: string;
  category?: string;
  folder?: string;
  text: string;
}
