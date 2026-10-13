import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageBackend } from "./storage.js";
import type { VfsFile } from "../types.js";

const file = (content: string): VfsFile => ({ content, encoding: "utf8", mimeType: "text/markdown", mtimeMs: 123 });

describe("StorageBackend", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("S1 — set then get through a fresh backend over the same localStorage survives a reload", async () => {
    const backend = StorageBackend(localStorage, "web-agent-vfs:home:");
    await backend.set!("/notes.md", file("hi"));
    const reopened = StorageBackend(localStorage, "web-agent-vfs:home:");
    expect(await reopened.get("/notes.md")).toEqual(file("hi"));
  });

  it("S2 — list('/') reads the index only, never the file keys", async () => {
    const backend = StorageBackend(localStorage, "web-agent-vfs:home:");
    await backend.set!("/a.md", file("a"));
    await backend.set!("/b.md", file("b"));
    await backend.set!("/c.md", file("c"));

    const spy = vi.spyOn(Storage.prototype, "getItem");
    const entries = await backend.list("/");
    expect(entries).toHaveLength(3);
    for (const call of spy.mock.calls) {
      expect(String(call[0])).not.toMatch(/web-agent-vfs:home:f:/);
    }
    spy.mockRestore();
  });

  it("S3 — list('/deck') returns only that subtree", async () => {
    const backend = StorageBackend(localStorage, "web-agent-vfs:home:");
    await backend.set!("/deck/1.html", file("slide"));
    await backend.set!("/notes.md", file("note"));
    const entries = await backend.list("/deck");
    expect(entries.map((e) => e.path)).toEqual(["/deck/1.html"]);
  });

  it("S4 — a corrupt index value is treated as absent, nothing thrown", async () => {
    localStorage.setItem("web-agent-vfs:home:index", "{oops");
    const backend = StorageBackend(localStorage, "web-agent-vfs:home:");
    expect(await backend.list("/")).toEqual([]);
  });

  it("S5 — a corrupt file value is treated as absent, nothing thrown", async () => {
    localStorage.setItem("web-agent-vfs:home:f:/a.md", "{oops");
    const backend = StorageBackend(localStorage, "web-agent-vfs:home:");
    expect(await backend.get("/a.md")).toBeUndefined();
  });

  it("S6 — default-layout key names: /tmp on sessionStorage, /home/agent and /home/shared on localStorage", async () => {
    sessionStorage.clear();
    const tmp = StorageBackend(sessionStorage, "web-agent-vfs:tmp:");
    const home = StorageBackend(localStorage, "web-agent-vfs:home:");
    const shared = StorageBackend(localStorage, "web-agent-vfs:shared:");
    await tmp.set!("/t.md", file("t"));
    await home.set!("/h.md", file("h"));
    await shared.set!("/s.md", file("s"));

    expect(sessionStorage.getItem("web-agent-vfs:tmp:f:/t.md")).not.toBeNull();
    expect(localStorage.getItem("web-agent-vfs:home:f:/h.md")).not.toBeNull();
    expect(localStorage.getItem("web-agent-vfs:shared:f:/s.md")).not.toBeNull();
  });

  it("S7 — delete removes both the file key and the index row", async () => {
    const backend = StorageBackend(localStorage, "web-agent-vfs:home:");
    await backend.set!("/a.md", file("a"));
    await backend.delete!("/a.md");
    expect(localStorage.getItem("web-agent-vfs:home:f:/a.md")).toBeNull();
    expect(await backend.list("/")).toEqual([]);
  });
});
