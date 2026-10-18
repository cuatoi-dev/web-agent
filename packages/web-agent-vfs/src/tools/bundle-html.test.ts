import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext, CustomToolDef } from "@cuatoi/web-agent-core";
import { vfsTools } from "../index.js";
import { MemoryBackend } from "../backends/memory.js";

const ctx = { sessionId: "s1" } as unknown as ToolContext;
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNgYGAAAAAEAAHI6uv5AAAAAElFTkSuQmCC";

describe("bundle_html tool", () => {
  let tmpBackend: ReturnType<typeof MemoryBackend>;
  let provider: ReturnType<typeof vfsTools>;
  let vfs: ReturnType<typeof vfsTools>["vfs"];
  let bundleTool: CustomToolDef;

  beforeEach(async () => {
    tmpBackend = MemoryBackend();
    provider = vfsTools({ tmp: tmpBackend });
    vfs = provider.vfs;
    const defs = await provider.load();
    bundleTool = defs.find((d) => d.name === "bundle_html")!;
  });

  it("One PNG: output src is data:image/png;base64,... and rest of doc is byte-identical", async () => {
    await tmpBackend.set!("/img.png", { content: TINY_PNG, encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    const before = "<html><head><title>Test</title></head><body><h1>Report</h1><p>Before</p>";
    const after = "<p>After</p></body></html>";
    const srcHtml = `${before}<img src="/tmp/img.png" width="480">${after}`;
    await vfs.write("/tmp/report.src.html", srcHtml);

    const res = await bundleTool.execute({ src: "/tmp/report.src.html", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/^Saved \/tmp\/report\.html \(1 images inlined, \d+ KB\)$/);

    const out = await vfs.get("/tmp/report.html");
    expect(out).toBeDefined();
    expect(out!.encoding).toBe("utf8");
    expect(out!.mimeType).toBe("text/html");

    const expectedImg = `<img src="data:image/png;base64,${TINY_PNG}" width="480">`;
    expect(out!.content).toBe(`${before}${expectedImg}${after}`);
  });

  it("Four files with .png, .JPG, .jpeg and .webp: each becomes its own MIME type", async () => {
    await tmpBackend.set!("/1.png", { content: TINY_PNG, encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    await tmpBackend.set!("/2.JPG", { content: "jpgdata", encoding: "base64", mimeType: "image/jpeg", mtimeMs: 1 });
    await tmpBackend.set!("/3.jpeg", { content: "jpegdata", encoding: "base64", mimeType: "image/jpeg", mtimeMs: 1 });
    await tmpBackend.set!("/4.webp", { content: "webpdata", encoding: "base64", mimeType: "image/webp", mtimeMs: 1 });

    const srcHtml = [
      "<html><body>",
      '<img src="/tmp/1.png">',
      '<img src="/tmp/2.JPG">',
      '<img src="/tmp/3.jpeg">',
      '<img src="/tmp/4.webp">',
      "</body></html>",
    ].join("");
    await vfs.write("/tmp/report.src.html", srcHtml);

    const res = await bundleTool.execute({ src: "/tmp/report.src.html", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain("4 images inlined");

    const out = (await vfs.get("/tmp/report.html"))!;
    expect(out.content).toContain(`src="data:image/png;base64,${TINY_PNG}"`);
    expect(out.content).toContain('src="data:image/jpeg;base64,jpgdata"');
    expect(out.content).toContain('src="data:image/jpeg;base64,jpegdata"');
    expect(out.content).toContain('src="data:image/webp;base64,webpdata"');
  });

  it("survives http, data:, and relative src unchanged and reports 0 images inlined", async () => {
    const srcHtml = [
      "<html><body>",
      '<img src="http://example.com/pic.png">',
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
      '<img src="relative.png">',
      "</body></html>",
    ].join("");
    await vfs.write("/tmp/report.src.html", srcHtml);

    const res = await bundleTool.execute({ src: "/tmp/report.src.html", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/^Saved \/tmp\/report\.html \(0 images inlined, \d+ KB\)$/);

    const out = (await vfs.get("/tmp/report.html"))!;
    expect(out.content).toBe(srcHtml);
  });

  it("Two missing images: exact error, isError is true, vfs.get(out) is undefined, ordered and deduplicated", async () => {
    const srcHtml = '<html><body><img src="/tmp/b.png"><img src="/tmp/a.png"><img src="/tmp/b.png"></body></html>';
    await vfs.write("/tmp/report.src.html", srcHtml);

    const res = await bundleTool.execute({ src: "/tmp/report.src.html", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Error: Images not found: /tmp/b.png, /tmp/a.png");

    expect(await vfs.get("/tmp/report.html")).toBeUndefined();
  });

  it("One present and one missing: report.html still does not exist, proving write is last", async () => {
    await tmpBackend.set!("/present.png", { content: TINY_PNG, encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    const srcHtml = '<html><body><img src="/tmp/present.png"><img src="/tmp/missing.png"></body></html>';
    await vfs.write("/tmp/report.src.html", srcHtml);

    const res = await bundleTool.execute({ src: "/tmp/report.src.html", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Error: Images not found: /tmp/missing.png");
    expect(await vfs.get("/tmp/report.html")).toBeUndefined();
  });

  it("unsupported type: /tmp/logo.svg fails and report.html does not exist", async () => {
    await tmpBackend.set!("/logo.svg", { content: "<svg></svg>", encoding: "utf8", mimeType: "image/svg+xml", mtimeMs: 1 });
    const srcHtml = '<html><body><img src="/tmp/logo.svg"></body></html>';
    await vfs.write("/tmp/report.src.html", srcHtml);

    const res = await bundleTool.execute({ src: "/tmp/report.src.html", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Error: /tmp/logo.svg is not a supported image. Use .png, .jpg, .jpeg, .gif or .webp.");
    expect(await vfs.get("/tmp/report.html")).toBeUndefined();
  });

  it("output path on a read-only mount returns is read-only and does not throw", async () => {
    await tmpBackend.set!("/img.png", { content: TINY_PNG, encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    await vfs.write("/tmp/report.src.html", '<html><body><img src="/tmp/img.png"></body></html>');

    vfs.mount("/store", {
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
    }, { external: true });

    const res = await bundleTool.execute({ src: "/tmp/report.src.html", out: "/store/report.html" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toContain("is read-only");
  });

  it("output already exists with old text: holds new document and matches regex after bundle", async () => {
    await tmpBackend.set!("/img.png", { content: TINY_PNG, encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    await vfs.write("/tmp/report.src.html", '<html><body><p>new</p><img src="/tmp/img.png"></body></html>');
    await vfs.write("/tmp/report.html", "old text");

    const res = await bundleTool.execute({ src: "/tmp/report.src.html", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/^Saved \/tmp\/report\.html \(1 images inlined, \d+ KB\)$/);

    const out = (await vfs.get("/tmp/report.html"))!;
    expect(out.content).toContain("<p>new</p>");
    expect(out.content).not.toContain("old text");
  });

  it("source path that does not exist returns error and writes no output file", async () => {
    const res = await bundleTool.execute({ src: "/tmp/nope.html", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Error: /tmp/nope.html does not exist.");
    expect(await vfs.get("/tmp/report.html")).toBeUndefined();
  });

  it("source path holding a base64 file returns not a text file error", async () => {
    await tmpBackend.set!("/x.png", { content: TINY_PNG, encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    const res = await bundleTool.execute({ src: "/tmp/x.png", out: "/tmp/report.html" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Error: /tmp/x.png is not a text file.");
    expect(await vfs.get("/tmp/report.html")).toBeUndefined();
  });

  it("src and out missing from input returns error", async () => {
    const res = await bundleTool.execute({}, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Error: src and out are both required.");
  });

  it("phrase and inProgressPhrase format correctly", () => {
    expect(bundleTool.phrase!({ input: { out: "/tmp/report.html" }, failed: false }, "tesagent")).toBe(
      "tesagent bundled /tmp/report.html",
    );
    expect(bundleTool.phrase!({ input: { out: "/tmp/report.html" }, failed: true }, "tesagent")).toBe(
      "tesagent could not bundle /tmp/report.html",
    );
    expect(bundleTool.phrase!({ input: {}, failed: true }, "tesagent")).toBe(
      "tesagent could not bundle a file",
    );
    expect(bundleTool.inProgressPhrase!("tesagent")).toBe("tesagent is bundling the report…");
  });
});
