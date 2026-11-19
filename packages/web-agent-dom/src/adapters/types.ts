// types.ts — shared shapes for the adapter modules.

import type { CueKind } from "@cuatoi/web-agent-core";
import type { RefTable } from "./ref-table.js";

/** Await-able hook fired by the adapter before a synthetic event is
 *  dispatched. Resolves after any cue animation completes.
 *
 *  `signal` lets the cue itself skip any post-animation step (e.g. the
 *  click pulse) once the run has already been stopped — the animation is not
 *  interruptible mid-flight, but a straggling call that only settles AFTER
 *  the run ended must not resurrect a cursor layer that `destroy()` already
 *  removed. Optional: callers with no signal (e.g. `see`) are unaffected. */
export type ActionCueFn = (
  el: Element | undefined,
  kind: CueKind,
  detail?: {
    value?: string;
    speedMs?: number;
    point?: { x: number; y: number };
    rect?: { x: number; y: number; width: number; height: number };
  },
  signal?: AbortSignal,
) => Promise<void>;

export interface SnapshotInput {
  scope?: string;
  interactive_only?: boolean;
  /** Case-insensitive substring. When set and non-blank, the snapshot
   *  keeps only elements whose text or name attributes contain it, plus the
   *  significant ancestors leading to them. Absent, empty or whitespace-only
   *  means no filtering, and the output is byte-identical to an unfiltered
   *  snapshot. */
  include_text?: string;
}

/** One pending item in `walkFromRoot`'s BFS selection queue (pass 1):
 *  the node to visit, its indentation depth, and the chain of ancestors the
 *  walk passed through to reach it, each credited with "has a selected
 *  descendant" once this node is chosen — see `snapshot-walk.ts`. */
export interface QueueItem {
  node: Node;
  depth: number;
  ancestors: Node[];
}

export interface DomAdapterOptions {
  refTable?: RefTable;
  root?: ParentNode;
  snapshotMaxChars?: number;
  /** Hard cap on significant-nesting depth emitted per snapshot. Default 12. */
  snapshotMaxDepth?: number;
  /** Max direct children of one parent that the walk considers. Later
   *  children are not walked; an `include_text` walk ignores this cap. Default 50. */
  snapshotSubtreeMaxNodes?: number;
  /** Overall cap on significant lines emitted per snapshot. Default 400. */
  snapshotMaxNodes?: number;
  agentUiSelector?: string;
  /** Visual action-cue hook. Optional; if unset no cue is fired. */
  actionCue?: ActionCueFn;
  /** ms-per-word typing pace supplier. Undefined/0 ⇒ instant set. */
  typingPaceMs?: () => number;
}

/** Per-`snapshot()` memo for `isInteractive`. `isPointerControl` walks
 *  ancestors *and* descendants, and each of those checks calls back into
 *  `isInteractive` — on a page with several nested `cursor: pointer`
 *  wrappers (measured: 156 on the cat-store store page) that mutual
 *  recursion re-derives the same element's status over and over and blows
 *  the call stack. Caching each element's result the first time it's
 *  computed turns that back into one evaluation per element. The provisional
 *  `false` written before recursing breaks a genuine cycle (ancestor's
 *  descendant-check reaching back down to the very element whose ancestor-
 *  check is still in progress) without changing the final answer: the
 *  in-progress element's real result is written when its own call returns,
 *  and treating it as "not (yet known) interactive" while a caller is
 *  mid-computation is the same conservative default `isInteractive` already
 *  falls back to. */
export type InteractiveCache = Map<Element, boolean>;

export type AgentPermission = "allow" | "ask" | "block";

export interface PermissionResolution {
  permission: AgentPermission;
  reason?: string;
}

export type ConfirmInteractionFn = (detail: {
  tool: string;
  ref: string;
  name?: string;
  action: string;
  reason?: string;
}) => Promise<boolean>;

export interface QueryInput {
  path: string;
  keys_only?: boolean;
  limit?: number;
}
