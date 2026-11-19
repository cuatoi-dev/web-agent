// The debugger session shapes: one chrome.debugger session per tab,
// owned by the side panel page. Its only import is `src/core/types.ts`, which
// itself imports nothing, so types.ts can still import this file without a
// cycle.
import type { ConsoleEntry, ReadConsoleArgs, ReadConsoleResult } from "../core/types";
import type { DebuggerFrames } from "./debugger-frames.types";

/** One request in a tab's debugger network log. Timestamps are CDP
 *  MonotonicTime, in seconds. */
export interface NetworkEntry {
  seq: number;
  requestId: string;
  method: string;
  url: string;
  /** CDP ResourceType, e.g. "Document", "Fetch"; "Other" when absent. */
  resourceType: string;
  startTs: number;
  requestHeaders: Record<string, string>;
  postData?: string;
  hasPostData: boolean;
  status?: number;
  mimeType?: string;
  responseHeaders?: Record<string, string>;
  endTs?: number;
  /** CDP `loadingFailed.errorText`. */
  failed?: string;
}

/** One tab's debugger state. `page_emulate` sets `emulation`; `page_dialog`
 *  sets `dialogPlan`, and the network log fills `network`. */
export interface TabDebugState {
  status: "debugging" | "canceled";
  /** `new URL(tab.url).host`, e.g. `localhost:10040`. */
  host: string;
  /** The tab's top frame id, from Page.getFrameTree at start and
   *  refreshed on every main-frame Page.frameNavigated. A console entry whose
   *  context belongs to any other frame is prefixed with that frame's origin. */
  topFrameId: string;
  /** Newest last, at most 50; the oldest is dropped. */
  dialogs: string[];
  dialogPlan: { accept: boolean; promptText?: string } | null;
  lastDialog: string | null;
  emulation: Record<string, unknown> | null;
  originalUserAgent: string;
  /** Newest last, at most 200; the oldest is dropped. */
  network: NetworkEntry[];
  /** The `seq` the next request gets; starts at 1. */
  nextSeq: number;
  /** The tab's console, from Runtime.consoleAPICalled and
   *  Runtime.exceptionThrown. Newest last, at most PAGE_CONSOLE_CAPACITY. */
  console: ConsoleEntry[];
  /** How many entries fell out of the buffer since the current document. */
  consoleDropped: number;
  /** Changes on every main-frame navigation, so the panel can tell the agent
   *  the page reloaded. */
  consoleDocumentId: string;
}

/** The chrome calls the session makes. Overridable for tests only. */
export interface DebuggerApi {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  /** `sessionId` addresses an auto-attached iframe target
   *  (`{ tabId, sessionId }`); omitting it addresses the tab's top target. */
  sendCommand(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown>;
  /** `chrome.tabs.get(tabId).url`, or "" when the tab has none. */
  tabUrl(tabId: number): Promise<string>;
  onDetach(listener: (tabId: number, reason: string) => void): void;
  /** `sessionId` is present when the event came from a child
   *  (iframe) session, absent for the tab's top target. */
  onEvent(listener: (tabId: number, method: string, params: unknown, sessionId?: string) => void): void;
}

/** What a session call hands back to a tool. */
export interface DebuggerToolText {
  content: string;
  isError?: boolean;
}

export type DebuggerGate =
  | { ok: true; state: TabDebugState }
  | { ok: false; error: string };

export interface DebuggerSession {
  /** Attach (recovering a stale attach), enable Page, Runtime and Network, record state. */
  start(tabId: number): Promise<DebuggerToolText>;
  /** Detach and forget the tab. Never an error. */
  stop(tabId: number): Promise<string>;
  gate(tabId: number): DebuggerGate;
  send(tabId: number, method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
  /** The tab's frames: auto-attached iframe targets, execution
   *  contexts and the ref → frame map. */
  readonly frames: DebuggerFrames;
  /** Every Page.frameNavigated, in any session. `isMain` is true for
   *  the navigating target's OWN root frame (`frame.parentId === undefined`).
   *  The helper world drops that frame's isolated context, because Chrome
   *  hands back the same context id for an empty world after a navigation. */
  onFrameNavigated(
    listener: (tabId: number, sessionId: string | undefined, frameId: string, isMain: boolean) => void,
  ): void;
  realClick(tabId: number, x: number, y: number): Promise<void>;
  pressBackspace(tabId: number): Promise<void>;
  insertText(tabId: number, text: string): Promise<void>;
  /** Clear device metrics and touch emulation, restoring original userAgent if emulated. */
  resetEmulation(tabId: number, s?: TabDebugState): Promise<void>;
  /** For the side panel's `pagehide`: detach every debugging tab, errors ignored. */
  detachAll(): void;
  /** The tab's current URL (`chrome.tabs.get`), or "" when it has none. */
  tabUrl(tabId: number): Promise<string>;
  /** The tab's console buffer, filtered and limited, in the same
   *  shape the page script's `readConsole` used to return. An unknown tab
   *  reads as an empty buffer. */
  readConsole(tabId: number, options?: ReadConsoleArgs): ReadConsoleResult;
  /** Read by the debugger page tools, the helper worlds, the recorder and
   *  unit tests. */
  readonly state: Map<number, TabDebugState>;
  /** Called with the tab id on every MAIN-frame navigation, so the
   *  helper-world cache can drop a context id Chrome is about to reuse for an
   *  empty world. */
  onMainFrameNavigated(listener: (tabId: number) => void): void;
  /** A child target attaches during a recording; arm it too. */
  onChildAttached(listener: (tabId: number, sessionId: string) => void): void;
  /** Runtime.bindingCalled, in any session. */
  onBindingCalled(
    listener: (tabId: number, sessionId: string | undefined, name: string, payload: string, executionContextId: number) => void,
  ): void;
  /** Page.navigatedWithinDocument, in any session. */
  onNavigatedWithinDocument(listener: (tabId: number, frameId: string, url: string) => void): void;
  /** The tab's debugger detached: Cancel, a closed tab, or
   *  stop_debugging. Ends any live recording on that tab. */
  onDetached(listener: (tabId: number, reason: string) => void): void;
}

/** Spliced into `PanelPageToolsOptions` (types.ts). */
export interface DebuggerToolsOptions {
  /** One session for the whole side panel page, shared by every agent's
   *  panel (sidepanel.ts). Absent means `createPanelPageTools` makes its own. */
  debuggerSession?: DebuggerSession;
}
