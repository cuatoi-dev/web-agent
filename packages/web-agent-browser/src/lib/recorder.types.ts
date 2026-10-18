// 124/005 — the recorder's step and message shapes, and the panel-side
// recording controller. Split out of types.ts to stay under that file's
// 500-line cap (eslint.config.mjs max-lines); imports only the element target
// type, mirroring act-by-ref-tools.types.ts.
import type { ElementTarget } from "./element-target.types";

/** What the user did. `check`/`uncheck` are a click on a checkbox or radio. */
export type RecordedStepKind =
  | "click"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "press"
  | "scroll"
  | "hover"
  | "route";

/** One recorded action. Built in the MAIN world, where the element still
 *  exists; only this flat, structured-clonable shape crosses to the panel.
 *
 *  `line` is the readable text the plan fixes, for example
 *  `click button "Apply"`. It is computed here, once, and reused verbatim as
 *  the text of the `stop_recording` list.
 *
 *  `value` carries a `fill`'s text; `values` carries a `select`'s chosen option
 *  labels (the plan's "value = selected option labels", as a list so
 *  `selectOption` gets one argument per label). A password's text is never
 *  read: `masked` is true and `value` is absent. */
export interface RecordedStep {
  recordingId: string;
  seq: number;
  kind: RecordedStepKind;
  value?: string;
  values?: string[];
  masked?: boolean;
  key?: string;
  deltaY?: number;
  path?: string;
  line: string;
  /** Role, name and label, read before the step is posted.
   *  Absent for `scroll` and for a `press` with no focused element. */
  target?: ElementTarget;
  /** 131/004 — the `<iframe>` selectors from the top page down to this
   *  step's frame, top-down. Absent for a top-frame step. Built by the
   *  helper world, the same way 131/003 builds them for the agent's own
   *  actions. */
  frames?: string[];
  /** 131/004 — the origin of the frame the step happened in, e.g.
   *  "http://pay.test". Absent for the top frame. */
  frameOrigin?: string;
}

/** The controller's state. `stopped` holds one finished recording waiting to be
 *  read by `stop_recording`; reading it returns the controller to `idle`. */
export type RecordingState =
  | { kind: "idle" }
  | { kind: "recording"; tabId: number; host: string; url: string; recordingId: string; steps: RecordedStep[] }
  | { kind: "stopped"; host: string; url: string; steps: RecordedStep[]; note?: string };

/** One finished recording, as `stop_recording` reports it. */
export interface RecordingResult {
  host: string;
  url: string;
  steps: RecordedStep[];
  note?: string;
}

/** The browser calls the controller makes. A unit test supplies fakes. */
export interface RecordingApi {
  addTabRemovedListener: (listener: (tabId: number) => void) => void;
  removeTabRemovedListener: (listener: (tabId: number) => void) => void;
  /** `chrome.tabs.get(tabId)`, narrowed to the URL. Rejects for a closed tab. */
  tabUrl: (tabId: number) => Promise<string>;
}

/** One controller per agent panel. Watch me uses the same controller. */
export interface RecordingController {
  state: () => RecordingState;
  /** `{ host, url }` for the tab, for the confirm summary and the state. */
  tabInfo: (tabId: number) => Promise<{ host: string; url: string }>;
  /** `from` is "tool" for `start_recording` and "button" for Watch me. A
   *  "button" start attaches the debugger itself; a "tool" start requires it
   *  and returns the 131/001 gate error when it is missing. */
  start: (
    tabId: number,
    info: { host: string; url: string },
    from: "tool" | "button",
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Stops, consumes and returns the recording, whether it is still running or
   *  already stopped by a navigation or a closed tab. */
  stop: () => Promise<RecordingResult | { error: string }>;
  /** No-op unless a recording is live on `tabId`. */
  pause: (tabId: number) => Promise<void>;
  /** Waits {@link REC_RESUME_DELAY_MS} first. No-op unless a recording is live
   *  on `tabId`. */
  resume: (tabId: number) => Promise<void>;
  /** Notifies on every state change (`start`, a step, `finish`, `stop`) —
   *  task 006's Watch me provider uses this to re-render live. Returns an
   *  unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}

