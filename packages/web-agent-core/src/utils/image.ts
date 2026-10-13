import type { ImageLimits } from "./types.js";
export type { ImageLimits } from "./types.js";

export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxDimension: 1024,
  maxBytes: 512 * 1024,  // 512 KB
  quality: 0.82,
};

/** 003: limits for images a tool returns. 1536 = 768 × 2, just under Claude's
 *  1568 px standard tier. User attachments keep DEFAULT_IMAGE_LIMITS. */
export const TOOL_IMAGE_LIMITS = {
  maxDimension: 1536,
  maxBytes: 1_048_576,
  quality: 0.82,
} as const;

/** The media type in a data URL's header (`data:image/png;base64,…` →
 *  `image/png`), lower-cased. `undefined` when there is no header. */
export function mediaTypeOf(dataUrl: string): string | undefined {
  const m = /^data:([^;,]+)[;,]/i.exec(dataUrl.trim());
  return m ? m[1].toLowerCase() : undefined;
}

/** Decoded byte size of a data URL's payload (the formula `downscaleImage` uses). */
function payloadBytes(dataUrl: string): number {
  return (dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75;
}

/**
 * Checks whether a data-URL or base64 string contains a non-empty image payload.
 */
export function hasImagePayload(dataUrlOrBase64: string): boolean {
  if (!dataUrlOrBase64 || typeof dataUrlOrBase64 !== "string") return false;
  const trimmed = dataUrlOrBase64.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    return comma !== -1 && trimmed.slice(comma + 1).trim().length > 0;
  }
  return true;
}

/**
 * Throws an error if the image payload is empty or invalid.
 */
export function assertImagePayload(dataUrlOrBase64: string): void {
  if (!hasImagePayload(dataUrlOrBase64)) {
    throw new Error("Invalid image: base64 payload is empty");
  }
}

/**
 * Load an image into an ImageBitmap, falling back to HTMLImageElement + canvas
 * if createImageBitmap fails (e.g., Chromium rejects 1x1 PNGs).
 */
async function loadImageAsBitmap(
  dataUrl: string,
  maxDimension?: number,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();

  // Primary path: createImageBitmap (fastest, most memory-efficient)
  try {
    const bmp = await createImageBitmap(blob);
    return { bitmap: bmp, width: bmp.width, height: bmp.height };
  } catch {
    // Fallback: decode via HTMLImageElement (handles degenerate sizes)
  }

  // Fallback: HTMLImageElement → canvas → ImageBitmap
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Image decode failed"));
    i.src = dataUrl;
  });

  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (maxDimension) {
    const longest = Math.max(w, h);
    if (longest > maxDimension) {
      const scale = maxDimension / longest;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const bmp = await createImageBitmap(canvas);
  return { bitmap: bmp, width: w, height: h };
}

/**
 * Downscale a data-URL image using an OffscreenCanvas, or an HTMLCanvasElement
 * when OffscreenCanvas is missing. Returns a new data-URL that fits the limits.
 *
 * Algorithm:
 *   1. Decode the data-URL into an Image / ImageBitmap.
 *   2. If max(w, h) > maxDimension → scale both sides proportionally so the
 *      longest edge equals maxDimension.
 *   3. Draw onto a canvas and re-encode as image/jpeg at `quality`.
 *   4. If the result still exceeds maxBytes, reduce quality by 0.1 and retry
 *      (floor at quality 0.3 to avoid unrecognisable output).
 *   5. Return the resulting data-URL.
 *
 * Environment notes:
 *   - Browser: uses OffscreenCanvas when available, falls back to HTMLCanvasElement.
 *   - Node/jsdom (tests): createImageBitmap is undefined in jsdom, so the
 *     function resolves with the input data-URL unchanged. Tests can stub
 *     createImageBitmap or mock this module entirely.
 *
 * @param dataUrl   Original data-URL (data:image/...;base64,...).
 * @param limits    Scaling limits (merged with DEFAULT_IMAGE_LIMITS).
 * @returns         Promise resolving to a downscaled data-URL.
 */
export async function downscaleImage(
  dataUrl: string,
  limits: ImageLimits = {},
): Promise<string> {
  const { maxDimension, maxBytes, quality } = { ...DEFAULT_IMAGE_LIMITS, ...limits };

  assertImagePayload(dataUrl);

  // --- jsdom / no-createImageBitmap guard ---
  if (typeof createImageBitmap === "undefined") {
    // Test/jsdom environment: can't decode, return original.
    return dataUrl;
  }

  // --- load image (with createImageBitmap fallback) ---
  let loaded: { bitmap: ImageBitmap; width: number; height: number };
  try {
    loaded = await loadImageAsBitmap(dataUrl, maxDimension);
  } catch (err) {
    throw new Error(
      `Failed to decode image for downscaling: ${(err as Error)?.message || String(err)}`,
      { cause: err },
    );
  }

  const { bitmap: srcBmp, width: srcW, height: srcH } = loaded;

  // --- compute target dimensions ---
  let dstW = srcW;
  let dstH = srcH;
  if (dstW <= 0 || dstH <= 0) {
    srcBmp.close?.();
    throw new Error("Cannot downscale image: image has degenerate dimensions (0x0)");
  }
  const longest = Math.max(srcW, srcH);
  if (maxDimension && longest > maxDimension) {
    const scale = maxDimension / longest;
    dstW = Math.round(srcW * scale);
    dstH = Math.round(srcH * scale);
  }

  // --- draw & encode ---
  async function encode(q: number): Promise<string> {
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let ctx2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(dstW, dstH);
      ctx2d = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    } else {
      canvas = document.createElement("canvas");
      (canvas).width = dstW;
      (canvas).height = dstH;
      ctx2d = (canvas).getContext("2d")!;
    }

    ctx2d.drawImage(srcBmp, 0, 0, dstW, dstH);

    if (canvas instanceof OffscreenCanvas) {
      const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: q });
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(outBlob);
      });
    } else {
      return (canvas).toDataURL("image/jpeg", q);
    }
  }

  let q = quality ?? 0.82;
  let result = await encode(q);

  // --- byte-size reduction loop ---
  if (maxBytes) {
    let byteSize = (result.length - result.indexOf(",") - 1) * 0.75;
    while (byteSize > maxBytes && q > 0.3) {
      q = Math.max(q - 0.1, 0.3);
      result = await encode(q);
      byteSize = (result.length - result.indexOf(",") - 1) * 0.75;
      if (byteSize <= maxBytes) break;
    }
  }

  srcBmp.close();
  return result;
}

/**
 * 003: downscale an image a tool returned to TOOL_IMAGE_LIMITS, keeping its
 * format where it can.
 *
 * - Within 1536 px and 1 MB: returned unchanged (same bytes, same format,
 *   transparency kept).
 * - A JPEG over a limit: re-encoded as JPEG at the 1536 px size, quality 0.82,
 *   then quality down by 0.1 (floor 0.3) while over 1 MB.
 * - Any other type over a limit: encoded as PNG at the 1536 px size. If that
 *   PNG is still over 1 MB, encoded once more as PNG at half that size
 *   (768 px long edge). There is no third size.
 *
 * jsdom has no createImageBitmap, so the input is returned unchanged there.
 * An empty payload throws "Invalid image: base64 payload is empty"; an image
 * that cannot be decoded throws "Failed to decode image for downscaling: …".
 */
export async function downscaleToolImage(dataUrl: string): Promise<string> {
  const { maxDimension, maxBytes, quality } = TOOL_IMAGE_LIMITS;

  assertImagePayload(dataUrl);
  if (typeof createImageBitmap === "undefined") return dataUrl;

  const type = mediaTypeOf(dataUrl);

  // Decode at full size: no maxDimension, so the fallback path does not
  // pre-shrink and the "within the limits" check sees the real size.
  let loaded: { bitmap: ImageBitmap; width: number; height: number };
  try {
    loaded = await loadImageAsBitmap(dataUrl);
  } catch (err) {
    throw new Error(
      `Failed to decode image for downscaling: ${(err as Error)?.message || String(err)}`,
      { cause: err },
    );
  }
  const { bitmap, width: srcW, height: srcH } = loaded;
  if (srcW <= 0 || srcH <= 0) {
    bitmap.close?.();
    throw new Error("Cannot downscale image: image has degenerate dimensions (0x0)");
  }

  const longest = Math.max(srcW, srcH);
  if (longest <= maxDimension && payloadBytes(dataUrl) <= maxBytes) {
    bitmap.close?.();
    return dataUrl;
  }

  let w = srcW;
  let h = srcH;
  if (longest > maxDimension) {
    const scale = maxDimension / longest;
    w = Math.round(srcW * scale);
    h = Math.round(srcH * scale);
  }

  try {
    if (type === "image/jpeg") {
      let q: number = quality;
      let out = await encodeBitmap(bitmap, w, h, "image/jpeg", q);
      while (payloadBytes(out) > maxBytes && q > 0.3) {
        q = Math.max(q - 0.1, 0.3);
        out = await encodeBitmap(bitmap, w, h, "image/jpeg", q);
      }
      return out;
    }
    let out = await encodeBitmap(bitmap, w, h, "image/png");
    if (payloadBytes(out) > maxBytes) {
      out = await encodeBitmap(bitmap, Math.round(w / 2), Math.round(h / 2), "image/png");
    }
    return out;
  } finally {
    bitmap.close?.();
  }
}

/** Draw `bitmap` at w × h and encode it. `quality` applies to JPEG only. */
async function encodeBitmap(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  type: "image/png" | "image/jpeg",
  quality?: number,
): Promise<string> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx2d = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    ctx2d.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob(
      type === "image/jpeg" ? { type, quality } : { type },
    );
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("Could not read the encoded image"));
      reader.readAsDataURL(blob);
    });
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  return type === "image/jpeg" ? canvas.toDataURL(type, quality) : canvas.toDataURL(type);
}
