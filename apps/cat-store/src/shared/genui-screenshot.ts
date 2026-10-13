import type { GenuiScreenshotRequest } from "./types.js";

/** Marker every screenshot message carries, so neither side confuses it with a
 *  diagnostic (GENUI_DIAGNOSTIC_MARKER) or with unrelated postMessage traffic. */
export const GENUI_SCREENSHOT_MARKER =
  "wa-genui-screenshot" as const satisfies GenuiScreenshotRequest["marker"];

/** How long the parent waits for one capture before giving up. html-to-image
 *  embeds fonts and rasterises through an SVG image, so a panel-sized capture
 *  takes noticeably longer than a paint; 10 s is well above that and still
 *  bounded. Every caller can override it per request. */
export const GENUI_SCREENSHOT_TIMEOUT_MS = 10_000;

export type {
  GenuiScreenshotRequest,
  GenuiScreenshotOk,
  GenuiScreenshotFailed,
  GenuiScreenshotResponse,
  GenuiScreenshotResult,
} from "./types.js";
