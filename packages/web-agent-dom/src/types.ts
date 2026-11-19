// types.ts — shared shapes for the package-root modules.

import type { ActionCueFn } from "./adapters/types.js";
import type { DomAdapter } from "./adapters/dom-adapter.js";

export interface PickerProviderOptions {
  /** CSS selector for UI to exclude from picking (defaults to the agent panel). */
  agentUiSelector?: string;
  /** Max pins allowed. Default 8. */
  maxItems?: number;
  /** Adapter used to build the focused snapshot at send time. Supplied by
   *  `domTools()`; a standalone caller gets a fresh one. */
  getDomAdapter?: () => DomAdapter;
}

export interface PickedEntry {
  id: number;
  el: Element;
  role: string;
  name: string;
}

/** Detail passed to `confirmInteraction` for an "ask"-tier click/fill/select_option. */
export interface ConfirmInteractionDetail {
  action: string;
  ref: string;
  name?: string;
  reason?: string;
}

export interface DomToolsOptions {
  snapshotMaxChars?: number;
  snapshotMaxDepth?: number;
  snapshotSubtreeMaxNodes?: number;
  snapshotMaxNodes?: number;
  /** Whether the `see` tool is offered. Default true. */
  images?: boolean;
  /** Visual action-cue hook, fired before a synthetic click/fill/select/see. */
  actionCue?: ActionCueFn;
  /** ms-per-word typing pace for `fill`. 0/undefined ⇒ instant. */
  typingPaceMs?: number;
  agentUiSelector?: string;
  /**
   * State source for `query_state` — read fresh on every call, same contract as
   * core's own `SessionConfig.store.getState`. This package constructs its own
   * `StateAdapter` and core has none to share, so without this
   * `query_state` has nothing to query. Defaults to `() => ({})`.
   */
  getState?: () => unknown;
  /**
   * The "ask"-tier confirm gate. Called before an `"ask"`-permission
   * click/fill/select_option runs; return `false` to block it. `"block"`-tier
   * enforcement needs no wiring — it lives inside `DomAdapter` itself. A host
   * not passing this leaves "ask"-tier elements unconfirmed (they execute like
   * "allow"); wire `createConfirmScrim` from `@cuatoi/web-agent-lit` (or an
   * equivalent) to restore the confirm dialog.
   */
  confirmInteraction?: (detail: ConfirmInteractionDetail) => Promise<boolean>;
}
