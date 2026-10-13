// The shape createHelperWorlds() (131/002) returns. Split out to satisfy
// wa/types-in-types-file; kept import-free so `types.ts` can import it
// with no risk of an import cycle back through the implementation file.

/** Where a ref's element is, once its frame has been checked. */
export interface RefTarget {
  /** undefined = the tab's top target. */
  sessionId?: string;
  frameId: string;
  backendNodeId: number;
  /** "" for the top target, "f<k>:" for a child — the prefix its refs carry. */
  refPrefix: string;
}

export interface HelperWorlds {
  /** The whole helper source, fetched once per panel page. */
  source(): Promise<string>;
  /** 131/003 — `"23"` → `{ frame: "", backendNodeId: 23 }`, `"f1:23"` →
   *  `{ frame: "f1", backendNodeId: 23 }`. Syntax only: `resolve` is what
   *  checks the frame still exists. */
  parseRef(ref: string): { ok: true; frame: string; backendNodeId: number } | { ok: false; error: string };
  /** 131/003 — the ref's session, frame and node. A `f<k>` whose child has
   *  detached, and a ref with an unreadable shape, both fail here. */
  resolve(
    tabId: number,
    ref: string,
  ): { ok: true; at: RefTarget } | { ok: false; error: string };
  /** 131/003 — the `<iframe>` selectors from the top page down to the ref's own
   *  frame, for `page.frameLocator(...)`. `[]` for a ref in the top frame. */
  frameChain(tabId: number, ref: string): Promise<string[]>;
  /** 131/004 — the same walk, from a frame rather than a ref. A recorded step
   *  has no ref, so the driver passes the frame the binding call came from. */
  frameChainAt(tabId: number, at: { sessionId?: string; frameId: string; refPrefix?: string }): Promise<string[]>;
  /** 131/003 — drop one frame's isolated world (Page.frameNavigated). */
  forgetFrame(tabId: number, sessionId: string | undefined, frameId: string): void;
  /** Install the helper if needed and run `fn` on the ref's element. */
  call<T>(
    tabId: number,
    ref: string,
    fn: string,
    args?: unknown[],
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }>;
  /** Install the helper if needed and run `fn` on `document.documentElement`. */
  callOnDocument<T>(
    tabId: number,
    fn: string,
    args?: unknown[],
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }>;
  /** DOM.scrollIntoViewIfNeeded + DOM.getBoxModel, in viewport CSS pixels. */
  centre(tabId: number, ref: string): Promise<{ ok: true; x: number; y: number } | { ok: false; error: string }>;
  /** DOM.getBoxModel's content quad plus the layout-viewport scroll. */
  box(
    tabId: number,
    ref: string,
  ): Promise<
    | { ok: true; x: number; y: number; width: number; height: number; scrollX: number; scrollY: number }
    | { ok: false; error: string }
  >;
  /** Drop a tab's cached context — call on Page.frameNavigated for the main frame. */
  forget(tabId: number): void;
}
