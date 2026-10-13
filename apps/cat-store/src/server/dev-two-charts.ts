import { deflateSync } from "node:zlib";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function chartPng(pixel: (x: number, y: number) => readonly [number, number, number]): string {
  const scanlines = Buffer.alloc(64 * (1 + 64 * 3));
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const offset = y * 193 + 1 + x * 3;
      const rgb = pixel(x, y);
      scanlines.set(rgb, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const redBarBase64 = chartPng((x, y) => {
  if (y >= 54 && y <= 55 && x >= 7 && x <= 58) return [40, 40, 40];
  if (y < 54 && ((x >= 12 && x <= 21 && y >= 32) ||
    (x >= 28 && x <= 37 && y >= 18) || (x >= 44 && x <= 53 && y >= 26))) {
    return [220, 30, 30];
  }
  return [255, 255, 255];
});

const greenLineBase64 = chartPng((x, y) => {
  if (y >= 54 && y <= 55 && x >= 7 && x <= 58) return [40, 40, 40];
  if (x >= 10 && x <= 54) {
    const lineY = x <= 25 ? 45 - (x - 10) * 1.4 :
      x <= 39 ? 24 + (x - 25) * 0.65 : 33.1 - (x - 39) * 1.4;
    if (Math.abs(y - lineY) <= 1.5) return [30, 180, 50];
  }
  return [255, 255, 255];
});

/** Return two PNG charts for development verification. */
export function devTwoCharts(): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: "image/png" }
  >;
} {
  return {
    content: [
      { type: "text", text: "Two charts for Q3." },
      { type: "image", data: redBarBase64, mimeType: "image/png" },
      { type: "image", data: greenLineBase64, mimeType: "image/png" },
    ],
  };
}
