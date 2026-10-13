import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { editFileTool } from "./edit-file.js";
import { readFileTool } from "./read-file.js";
import { createReadTracker } from "../read-tracker.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsMount } from "../types.js";

const ctx = { sessionId: "s1" } as unknown as ToolContext;

function setup() {
  const home = MemoryBackend();
  const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
  const tracker = createReadTracker();
  const edit = editFileTool(mounts, tracker);
  const read = readFileTool(mounts, tracker);
  return { home, tracker, edit, read };
}

describe("edit_file", () => {
  it("E1 — editing before any read fails", async () => {
    const { home, edit } = setup();
    await home.set!("/notes.md", { content: "hello world", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "hello", new_string: "hi" }, ctx);
    expect(out.content).toBe("Error: /home/agent/notes.md has not been read in this chat. Read it with read_file first.");
    expect(out.isError).toBe(true);
  });

  it("E2 — after a read, replaces one occurrence", async () => {
    const { home, read, edit } = setup();
    await home.set!("/notes.md", { content: "hello world", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "hello", new_string: "goodbye" }, ctx);
    expect(out.content).toBe("The file /home/agent/notes.md has been updated.");
    expect((await home.get("/notes.md"))?.content).toBe("goodbye world");
  });

  it("E3 — three occurrences without replace_all fails, file unchanged", async () => {
    const { home, read, edit } = setup();
    await home.set!("/notes.md", { content: "aa aa aa", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "aa", new_string: "bb" }, ctx);
    expect(out.content).toBe("Error: found 3 matches of old_string. Set replace_all to true, or add more context so it matches once.");
    expect((await home.get("/notes.md"))?.content).toBe("aa aa aa");
  });

  it("E4 — three occurrences with replace_all replaces all and reports the count", async () => {
    const { home, read, edit } = setup();
    await home.set!("/notes.md", { content: "aa aa aa", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "aa", new_string: "bb", replace_all: true }, ctx);
    expect(out.content).toBe("The file /home/agent/notes.md has been updated. Replaced 3 occurrences.");
    expect((await home.get("/notes.md"))?.content).toBe("bb bb bb");
  });

  it("E5 — old_string not found fails", async () => {
    const { home, read, edit } = setup();
    await home.set!("/notes.md", { content: "hello", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "nope", new_string: "x" }, ctx);
    expect(out.content).toBe("Error: old_string was not found in /home/agent/notes.md.");
  });

  it("E6 — an empty old_string fails", async () => {
    const { home, read, edit } = setup();
    await home.set!("/notes.md", { content: "hello", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "", new_string: "x" }, ctx);
    expect(out.content).toBe("Error: old_string is empty.");
  });

  it("E7 — identical old_string and new_string fails", async () => {
    const { home, read, edit } = setup();
    await home.set!("/notes.md", { content: "hello", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "hello", new_string: "hello" }, ctx);
    expect(out.content).toBe("Error: old_string and new_string are the same.");
  });

  it("E8 — an image file cannot be edited", async () => {
    const { home, edit } = setup();
    await home.set!("/rainbow.png", { content: "aGk=", encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    const out = await edit.execute({ file_path: "/home/agent/rainbow.png", old_string: "a", new_string: "b" }, ctx);
    expect(out.content).toBe("Error: /home/agent/rainbow.png is an image; edit_file changes text files only.");
  });

  it("E9 — a missing file fails", async () => {
    const { edit } = setup();
    const out = await edit.execute({ file_path: "/home/agent/nope.md", old_string: "a", new_string: "b" }, ctx);
    expect(out.content).toBe("Error: /home/agent/nope.md does not exist.");
  });

  it("E10 — a read-only path fails the same way as write_file", async () => {
    const { edit } = setup();
    const out = await edit.execute({ file_path: "/notes.md", old_string: "a", new_string: "b" }, ctx);
    expect(out.content).toBe("Error: /notes.md is read-only. Writable paths: /home/agent.");
  });

  it("E11 — occurrences are counted non-overlapping", async () => {
    // "aa" in "aaaa" is 2 NON-overlapping matches (positions 0 and 2), not 3
    // (which an overlapping scan would report for positions 0, 1 and 2).
    const { home, read, edit } = setup();
    await home.set!("/notes.md", { content: "aaaa", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "aa", new_string: "bb" }, ctx);
    expect(out.content).toBe("Error: found 2 matches of old_string. Set replace_all to true, or add more context so it matches once.");

    const replaced = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "aa", new_string: "bb", replace_all: true }, ctx);
    expect(replaced.content).toBe("The file /home/agent/notes.md has been updated. Replaced 2 occurrences.");
    expect((await home.get("/notes.md"))?.content).toBe("bbbb");
  });

  it("E12 — old_string is matched as plain text, not a regular expression", async () => {
    const { home, read, edit } = setup();
    await home.set!("/notes.md", { content: "a.b and axb", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "a.b", new_string: "Z" }, ctx);
    expect(out.content).toBe("The file /home/agent/notes.md has been updated.");
    expect((await home.get("/notes.md"))?.content).toBe("Z and axb");
  });

  it("E13 — a successful edit keeps the path marked read, so a second edit works", async () => {
    const { home, read, edit, tracker } = setup();
    await home.set!("/notes.md", { content: "one two", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await read.execute({ file_path: "/home/agent/notes.md" }, ctx);
    await edit.execute({ file_path: "/home/agent/notes.md", old_string: "one", new_string: "1" }, ctx);
    expect(tracker.wasRead("s1", "/home/agent/notes.md")).toBe(true);
    const out = await edit.execute({ file_path: "/home/agent/notes.md", old_string: "two", new_string: "2" }, ctx);
    expect(out.content).toBe("The file /home/agent/notes.md has been updated.");
    expect((await home.get("/notes.md"))?.content).toBe("1 2");
  });
});

describe("edit_file on an attached folder", () => {
  const txt = (content: string, mtimeMs: number) => ({ content, encoding: "utf8" as const, mimeType: "text/markdown", mtimeMs });

  function attached() {
    const disk = MemoryBackend();
    const mounts: VfsMount[] = [
      { prefix: "/home/agent", backend: MemoryBackend() },
      { prefix: "/share/site", backend: disk, external: true },
    ];
    const tracker = createReadTracker();
    return { disk, tracker, edit: editFileTool(mounts, tracker), read: readFileTool(mounts, tracker) };
  }
  const args = { file_path: "/share/site/a.md", old_string: "old", new_string: "new" };

  it("fails after a newer change on disk, keeps the bytes, and succeeds after a new read", async () => {
    const { disk, read, edit } = attached();
    await disk.set!("/a.md", txt("old", 100));
    await read.execute({ file_path: "/share/site/a.md" }, ctx);
    await disk.set!("/a.md", txt("old plus", 200));
    const out = await edit.execute(args, ctx);
    expect(out.content).toBe("Error: /share/site/a.md changed on disk since you read it. Read it again with read_file.");
    expect(out.isError).toBe(true);
    expect((await disk.get("/a.md"))?.content).toBe("old plus");
    await read.execute({ file_path: "/share/site/a.md" }, ctx);
    expect((await edit.execute(args, ctx)).isError).toBeUndefined();
    expect((await disk.get("/a.md"))?.content).toBe("new plus");
  });

  it("allows a second edit without a new read, because the write recorded the disk time", async () => {
    const { disk, read, edit } = attached();
    await disk.set!("/a.md", txt("old old", 100));
    await read.execute({ file_path: "/share/site/a.md" }, ctx);
    expect((await edit.execute({ ...args, replace_all: true }, ctx)).isError).toBeUndefined();
    const second = await edit.execute({ ...args, old_string: "new new", new_string: "newer" }, ctx);
    expect(second.isError).toBeUndefined();
  });

  it("a rejected edit does not grant a read", async () => {
    const { disk, tracker, edit } = attached();
    await disk.set!("/a.md", txt("old", 100));
    const out = await edit.execute(args, ctx);
    expect(out.isError).toBe(true);
    expect(tracker.wasRead("s1", "/share/site/a.md")).toBe(false);
  });
});
