// dom-adapter.ts — builds accessibility-style DOM snapshots with numbered refs.
// Pure DOM/TS; no loop or SDK imports (§3).
// Package-owned adapter (006): this package constructs and closes over its own
// DomAdapter instance. Core ships no DOM adapter of its own since 007.
// `utils/image.ts` itself stays core-only (006 decision), so only its exported
// `downscaleToolImage` is reused (adapters/screenshot.ts).
//
// The element semantics, snapshot formatting, traversal, screenshot, action and
// waiter code live in sibling modules; this file holds the class that wires them
// to one adapter's state.

import { RefTable } from "./ref-table.js";
import { staleRef, detachedRef } from "../tools/error-messages.js";
import { resolveAgentPermission, type AgentPermission } from "./permission-resolver.js";
import { describeElementParts, getName } from "./element-semantics.js";
import { walkFromRoot } from "./snapshot-walk.js";
import { captureScreenshot } from "./screenshot.js";
import { performClick, performFill, performSelectOption, performSelectOptions } from "./interactions.js";
import type { InteractionContext } from "./adapter-contexts.types.js";
import { waitForIdle, waitForText } from "./waiters.js";
import type { ActionCueFn, DomAdapterOptions, SnapshotInput } from "./types.js";

// Re-exported so importers of this module keep their existing import path.
export type { ActionCueFn, DomAdapterOptions, SnapshotInput } from "./types.js";
export { describeElementParts } from "./element-semantics.js";

// ---------------------------------------------------------------------------
// DomAdapter
// ---------------------------------------------------------------------------
export class DomAdapter {
  readonly refTable: RefTable;
  readonly root: ParentNode;
  readonly snapshotMaxChars: number;
  readonly snapshotMaxDepth: number;
  readonly snapshotSubtreeMaxNodes: number;
  readonly snapshotMaxNodes: number;
  readonly agentUiSelector: string;
  readonly actionCue?: ActionCueFn;
  readonly typingPaceMs?: () => number;
  #agentUiEl: Element | null = null;

  constructor(opts?: DomAdapterOptions) {
    this.refTable = opts?.refTable ?? new RefTable();
    this.root = opts?.root ?? document;
    this.snapshotMaxChars = opts?.snapshotMaxChars ?? 12_000;
    this.snapshotMaxDepth = opts?.snapshotMaxDepth ?? 12;
    this.snapshotSubtreeMaxNodes = opts?.snapshotSubtreeMaxNodes ?? 50;
    this.snapshotMaxNodes = opts?.snapshotMaxNodes ?? 400;
    this.agentUiSelector = opts?.agentUiSelector ?? "[data-agent-ui]";
    this.actionCue = opts?.actionCue;
    this.typingPaceMs = opts?.typingPaceMs;
  }

  /** State handed to `interactions.ts`. `resolveOrThrow`
   *  is bound here because it stays private to the class. */
  get #interactionContext(): InteractionContext {
    return {
      actionCue: this.actionCue,
      typingPaceMs: this.typingPaceMs,
      resolveOrThrow: (ref: string) => this.#resolveOrThrow(ref),
      describeElement: (el: Element) => this.describeElement(el),
    };
  }

  snapshot(input: SnapshotInput): Promise<string> {
    // Determine traversal root
    let walkRoot: Node;
    if (input.scope) {
      const r = this.refTable.resolve(input.scope);
      if (r.status === "ok") {
        walkRoot = r.el;
      } else if (r.status === "stale") {
        // inline §10-style message
        return Promise.resolve(`Ref ${input.scope} is stale (generation ${r.fromGeneration}, current ${r.generation}). Take a new snapshot.`);
      } else if (r.status === "detached") {
        return Promise.resolve(`Ref ${input.scope} no longer exists in the DOM. Take a new snapshot.`);
      } else {
        return Promise.resolve(`Unknown ref ${input.scope}. Take a new snapshot.`);
      }
    } else {
      walkRoot = this.root instanceof Document ? this.root.body : this.root;
    }

    const gen = this.refTable.invalidateAll();

    // Capture agent UI element for exclusion (SEC6).
    this.#agentUiEl = this.root.querySelector(this.agentUiSelector);

    if (!walkRoot) {
      return Promise.resolve(`generation: ${gen}\n<empty page>`);
    }

    const prefix = `generation: ${gen}\n`;
    const { text } = this.#walkFromRoot(walkRoot, !!input.interactive_only, {
      charPrefixLen: prefix.length,
      includeText: input.include_text,
    });
    return Promise.resolve(prefix + text);
  }

  /**
   * Focused snapshot of each given element's subtree, all assigned within a
   * SINGLE ref-table generation (016-2). `snapshot({scope})` bumps the
   * generation and resets the ref counter on every call, so calling it once
   * per pinned element would silently misresolve refs across items (item 2's
   * call wipes item 1's assignments; because the per-generation ref counter
   * restarts at 1, a reused ref number can resolve to the WRONG element, not
   * just go stale). This method invalidates once for the whole batch instead,
   * so every returned ref stays valid and unambiguous together.
   */
  snapshotFocused(elements: Element[]): Promise<{ ref: number; text: string }[]> {
    this.#agentUiEl = this.root.querySelector(this.agentUiSelector);
    this.refTable.invalidateAll();
    return Promise.resolve(elements.map((el) => {
      const { text, rootRef } = this.#walkFromRoot(el, false, { forceRootRef: true });
      return { ref: rootRef as number, text };
    }));
  }

  /** Runs the shared traversal core (`snapshot-walk.ts`) against this
   *  adapter's budgets, ref table and captured agent-UI element. */
  #walkFromRoot(
    walkRoot: Node,
    interactiveOnly: boolean,
    opts?: { forceRootRef?: boolean; charPrefixLen?: number; includeText?: string },
  ): { text: string; rootRef: number | undefined } {
    return walkFromRoot({
      refTable: this.refTable,
      snapshotMaxChars: this.snapshotMaxChars,
      snapshotMaxDepth: this.snapshotMaxDepth,
      snapshotSubtreeMaxNodes: this.snapshotSubtreeMaxNodes,
      snapshotMaxNodes: this.snapshotMaxNodes,
      agentUiEl: this.#agentUiEl,
    }, walkRoot, interactiveOnly, opts);
  }

  /** Rasterize a DOM target to an image data URL. See `captureScreenshot` in
   *  `screenshot.ts` for the three possible outcomes. */
  async screenshot(scope?: string): Promise<{
    dataUrl: string;
    mediaType: string;
    width: number;
    height: number;
    /**
     * Present only when the capture probably does not show the scoped element.
     * Absent on every clean capture and on every unscoped call.
     */
    warning?: string;
  }> {
    return captureScreenshot({
      root: this.root,
      agentUiSelector: this.agentUiSelector,
      actionCue: this.actionCue,
      resolveOrThrow: (ref: string) => this.#resolveOrThrow(ref),
    }, scope);
  }

  // -----------------------------------------------------------------------
  // Ref resolution and element description
  // -----------------------------------------------------------------------

  #resolveOrThrow(ref: string): Element {
    const result = this.refTable.resolve(ref);
    if (result.status === "stale") {
      throw new Error(staleRef(ref, result.fromGeneration, this.refTable.generation));
    }
    if (result.status === "detached" || result.status === "unknown") {
      throw new Error(detachedRef(ref));
    }
    return result.el;
  }

  describeElement(el: Element): string {
    const { role, name } = describeElementParts(el);
    return name ? `${role} "${name}"` : role;
  }

  /**
   * Read-only lookup used by the `confirmInteraction` gate in `tool-provider.ts`
   * (007) to decide whether an about-to-run click/fill/selectOption needs
   * confirmation, without performing it or calling `#resolveOrThrow` (which
   * throws on a stale/detached ref — the gate needs a non-throwing check).
   * Returns undefined when the ref cannot be resolved.
   */
  describeRef(ref: string): { name: string; permission: AgentPermission; permissionReason?: string } | undefined {
    const result = this.refTable.resolve(ref);
    if (result.status !== "ok") return undefined;
    const { permission, reason } = resolveAgentPermission(result.el);
    return { name: getName(result.el), permission, permissionReason: reason };
  }

  /**
   * Read-only, non-throwing ref inspection for the panel page tools
   * (118/122-001): the panel needs to check a ref's status, name, permission
   * and disabled state across a MAIN-world round trip, before it decides
   * whether to run the action at all.
   */
  inspectRef(ref: string): {
    status: "ok" | "stale" | "detached" | "unknown";
    error?: string;
    name?: string;
    description?: string;
    permission?: AgentPermission;
    permissionReason?: string;
    disabled?: boolean;
    el?: Element;
  } {
    const result = this.refTable.resolve(ref);
    if (result.status === "stale") {
      return { status: "stale", error: staleRef(ref, result.fromGeneration, this.refTable.generation) };
    }
    if (result.status === "detached") {
      return { status: "detached", error: detachedRef(ref) };
    }
    if (result.status === "unknown") {
      return { status: "unknown", error: `Unknown ref ${ref}. Take a new snapshot.` };
    }
    const el = result.el;
    const name = getName(el);
    const description = this.describeElement(el);
    const { permission, reason } = resolveAgentPermission(el);
    const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
    return {
      status: "ok",
      name,
      description,
      permission,
      permissionReason: reason,
      disabled,
      el,
    };
  }

  async click(ref: string, signal?: AbortSignal): Promise<string> {
    return performClick(this.#interactionContext, ref, signal);
  }

  async fill(ref: string, value: string, signal?: AbortSignal): Promise<string> {
    return performFill(this.#interactionContext, ref, value, signal);
  }

  async selectOption(ref: string, option: string, signal?: AbortSignal): Promise<string> {
    return performSelectOption(this.#interactionContext, ref, option, signal);
  }

  async selectOptions(ref: string, values: string[], signal?: AbortSignal): Promise<string> {
    return performSelectOptions(this.#interactionContext, ref, values, signal);
  }

  async waitForIdle(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    return waitForIdle({ root: this.root, agentUiSelector: this.agentUiSelector }, timeoutMs, signal);
  }

  async waitForText(text: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    return waitForText({ root: this.root, agentUiSelector: this.agentUiSelector }, text, timeoutMs, signal);
  }
}
