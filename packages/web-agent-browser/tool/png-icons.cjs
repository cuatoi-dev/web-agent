const { inflateSync, deflateSync } = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The four sizes Chrome asks for. `icons` carries all four; the toolbar
 *  action carries the two small ones. */
const ICON_SIZES = [16, 32, 48, 128];

/** Chrome refuses to show an icon smaller than this, and upscaling pixel art
 *  looks broken, so the source must already be at least 128 square. */
const MIN_SOURCE = 128;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Decodes one 8-bit RGBA, non-interlaced PNG into flat RGBA bytes.
 *
 * Every other PNG variant fails by name, because a brand owner who exported a
 * palette or an interlaced file needs to know which one they produced.
 *
 * @param {string} file - absolute path to the icon
 * @returns {{width: number, height: number, data: Buffer}}
 * @throws {Error} naming brand/icon.png and the variant found
 */
function decodePng(file) {
  const where = "brand/icon.png";
  if (!fs.existsSync(file)) {
    throw new Error(`${where} is missing; the build needs one square PNG of at least ${MIN_SOURCE}x${MIN_SOURCE}`);
  }
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error(`${where} is not a PNG`);

  let pos = 8, width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || colour !== 6) {
    throw new Error(
      `${where} must be an 8-bit RGBA PNG, found bit depth ${depth} and colour type ${colour}; `
      + "re-export it as 8-bit RGBA (colour type 6)",
    );
  }
  if (interlace !== 0) throw new Error(`${where} is interlaced; re-export it non-interlaced`);
  if (width !== height) throw new Error(`${where} must be square, got ${width}x${height}`);
  if (width < MIN_SOURCE) {
    throw new Error(
      `${where} is ${width}x${height}; Chrome requires a ${MIN_SOURCE}px icon and upscaling pixel art looks broken`,
    );
  }

  // Undo the five PNG line filters.
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const A = x >= bpp ? cur[x - bpp] : 0;
      const B = prev ? prev[x] : 0;
      const C = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += A;
      else if (filter === 2) v += B;
      else if (filter === 3) v += (A + B) >> 1;
      else if (filter === 4) {
        const p = A + B - C, pa = Math.abs(p - A), pb = Math.abs(p - B), pc = Math.abs(p - C);
        v += pa <= pb && pa <= pc ? A : pb <= pc ? B : C;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}

/** Box average in PREMULTIPLIED alpha, or transparent pixels bleed their
 *  colour into the edges of a pixel-art sprite. */
function boxDownscale(img, size) {
  const { width: w, height: h, data } = img;
  const out = Buffer.alloc(size * size * 4);
  const sx = w / size, sy = h / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4, al = data[i + 3] / 255;
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al;
          a += data[i + 3]; n++;
        }
      }
      const o = (y * size + x) * 4, av = a / n / 255;
      out[o]     = av > 0 ? Math.round(r / n / av) : 0;
      out[o + 1] = av > 0 ? Math.round(g / n / av) : 0;
      out[o + 2] = av > 0 ? Math.round(b / n / av) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: size, height: size, data: out };
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Re-encodes to 8-bit RGBA, non-interlaced, filter "none" on every line. */
function encodePng(img) {
  const { width, height, data } = img, stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Writes `<outDir>/16.png`, `32.png`, `48.png` and `128.png` from an already
 *  decoded image. Decoding happens earlier, so nothing is written until every
 *  check has passed. */
function writeIcons(img, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of ICON_SIZES) {
    fs.writeFileSync(path.join(outDir, `${size}.png`), encodePng(boxDownscale(img, size)));
  }
}

module.exports = { decodePng, boxDownscale, encodePng, writeIcons, ICON_SIZES, MIN_SOURCE };
