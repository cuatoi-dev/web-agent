// One chrome.debugger session per tab, owned by the side panel page.
// The debugger attach belongs to the EXTENSION, not to this page: closing the
// page does not detach it (probed 2026-09-17), which is why sidepanel.ts calls
// detachAll() on pagehide, and why an attach left over from an earlier panel
// fails with "Another debugger is already attached" and is recovered here.
import { errorMessage } from "./error-message";
import { applyNetworkEvent } from "./debugger-network";
import { PAGE_CONSOLE_CAPACITY, PAGE_CONSOLE_ENTRY_CHARS } from "./constants";
import { createDebuggerFrames } from "./debugger-frames";
import type { ConsoleLogLevel, ReadConsoleArgs, ReadConsoleResult } from "../core/types";
import type {
  DebuggerApi,
  DebuggerGate,
  DebuggerSession,
  DebuggerToolText,
  TabDebugState,
} from "./debugger-tools.types";

export type { DebuggerApi, DebuggerSession, TabDebugState } from "./debugger-tools.types";

const PROTOCOL_VERSION = "1.3";
const MAX_DIALOGS = 50;

/** Flat mode: every child speaks through `{ tabId, sessionId }`
 *  instead of Target.sendMessageToTarget. `waitForDebuggerOnStart: false`
 *  keeps the iframe running while we enable its domains. */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };

export const defaultDebuggerApi: DebuggerApi = {
  attach: (tabId) => chrome.debugger.attach({ tabId }, PROTOCOL_VERSION),
  detach: (tabId) => chrome.debugger.detach({ tabId }),
  // Chrome 125 added `sessionId` to the debuggee target, which is how
  // a command reaches an auto-attached iframe target. @types/chrome 0.0.278
  // still types the target as `Debuggee` (tabId | extensionId | targetId), so
  // the field is cast through. Do not upgrade @types/chrome for this.
  sendCommand: (tabId, method, params, sessionId) =>
    chrome.debugger.sendCommand(
      (sessionId === undefined ? { tabId } : { tabId, sessionId }) as chrome.debugger.Debuggee,
      method,
      params,
    ),
  tabUrl: async (tabId) => (await chrome.tabs.get(tabId)).url ?? "",
  onDetach: (listener) => {
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (typeof source.tabId === "number") listener(source.tabId, reason);
    });
  },
  onEvent: (listener) => {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      // Same cast, the other way round: an event from a child session carries
      // `sessionId`, which this @types/chrome version does not declare.
      const from = source as chrome.debugger.Debuggee & { sessionId?: string };
      if (typeof from.tabId === "number") listener(from.tabId, method, params, from.sessionId);
    });
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A browser message usually ends with a period; the tool text adds its own. */
function withoutFinalPeriod(message: string): string {
  return message.replace(/\.$/, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A fresh id for the tab's current document. */
function newDocumentId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** CDP console types mapped to the four levels page_console reports. */
function levelOf(type: unknown): ConsoleLogLevel {
  if (type === "info") return "info";
  if (type === "warning") return "warn";
  if (type === "error" || type === "assert") return "error";
  return "log";
}

/** A value whose `String()` conversion is its own, not
 *  `Object.prototype.toString`'s `"[object Object]"`. */
function isStringifiable(value: unknown): value is string | number | boolean | bigint | symbol {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" || t === "bigint" || t === "symbol";
}

/** One `Runtime.consoleAPICalled` argument as text. CDP never sends the raw
 *  value, so an object reads from its preview: `Object {a: 1}`,
 *  `Array(3) [1, 2, 3]`. */
function remoteArgText(arg: unknown): string {
  if (!isRecord(arg)) return "";
  if (arg.type === "string") return typeof arg.value === "string" ? arg.value : "";
  if (arg.type === "undefined") return "undefined";
  if (arg.subtype === "null") return "null";
  if (isStringifiable(arg.value)) {
    return String(arg.value);
  }
  if (typeof arg.unserializableValue === "string") return arg.unserializableValue;
  const preview = isRecord(arg.preview) ? arg.preview : undefined;
  const description = typeof arg.description === "string" ? arg.description : "";
  if (preview && Array.isArray(preview.properties)) {
    const props = preview.properties.filter(isRecord);
    const isArray = preview.subtype === "array";
    const inner = props
      .map((p) => {
        const v = typeof p.value === "string" ? p.value : "";
        return isArray ? v : `${typeof p.name === "string" ? p.name : ""}: ${v}`;
      })
      .join(", ");
    const tail = preview.overflow === true ? ", …" : "";
    const body = isArray ? `[${inner}${tail}]` : `{${inner}${tail}}`;
    return description ? `${description} ${body}` : body;
  }
  return description || (typeof arg.type === "string" ? arg.type : "");
}

export function createDebuggerSession(api: DebuggerApi = defaultDebuggerApi): DebuggerSession {
  const state = new Map<number, TabDebugState>();
  const frames = createDebuggerFrames();
  let listening = false;
  // The helper-world cache listens here to drop a context id Chrome
  // is about to reuse for an empty world on a main-frame navigation.
  const navListeners: ((tabId: number) => void)[] = [];
  // The same, per frame and per session.
  const frameNavListeners: ((tabId: number, sessionId: string | undefined, frameId: string, isMain: boolean) => void)[] = [];
  // The recorder driver arms a child the moment it attaches, reads
  // its own binding calls, and raises a route step on a same-document
  // navigation.
  const childListeners: ((tabId: number, sessionId: string) => void)[] = [];
  const bindingListeners: ((tabId: number, sessionId: string | undefined, name: string, payload: string, executionContextId: number) => void)[] = [];
  const withinDocListeners: ((tabId: number, frameId: string, url: string) => void)[] = [];
  // A detach (the user's Cancel, a closed tab, or stop_debugging)
  // ends any recording on that tab.
  const detachedListeners: ((tabId: number, reason: string) => void)[] = [];

  function pushConsole(s: TabDebugState, level: ConsoleLogLevel, raw: string): void {
    const text = raw.length > PAGE_CONSOLE_ENTRY_CHARS ? raw.slice(0, PAGE_CONSOLE_ENTRY_CHARS) : raw;
    if (s.console.length >= PAGE_CONSOLE_CAPACITY) {
      s.console.shift();
      s.consoleDropped += 1;
    }
    s.console.push({ level, text, ts: Date.now() });
  }

  /** "(frame http://pay.test) " for an entry from any frame but the top one,
   *  "" for the top frame and for an entry whose context was never seen. */
  function framePrefix(tabId: number, s: TabDebugState, sessionId: string | undefined, contextId: number): string {
    if (sessionId !== undefined) {
      const child = frames.childBySession(tabId, sessionId);
      return child ? `(frame ${child.origin}) ` : "";
    }
    const ctx = frames.contextById(tabId, undefined, contextId);
    if (!ctx || ctx.frameId === "" || ctx.frameId === s.topFrameId) return "";
    return `(frame ${ctx.origin}) `;
  }

  /** A newly attached iframe target: the same domains the top target enables,
   *  plus its own auto-attach so a cross-site frame nested inside it attaches
   *  too. DOM.getDocument primes the child's node map before any
   *  backendNodeId command runs against it. Every failure is ignored: a frame
   *  that detached mid-enable must not fail the tab. */
  async function enableChild(tabId: number, sessionId: string): Promise<void> {
    for (const [method, params] of [
      ["Runtime.enable", undefined],
      ["Page.enable", undefined],
      ["DOM.enable", undefined],
      ["DOM.getDocument", { depth: 1 }],
      ["Target.setAutoAttach", AUTO_ATTACH],
    ] as const) {
      await api.sendCommand(tabId, method, params, sessionId).catch(() => {});
    }
  }

  function ensureListeners(): void {
    if (listening) return;
    listening = true;
    api.onDetach((tabId, reason) => {
      const s = state.get(tabId);
      if (!s) return;
      if (reason === "canceled_by_user") s.status = "canceled";
      else if (reason === "target_closed") {
        state.delete(tabId);
        frames.forget(tabId);
      }
      for (const l of detachedListeners) l(tabId, reason);
    });
    api.onEvent((tabId, method, params, sessionId) => {
      const s = state.get(tabId);
      if (!s || s.status !== "debugging") return;
      const p = isRecord(params) ? params : {};
      // Child iframe targets and per-frame execution contexts.
      if (method.startsWith("Target.") || method.startsWith("Runtime.executionContext")) {
        const child = frames.applyEvent(tabId, sessionId, method, p);
        if (child) {
          void enableChild(tabId, child.sessionId).then(() => {
            for (const l of childListeners) l(tabId, child.sessionId);
          });
        }
        return;
      }
      // The tab's network log.
      if (method.startsWith("Network.")) {
        applyNetworkEvent(s, method, p);
        return;
      }
      if (method === "Runtime.bindingCalled") {
        const name = typeof p.name === "string" ? p.name : "";
        const payload = typeof p.payload === "string" ? p.payload : "";
        const ctx = typeof p.executionContextId === "number" ? p.executionContextId : 0;
        for (const l of bindingListeners) l(tabId, sessionId, name, payload, ctx);
        return;
      }
      if (method === "Page.navigatedWithinDocument") {
        const frameId = typeof p.frameId === "string" ? p.frameId : "";
        const url = typeof p.url === "string" ? p.url : "";
        for (const l of withinDocListeners) l(tabId, frameId, url);
        return;
      }
      // The tab's console. Chrome replays everything logged before
      // Runtime.enable (measured 2026-09-19), so the buffer holds the whole
      // document, not just what happened after start_debugging.
      if (method === "Runtime.consoleAPICalled") {
        const args = Array.isArray(p.args) ? p.args : [];
        const contextId = typeof p.executionContextId === "number" ? p.executionContextId : 0;
        pushConsole(s, levelOf(p.type), framePrefix(tabId, s, sessionId, contextId) + args.map(remoteArgText).join(" "));
        return;
      }
      if (method === "Runtime.exceptionThrown") {
        const details = isRecord(p.exceptionDetails) ? p.exceptionDetails : {};
        const ex = isRecord(details.exception) ? details.exception : {};
        const text =
          typeof ex.description === "string"
            ? ex.description
            : typeof details.text === "string"
              ? details.text
              : "Error";
        const cid = typeof details.executionContextId === "number" ? details.executionContextId : 0;
        pushConsole(s, "error", framePrefix(tabId, s, sessionId, cid) + text);
        return;
      }
      // A new document starts a new buffer, as the page script's buffer did.
      // `frame.parentId` is absent only on the main frame.
      if (method === "Page.frameNavigated") {
        const frame = isRecord(p.frame) ? p.frame : {};
        const frameId = typeof frame.id === "string" ? frame.id : "";
        const isMain = frame.parentId === undefined;
        for (const l of frameNavListeners) l(tabId, sessionId, frameId, isMain);
        // Only the TOP target's own main frame clears the console and the refs;
        // a child target's root frame is an iframe, and the console keeps the
        // buffer across iframe navigations.
        if (isMain && sessionId === undefined) {
          s.topFrameId = frameId;
          frames.forgetRefs(tabId);
          s.console = [];
          s.consoleDropped = 0;
          s.consoleDocumentId = newDocumentId();
          for (const l of navListeners) l(tabId);
        }
        return;
      }
      if (method !== "Page.javascriptDialogOpening") return;
      const type = typeof p.type === "string" ? p.type : "dialog";
      const message = typeof p.message === "string" ? p.message : "";
      const plan = s.dialogPlan;
      const command: Record<string, unknown> = { accept: plan ? plan.accept : false };
      if (plan?.promptText !== undefined) command.promptText = plan.promptText;
      // Another client (Playwright in the specs) may answer first; its
      // "No dialog is showing" rejection is expected and ignored.
      void api.sendCommand(tabId, "Page.handleJavaScriptDialog", command).catch(() => {});
      s.lastDialog = plan
        ? `${type} "${message}" → ${plan.accept ? "accepted" : "dismissed"}`
        : `${type} "${message}" → dismissed (no answer was set)`;
      s.dialogPlan = null;
      s.dialogs.push(s.lastDialog);
      if (s.dialogs.length > MAX_DIALOGS) s.dialogs.shift();
    });
  }

  async function start(tabId: number): Promise<DebuggerToolText> {
    ensureListeners();
    if (state.get(tabId)?.status === "debugging") {
      return { content: `Tab #${tabId} is already being debugged.` };
    }
    // The tab must exist before anything is attached to it.
    let url: string;
    try {
      url = await api.tabUrl(tabId);
    } catch {
      return {
        content: `No tab with ID ${tabId}. Call read_tabs and pass the ID it reports.`,
        isError: true,
      };
    }
    try {
      await api.attach(tabId);
    } catch (err) {
      const message = errorMessage(err);
      if (!message.includes("Another debugger is already attached")) {
        return {
          content: `start_debugging could not attach to tab #${tabId}: ${withoutFinalPeriod(message)}.`,
          isError: true,
        };
      }
      // Plan correction 2026-09-17: our own attach from an earlier panel — recover.
      await api.detach(tabId).catch(() => {});
      try {
        await api.attach(tabId);
      } catch (err2) {
        return {
          content: `start_debugging could not attach to tab #${tabId}: ${withoutFinalPeriod(errorMessage(err2))}.`,
          isError: true,
        };
      }
    }
    const host = hostOf(url);
    // REGISTER THE STATE FIRST. Chrome replays the tab's earlier
    // console calls the moment Runtime.enable lands, and the onEvent listener
    // drops any event for a tab it has no state for, so enabling before this
    // line loses every replayed entry.
    state.set(tabId, {
      status: "debugging",
      host,
      topFrameId: "",
      dialogs: [],
      dialogPlan: null,
      lastDialog: null,
      emulation: null,
      originalUserAgent: "",
      network: [],
      nextSeq: 1,
      console: [],
      consoleDropped: 0,
      consoleDocumentId: newDocumentId(),
    });
    try {
      await api.sendCommand(tabId, "Page.enable");
      // The top frame id, read BEFORE Runtime.enable. Runtime.enable
      // replays every console message the page already produced, and
      // framePrefix() needs
      // topFrameId set before that replay to tell the top frame's own messages
      // apart from a frame's — reading it after Runtime.enable left topFrameId
      // "" for the whole replay, so a page's own top-frame startup logging came
      // back wrongly prefixed (found running the mock e2e).
      const ft = await api.sendCommand(tabId, "Page.getFrameTree");
      const tree = isRecord(ft) && isRecord(ft.frameTree) && isRecord(ft.frameTree.frame) ? ft.frameTree.frame : {};
      const started = state.get(tabId);
      if (started) started.topFrameId = typeof tree.id === "string" ? tree.id : "";
      await api.sendCommand(tabId, "Network.enable");
      await api.sendCommand(tabId, "Runtime.enable");
      await api.sendCommand(tabId, "DOM.enable");
      // Attaching to every out-of-process iframe. Chrome reports the frames
      // that already exist as Target.attachedToTarget events, which
      // ensureListeners() turns into child sessions.
      await api.sendCommand(tabId, "Target.setAutoAttach", AUTO_ATTACH);
      const ua = await api.sendCommand(tabId, "Runtime.evaluate", {
        expression: "navigator.userAgent",
        returnByValue: true,
      });
      const result = isRecord(ua) && isRecord(ua.result) ? ua.result : {};
      const s = state.get(tabId);
      if (s) s.originalUserAgent = typeof result.value === "string" ? result.value : "";
      return { content: `Debugging tab #${tabId} (${host}).` };
    } catch (err) {
      state.delete(tabId);
      await api.detach(tabId).catch(() => {});
      return {
        content: `start_debugging could not attach to tab #${tabId}: ${withoutFinalPeriod(errorMessage(err))}.`,
        isError: true,
      };
    }
  }

  async function resetEmulation(tabId: number, s?: TabDebugState): Promise<void> {
    const debugState = s ?? state.get(tabId);
    if (!debugState) return;
    // Touch is disabled BEFORE clearing device metrics — the metrics clear is
    // what triggers the page's "resize" event (see the matching comment in
    // panel-page-tools-debugger.ts), so touch must already be off when that
    // event fires.
    await send(tabId, "Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
    await send(tabId, "Emulation.clearDeviceMetricsOverride").catch(() => {});
    const emu = debugState.emulation;
    if (emu && typeof emu === "object" && "preset" in emu && emu.preset) {
      await send(tabId, "Emulation.setUserAgentOverride", { userAgent: debugState.originalUserAgent }).catch(() => {});
    }
    debugState.emulation = null;
  }

  async function stop(tabId: number): Promise<string> {
    const s = state.get(tabId);
    if (!s || s.status === "canceled") return `Tab #${tabId} is not being debugged.`;
    await resetEmulation(tabId, s);
    await api.detach(tabId).catch(() => {});
    state.delete(tabId);
    frames.forget(tabId);
    for (const l of detachedListeners) l(tabId, "stop_debugging");
    return `Stopped debugging tab #${tabId}. Emulation was reset.`;
  }

  function gate(tabId: number): DebuggerGate {
    const s = state.get(tabId);
    if (!s) return { ok: false, error: `Debugging is not started on tab #${tabId}. Call start_debugging first.` };
    if (s.status === "canceled") {
      return {
        ok: false,
        error: `Debugging stopped on tab #${tabId}: the user pressed Cancel on Chrome's bar. Call start_debugging to continue.`,
      };
    }
    return { ok: true, state: s };
  }

  const send = (tabId: number, method: string, params?: Record<string, unknown>, sessionId?: string) =>
    sessionId !== undefined
      ? api.sendCommand(tabId, method, params, sessionId)
      : api.sendCommand(tabId, method, params);

  async function realClick(tabId: number, x: number, y: number): Promise<void> {
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    // CDP's response confirms the event was dispatched into the renderer, not
    // that the page's own click handler has finished running — measured
    // 2026-09-19: a page_verify called immediately after page_click could
    // still see the pre-click DOM. A Node-side setTimeout(0) is not
    // correlated with the RENDERER's task queue, so wait inside the page
    // itself for two animation frames, matching web-agent-dom's
    // interactions.ts settle wait after a synthetic click.
    await send(tabId, "Runtime.evaluate", {
      expression: "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
      awaitPromise: true,
    }).catch(() => {});
  }

  async function pressBackspace(tabId: number): Promise<void> {
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  }

  async function insertText(tabId: number, text: string): Promise<void> {
    await send(tabId, "Input.insertText", { text });
  }

  function detachAll(): void {
    for (const [tabId, s] of state) {
      if (s.status === "debugging") void api.detach(tabId).catch(() => {});
      frames.forget(tabId);
    }
    state.clear();
  }

  const tabUrl = (tabId: number) => api.tabUrl(tabId);

  function readConsole(tabId: number, options: ReadConsoleArgs = {}): ReadConsoleResult {
    const s = state.get(tabId);
    if (!s) return { documentId: "", dropped: 0, total: 0, entries: [] };
    const filtered = options.level ? s.console.filter((e) => e.level === options.level) : s.console;
    const limit = options.limit ?? 50;
    return {
      documentId: s.consoleDocumentId,
      dropped: s.consoleDropped,
      total: filtered.length,
      entries: filtered.slice(-limit),
    };
  }

  return {
    start,
    stop,
    gate,
    send,
    realClick,
    pressBackspace,
    insertText,
    resetEmulation,
    detachAll,
    tabUrl,
    readConsole,
    state,
    frames,
    onMainFrameNavigated: (l) => { navListeners.push(l); },
    onFrameNavigated: (l) => { frameNavListeners.push(l); },
    onChildAttached: (l) => { childListeners.push(l); },
    onBindingCalled: (l) => { bindingListeners.push(l); },
    onNavigatedWithinDocument: (l) => { withinDocListeners.push(l); },
    onDetached: (l) => { detachedListeners.push(l); },
  };
}
