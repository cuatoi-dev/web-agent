import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { searchFilesTool } from "./search-files.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsMount } from "../types.js";

const ctx = { sessionId: "s1" } as unknown as ToolContext;

describe("search_files", () => {
  it("S1 — files_with_matches mode returns matching paths only", async () => {
    const backend = MemoryBackend();
    await backend.set!("/notes/q3.md", { content: "revenue grew 12%", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 200 });
    await backend.set!("/notes/q2.md", { content: "operational summary", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    const out = await tool.execute({ pattern: "revenue" }, ctx);
    expect(out.content).toBe("/home/agent/notes/q3.md");
  });

  it("S2 — content mode with context lines, delimiters and line number toggle", async () => {
    const backend = MemoryBackend();
    const text = [
      "header line",
      "first match revenue",
      "middle line 1",
      "middle line 2",
      "middle line 3",
      "second match revenue",
      "footer line",
    ].join("\n");
    await backend.set!("/notes.md", { content: text, encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    // Basic content mode
    const basic = await tool.execute({ pattern: "revenue", output_mode: "content" }, ctx);
    expect(basic.content).toBe(
      "/home/agent/notes.md:2:first match revenue\n/home/agent/notes.md:6:second match revenue",
    );

    // With context -C: 1
    const withContext = await tool.execute({ pattern: "revenue", output_mode: "content", "-C": 1 }, ctx);
    expect(withContext.content).toBe(
      [
        "/home/agent/notes.md-1-header line",
        "/home/agent/notes.md:2:first match revenue",
        "/home/agent/notes.md-3-middle line 1",
        "--",
        "/home/agent/notes.md-5-middle line 3",
        "/home/agent/notes.md:6:second match revenue",
        "/home/agent/notes.md-7-footer line",
      ].join("\n"),
    );

    // With -n: false
    const noLineNum = await tool.execute({ pattern: "revenue", output_mode: "content", "-n": false }, ctx);
    expect(noLineNum.content).toBe(
      "/home/agent/notes.md:first match revenue\n/home/agent/notes.md:second match revenue",
    );
  });

  it("S3 — case-insensitive matching and only-matching output", async () => {
    const backend = MemoryBackend();
    await backend.set!("/notes.md", { content: "Revenue grew and REVENUE peaked", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    const out = await tool.execute({ pattern: "revenue", output_mode: "content", "-i": true, "-o": true }, ctx);
    expect(out.content).toBe(
      "/home/agent/notes.md:1:Revenue\n/home/agent/notes.md:1:REVENUE",
    );
  });

  it("S4 — count mode returns counts and summary line", async () => {
    const backend = MemoryBackend();
    await backend.set!("/a.md", { content: "foo bar foo", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    await backend.set!("/b.md", { content: "foo baz", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 200 });
    await backend.set!("/c.md", { content: "no match", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 50 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    const out = await tool.execute({ pattern: "foo", output_mode: "count" }, ctx);
    expect(out.content).toBe(
      "/home/agent/b.md:1\n/home/agent/a.md:2\nFound 3 matches in 2 files.",
    );
  });

  it("S5 — multiline mode matches across line breaks", async () => {
    const backend = MemoryBackend();
    await backend.set!("/multiline.txt", { content: "start\nend", encoding: "utf8", mimeType: "text/plain", mtimeMs: 100 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    const out = await tool.execute({ pattern: "start.*end", multiline: true, output_mode: "content" }, ctx);
    expect(out.content).toBe("/home/agent/multiline.txt:1:start");

    const defaultMode = await tool.execute({ pattern: "start.*end", multiline: true }, ctx);
    expect(defaultMode.content).toBe("/home/agent/multiline.txt");
  });

  it("S6 — glob filter restricts files", async () => {
    const backend = MemoryBackend();
    await backend.set!("/notes.md", { content: "cat dog", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    await backend.set!("/data.csv", { content: "cat dog", encoding: "utf8", mimeType: "text/csv", mtimeMs: 200 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    const out = await tool.execute({ pattern: "cat", glob: "*.csv" }, ctx);
    expect(out.content).toBe("/home/agent/data.csv");
  });

  it("S7 — single file search when path points to an existing file", async () => {
    const backend = MemoryBackend();
    await backend.set!("/target.md", { content: "hello target", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });
    await backend.set!("/other.md", { content: "hello other", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 200 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    const out = await tool.execute({ pattern: "hello", path: "/home/agent/target.md" }, ctx);
    expect(out.content).toBe("/home/agent/target.md");
  });

  it("S8 — pagination limits and offsets with notice", async () => {
    const backend = MemoryBackend();
    await backend.set!("/a.txt", { content: "match", encoding: "utf8", mimeType: "text/plain", mtimeMs: 10 });
    await backend.set!("/b.txt", { content: "match", encoding: "utf8", mimeType: "text/plain", mtimeMs: 20 });
    await backend.set!("/c.txt", { content: "match", encoding: "utf8", mimeType: "text/plain", mtimeMs: 30 });
    await backend.set!("/d.txt", { content: "match", encoding: "utf8", mimeType: "text/plain", mtimeMs: 40 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    const out = await tool.execute({ pattern: "match", head_limit: 2, offset: 1 }, ctx);
    expect(out.content).toBe(
      "/home/agent/c.txt\n/home/agent/b.txt\n[Showing results with pagination = limit: 2, offset: 1]",
    );

    const pastEnd = await tool.execute({ pattern: "match", offset: 10 }, ctx);
    expect(pastEnd.content).toBe("No results at offset 10.");
  });

  it("S9 — skips base64 image files and rejects invalid regex", async () => {
    const backend = MemoryBackend();
    await backend.set!("/image.png", { content: "iVBORw0KGgoAAAANSUhEUgAA", encoding: "base64", mimeType: "image/png", mtimeMs: 100 });
    await backend.set!("/text.txt", { content: "pure text", encoding: "utf8", mimeType: "text/plain", mtimeMs: 100 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tool = searchFilesTool(mounts);

    const out = await tool.execute({ pattern: "iVBOR" }, ctx);
    expect(out.content).toBe("No matches found.");

    const badRegex = await tool.execute({ pattern: "[unclosed" }, ctx);
    expect(badRegex.isError).toBe(true);
    expect(badRegex.content).toMatch(/^Error: invalid regular expression: /);
  });
});

// Content-mode lines over 500 characters are omitted whole.
describe("search_files long lines", () => {
  const file = (content: string, mtimeMs = 1) => ({ content, encoding: "utf8" as const, mimeType: "text/plain", mtimeMs });

  it("prints a 500-character matching line as today and omits a 501-character one", async () => {
    const backend = MemoryBackend();
    const line500 = "match" + "x".repeat(495);
    const line501 = "match" + "x".repeat(496);
    await backend.set!("/a.txt", file(line500, 200));
    await backend.set!("/b.txt", file(line501, 100));
    const tool = searchFilesTool([{ prefix: "/home/agent", backend }]);

    const out = await tool.execute({ pattern: "match", output_mode: "content" }, ctx);
    expect(out.content).toContain(`/home/agent/a.txt:1:${line500}`);
    expect(out.content).toContain("/home/agent/b.txt:1: [line omitted: 501 characters, over 500]");
    expect(out.content).not.toContain(line501);
  });

  it("reports a single 48,210-character line and extracts the middle value with -o", async () => {
    const backend = MemoryBackend();
    const middle = "checksum=LIVE-PROOF-4402";
    const line = "x".repeat(24_000) + middle + "y".repeat(48_210 - 24_000 - middle.length);
    await backend.set!("/log.txt", file(line));
    const tool = searchFilesTool([{ prefix: "/home/agent", backend }]);

    const out = await tool.execute({ pattern: "LIVE-PROOF-4402", output_mode: "content" }, ctx);
    expect(out.content).toBe("/home/agent/log.txt:1: [line omitted: 48,210 characters, over 500]");

    const only = await tool.execute({ pattern: middle, output_mode: "content", "-o": true }, ctx);
    expect(only.content).toBe(`/home/agent/log.txt:1:${middle}`);
  });

  it("omits a long context line but keeps a short context line as a hyphen", async () => {
    const backend = MemoryBackend();
    const long = "z".repeat(501);
    const content = ["header", "match here", long].join("\n");
    await backend.set!("/notes.md", file(content));
    const tool = searchFilesTool([{ prefix: "/home/agent", backend }]);

    const out = await tool.execute({ pattern: "match", output_mode: "content", "-C": 1 }, ctx);
    expect(out.content).toContain("/home/agent/notes.md-1-header");
    expect(out.content).toContain("/home/agent/notes.md:2:match here");
    expect(out.content).toContain("/home/agent/notes.md:3: [line omitted: 501 characters, over 500]");
  });

  it("omits numbers when -n is false", async () => {
    const backend = MemoryBackend();
    await backend.set!("/notes.md", file("match" + "x".repeat(496)));
    const tool = searchFilesTool([{ prefix: "/home/agent", backend }]);
    const out = await tool.execute({ pattern: "match", output_mode: "content", "-n": false }, ctx);
    expect(out.content).toBe("/home/agent/notes.md: [line omitted: 501 characters, over 500]");
  });

  it("file and count modes still reflect a match on an omitted line", async () => {
    const backend = MemoryBackend();
    await backend.set!("/log.txt", file("match" + "x".repeat(500)));
    const tool = searchFilesTool([{ prefix: "/home/agent", backend }]);

    expect((await tool.execute({ pattern: "match" }, ctx)).content).toBe("/home/agent/log.txt");
    expect((await tool.execute({ pattern: "match", output_mode: "count" }, ctx)).content).toBe(
      "/home/agent/log.txt:1\nFound 1 matches in 1 files.",
    );
  });
});
