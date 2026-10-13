// 131/003 — what one debugged tab knows about its frames: the auto-attached
// out-of-process iframe targets, each frame's default execution context, and
// which frame every ref a snapshot printed came from. Imports nothing.

/** One auto-attached out-of-process iframe target. */
export interface ChildTarget {
  /** 1, 2, 3 … per tab, in attach order. Never reused while the tab is
   *  debugged, so a ref that names a detached frame can be told apart from one
   *  that names a live frame. */
  k: number;
  /** The CDP session id; goes into `{ tabId, sessionId }`. */
  sessionId: string;
  /** `targetInfo.targetId`, which for an iframe target IS that frame's id. */
  targetId: string;
  /** e.g. "http://pay.test"; "" when the URL could not be parsed. */
  origin: string;
  /** The session that owns this frame's `<iframe>` element. `undefined` means
   *  the tab's top target — set from the event's own `source.sessionId`. */
  parentSessionId?: string;
}

/** One execution context of one frame, from Runtime.executionContextCreated. */
export interface FrameContext {
  contextId: number;
  frameId: string;
  origin: string;
  /** `auxData.isDefault` — true for the frame's own main world. */
  isDefault: boolean;
  /** `ExecutionContextDescription.name` — what `worldName` set, e.g.
   *  "web-agent-recorder" (131/004). "" for a world created without one. */
  name: string;
  /** The child session this context belongs to; absent for the top target. */
  sessionId?: string;
}

/** Where a ref's element lives. `sessionId` absent = the tab's top target. */
export interface RefFrame {
  sessionId?: string;
  frameId: string;
}

/** One tab's registry state: its children, execution contexts and ref map. */
export interface TabFrames {
  nextK: number;
  children: Map<string, ChildTarget>; // by sessionId
  contexts: Map<string, FrameContext>; // by ctxKey
  refs: Map<string, RefFrame>; // by the ref text the snapshot printed
}

export interface DebuggerFrames {
  /** Feed every `Target.*` and `Runtime.executionContext*` event here.
   *  Returns the child that was just created, so the caller can enable its
   *  domains; `undefined` for every other event. */
  applyEvent(
    tabId: number,
    sessionId: string | undefined,
    method: string,
    params: Record<string, unknown>,
  ): ChildTarget | undefined;
  /** Every live child of the tab, in attach order. */
  children(tabId: number): ChildTarget[];
  childBySession(tabId: number, sessionId: string): ChildTarget | undefined;
  childByNumber(tabId: number, k: number): ChildTarget | undefined;
  /** The child whose frame id is `frameId` — how an `<iframe>` element found
   *  with DOM.describeNode is matched to its target. */
  childByFrameId(tabId: number, frameId: string): ChildTarget | undefined;
  /** The frame's main-world context, or undefined when none was seen. */
  defaultContext(tabId: number, sessionId: string | undefined, frameId: string): FrameContext | undefined;
  contextById(tabId: number, sessionId: string | undefined, contextId: number): FrameContext | undefined;
  /** 131/004 — every context of the tab whose world name is `name`, in any
   *  session. How pause/resume reaches the recorder in every frame. */
  contextsNamed(tabId: number, name: string): { sessionId?: string; contextId: number }[];
  /** Record where each ref a snapshot printed lives. Merges: a ref an older
   *  snapshot recorded stays until the main frame navigates. */
  rememberRefs(tabId: number, entries: { ref: string; sessionId?: string; frameId: string }[]): void;
  refFrame(tabId: number, ref: string): RefFrame | undefined;
  /** Main-frame navigation: every ref printed for the old document is gone. */
  forgetRefs(tabId: number): void;
  /** stop_debugging / detach: drop the whole tab. */
  forget(tabId: number): void;
}
