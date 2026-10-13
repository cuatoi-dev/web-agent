import { describe, expect, it } from "vitest";
import { buildMounts, canDelete, canWrite, ConfigError, filesUnder, readOnlyMessage, resolve, writablePrefixes } from "./mounts.js";
import { MemoryBackend } from "./backends/memory.js";
import { vfsTools } from "./index.js";

describe("buildMounts", () => {
  it("M1 — with no options, mounts the three defaults in order", () => {
    const mounts = buildMounts();
    expect(mounts.map((m) => m.prefix)).toEqual(["/tmp", "/home/agent", "/home/shared"]);
  });

  it("M2 — a host mount is appended after the defaults", () => {
    const mounts = buildMounts({ mounts: { "/data": MemoryBackend() } });
    expect(mounts.map((m) => m.prefix)).toEqual(["/tmp", "/home/agent", "/home/shared", "/data"]);
  });

  it("M3 — a host mount inside an existing prefix is refused", () => {
    expect(() => buildMounts({ mounts: { "/home/agent/x": MemoryBackend() } })).toThrow(ConfigError);
    try {
      buildMounts({ mounts: { "/home/agent/x": MemoryBackend() } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain("/home/agent");
    }
  });

  it("M4 — mounting the root is refused, naming an overlap", () => {
    expect(() => buildMounts({ mounts: { "/": MemoryBackend() } })).toThrow(ConfigError);
    try {
      buildMounts({ mounts: { "/": MemoryBackend() } });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toMatch(/overlaps/);
    }
  });

  it("M5 — a host mount that contains an existing prefix is refused", () => {
    expect(() => buildMounts({ mounts: { "/home": MemoryBackend() } })).toThrow(ConfigError);
  });
});

describe("resolve", () => {
  it("M6 — a path with no mount resolves to mount null and rel undefined", () => {
    const result = resolve(buildMounts(), "/notes.md");
    expect(result).toEqual({ p: "/notes.md", mount: null });
    expect(result.rel).toBeUndefined();
  });

  it("M7 — a path inside a mount resolves with the mount-relative rel", () => {
    const result = resolve(buildMounts(), "/home/agent/a.md");
    expect(result.mount?.prefix).toBe("/home/agent");
    expect(result.rel).toBe("/a.md");
  });

  it("M8 — the mount root itself resolves to rel /", () => {
    const result = resolve(buildMounts(), "/home/agent");
    expect(result.mount?.prefix).toBe("/home/agent");
    expect(result.rel).toBe("/");
  });
});

describe("writablePrefixes / canWrite / canDelete", () => {
  it("M9 — the default layout is fully writable", () => {
    expect(writablePrefixes(buildMounts())).toEqual(["/tmp", "/home/agent", "/home/shared"]);
  });

  it("M10 — a backend with no set is read-only and excluded from writablePrefixes", () => {
    const readOnly = { get: () => Promise.resolve(undefined), list: () => Promise.resolve([]) };
    const mounts = buildMounts({ mounts: { "/data": readOnly } });
    const dataMount = mounts.find((m) => m.prefix === "/data") ?? null;
    expect(canWrite(dataMount)).toBe(false);
    expect(canDelete(dataMount)).toBe(false);
    expect(writablePrefixes(mounts)).not.toContain("/data");
  });
});

describe("vfsTools().load()", () => {
  it("M11 — a bad mount configuration rejects the load, not a synchronous throw", async () => {
    const provider = vfsTools({ mounts: { "/": MemoryBackend() } });
    await expect(provider.load()).rejects.toThrow(ConfigError);
  });
});

describe("filesUnder", () => {
  it("M12 — lists all files across multiple mounts when base is root", async () => {
    const tmp = MemoryBackend();
    const home = MemoryBackend();
    const shared = MemoryBackend();
    await tmp.set!("/draft.md", { content: "t", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    await home.set!("/notes/a.md", { content: "h", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 200 });
    await shared.set!("/shared.csv", { content: "s", encoding: "utf8", mimeType: "text/csv", mtimeMs: 300 });

    const mounts = buildMounts({ tmp, home, shared });
    const entries = await filesUnder(mounts, "/");
    expect(entries.map((e) => e.abs).sort()).toEqual([
      "/home/agent/notes/a.md",
      "/home/shared/shared.csv",
      "/tmp/draft.md",
    ]);
  });

  it("M13 — lists files under a specific mount only", async () => {
    const tmp = MemoryBackend();
    const home = MemoryBackend();
    await tmp.set!("/draft.md", { content: "t", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    await home.set!("/notes/a.md", { content: "h", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 200 });
    await home.set!("/root.md", { content: "r", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 250 });

    const mounts = buildMounts({ tmp, home });
    const entries = await filesUnder(mounts, "/home/agent");
    expect(entries.map((e) => e.abs).sort()).toEqual([
      "/home/agent/notes/a.md",
      "/home/agent/root.md",
    ]);
  });

  it("M14 — lists files under nested directory within a mount", async () => {
    const home = MemoryBackend();
    await home.set!("/notes/a.md", { content: "h", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 200 });
    await home.set!("/data/orders.csv", { content: "o", encoding: "utf8", mimeType: "text/csv", mtimeMs: 300 });

    const mounts = buildMounts({ home });
    const entries = await filesUnder(mounts, "/home/agent/notes");
    expect(entries.map((e) => e.abs)).toEqual(["/home/agent/notes/a.md"]);
  });

  it("M15 — returns empty array for an unmounted path", async () => {
    const mounts = buildMounts({ home: MemoryBackend() });
    const entries = await filesUnder(mounts, "/unmounted/dir");
    expect(entries).toEqual([]);
  });
});


describe("readOnlyMessage", () => {
  const rw = (prefix: string, external = false) => ({ prefix, backend: MemoryBackend(), external });
  const ro = (prefix: string, external = false) => {
    const m = MemoryBackend();
    return { prefix, backend: { get: (r: string) => m.get(r), list: (r: string) => m.list(r) }, external };
  };

  it("lists only writable prefixes, including a writable attached folder", () => {
    const mounts = [rw("/home/agent"), ro("/share/reports", true), rw("/share/site", true)];
    expect(readOnlyMessage("/share/reports/a.csv", mounts[1], mounts)).toBe(
      "Error: /share/reports/a.csv is read-only. The user attached /share/reports read only. Writable paths: /home/agent, /share/site.",
    );
  });

  it("keeps the plain text for a read-only mount that is not attached", () => {
    const mounts = [rw("/home/agent"), ro("/store")];
    expect(readOnlyMessage("/store/x.md", mounts[1], mounts)).toBe(
      "Error: /store/x.md is read-only. Writable paths: /home/agent.",
    );
  });
});
