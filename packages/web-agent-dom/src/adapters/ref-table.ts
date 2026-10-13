// ref-table.ts — numbered-ref ↔ DOM-element registry.
// Each new snapshot bumps the generation and invalidates all prior refs.
// Pure DOM/TS; no loop or SDK imports (§3).

import type { RefEntry, ResolveResult } from "./ref-table.types.js";

// Re-exported so importers of this module keep their existing import path.
export type { ResolveResult } from "./ref-table.types.js";

// ---------------------------------------------------------------------------
// RefTable
// ---------------------------------------------------------------------------
export class RefTable {
  #generation = 0;
  /** Current-generation map: ref → entry. */
  #map = new Map<number, RefEntry>();
  /** 124/005 — the reverse of `#map`, for the recorder: it needs the ref an
   *  element already has, and must not assign a second one for the same
   *  element in the same generation. A WeakMap, so a removed element is
   *  collectable; replaced (not cleared) on `invalidateAll`, because a
   *  WeakMap cannot be cleared and a stale entry would hand out a ref from a
   *  previous generation. */
  #byElement = new WeakMap<Element, number>();
  /** Cross-generation: ref number → last known generation it was assigned in.
   *  Kept small: ref numbers restart at 1 each generation. Entries are never
   *  removed; an old entry yields "stale" instead of "unknown". */
  #lastSeenGeneration = new Map<number, number>();
  /** Monotonic ref counter (resets to 1 each generation). */
  #nextRef = 1;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Current generation number (monotonically increasing). */
  get generation(): number {
    return this.#generation;
  }

  /** Bump generation, clear current map, reset ref counter.
   *  Returns the new generation number.
   *  Called by dom-adapter at the start of each snapshot (task 007). */
  invalidateAll(): number {
    this.#generation++;
    this.#map.clear();
    this.#byElement = new WeakMap<Element, number>();
    this.#nextRef = 1;
    return this.#generation;
  }

  /** Assign a ref to `el`. Returns the numeric ref (1-based per generation). */
  assign(el: Element): number {
    const ref = this.#nextRef++;
    const entry: RefEntry = {
      weakRef: new WeakRef(el),
      fromGeneration: this.#generation,
    };
    this.#map.set(ref, entry);
    this.#lastSeenGeneration.set(ref, this.#generation);
    this.#byElement.set(el, ref);
    return ref;
  }

  /** 124/005 — the ref `el` holds in the CURRENT generation, or undefined
   *  when it has none. Never assigns; the caller decides whether to. */
  refFor(el: Element): number | undefined {
    return this.#byElement.get(el);
  }

  /** Resolve a ref. Accepts `number | string`; coerce non-numeric → unknown. */
  resolve(ref: number | string): ResolveResult {
    // Accept "7" → 7; non-numeric string → unknown.
    const num = typeof ref === "string" ? Number(ref) : ref;
    if (!Number.isFinite(num) || num < 1 || Math.floor(num) !== num) {
      return { status: "unknown" };
    }

    const entry = this.#map.get(num);

    if (entry) {
      // Ref exists in current generation.
      const el = entry.weakRef.deref();
      if (!el || !el.isConnected) {
        return { status: "detached" };
      }
      return { status: "ok", el, generation: this.#generation };
    }

    // Not in current map — check cross-generation history.
    const lastGen = this.#lastSeenGeneration.get(num);
    if (lastGen !== undefined && lastGen < this.#generation) {
      return {
        status: "stale",
        fromGeneration: lastGen,
        generation: this.#generation,
      };
    }

    return { status: "unknown" };
  }
}
