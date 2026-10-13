// ref-table.types.ts — shapes owned by `ref-table.ts`.
//
// Kept out of `types.ts` because that file imports `RefTable` itself for
// `DomAdapterOptions.refTable`; declaring these there would close an import
// cycle between the two files.

// ---------------------------------------------------------------------------
// ResolveResult discriminated union (§5.1 S2 + §10 matrix)
// ---------------------------------------------------------------------------
export type ResolveResult =
  | { status: "ok"; el: Element; generation: number }
  // ref exists conceptually but from a prior generation (tracked via lastSeenGeneration)
  | { status: "stale"; fromGeneration: number; generation: number }
  // WeakRef cleared or element not connected to document
  | { status: "detached" }
  // never assigned in current generation and no prior record
  | { status: "unknown" };

// ---------------------------------------------------------------------------
// Internal per-ref record
// ---------------------------------------------------------------------------
export interface RefEntry {
  /** Weak reference to the element — avoids leaking DOM nodes. */
  weakRef: WeakRef<Element>;
  /** The generation in which this ref was assigned. */
  fromGeneration: number;
}
