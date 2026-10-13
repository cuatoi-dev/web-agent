import {
  GENUI_DIAGNOSTIC_MARKER,
  type GenuiDiagnostic,
  type GenuiDiagnosticMessage,
} from "../../shared/genui-diagnostics";

import type { GenuiDiagnosticsCollector } from "./types";

export type { GenuiDiagnosticsCollector } from "./types";

export function createGenuiDiagnosticsCollector(
  win: Window = window,
): GenuiDiagnosticsCollector {
  let buffer: GenuiDiagnostic[] = [];
  let listening = false;

  const onMessage = (ev: MessageEvent): void => {
    // The frame is same-origin by design (task 004), so anything from another
    // origin is not ours.
    if (ev.origin !== win.location.origin) return;
    const data = ev.data as Partial<GenuiDiagnosticMessage> | null | undefined;
    if (!data || data.marker !== GENUI_DIAGNOSTIC_MARKER || !data.entry) return;
    buffer.push(data.entry);
  };

  return {
    start(): void {
      if (listening) return;
      win.addEventListener("message", onMessage);
      listening = true;
    },
    stop(): void {
      if (!listening) return;
      win.removeEventListener("message", onMessage);
      listening = false;
    },
    drain(): GenuiDiagnostic[] {
      const out = buffer;
      buffer = [];
      return out;
    },
    size(): number {
      return buffer.length;
    },
  };
}
