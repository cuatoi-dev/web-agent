import { describe, expect, it } from "vitest";
import { isImageExt, isVisibleFile, mimeFromPath, TEXT_EXTS } from "./mime.js";

describe("mimeFromPath", () => {
  it.each([
    ["/a.md", "text/markdown"],
    ["/a.txt", "text/plain"],
    ["/a.json", "application/json"],
    ["/a.html", "text/html"],
    ["/a.htm", "text/html"],
    ["/a.css", "text/css"],
    ["/a.js", "text/javascript"],
    ["/a.mjs", "text/javascript"],
    ["/a.cjs", "text/javascript"],
    ["/a.ts", "text/typescript"],
    ["/a.csv", "text/csv"],
    ["/a.xml", "application/xml"],
    ["/a.svg", "image/svg+xml"],
    ["/a.yml", "application/yaml"],
    ["/a.yaml", "application/yaml"],
  ])("%s -> %s", (path, expected) => {
    expect(mimeFromPath(path)).toBe(expected);
  });

  it("no extension falls back to text/plain", () => {
    expect(mimeFromPath("/README")).toBe("text/plain");
  });

  it("unknown extension falls back to text/plain", () => {
    expect(mimeFromPath("/a.unknown")).toBe("text/plain");
  });

  it("is case-insensitive on the extension", () => {
    expect(mimeFromPath("/a.MD")).toBe("text/markdown");
  });

  it("a dotfile has no extension", () => {
    expect(mimeFromPath("/home/agent/.env")).toBe("text/plain");
  });
});


describe("folder visibility", () => {
  it.each([
    ["/a.TSV", "text/tab-separated-values"],
    ["/a.PY", "text/plain"],
    ["/a.Toml", "application/toml"],
    ["/a.PNG", "image/png"],
    ["/a.jpeg", "image/jpeg"],
    ["/a.WebP", "image/webp"],
  ])("%s -> %s", (path, expected) => {
    expect(mimeFromPath(path)).toBe(expected);
  });

  it("shows every approved text extension, in any case, and text/* types", () => {
    for (const ext of TEXT_EXTS) {
      expect(isVisibleFile(`f.${ext.toUpperCase()}`, "application/octet-stream")).toBe(true);
    }
    expect(isVisibleFile("noext", "text/plain")).toBe(true);
  });

  it("hides spreadsheets and unknown binary files", () => {
    expect(isVisibleFile("b.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(false);
    expect(isVisibleFile("x.bin", "application/octet-stream")).toBe(false);
    expect(isVisibleFile("noext", "")).toBe(false);
  });

  it("shows the four raster image types and treats svg as text, not as a raster image", () => {
    for (const n of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp"]) {
      expect(isImageExt(n)).toBe(true);
      expect(isVisibleFile(n, "")).toBe(true);
    }
    expect(isImageExt("a.svg")).toBe(false);
    expect(isVisibleFile("a.svg", "")).toBe(true);
  });
});
