// types.ts — shared shapes for the cat-store demo pages in this directory.
//
// Keep shared types independent of the gallery modules that import them.
// Theme ids are validated through the theme registry at runtime.

import type { SessionState } from "@cuatoi/web-agent-core";

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
  | 'working'
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
  | 'todo-progress'
  | 'present-demo'
  // 009 — folded dev demos. These render only in `?frame=<id>` mode, never as
  // a catalog tile, so the catalog strip and every spec that counts canvases
  // or error cards on it are unchanged.
  | 'demo-cues'
  | 'demo-chart-datasource'
  | 'demo-theme-showcase'
  | 'demo-blocks'
  | 'demo-snapshot'
  | 'demo-agent-run'
  // 010 — the message-window states. Ordinary catalog tiles, not folded demos:
  // each one carries `state` and renders as a tile like the other 32.
  | 'window-bottom'
  | 'window-scrolled'
  | 'window-loading-older'
  | 'window-loaded-older';

export interface GalleryState {
  id: GalleryStateId;
  title: string;
  caption: string;
  kind: 'bubble' | 'panel' | 'demo';
  /** 009 — a folded dev demo builds its own DOM inside `host`. A state that
   *  carries `mount` renders ONLY in `gallery.html?frame=<id>`; the catalog
   *  strip skips it. */
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
  models?: import("@cuatoi/web-agent-core").ModelOption[];
  /** Demo-only: opens the header kebab menu for the capture (067-ui). */
  menuOpen?: boolean;
  /** 068/003 — demo-only: the todo list the fake session reports, so the
   *  composer indicator and its badge appear in the gallery. Setting it also
   *  turns the panel's `todo` config flag on for that tile. */
  todos?: import("@cuatoi/web-agent-core").TodoItem[];
  /** 010 — demo-only: the message-window state the gallery host pushes onto the
   *  panel after the tile is in the document, so the 008/009/010 window states
   *  render with no scripted conversation. */
  demoWindow?: import("@cuatoi/web-agent-lit").DemoWindowState;
  // 045b avatar/naming config (applied by the gallery host, not SessionState)
  agentName?: string;
  agentShortName?: string;
  userName?: string;
  userAvatar?: string;
  agentAvatar?: string;
}

/** A registered theme id used by the gallery switcher. */
export type GalleryTheme = string;

/** A registered theme id, or the host-provided showcase example (`provided`).
 *  `GalleryTheme` is `string`, so `'provided'` needs no separate constituent. */
export type ShowcaseTheme = GalleryTheme;
