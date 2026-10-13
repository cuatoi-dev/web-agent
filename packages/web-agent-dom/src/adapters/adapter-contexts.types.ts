// adapter-contexts.types.ts — the slices of `DomAdapter` state each split-out
// adapter module reads. Every field was `this.<field>` before the split.

import type { RefTable } from "./ref-table.js";
import type { ActionCueFn } from "./types.js";

/** The adapter state `walkFromRoot` reads. `agentUiEl` is the element captured
 *  by the caller for the SEC6 exclusion. */
export interface SnapshotWalkContext {
  refTable: RefTable;
  snapshotMaxChars: number;
  snapshotMaxDepth: number;
  snapshotSubtreeMaxNodes: number;
  snapshotMaxNodes: number;
  agentUiEl: Element | null;
}

/** The adapter state `captureScreenshot` reads. `resolveOrThrow` is the
 *  adapter's own ref resolver, which throws on a stale/detached ref. */
export interface ScreenshotContext {
  root: ParentNode;
  agentUiSelector: string;
  actionCue?: ActionCueFn;
  resolveOrThrow: (ref: string) => Element;
}

/** The adapter state the click/fill/selectOption actions read.
 *  `resolveOrThrow` and `describeElement` are the adapter's own helpers. */
export interface InteractionContext {
  actionCue?: ActionCueFn;
  typingPaceMs?: () => number;
  resolveOrThrow: (ref: string) => Element;
  describeElement: (el: Element) => string;
}

/** The adapter state the waiters read. */
export interface WaitContext {
  root: ParentNode;
  agentUiSelector: string;
}
