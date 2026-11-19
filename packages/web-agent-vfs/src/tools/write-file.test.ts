import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { isBase64, writeFileTool } from "./write-file.js";
import { readFileTool } from "./read-file.js";
import { createReadTracker } from "../read-tracker.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsMount, VfsBackend } from "../types.js";

const ctxA = { sessionId: "s1" } as unknown as ToolContext;
const ctxB = { sessionId: "s2" } as unknown as ToolContext;

function setup(extra?: Record<string, VfsBackend>) {
  const home = MemoryBackend();
  const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
  if (extra) {
    for (const [prefix, backend] of Object.entries(extra)) {
      mounts.push({ prefix, backend });
    }
  }
  const tracker = createReadTracker();
  const write = writeFileTool(mounts, tracker);
  const read = readFileTool(mounts, tracker);
  return { home, tracker, write, read, mounts };
}

describe("isBase64", () => {
  it("accepts valid base64", () => {
    expect(isBase64("aGk=")).toBe(true);
  });
  it("rejects invalid base64", () => {
    expect(isBase64("not base64!!")).toBe(false);
  });
});

describe("write_file", () => {
  it("W1 — creates a new file", async () => {
    const { home, write } = setup();
    const out = await write.execute({ file_path: "/home/agent/notes.md", content: "hi" }, ctxA);
    expect(out.content).toBe("File created successfully at: /home/agent/notes.md");
    const stored = await home.get("/notes.md");
    expect(stored?.mimeType).toBe("text/markdown");
    expect(stored?.mtimeMs).toBeGreaterThan(0);
  });

  it("W2 — overwriting a file not read in this chat fails, and the content is unchanged", async () => {
    const { home, write } = setup();
    await home.set!("/notes.md", { content: "original", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    const out = await write.execute({ file_path: "/home/agent/notes.md", content: "new" }, ctxA);
    expect(out.content).toBe("Error: /home/agent/notes.md already exists and has not been read in this chat. Read it with read_file first.");
    expect(out.isError).toBe(true);
    expect((await home.get("/notes.md"))?.content).toBe("original");
  });

  it("W3 — read then overwrite succeeds", async () => {
    const { home, read, write } = setup();
    await home.set!("/notes.md", { content: "original", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctxA);
    const out = await write.execute({ file_path: "/home/agent/notes.md", content: "new" }, ctxA);
    expect(out.content).toBe("The file /home/agent/notes.md has been updated.");
  });

  it("W4 — a write of a file this chat itself created can overwrite it again", async () => {
    const { write } = setup();
    await write.execute({ file_path: "/home/agent/notes.md", content: "v1" }, ctxA);
    const out = await write.execute({ file_path: "/home/agent/notes.md", content: "v2" }, ctxA);
    expect(out.content).toBe("The file /home/agent/notes.md has been updated.");
  });

  it("W5 — a read in one chat does not count for another chat", async () => {
    const { home, read, write } = setup();
    await home.set!("/notes.md", { content: "original", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctxA);
    const out = await write.execute({ file_path: "/home/agent/notes.md", content: "new" }, ctxB);
    expect(out.content).toBe("Error: /home/agent/notes.md already exists and has not been read in this chat. Read it with read_file first.");
  });

  it("W6 — a path with no writable mount fails naming the writable paths", async () => {
    const mounts: VfsMount[] = [
      { prefix: "/tmp", backend: MemoryBackend() },
      { prefix: "/home/agent", backend: MemoryBackend() },
      { prefix: "/home/shared", backend: MemoryBackend() },
    ];
    const write = writeFileTool(mounts, createReadTracker());
    const out = await write.execute({ file_path: "/notes.md", content: "x" }, ctxA);
    expect(out.content).toBe("Error: /notes.md is read-only. Writable paths: /tmp, /home/agent, /home/shared.");
  });

  it("W7 — a read-only host mount excludes itself from the writable list", async () => {
    const readOnly: VfsBackend = { get: () => Promise.resolve(undefined), list: () => Promise.resolve([]) };
    const { write } = setup({ "/data": readOnly });
    const out = await write.execute({ file_path: "/data/a.md", content: "x" }, ctxA);
    expect(out.isError).toBe(true);
    expect(out.content).toBe("Error: /data/a.md is read-only. Writable paths: /home/agent.");
  });

  it("W8 — base64 with no mime_type fails", async () => {
    const { write } = setup();
    const out = await write.execute({ file_path: "/home/agent/a.png", content: "aGk=", encoding: "base64" }, ctxA);
    expect(out.content).toBe("Error: mime_type is required when encoding is base64.");
  });

  it("W9 — base64 with a non-image mime_type fails", async () => {
    const { write } = setup();
    const out = await write.execute({ file_path: "/home/agent/a.pdf", content: "aGk=", encoding: "base64", mime_type: "application/pdf" }, ctxA);
    expect(out.content).toBe("Error: binary files must be images (image/png, image/jpeg, image/gif, image/webp). Got application/pdf.");
  });

  it("W10 — base64 with invalid content fails", async () => {
    const { write } = setup();
    const out = await write.execute({ file_path: "/home/agent/a.png", content: "not base64!!", encoding: "base64", mime_type: "image/png" }, ctxA);
    expect(out.content).toBe("Error: content is not valid base64.");
  });

  it("W11 — a valid base64 image is created", async () => {
    const { home, write } = setup();
    const out = await write.execute({ file_path: "/home/agent/a.png", content: "aGk=", encoding: "base64", mime_type: "image/png" }, ctxA);
    expect(out.content).toBe("File created successfully at: /home/agent/a.png");
    const stored = await home.get("/a.png");
    expect(stored?.encoding).toBe("base64");
    expect(stored?.mimeType).toBe("image/png");
  });

  it("W12 — extension-inferred MIME types", async () => {
    const { home, write } = setup();
    await write.execute({ file_path: "/home/agent/a.json", content: "{}" }, ctxA);
    await write.execute({ file_path: "/home/agent/a.html", content: "<p></p>" }, ctxA);
    await write.execute({ file_path: "/home/agent/a.unknown", content: "x" }, ctxA);
    expect((await home.get("/a.json"))?.mimeType).toBe("application/json");
    expect((await home.get("/a.html"))?.mimeType).toBe("text/html");
    expect((await home.get("/a.unknown"))?.mimeType).toBe("text/plain");
  });

  it("W13 — an explicit mime_type wins over the extension", async () => {
    const { home, write } = setup();
    await write.execute({ file_path: "/home/agent/a.md", content: "x", mime_type: "text/plain" }, ctxA);
    expect((await home.get("/a.md"))?.mimeType).toBe("text/plain");
  });

  it("W14 — a QuotaExceededError from the backend is reported by name", async () => {
    const quotaBackend: VfsBackend = {
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      set: () => Promise.reject(Object.assign(new Error("full"), { name: "QuotaExceededError" })),
    };
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: quotaBackend }];
    const tracker = createReadTracker();
    const write = writeFileTool(mounts, tracker);
    const out = await write.execute({ file_path: "/home/agent/a.md", content: "x" }, ctxA);
    expect(out.content).toBe("Error: could not write /home/agent/a.md: the storage for /home/agent is full.");
  });

  it("W15 — a plain Error from the backend is reported by message", async () => {
    const failBackend: VfsBackend = {
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      set: () => Promise.reject(new Error("boom")),
    };
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: failBackend }];
    const tracker = createReadTracker();
    const write = writeFileTool(mounts, tracker);
    const out = await write.execute({ file_path: "/home/agent/a.md", content: "x" }, ctxA);
    expect(out.content).toBe("Error: could not write /home/agent/a.md: boom");
  });

  it("W16 — writing to a folder path fails", async () => {
    const { home, write } = setup();
    await home.set!("/deck/1.html", { content: "<p></p>", encoding: "utf8", mimeType: "text/html", mtimeMs: 1 });
    const out = await write.execute({ file_path: "/home/agent/deck", content: "x" }, ctxA);
    expect(out.content).toBe("Error: /home/agent/deck is a folder.");
  });
});

describe("write_file on an attached folder", () => {
  const txt = (content: string, mtimeMs: number) => ({ content, encoding: "utf8" as const, mimeType: "text/markdown", mtimeMs });

  function attached() {
    const disk = MemoryBackend();
    const home = MemoryBackend();
    const mounts: VfsMount[] = [
      { prefix: "/home/agent", backend: home },
      { prefix: "/share/site", backend: disk, external: true },
    ];
    const tracker = createReadTracker();
    return { disk, home, tracker, write: writeFileTool(mounts, tracker), read: readFileTool(mounts, tracker) };
  }

  it("fails when the file changed on disk after the read, and keeps the content", async () => {
    const { disk, read, write } = attached();
    await disk.set!("/a.md", txt("old", 100));
    await read.execute({ file_path: "/share/site/a.md" }, ctxA);
    await disk.set!("/a.md", txt("changed elsewhere", 200));
    const out = await write.execute({ file_path: "/share/site/a.md", content: "mine" }, ctxA);
    expect(out.content).toBe("Error: /share/site/a.md changed on disk since you read it. Read it again with read_file.");
    expect(out.isError).toBe(true);
    expect((await disk.get("/a.md"))?.content).toBe("changed elsewhere");
    await read.execute({ file_path: "/share/site/a.md" }, ctxA);
    const again = await write.execute({ file_path: "/share/site/a.md", content: "mine" }, ctxA);
    expect(again.isError).toBeUndefined();
    expect((await disk.get("/a.md"))?.content).toBe("mine");
  });

  it("allows a write when the disk time equals or is older than the read", async () => {
    const { disk, read, write } = attached();
    await disk.set!("/a.md", txt("old", 100));
    await read.execute({ file_path: "/share/site/a.md" }, ctxA);
    await disk.set!("/a.md", txt("same-time", 100));
    expect((await write.execute({ file_path: "/share/site/a.md", content: "x" }, ctxA)).isError).toBeUndefined();
    await disk.set!("/b.md", txt("old", 300));
    await read.execute({ file_path: "/share/site/b.md" }, ctxA);
    await disk.set!("/b.md", txt("older", 50));
    expect((await write.execute({ file_path: "/share/site/b.md", content: "x" }, ctxA)).isError).toBeUndefined();
  });

  it("still needs a read in the chat that writes", async () => {
    const { disk, read, write } = attached();
    await disk.set!("/a.md", txt("old", 100));
    await read.execute({ file_path: "/share/site/a.md" }, ctxA);
    const out = await write.execute({ file_path: "/share/site/a.md", content: "x" }, ctxB);
    expect(out.content).toContain("has not been read in this chat");
  });

  it("records the disk's own time, so the next write needs no new read", async () => {
    const { disk, write } = attached();
    expect((await write.execute({ file_path: "/share/site/n.md", content: "1" }, ctxA)).isError).toBeUndefined();
    const stored = await disk.get("/n.md");
    expect(stored?.content).toBe("1");
    const next = await write.execute({ file_path: "/share/site/n.md", content: "2" }, ctxA);
    expect(next.content).toBe("The file /share/site/n.md has been updated.");
  });

  it("rejects a binary file that is not an image with the approved text, and writes nothing", async () => {
    const { disk, write } = attached();
    const out = await write.execute(
      { file_path: "/share/site/x.bin", content: "AAEC", encoding: "base64", mime_type: "application/octet-stream" },
      ctxA,
    );
    expect(out.content).toBe("Error: Only text files and PNG, JPEG, GIF or WebP images can be written.");
    expect(await disk.get("/x.bin")).toBeUndefined();
  });

  it("keeps the read-before-write rule on internal mounts: any earlier read is enough", async () => {
    const { home, tracker, write } = attached();
    await home.set!("/a.md", txt("old", 100));
    tracker.markRead("s1", "/home/agent/a.md", 100);
    await home.set!("/a.md", txt("newer", 900));
    expect((await write.execute({ file_path: "/home/agent/a.md", content: "x" }, ctxA)).isError).toBeUndefined();
  });

  it("names the attached folder when it is read only", async () => {
    const m = MemoryBackend();
    const mounts: VfsMount[] = [
      { prefix: "/home/agent", backend: MemoryBackend() },
      { prefix: "/share/reports", backend: { get: (r: string) => m.get(r), list: (r: string) => m.list(r) }, external: true },
    ];
    const out = await writeFileTool(mounts, createReadTracker()).execute({ file_path: "/share/reports/a.csv", content: "x" }, ctxA);
    expect(out.content).toBe("Error: /share/reports/a.csv is read-only. The user attached /share/reports read only. Writable paths: /home/agent.");
  });
});
