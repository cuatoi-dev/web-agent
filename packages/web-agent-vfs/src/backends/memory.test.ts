import { describe, expect, it } from "vitest";
import { MemoryBackend } from "./memory.js";
import type { VfsFile } from "../types.js";

const file = (content: string): VfsFile => ({ content, encoding: "utf8", mimeType: "text/plain", mtimeMs: 1 });

describe("MemoryBackend", () => {
  it("get/set/list/delete round trip", async () => {
    const backend = MemoryBackend();
    expect(await backend.get("/a.md")).toBeUndefined();
    await backend.set!("/a.md", file("hello"));
    expect(await backend.get("/a.md")).toEqual(file("hello"));
    await backend.delete!("/a.md");
    expect(await backend.get("/a.md")).toBeUndefined();
  });

  it("list('/') returns everything", async () => {
    const backend = MemoryBackend();
    await backend.set!("/a.md", file("a"));
    await backend.set!("/sub/b.md", file("b"));
    const entries = await backend.list("/");
    expect(entries.map((e) => e.path).sort()).toEqual(["/a.md", "/sub/b.md"]);
  });

  it("list('/sub') returns only that subtree", async () => {
    const backend = MemoryBackend();
    await backend.set!("/a.md", file("a"));
    await backend.set!("/sub/b.md", file("b"));
    const entries = await backend.list("/sub");
    expect(entries.map((e) => e.path)).toEqual(["/sub/b.md"]);
  });

  it("size equals content.length", async () => {
    const backend = MemoryBackend();
    await backend.set!("/a.md", file("hello world"));
    const [entry] = await backend.list("/");
    expect(entry.size).toBe("hello world".length);
  });
});
