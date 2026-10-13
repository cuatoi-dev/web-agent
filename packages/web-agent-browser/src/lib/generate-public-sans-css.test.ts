import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

// The generator is a CommonJS build script, not part of the src/ TypeScript
// graph — it runs inside webpack.config.cjs, never inside a bundled entry.
const require = createRequire(import.meta.url);
const { generatePublicSansCss } = require("../../tool/generate-public-sans-css.cjs") as {
  generatePublicSansCss: (vendorDir: string) => string;
};

const VENDOR_DIR = path.resolve(__dirname, "../../vendor/public-sans");

describe("generatePublicSansCss", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-sans-test-"));
    tempDirs.push(dir);
    return dir;
  }

  it("produces valid @font-face rules with embedded base64 data URIs", () => {
    const css = generatePublicSansCss(VENDOR_DIR);

    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css.match(/font-family: "Public Sans"/g)).toHaveLength(2);
    expect(css.match(/font-weight: 400/g)).toHaveLength(1);
    expect(css.match(/font-weight: 700/g)).toHaveLength(1);
    expect(css.match(/font-display: swap/g)).toHaveLength(2);

    const payloads = [...css.matchAll(/src: url\("data:font\/woff2;base64,([^"]+)"\)/g)].map((m) => m[1]);
    expect(payloads).toHaveLength(2);
    for (const payload of payloads) {
      expect(payload.length).toBeGreaterThan(40000);
    }
  });

  it("decodes base64 payload matching source woff2 binaries", () => {
    const css = generatePublicSansCss(VENDOR_DIR);
    const payloads = [...css.matchAll(/src: url\("data:font\/woff2;base64,([^"]+)"\)/g)].map((m) => m[1]);

    const regularBuffer = Buffer.from(payloads[0], "base64");
    const boldBuffer = Buffer.from(payloads[1], "base64");

    expect(regularBuffer.equals(fs.readFileSync(path.join(VENDOR_DIR, "PublicSans-Regular.woff2")))).toBe(true);
    expect(boldBuffer.equals(fs.readFileSync(path.join(VENDOR_DIR, "PublicSans-Bold.woff2")))).toBe(true);
  });

  it("fails when PublicSans-Regular.woff2 is missing", () => {
    const tempDir = makeTempDir();
    fs.writeFileSync(path.join(tempDir, "PublicSans-Bold.woff2"), Buffer.from([1, 2, 3]));

    expect(() => generatePublicSansCss(tempDir)).toThrow(/Public Sans font file not found: .*PublicSans-Regular\.woff2/);
  });

  it("fails when PublicSans-Bold.woff2 is missing", () => {
    const tempDir = makeTempDir();
    fs.writeFileSync(path.join(tempDir, "PublicSans-Regular.woff2"), Buffer.from([1, 2, 3]));

    expect(() => generatePublicSansCss(tempDir)).toThrow(/Public Sans font file not found: .*PublicSans-Bold\.woff2/);
  });

  it("fails when a font file is empty", () => {
    const tempDir = makeTempDir();
    fs.writeFileSync(path.join(tempDir, "PublicSans-Regular.woff2"), Buffer.alloc(0));
    fs.writeFileSync(path.join(tempDir, "PublicSans-Bold.woff2"), Buffer.from([1, 2, 3]));

    expect(() => generatePublicSansCss(tempDir)).toThrow(/Public Sans font file is empty/);
  });
});
