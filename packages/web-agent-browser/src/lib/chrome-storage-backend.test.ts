import { describe, expect, it } from "vitest";
import { ChromeStorageBackend, type ChromeStorageArea } from "./chrome-storage-backend";
import type { VfsFile } from "@cuatoi/web-agent-vfs";

const file = (content: string): VfsFile => ({
  content,
  encoding: "utf8",
  mimeType: "text/markdown",
  mtimeMs: 123,
});

interface FakeArea extends ChromeStorageArea {
  store: Record<string, unknown>;
  setCalls: Record<string, unknown>[];
  getKeys: string[];
  /** Milliseconds each get() waits before it resolves. Set > 0 to widen the
   *  window two concurrent writes race in (case C2). */
  delayMs: number;
}

function fakeArea(): FakeArea {
  const area: FakeArea = {
    store: {},
    setCalls: [],
    getKeys: [],
    delayMs: 0,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) area.getKeys.push(k);
      if (area.delayMs > 0) await new Promise((r) => setTimeout(r, area.delayMs));
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in area.store) out[k] = area.store[k];
      return out;
    },
    async set(items) {
      area.setCalls.push(items);
      Object.assign(area.store, items);
      await Promise.resolve();
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete area.store[k];
      await Promise.resolve();
    },
  };
  return area;
}

describe("ChromeStorageBackend", () => {
  it("C1 — one set call writes both keys", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c1");
    await b.set!("/a.md", file("a"));
    expect(area.setCalls).toHaveLength(1);
    expect(Object.keys(area.setCalls[0])).toEqual(["web-agent-vfs:home:c1:f:/a.md", "web-agent-vfs:home:c1:index"]);
  });

  it("C2 — two concurrent sets on one ns both survive", async () => {
    const area = fakeArea();
    area.delayMs = 5;
    const b1 = ChromeStorageBackend(area, "shared:c2");
    const b2 = ChromeStorageBackend(area, "shared:c2");
    await Promise.all([b1.set!("/x.md", file("x")), b2.set!("/y.md", file("y"))]);
    expect((await b1.list("/")).map((e) => e.path).sort()).toEqual(["/x.md", "/y.md"]);
    expect(area.setCalls).toHaveLength(2);
  });

  it("C3 — different namespaces do not serialise with each other", async () => {
    const area = fakeArea();
    const a = ChromeStorageBackend(area, "home:c3a");
    const b = ChromeStorageBackend(area, "home:c3b");
    await a.set!("/a.md", file("a"));
    await b.set!("/b.md", file("b"));
    expect((await a.list("/")).map((e) => e.path)).toEqual(["/a.md"]);
    expect((await b.list("/")).map((e) => e.path)).toEqual(["/b.md"]);
  });

  it("C4 — list reads the index only", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c4");
    await b.set!("/a.md", file("a"));
    await b.set!("/b.md", file("b"));
    await b.set!("/c.md", file("c"));
    area.getKeys = [];
    const entries = await b.list("/");
    expect(entries).toHaveLength(3);
    expect(area.getKeys).toEqual(["web-agent-vfs:home:c4:index"]);
    for (const k of area.getKeys) expect(k).not.toMatch(/:f:\//);
  });

  it("C5 — list on a subtree", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c5");
    await b.set!("/deck/1.html", file("slide"));
    await b.set!("/notes.md", file("note"));
    const entries = await b.list("/deck");
    expect(entries.map((e) => e.path)).toEqual(["/deck/1.html"]);
  });

  it("C6 — get returns the stored file, and undefined for a missing one", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c6");
    await b.set!("/a.md", file("a"));
    expect(await b.get("/a.md")).toEqual(file("a"));
    expect(await b.get("/nope.md")).toBeUndefined();
  });

  it("C7 — delete removes the file key and the index row", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c7");
    await b.set!("/a.md", file("a"));
    await b.delete!("/a.md");
    expect(area.store["web-agent-vfs:home:c7:f:/a.md"]).toBeUndefined();
    expect(await b.list("/")).toEqual([]);
  });

  it("C8 — a missing index reads as empty", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c8");
    expect(await b.list("/")).toEqual([]);
  });

  it("C9 — an area.set rejection reaches the caller unchanged", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c9");
    area.set = () => Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
    await expect(b.set!("/a.md", file("a"))).rejects.toThrow("QUOTA_BYTES quota exceeded");
  });

  it("C10 — a rejected write does not poison the namespace's queue", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c10");
    const realSet = area.set.bind(area);
    area.set = () => Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
    await expect(b.set!("/a.md", file("a"))).rejects.toThrow("QUOTA_BYTES quota exceeded");
    area.set = realSet;
    await expect(b.set!("/b.md", file("b"))).resolves.toBeUndefined();
    expect((await b.list("/")).map((e) => e.path)).toEqual(["/b.md"]);
  });

  it("C11 — entryOf metadata", async () => {
    const area = fakeArea();
    const b = ChromeStorageBackend(area, "home:c11");
    await b.set!("/a.md", file("hello"));
    const idx = area.store["web-agent-vfs:home:c11:index"] as Record<string, unknown>;
    expect(idx["/a.md"]).toEqual({
      path: "/a.md",
      mimeType: "text/markdown",
      encoding: "utf8",
      mtimeMs: 123,
      size: 5,
    });
  });
});
