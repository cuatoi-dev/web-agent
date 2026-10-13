/**
 * Longest edge of the scratch canvas the alpha scan draws into. The scan
 * therefore reads at most ALPHA_SCAN_MAX_EDGE² = 65,536 pixels, whatever the
 * real size of the capture. That is the cost bound: one decode plus one
 * `getImageData` of at most 256x256, per scoped `see` call.
 */
export const ALPHA_SCAN_MAX_EDGE = 256;

/**
 * Does this PNG data URL contain at least one pixel that is not fully
 * transparent?
 *
 *  - `true`  — at least one pixel has alpha > 0.
 *  - `false` — every sampled pixel is fully transparent.
 *  - `undefined` — the environment cannot measure (no 2D canvas, undecodable
 *    input). **`undefined` never means "hidden."** The caller must treat it as
 *    "not measured" and fall back to the CSS visibility check alone.
 *
 * Pass the PNG that `html-to-image` produced, NOT the downscaled result, so
 * the scan measures the real capture and not a resized copy.
 */
export async function hasVisiblePixels(
  pngDataUrl: string,
): Promise<boolean | undefined> {
  if (typeof document === "undefined" || typeof Image === "undefined") return undefined;

  // Probe the 2D context FIRST, before decoding. jsdom fires neither `load` nor
  // `error` for a data: URL, so decoding first would leave the promise pending
  // for ever in every unit test.
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode failed"));
      i.src = pngDataUrl;
    });
  } catch {
    return undefined;
  }

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return undefined;

  const scale = Math.min(1, ALPHA_SCAN_MAX_EDGE / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  canvas.width = dw;
  canvas.height = dh;
  ctx.drawImage(img, 0, 0, dw, dh);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, dw, dh).data;
  } catch {
    return undefined; // tainted canvas or unimplemented getImageData
  }
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}
