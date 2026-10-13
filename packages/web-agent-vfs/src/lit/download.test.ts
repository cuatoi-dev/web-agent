import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { downloadFile, isDeletable } from "./files-screen.js";
import { vfsTools } from "../index.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsHandle } from "../types.js";

describe("downloadFile", () => {
  let createSpy: ReturnType<typeof vi.spyOn>;
  let revokeSpy: ReturnType<typeof vi.spyOn>;
  let clickedAnchors: HTMLAnchorElement[];

  beforeEach(() => {
    clickedAnchors = [];
    const urlRecord = URL as unknown as Record<string, unknown>;
    if (typeof urlRecord["createObjectURL"] !== "function") {
      urlRecord["createObjectURL"] = () => "blob:mock-url";
    }
    if (typeof urlRecord["revokeObjectURL"] !== "function") {
      urlRecord["revokeObjectURL"] = () => undefined;
    }
    createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("decodes base64 content to bytes and creates Blob with mimeType", () => {
    // "Hello" -> "SGVsbG8="
    downloadFile("/tmp/deck/logo.png", {
      content: "SGVsbG8=",
      encoding: "base64",
      mimeType: "image/png",
      mtimeMs: Date.now(),
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(5);
  });

  it("encodes UTF-8 text string to Blob", () => {
    const text = "Project notes\nsecond line";
    downloadFile("/home/agent/notes.md", {
      content: text,
      encoding: "utf8",
      mimeType: "text/markdown",
      mtimeMs: Date.now(),
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/markdown");
    expect(blob.size).toBe(new TextEncoder().encode(text).length);
  });

  it("appends anchor element, sets download filename, clicks and cleans up object URL", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchors.push(this);
    });
    downloadFile("/home/agent/notes.md", {
      content: "hi",
      encoding: "utf8",
      mimeType: "text/plain",
      mtimeMs: Date.now(),
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].download).toBe("notes.md");
    expect(clickedAnchors[0].href).toBe("blob:mock-url");
    // Anchor is removed after click
    expect(document.body.contains(clickedAnchors[0])).toBe(false);
    // Revoke runs on next tick
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeSpy).toHaveBeenCalledWith("blob:mock-url");
  });
});

describe("isDeletable", () => {
  function mockVfs(): VfsHandle {
    const readable = MemoryBackend();
    const readOnly = { get: (r: string) => readable.get(r), list: (r: string) => readable.list(r) };
    return vfsTools({
      tmp: MemoryBackend(),
      home: MemoryBackend(),
      shared: MemoryBackend(),
      mounts: { "/store": readOnly },
    }).vfs;
  }

  it("returns true for files on writable mounts", () => {
    expect(isDeletable(mockVfs(), "/home/agent/notes.md")).toBe(true);
  });

  it("returns false for files on read-only mounts", () => {
    expect(isDeletable(mockVfs(), "/store/latest-promotion.md")).toBe(false);
  });

  it("returns false for unknown paths", () => {
    expect(isDeletable(mockVfs(), "/nowhere/file.txt")).toBe(false);
  });
});
