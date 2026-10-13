import type { GenuiDiagnosticMessage } from "./types.js";

/** Marker every diagnostic message carries, so the parent can tell its frame's
 *  messages apart from any other postMessage traffic on the page. */
export const GENUI_DIAGNOSTIC_MARKER =
  "wa-genui-diagnostic" as const satisfies GenuiDiagnosticMessage["marker"];

/** sourceURL given to every inline script mountIntoFrame() injects. */
export const GENUI_SCRIPT_SOURCE_URL = "agent-ui.js";

export type {
  GenuiSerializedError,
  GenuiConsoleArg,
  GenuiConsoleLevel,
  GenuiConsoleDiagnostic,
  GenuiExceptionDiagnostic,
  GenuiRejectionDiagnostic,
  GenuiResourceDiagnostic,
  GenuiDiagnostic,
  GenuiDiagnosticMessage,
} from "./types.js";
