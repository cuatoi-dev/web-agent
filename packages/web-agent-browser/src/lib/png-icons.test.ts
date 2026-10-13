import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { decodePng, encodePng, boxDownscale, writeIcons, MIN_SOURCE } = require("../../tool/png-icons.cjs") as {
  decodePng: (file: string) => { width: number; height: number; data: Buffer };
  encodePng: (img: { width: number; height: number; data: Buffer }) => Buffer;
  boxDownscale: (img: { width: number; height: number; data: Buffer }, size: number) => { width: number; height: number; data: Buffer };
  writeIcons: (img: { width: number; height: number; data: Buffer }, outDir: string) => void;
  MIN_SOURCE: number;
};

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads IHDR fields from a PNG buffer without fully decoding it. */
function readIHDR(buf: Buffer) {
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    depth: buf[24],
    colour: buf[25],
    interlace: buf[28],
  };
}

/** Builds a minimal PNG buffer with the given IHDR values (no real pixels). */
function makeMinimalPng(width: number, height: number, depth: number, colour: number, interlace: number): Buffer {
  const PNG_SIG_BUF = PNG_SIG;
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = depth;
  ihdrData[9] = colour;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = interlace;

  function crc32(buf: Buffer): number {
    const table = (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      return t;
    })();
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  }

  // A valid IDAT needs at least the inflated scanline data.
  // For a 1x1 RGBA this is 5 bytes (filter + 4 channels).
  // No IDAT is written: the IHDR alone is enough to test validation paths.
  return Buffer.concat([PNG_SIG_BUF, chunk("IHDR", ihdrData)]);
}

/** Creates a solid-colour 128×128 RGBA image. */
function makeImage128(r: number, g: number, b: number, a: number) {
  const data = Buffer.alloc(128 * 128 * 4);
  for (let i = 0; i < 128 * 128; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return { width: 128, height: 128, data };
}

describe("png-icons codec", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "png-test-"));
    tempDirs.push(dir);
    return dir;
  }

  describe("round trip", () => {
    it("encode then decode produces identical dimensions and pixel data", () => {
      const img = makeImage128(100, 150, 200, 255);
      const dir = makeTempDir();
      const file = path.join(dir, "test.png");
      fs.writeFileSync(file, encodePng(img));
      const decoded = decodePng(file);
      expect(decoded.width).toBe(128);
      expect(decoded.height).toBe(128);
      // Spot-check a few pixels — same colour all over.
      expect(decoded.data[0]).toBe(100);
      expect(decoded.data[1]).toBe(150);
      expect(decoded.data[2]).toBe(200);
      expect(decoded.data[3]).toBe(255);
      expect(decoded.data.length).toBe(img.data.length);
    });
  });

  describe("writeIcons", () => {
    it("writes four PNGs each at the correct size with correct IHDR", () => {
      const img = makeImage128(0, 255, 0, 255);
      const dir = makeTempDir();
      writeIcons(img, dir);
      for (const size of [16, 32, 48, 128]) {
        const buf = fs.readFileSync(path.join(dir, `${size}.png`));
        const hdr = readIHDR(buf);
        expect(hdr.width).toBe(size);
        expect(hdr.height).toBe(size);
        expect(hdr.depth).toBe(8);
        expect(hdr.colour).toBe(6);
        expect(hdr.interlace).toBe(0);
      }
    });
  });

  describe("boxDownscale", () => {
    it("left half red, right half blue — pixel at x=3 is red, x=12 is blue at size 16", () => {
      const data = Buffer.alloc(128 * 128 * 4);
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const i = (y * 128 + x) * 4;
          if (x < 64) { data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255; }
          else { data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255; }
        }
      }
      const out = boxDownscale({ width: 128, height: 128, data }, 16);
      const redPx = out.data[(0 * 16 + 3) * 4];     // x=3, y=0 → red channel
      const bluePx = out.data[(0 * 16 + 12) * 4 + 2]; // x=12, y=0 → blue channel
      expect(redPx).toBeGreaterThan(200);
      expect(bluePx).toBeGreaterThan(200);
    });

    it("transparent pixels do not bleed colour (premultiplied alpha)", () => {
      // Left half opaque red, right half fully transparent green.
      const data = Buffer.alloc(128 * 128 * 4);
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const i = (y * 128 + x) * 4;
          if (x < 64) { data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255; }
          else { data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; data[i + 3] = 0; } // transparent green
        }
      }
      const out = boxDownscale({ width: 128, height: 128, data }, 16);
      // Pixel at x=3 (left quarter) must have no green bleed.
      const g = out.data[(0 * 16 + 3) * 4 + 1];
      expect(g).toBe(0);
    });

    it("fully transparent block stays transparent", () => {
      const data = Buffer.alloc(128 * 128 * 4); // all zeros, alpha=0
      const out = boxDownscale({ width: 128, height: 128, data }, 16);
      for (let i = 3; i < out.data.length; i += 4) {
        expect(out.data[i]).toBe(0);
      }
    });
  });

  describe("decodePng error paths", () => {
    it("missing file throws naming brand/icon.png and 128", () => {
      const dir = makeTempDir();
      const fn = () => decodePng(path.join(dir, "no-such-file.png"));
      expect(fn).toThrow(/is missing/);
      expect(fn).toThrow(new RegExp(String(MIN_SOURCE)));
    });

    it("non-PNG bytes throw", () => {
      const dir = makeTempDir();
      const file = path.join(dir, "bad.png");
      fs.writeFileSync(file, Buffer.from("not a png at all"));
      expect(() => decodePng(file)).toThrow(/is not a PNG/);
    });

    it("too-small source throws naming the size and 128px requirement", () => {
      const img = { width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4) };
      const dir = makeTempDir();
      const file = path.join(dir, "small.png");
      fs.writeFileSync(file, encodePng(img));
      const fn = () => decodePng(file);
      expect(fn).toThrow(/64x64/);
      expect(fn).toThrow(/Chrome requires a 128px icon/);
    });

    it("non-square source throws naming must be square and the dimensions", () => {
      const data = Buffer.alloc(128 * 256 * 4);
      for (let i = 0; i < 128 * 256; i++) { data[i * 4 + 3] = 255; }
      const img = { width: 128, height: 256, data };
      const dir = makeTempDir();
      const file = path.join(dir, "nonsq.png");
      fs.writeFileSync(file, encodePng(img));
      const fn = () => decodePng(file);
      expect(fn).toThrow(/must be square/);
      expect(fn).toThrow(/128x256/);
    });

    it("wrong colour type throws naming colour type and 8-bit RGBA", () => {
      const dir = makeTempDir();
      const file = path.join(dir, "palette.png");
      fs.writeFileSync(file, makeMinimalPng(128, 128, 8, 3, 0));
      const fn = () => decodePng(file);
      expect(fn).toThrow(/colour type 3/);
      expect(fn).toThrow(/8-bit RGBA/);
    });

    it("interlaced PNG throws", () => {
      const dir = makeTempDir();
      const file = path.join(dir, "interlaced.png");
      fs.writeFileSync(file, makeMinimalPng(128, 128, 8, 6, 1));
      expect(() => decodePng(file)).toThrow(/is interlaced/);
    });
  });
});
