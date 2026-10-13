import { toPng } from "html-to-image";
import {
  GENUI_SCREENSHOT_MARKER,
  type GenuiScreenshotRequest,
  type GenuiScreenshotResponse,
} from "../../shared/genui-screenshot";

/** Captures the frame's own <body> and answers the parent.
 *
 *  Why in the frame, not the parent: called from the parent on the iframe,
 *  html-to-image clones `contentDocument.body` in `cloneIFrameElement` and then
 *  appends that body's children a second time in `cloneChildren`, so every
 *  element renders twice, and the iframe's own <body> background is dropped.
 *  Capturing here was measured byte-identical to a correct parent-side capture
 *  (28,902 characters either way) and is the only version that still works if
 *  the frame is ever sandboxed. */
function reply(response: GenuiScreenshotResponse): void {
  try {
    window.parent.postMessage(response, window.location.origin);
  } catch {
    /* A closed or cross-origin parent must never break the mounted code. */
  }
}

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.origin !== window.location.origin) return;
  const data = ev.data as Partial<GenuiScreenshotRequest> | null | undefined;
  if (!data || data.marker !== GENUI_SCREENSHOT_MARKER) return;
  if (data.kind !== "request" || typeof data.id !== "string") return;
  const id = data.id;

  // The <body> background is the frame's own, set by the frame stylesheet at
  // genui-routes.ts:30. Passing it explicitly is what keeps it out of the
  // transparent-band failure the parent-side capture produced.
  const backgroundColor = window.getComputedStyle(document.body).backgroundColor;

  // pixelRatio 1 makes the payload the same size on every display, so the
  // capture the reviewer opens is the capture any host gets.
  toPng(document.body, { backgroundColor, pixelRatio: 1 })
    .then((dataUrl) => {
      reply({ marker: GENUI_SCREENSHOT_MARKER, kind: "response", id, ok: true, dataUrl });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      reply({ marker: GENUI_SCREENSHOT_MARKER, kind: "response", id, ok: false, error: message });
    });
});
