import { describe, it, expect, vi, afterEach } from "vitest";
import { downscaleImage, downscaleToolImage, mediaTypeOf, hasImagePayload } from "./image.js";

describe("downscaleImage", () => {
  it("returns the data-URL unchanged in jsdom (no createImageBitmap)", async () => {
    // In jsdom, createImageBitmap is undefined, so the function returns input unchanged.
    const input = "data:image/png;base64,iVBORw0KGgo=";
    const result = await downscaleImage(input);
    expect(result).toBe(input);
  });

  it("throws when input dataUrl has empty payload (data:,)", async () => {
    await expect(downscaleImage("data:,")).rejects.toThrow(/empty/i);
  });

  it("throws when input dataUrl is empty string", async () => {
    await expect(downscaleImage("")).rejects.toThrow(/empty/i);
  });
});

describe("hasImagePayload", () => {
  it("returns false for empty or header-only data URLs", () => {
    expect(hasImagePayload("data:,")).toBe(false);
    expect(hasImagePayload("data:image/png;base64,")).toBe(false);
    expect(hasImagePayload("data:image/png;base64,AAA=")).toBe(true);
  });
});

describe("downscaleToolImage", () => {
  function stubBrowser(
    size: { width: number; height: number },
    bytesFor: (type: string, w: number, h: number, q?: number) => number,
  ) {
    const encodes: Array<{ type: string; quality?: number; w: number; h: number }> = [];
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob(["x"])) })));
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve({ ...size, close: vi.fn() })));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(public w: number, public h: number) {}
        getContext() {
          return { drawImage: vi.fn() };
        }
        convertToBlob(opts: { type: string; quality?: number }) {
          encodes.push({ type: opts.type, quality: opts.quality, w: this.w, h: this.h });
          return Promise.resolve(
            new Blob([new Uint8Array(bytesFor(opts.type, this.w, this.h, opts.quality))], { type: opts.type }),
          );
        }
      },
    );
    return encodes;
  }

  const pngUrl = (bytes: number) => "data:image/png;base64," + "A".repeat(Math.ceil(bytes / 0.75));
  const jpgUrl = (bytes: number) => "data:image/jpeg;base64," + "A".repeat(Math.ceil(bytes / 0.75));

  afterEach(() => vi.unstubAllGlobals());

  it("U1: jsdom path returns input unchanged; empty throws", async () => {
    const input = "data:image/png;base64,iVBORw0KGgo=";
    expect(await downscaleToolImage(input)).toBe(input);
    await expect(downscaleToolImage("data:,")).rejects.toThrow(/empty/i);
    await expect(downscaleToolImage("")).rejects.toThrow(/empty/i);
  });

  it("U2a: within limits, PNG is returned unchanged", async () => {
    const encodes = stubBrowser({ width: 1200, height: 800 }, () => 0);
    const input = pngUrl(200_000);
    const result = await downscaleToolImage(input);
    expect(result).toBe(input);
    expect(encodes).toHaveLength(0);
  });

  it("U2b: within limits, JPEG and GIF are returned unchanged", async () => {
    const encodes = stubBrowser({ width: 1200, height: 800 }, () => 0);
    const jpg = jpgUrl(200_000);
    const gif = "data:image/gif;base64," + "A".repeat(1000);
    expect(await downscaleToolImage(jpg)).toBe(jpg);
    expect(await downscaleToolImage(gif)).toBe(gif);
    expect(encodes).toHaveLength(0);
  });

  it("U2c: under 1536 px but over 1 MB, PNG is re-encoded", async () => {
    const encodes = stubBrowser({ width: 1000, height: 1000 }, () => 300_000);
    const input = pngUrl(2_000_000);
    const result = await downscaleToolImage(input);
    expect(encodes).toEqual([{ type: "image/png", quality: undefined, w: 1000, h: 1000 }]);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("U3a: large PNG, UI-like, scaled to 1536", async () => {
    const encodes = stubBrowser({ width: 3000, height: 2000 }, () => 219_000);
    const input = pngUrl(3_000_000);
    const result = await downscaleToolImage(input);
    expect(encodes).toEqual([{ type: "image/png", quality: undefined, w: 1536, h: 1024 }]);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("U3b: large PNG, photo-like (halved once to 768)", async () => {
    const encodes = stubBrowser({ width: 3000, height: 2000 }, (t, w) => (w === 1536 ? 1_670_000 : 331_000));
    const input = pngUrl(3_000_000);
    const result = await downscaleToolImage(input);
    expect(encodes).toEqual([
      { type: "image/png", quality: undefined, w: 1536, h: 1024 },
      { type: "image/png", quality: undefined, w: 768, h: 512 },
    ]);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("U3c: halving happens once only", async () => {
    const encodes = stubBrowser({ width: 3000, height: 2000 }, () => 5_000_000);
    const input = pngUrl(3_000_000);
    const result = await downscaleToolImage(input);
    expect(encodes).toHaveLength(2);
    expect(encodes[0]).toEqual({ type: "image/png", quality: undefined, w: 1536, h: 1024 });
    expect(encodes[1]).toEqual({ type: "image/png", quality: undefined, w: 768, h: 512 });
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("U3d: large JPEG scaled to 1536 px at quality 0.82", async () => {
    const encodes = stubBrowser({ width: 3000, height: 2000 }, () => 900_000);
    const input = jpgUrl(4_000_000);
    const result = await downscaleToolImage(input);
    expect(encodes).toEqual([{ type: "image/jpeg", quality: 0.82, w: 1536, h: 1024 }]);
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("U3e: JPEG quality loop steps down quality without halving dimensions", async () => {
    const encodes = stubBrowser(
      { width: 3000, height: 2000 },
      (t, w, h, q) => ((q ?? 0.82) > 0.5 ? 2_000_000 : 500_000),
    );
    const input = jpgUrl(4_000_000);
    const result = await downscaleToolImage(input);
    expect(encodes).toHaveLength(5);
    expect(encodes[0].quality).toBeCloseTo(0.82, 5);
    expect(encodes[1].quality).toBeCloseTo(0.72, 5);
    expect(encodes[2].quality).toBeCloseTo(0.62, 5);
    expect(encodes[3].quality).toBeCloseTo(0.52, 5);
    expect(encodes[4].quality).toBeCloseTo(0.42, 5);
    for (const e of encodes) {
      expect(e.w).toBe(1536);
      expect(e.h).toBe(1024);
      expect(e.type).toBe("image/jpeg");
    }
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("U3f: WebP over the limit becomes PNG", async () => {
    const encodes = stubBrowser({ width: 3000, height: 2000 }, () => 400_000);
    const input = "data:image/webp;base64," + "A".repeat(4_000_000);
    const result = await downscaleToolImage(input);
    expect(encodes).toHaveLength(1);
    expect(encodes[0].type).toBe("image/png");
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("U3g: decode failure throws descriptive error", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.reject(new Error("bad"))));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob(["x"])) })));
    vi.stubGlobal(
      "Image",
      class {
        onerror: (() => void) | null = null;
        onload = null;
        set src(_v: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    await expect(downscaleToolImage(pngUrl(100))).rejects.toThrow(
      /^Failed to decode image for downscaling: /,
    );
  });

  it("U3h: mediaTypeOf extracts type from data URL", () => {
    expect(mediaTypeOf("data:image/PNG;base64,AA")).toBe("image/png");
    expect(mediaTypeOf("data:image/jpeg,xyz")).toBe("image/jpeg");
    expect(mediaTypeOf("AAAA")).toBeUndefined();
  });
});
