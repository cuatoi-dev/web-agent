// The panel's recording controller, one per agent panel. It owns the
// step list, so a full page load loses no step that was already sent, and it
// is what Watch me drives.
import { REC_RESUME_DELAY_MS } from "./constants";
import type { DebuggerRecorder } from "./debugger-recorder.types";
import type { DebuggerSession } from "./debugger-tools.types";
import type {
  RecordedStep,
  RecordingApi,
  RecordingController,
  RecordingResult,
  RecordingState,
} from "./recorder.types";

export const defaultRecordingApi: RecordingApi = {
  addTabRemovedListener: (l) => {
    chrome.tabs.onRemoved.addListener(wrapTabId(l));
  },
  removeTabRemovedListener: (l) => {
    const w = tabWrapped.get(l);
    if (w) {
      chrome.tabs.onRemoved.removeListener(w);
      tabWrapped.delete(l);
    }
  },
  tabUrl: async (tabId) => (await chrome.tabs.get(tabId)).url ?? "",
};

// The wrapper exists because chrome's listener signature differs from the
// narrow one the controller wants, and removeListener needs the SAME
// function object that was added.
const tabWrapped = new Map<(t: number) => void, (t: number) => void>();
function wrapTabId(l: (t: number) => void) {
  const w = (t: number) => l(t);
  tabWrapped.set(l, w);
  return w;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A new id per recording. `crypto.randomUUID` is available in every page
 *  realm this extension runs in (secure contexts); the fallback keeps a
 *  non-secure http:// fixture page working. */
function newRecordingId(): string {
  const c = globalThis.crypto;
  return typeof c?.randomUUID === "function" ? c.randomUUID() : `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createRecordingController(options: {
  /** The tab's debugger. A controller built without one can still
   *  report a finished recording, but cannot start a new one. */
  session?: DebuggerSession;
  recorder?: DebuggerRecorder;
  api?: RecordingApi;
} = {}): RecordingController {
  const api = options.api ?? defaultRecordingApi;
  let state: RecordingState = { kind: "idle" };
  const listeners = new Set<() => void>();
  const notifyListeners = (): void => {
    for (const l of listeners) l();
  };

  const onStep = (tabId: number, step: RecordedStep): void => {
    if (state.kind !== "recording") return;
    if (tabId !== state.tabId) return;
    if (step.recordingId !== state.recordingId) return;
    // Upsert by seq: a fill or a scroll is re-sent as it grows.
    const at = state.steps.findIndex((s) => s.seq === step.seq);
    if (at >= 0) state.steps[at] = step;
    else state.steps.push(step);
    state.steps.sort((a, b) => a.seq - b.seq);
    notifyListeners();
  };

  const onRoute = (tabId: number, path: string, seq: number): void => {
    if (state.kind !== "recording" || tabId !== state.tabId) return;
    // The ONLY source of route steps: CDP Page.navigatedWithinDocument, once
    // per same-document navigation. The page script raises none.
    // `seq` comes pre-assigned from the driver's own tab-wide seq space, so it
    // can never collide with a step still in flight (found running the
    // recorder mock e2e — a route step raised between a click's
    // binding call and its async frame-chain lookup used to land on the same
    // seq and silently overwrite it).
    // The previous route step is the one with the highest seq. The array is
    // not re-sorted after a route push, so its last route entry may not be it.
    let lastRoute: RecordedStep | undefined;
    for (const s of state.steps) {
      if (s.kind === "route" && (lastRoute === undefined || s.seq > lastRoute.seq)) lastRoute = s;
    }
    // Same path as the previous route step: the URL did not change.
    if (lastRoute?.path === path) return;
    state.steps.push({ recordingId: state.recordingId, seq, kind: "route", line: `route to ${path}`, path });
    notifyListeners();
  };

  const onDetached = (tabId: number, reason: string): void => {
    if (state.kind !== "recording" || tabId !== state.tabId) return;
    finish(
      reason === "target_closed"
        ? "Recording stopped: the tab closed."
        : "Recording stopped: debugging was canceled.",
    );
  };

  const onTabRemoved = (tabId: number): void => {
    if (state.kind !== "recording" || tabId !== state.tabId) return;
    finish("Recording stopped: the tab closed.");
  };

  // Registered ONCE, at construction — these are push-only arrays with no
  // removal, so registering them per start would stack duplicates. Each
  // handler already returns early unless a recording is live on that tab.
  options.recorder?.onStep(onStep);
  options.recorder?.onRoute(onRoute);
  options.session?.onDetached(onDetached);

  /** Detaches every listener and parks the result. */
  function finish(note?: string): void {
    if (state.kind !== "recording") return;
    api.removeTabRemovedListener(onTabRemoved);
    const { host, url, steps } = state;
    state = { kind: "stopped", host, url, steps, ...(note === undefined ? {} : { note }) };
    lastResult = { host, url, steps, ...(note === undefined ? {} : { note }) };
    notifyListeners();
  }

  let lastResult: RecordingResult | null = null;

  return {
    state: () => state,

    async tabInfo(tabId) {
      const url = await api.tabUrl(tabId);
      return { host: hostOf(url), url };
    },

    async start(tabId, info, from) {
      if (state.kind === "recording") return { ok: false, error: `Already recording on ${state.host}.` };
      const session = options.session;
      const recorder = options.recorder;
      if (!session || !recorder) return { ok: false, error: "Recording is not available in this panel." };
      const gate = session.gate(tabId);
      if (!gate.ok) {
        // "tool" gets the debugger gate error verbatim. "button" attaches itself —
        // the user pressed it, which is the consent.
        if (from === "tool") return { ok: false, error: gate.error };
        const started = await session.start(tabId);
        if (started.isError) {
          return { ok: false, error: `Watch me could not start: ${started.content}` };
        }
      }
      const recordingId = newRecordingId();
      state = { kind: "recording", tabId, host: info.host, url: info.url, recordingId, steps: [] };
      lastResult = null;
      await recorder.install(tabId, recordingId);
      api.addTabRemovedListener(onTabRemoved);
      notifyListeners();
      return { ok: true };
    },

    async stop() {
      if (state.kind === "idle") return { error: "Nothing is being recorded." };
      if (state.kind === "recording") {
        const { tabId } = state;
        // Best effort: the panel's list is authoritative, so a tab that never
        // answers costs nothing.
        await options.recorder?.uninstall(tabId);
        finish(undefined);
      }
      const result = lastResult;
      state = { kind: "idle" };
      lastResult = null;
      notifyListeners();
      return result ?? { error: "Nothing is being recorded." };
    },

    async pause(tabId) {
      if (state.kind !== "recording" || state.tabId !== tabId) return;
      await options.recorder?.pause(tabId);
    },

    async resume(tabId) {
      if (state.kind !== "recording" || state.tabId !== tabId) return;
      // The page's own late listeners run before the recorder is live again,
      // so nothing the tool caused is attributed to the user.
      await new Promise((r) => setTimeout(r, REC_RESUME_DELAY_MS));
      if (state.kind !== "recording" || state.tabId !== tabId) return;
      await options.recorder?.resume(tabId);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
