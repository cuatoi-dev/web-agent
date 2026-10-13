import { describe, it, expect, vi, afterEach } from "vitest";
import { hasVisiblePixels, ALPHA_SCAN_MAX_EDGE } from "./image-alpha.js";

describe("hasVisiblePixels", () => {
  const originalGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "getContext",
  )!;
  const originalImage = globalThis.Image;

  afterEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  it("returns undefined when getContext('2d') returns null without constructing Image", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    const imageConstructorSpy = vi.fn();
    globalThis.Image = imageConstructorSpy;

    const result = await hasVisiblePixels("data:image/png;base64,mock");

    expect(result).toBeUndefined();
    expect(imageConstructorSpy).not.toHaveBeenCalled();
  });

  it("returns false when every alpha byte is 0", async () => {
    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        // 4 pixels: RGBA RGBA RGBA RGBA, all alpha = 0
        data: new Uint8ClampedArray([
          255, 0, 0, 0,
          0, 255, 0, 0,
          0, 0, 255, 0,
          255, 255, 255, 0,
        ]),
      })),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn((ctxId: string) => {
      if (ctxId === "2d") return mockCtx as unknown as CanvasRenderingContext2D;
      return null;
    });

    class MockImage {
      naturalWidth = 10;
      naturalHeight = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;

    const result = await hasVisiblePixels("data:image/png;base64,mock");
    expect(result).toBe(false);
  });

  it("returns true when one alpha byte is non-zero, placed last in the buffer", async () => {
    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        // 3 pixels: first two alpha=0, last pixel alpha=1
        data: new Uint8ClampedArray([
          255, 0, 0, 0,
          0, 255, 0, 0,
          0, 0, 255, 1,
        ]),
      })),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn((ctxId: string) => {
      if (ctxId === "2d") return mockCtx as unknown as CanvasRenderingContext2D;
      return null;
    });

    class MockImage {
      naturalWidth = 10;
      naturalHeight = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;

    const result = await hasVisiblePixels("data:image/png;base64,mock");
    expect(result).toBe(true);
  });

  it("returns undefined when the image fires onerror", async () => {
    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn((ctxId: string) => {
      if (ctxId === "2d") return mockCtx as unknown as CanvasRenderingContext2D;
      return null;
    });

    class FailingImage {
      naturalWidth = 10;
      naturalHeight = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    globalThis.Image = FailingImage as unknown as typeof Image;

    const result = await hasVisiblePixels("data:image/png;base64,corrupt");
    expect(result).toBeUndefined();
  });

  it("returns undefined when naturalWidth or naturalHeight is 0", async () => {
    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn((ctxId: string) => {
      if (ctxId === "2d") return mockCtx as unknown as CanvasRenderingContext2D;
      return null;
    });

    class ZeroImage {
      naturalWidth = 0;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    globalThis.Image = ZeroImage as unknown as typeof Image;

    const result = await hasVisiblePixels("data:image/png;base64,mock");
    expect(result).toBeUndefined();
  });

  it("returns undefined when getImageData throws", async () => {
    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new Error("SecurityError: tainted canvas");
      }),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn((ctxId: string) => {
      if (ctxId === "2d") return mockCtx as unknown as CanvasRenderingContext2D;
      return null;
    });

    class MockImage {
      naturalWidth = 10;
      naturalHeight = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;

    const result = await hasVisiblePixels("data:image/png;base64,mock");
    expect(result).toBeUndefined();
  });

  it("downscales scratch canvas to at most ALPHA_SCAN_MAX_EDGE on longest edge preserving aspect ratio", async () => {
    let drawnWidth = 0;
    let drawnHeight = 0;

    const mockCtx = {
      drawImage: vi.fn((_img: CanvasImageSource, _sx: number, _sy: number, dw: number, dh: number) => {
        drawnWidth = dw;
        drawnHeight = dh;
      }),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([0, 0, 0, 255]),
      })),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn((ctxId: string) => {
      if (ctxId === "2d") return mockCtx as unknown as CanvasRenderingContext2D;
      return null;
    });

    class LargeImage {
      naturalWidth = 2048;
      naturalHeight = 1536;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    globalThis.Image = LargeImage as unknown as typeof Image;

    const result = await hasVisiblePixels("data:image/png;base64,large");
    expect(result).toBe(true);
    expect(drawnWidth).toBe(ALPHA_SCAN_MAX_EDGE);
    expect(drawnHeight).toBe(192); // 1536 * (256 / 2048) = 192
  });
});
