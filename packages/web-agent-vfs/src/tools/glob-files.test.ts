import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { globFilesTool } from "./glob-files.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsMount } from "../types.js";

const ctx = { sessionId: "s1" } as unknown as ToolContext;

describe("glob_files", () => {
  it("G1 — matches top-level and nested files with newest first", async () => {
    const backend = MemoryBackend();
    await backend.set!("/notes.md", { content: "n", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    await backend.set!("/memory/day.md", { content: "d", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 200 });
    await backend.set!("/data.csv", { content: "c", encoding: "utf8", mimeType: "text/csv", mtimeMs: 300 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = globFilesTool(mounts);

    const out = await tool.execute({ pattern: "**/*.md", path: "/home/agent" }, ctx);
    expect(out.content).toBe("/home/agent/memory/day.md\n/home/agent/notes.md");
  });

  it("G2 — pattern with leading slash matches full absolute path", async () => {
    const backend = MemoryBackend();
    await backend.set!("/notes.md", { content: "n", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = globFilesTool(mounts);

    const out = await tool.execute({ pattern: "/home/agent/*.md" }, ctx);
    expect(out.content).toBe("/home/agent/notes.md");
  });

  it("G3 — returns files sorted by mtimeMs descending, then path ascending", async () => {
    const backend = MemoryBackend();
    await backend.set!("/b.md", { content: "b", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    await backend.set!("/a.md", { content: "a", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    await backend.set!("/c.md", { content: "c", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 200 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = globFilesTool(mounts);

    const out = await tool.execute({ pattern: "*.md" }, ctx);
    expect(out.content).toBe("/home/agent/c.md\n/home/agent/a.md\n/home/agent/b.md");
  });

  it("G4 — caps output at 100 files with pagination notice", async () => {
    const backend = MemoryBackend();
    for (let i = 0; i < 120; i++) {
      const name = `/file_${String(i).padStart(3, "0")}.txt`;
      await backend.set!(name, { content: "x", encoding: "utf8", mimeType: "text/plain", mtimeMs: i });
    }

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = globFilesTool(mounts);

    const out = await tool.execute({ pattern: "*.txt" }, ctx);
    const lines = out.content.split("\n");
    expect(lines.length).toBe(101); // 100 files + 1 notice
    expect(lines[0]).toBe("/home/agent/file_119.txt");
    expect(lines[99]).toBe("/home/agent/file_020.txt");
    expect(lines[100]).toBe("(Showing 100 of 120 files, newest first. Narrow the pattern or path to see the rest.)");
  });

  it("G5 — lists files across all mounts with root path and returns No files found when empty", async () => {
    const tmp = MemoryBackend();
    const home = MemoryBackend();
    const shared = MemoryBackend();
    await tmp.set!("/draft.md", { content: "t", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 10 });
    await home.set!("/notes.md", { content: "h", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 20 });
    await shared.set!("/team.md", { content: "s", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 30 });

    const mounts: VfsMount[] = [
      { prefix: "/tmp", backend: tmp },
      { prefix: "/home/agent", backend: home },
      { prefix: "/home/shared", backend: shared },
    ];
    const tool = globFilesTool(mounts);

    const out = await tool.execute({ pattern: "**/*.md", path: "/" }, ctx);
    expect(out.content).toBe("/home/shared/team.md\n/home/agent/notes.md\n/tmp/draft.md");

    const empty = await tool.execute({ pattern: "**/*.csv", path: "/" }, ctx);
    expect(empty.content).toBe("No files found.");
  });

  it("G6 — relative path input fails with Error", async () => {
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: MemoryBackend() }];
    const tool = globFilesTool(mounts);

    const out = await tool.execute({ pattern: "*.md", path: "relative/path" }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^Error: /);
  });

  it("G7 — phrase outputs formatted step line", () => {
    const tool = globFilesTool([]);
    const phrase = tool.phrase!({ input: { pattern: "*.md", path: "/home/agent" }, outcomeSummary: "" }, "tesagent");
    expect(phrase).toBe("tesagent listed *.md in /home/agent");
  });
});
