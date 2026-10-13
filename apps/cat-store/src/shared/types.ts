// types.ts — shared shapes for the modules under `src/shared`. These are
// imported by both the browser tree (`src/web`) and the Express server
// (`src/server`), so keep them free of DOM and of Node built-ins.
//
// The two `marker` fields spell their literal out rather than reading
// `typeof GENUI_DIAGNOSTIC_MARKER` / `typeof GENUI_SCREENSHOT_MARKER`. This
// file must import nothing from the modules that import it, or the module
// graph gains a cycle. Each constant is pinned back to the literal below with
// `as const satisfies`, so the two can never drift.

export interface Order {
  id: string;
  createdAt: string;
  customer: string;
  category: string;
  total: number;
  status: string;
  itemCount: number;
  items: string;
  [key: string]: unknown;
}

/** What the frame reports back to the parent after a mount. */
export interface GenuiChartsReadyResult {
  /** Chart elements found in the mounted source. */
  total: number;
  /** Charts that drew. */
  drawn: number;
  /** Charts that reported an error, including a malformed JSON child. */
  failed: number;
  /** True when the bound expired with at least one chart still unsettled. */
  timedOut: boolean;
}

/** An Error serialised by the frame. `instanceof Error` is false across
 *  realms, so the frame duck-types `.stack` and `.message` and sends this
 *  plain object instead. */
export interface GenuiSerializedError {
  type: "error";
  name: string;
  message: string;
  stack: string;
}

export type GenuiConsoleArg =
  | string
  | number
  | boolean
  | null
  | GenuiSerializedError;

export type GenuiConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface GenuiConsoleDiagnostic {
  kind: "console";
  level: GenuiConsoleLevel;
  args: GenuiConsoleArg[];
  time: number;
}

export interface GenuiExceptionDiagnostic {
  kind: "exception";
  message: string;
  /** Empty when the browser gave no Error object, for example a syntax error. */
  stack: string;
  source: string;
  line: number;
  column: number;
  time: number;
}

export interface GenuiRejectionDiagnostic {
  kind: "rejection";
  message: string;
  stack: string;
  time: number;
}

export interface GenuiResourceDiagnostic {
  kind: "resource";
  tag: string;
  url: string;
  time: number;
}

export type GenuiDiagnostic =
  | GenuiConsoleDiagnostic
  | GenuiExceptionDiagnostic
  | GenuiRejectionDiagnostic
  | GenuiResourceDiagnostic;

export interface GenuiDiagnosticMessage {
  marker: "wa-genui-diagnostic";
  entry: GenuiDiagnostic;
}

export interface GenuiScreenshotRequest {
  marker: "wa-genui-screenshot";
  kind: "request";
  /** Correlation id. The frame echoes it, so two captures in flight at once
   *  cannot be confused for one another. */
  id: string;
}

export interface GenuiScreenshotOk {
  marker: "wa-genui-screenshot";
  kind: "response";
  id: string;
  ok: true;
  /** PNG data URL, "data:image/png;base64,...". */
  dataUrl: string;
}

export interface GenuiScreenshotFailed {
  marker: "wa-genui-screenshot";
  kind: "response";
  id: string;
  ok: false;
  error: string;
}

export type GenuiScreenshotResponse = GenuiScreenshotOk | GenuiScreenshotFailed;

/** What the parent-side function resolves with. It never rejects: a caller
 *  that has to distinguish "no image" from "timed out" reads `error`, and task
 *  008 turns this straight into a tool result. */
export type GenuiScreenshotResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };
