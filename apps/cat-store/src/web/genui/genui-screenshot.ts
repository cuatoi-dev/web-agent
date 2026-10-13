import {
  GENUI_SCREENSHOT_MARKER,
  GENUI_SCREENSHOT_TIMEOUT_MS,
  type GenuiScreenshotRequest,
  type GenuiScreenshotResponse,
  type GenuiScreenshotResult,
} from "../../shared/genui-screenshot";

import type { CaptureOptions } from "./types";

export type { CaptureOptions } from "./types";

let sequence = 0;

/** Asks the frame to capture itself and resolves with the PNG data URL.
 *  Never rejects — every failure comes back as `{ ok: false, error }`. */
export async function captureFrameScreenshot(
  iframe: HTMLIFrameElement,
  options: CaptureOptions = {},
): Promise<GenuiScreenshotResult> {
  const win = options.win ?? window;
  const timeoutMs = options.timeoutMs ?? GENUI_SCREENSHOT_TIMEOUT_MS;
  const target = iframe.contentWindow;
  if (!target) return { ok: false, error: "frame-unavailable" };

  const id = `genui-shot-${++sequence}`;

  return new Promise<GenuiScreenshotResult>((resolve) => {
    let settled = false;

    const finish = (result: GenuiScreenshotResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      resolve(result);
    };

    const onMessage = (ev: MessageEvent): void => {
      if (ev.origin !== win.location.origin) return;
      const data = ev.data as Partial<GenuiScreenshotResponse> | null | undefined;
      if (!data || data.marker !== GENUI_SCREENSHOT_MARKER) return;
      // The id is what keeps two captures in flight apart: a reply for another
      // request is ignored here and picked up by that request's own listener.
      if (data.kind !== "response" || data.id !== id) return;
      if (data.ok !== true && data.ok !== false) return;
      const response = data as GenuiScreenshotResponse;
      finish(
        response.ok === true
          ? { ok: true, dataUrl: String(response.dataUrl) }
          : { ok: false, error: String(response.error ?? "capture-failed") },
      );
    };

    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), timeoutMs);

    win.addEventListener("message", onMessage);
    const request: GenuiScreenshotRequest = {
      marker: GENUI_SCREENSHOT_MARKER,
      kind: "request",
      id,
    };
    target.postMessage(request, win.location.origin);
  });
}
