// screenshot.ts — rasterizes a DOM target to an image data URL for
// `DomAdapter.screenshot()`. Split out of dom-adapter.ts; the code is
// unchanged, with the adapter state it reads passed in as `ctx`.

import { elementNotVisible, emptyScreenshot, screenshotMayNotContainElement } from "../tools/error-messages.js";
import { isElementVisible } from "../utils/visibility.js";
import { hasVisiblePixels } from "../utils/image-alpha.js";
import { downscaleToolImage, mediaTypeOf } from "@cuatoi/web-agent-core";
import * as htmlToImage from "html-to-image";
import { getName } from "./element-semantics.js";
import type { ScreenshotContext } from "./adapter-contexts.types.js";

/**
 * True when a data URL carries actual image bytes.
 * A zero-size canvas yields `"data:,"` — a header and an empty payload — which the
 * model API rejects with `invalid_image` ("empty base64 image").
 */
function hasImagePayload(dataUrl: string): boolean {
  const comma = dataUrl.indexOf(",");
  return comma !== -1 && dataUrl.slice(comma + 1).trim().length > 0;
}

/**
 * Rasterize a DOM target to an image data URL.
 *
 * Three outcomes are possible:
 * - **error** — the element cannot be photographed at all (zero-size rect, or
 *   empty rasterization result). No image is returned.
 * - **image + warning** — the capture succeeded but probably does not show the
 *   scoped element (CSS says hidden, or alpha scan finds 0 visible pixels).
 * - **image** — the element is visible; no warning is attached.
 *
 * Unscoped calls (`scope` absent) photograph `document.body` and never warn.
 * The agent UI (`ctx.agentUiSelector`) is always excluded via a node filter.
 * Result is downscaled via core's `downscaleToolImage` (1536 px, 1 MB).
 */
export async function captureScreenshot(ctx: ScreenshotContext, scope?: string): Promise<{
  dataUrl: string;
  mediaType: string;
  width: number;
  height: number;
  /**
   * Present only when the capture probably does not show the scoped element.
   * Absent on every clean capture and on every unscoped call.
   */
  warning?: string;
}> {
  let target: Element;
  if (scope) {
    target = ctx.resolveOrThrow(scope);
  } else {
    const body = ctx.root instanceof Document ? ctx.root.body : (ctx.root as Element);
    if (!body) throw new Error("No document body to screenshot.");
    target = body;
  }

  const agentSel = ctx.agentUiSelector;
  // Skip the cue (and any flash) when the captured region is/contains
  // the chat panel — matches the existing filter exclusion.
  const skipCue = !!(
    typeof target.matches === "function" &&
    (target.matches?.(agentSel) ||
      target.closest?.(agentSel))
  );

  const rect = (target as HTMLElement).getBoundingClientRect?.() ?? {
    x: 0, y: 0, width: 0, height: 0,
  };

  // A zero-size target cannot be photographed: it rasterizes to "data:," — a
  // header with no image bytes, which the model API rejects. Still
  // load-bearing: measured 2026-08-19, a `display:none` element has a 0x0
  // rect but DOES rasterize to a 4x4 PNG with bytes, so the empty-payload branch
  // below would not catch it. Only when a `scope` ref was given: with no scope
  // the target is document.body, whose whole-viewport capture must stay unchanged.
  if (scope) {
    const w = rect.width ?? 0;
    const h = rect.height ?? 0;
    if (w <= 0 || h <= 0) {
      throw new Error(elementNotVisible(scope, getName(target)));
    }
  }

  // Ask CSS whether the element is visible. Measured before the capture so the
  // answer describes the page as photographed. Scoped calls only — an unscoped
  // call photographs document.body and is never warned about.
  const cssVisible = scope ? isElementVisible(target) : true;

  if (ctx.actionCue && !skipCue) {
    await ctx.actionCue(target, "see", {
      rect: {
        x: rect.left ?? 0,
        y: rect.top ?? 0,
        width: rect.width ?? 0,
        height: rect.height ?? 0,
      },
    });
  }

  const filter = (node: HTMLElement) => {
    return !(node instanceof Element && (node.matches?.(agentSel) || node.closest?.(agentSel)));
  };

  const pngDataUrl = await htmlToImage.toPng(target as HTMLElement, {
    filter,
    cacheBust: true,
    pixelRatio: 1,
  });

  // Alpha scan runs on the PNG as captured, BEFORE downscaling, so it
  // measures the real capture and not a resized copy.
  // `undefined` means "could not measure" and must not be read as hidden.
  const pixelsVisible = scope ? await hasVisiblePixels(pngDataUrl) : undefined;

  let dataUrl: string;
  try {
    dataUrl = await downscaleToolImage(pngDataUrl);
  } catch {
    throw new Error(scope ? elementNotVisible(scope, getName(target)) : emptyScreenshot());
  }

  // `downscaleToolImage` throws on an undecodable input — the catch above handles
  // that case. This is the second net: a data URL that decodes successfully
  // but carries no payload bytes. Never return an image with no bytes.
  if (!hasImagePayload(dataUrl)) {
    throw new Error(scope ? elementNotVisible(scope, getName(target)) : emptyScreenshot());
  }

  const mediaType = mediaTypeOf(dataUrl) ?? "image/png";

  // The image is real. Warn only when something says the element is not in it.
  const warning =
    scope && (cssVisible === false || pixelsVisible === false)
      ? screenshotMayNotContainElement(scope, getName(target))
      : undefined;

  return {
    dataUrl, mediaType,
    width: Math.round(rect.width ?? 0),
    height: Math.round(rect.height ?? 0),
    ...(warning ? { warning } : {}),
  };
}
