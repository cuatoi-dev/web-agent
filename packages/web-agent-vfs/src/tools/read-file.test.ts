import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { editFileTool } from "./edit-file.js";
import { createAgentsMdTracker } from "../agents-md-tracker.js";
import { createReadTracker } from "../read-tracker.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsMount } from "../types.js";

const ctx = { sessionId: "s1" } as unknown as ToolContext;

function setup() {
  const backend = MemoryBackend();
  const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
  const tracker = createReadTracker();
  const agentsMdTracker = createAgentsMdTracker();
  const tool = readFileTool(mounts, tracker, agentsMdTracker);
  return { backend, tracker, tool, agentsMdTracker, mounts };
}

describe("read_file", () => {
  const file = (content: string, mtimeMs = 1) => ({ content, encoding: "utf8" as const, mimeType: "text/plain", mtimeMs });

  it("attaches unread AGENTS.md from parent folders in ancestor order and skips already seen instructions", async () => {
    const { backend, tool, agentsMdTracker } = setup();
    await backend.set!("/AGENTS.md", file("Root rule"));
    await backend.set!("/deck/AGENTS.md", file("Deck rule"));
    await backend.set!("/deck/slide.html", file("Slide"));
    const out = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    expect(out.content).toBe('     1\tSlide\n\n<agents-md path="/home/agent/AGENTS.md">\nRoot rule\n</agents-md>\n\n<agents-md path="/home/agent/deck/AGENTS.md">\nDeck rule\n</agents-md>');
    const again = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    expect(again.content).toBe("     1\tSlide");
    agentsMdTracker.record("s2", "/home/agent/AGENTS.md", 1);
    const other = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, { ...ctx, sessionId: "s2" });
    expect(other.content).not.toContain('<agents-md path="/home/agent/AGENTS.md">');
    expect(other.content).toContain('<agents-md path="/home/agent/deck/AGENTS.md">');
  });

  it("re-attaches AGENTS.md when file is recreated with newer mtimeMs", async () => {
    const { backend, tool } = setup();
    await backend.set!("/deck/AGENTS.md", file("Old rule"));
    await backend.set!("/deck/slide.html", file("Slide"));
    await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    await backend.delete!("/deck/AGENTS.md");
    await backend.set!("/deck/AGENTS.md", file("New rule", 2));
    const out = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    expect(out.content).toContain("New rule");
    expect(out.content).not.toContain("Old rule");
  });

  it("attaches ancestor AGENTS.md blocks to image file reads", async () => {
    const { backend, tool } = setup();
    await backend.set!("/deck/AGENTS.md", file("Deck rule"));
    const content = Buffer.from("image").toString("base64");
    await backend.set!("/deck/image.png", { content, encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    const out = await tool.execute({ file_path: "/home/agent/deck/image.png" }, ctx);
    expect(out.content).toMatch(/^Image /);
    expect(out.content).toContain('<agents-md path="/home/agent/deck/AGENTS.md">');
    expect(out.images).toEqual([{ dataUrl: `data:image/png;base64,${content}`, mediaType: "image/png" }]);
  });

  it("attaches ancestor AGENTS.md blocks to empty file reads", async () => {
    const { backend, tool } = setup();
    await backend.set!("/deck/AGENTS.md", file("Deck rule"));
    await backend.set!("/deck/empty.txt", file(""));
    const out = await tool.execute({ file_path: "/home/agent/deck/empty.txt" }, ctx);
    expect(out.content).toBe('The file /home/agent/deck/empty.txt is empty.\n\n<agents-md path="/home/agent/deck/AGENTS.md">\nDeck rule\n</agents-md>');
  });

  it("phrase returns with its AGENTS.md only when a block is attached", async () => {
    const { backend, tool } = setup();
    await backend.set!("/deck/AGENTS.md", file("Deck rule"));
    await backend.set!("/deck/slide.html", file('<agents-md path="fake">'));
    const input = { file_path: "/home/agent/deck/slide.html" };
    const out = await tool.execute(input, ctx);
    expect(tool.phrase!({ input, outcomeSummary: out.content }, "Tesagent")).toBe("Tesagent read /home/agent/deck/slide.html, with its AGENTS.md");
    const again = await tool.execute(input, ctx);
    expect(tool.phrase!({ input, outcomeSummary: again.content }, "Tesagent")).toBe("Tesagent read /home/agent/deck/slide.html");
    expect(tool.phrase!({ input, outcomeSummary: out.content, failed: true }, "Tesagent")).toBe("Tesagent could not read /home/agent/deck/slide.html");
  });

  it("failed reads leave both trackers unchanged and the next valid read still attaches AGENTS.md", async () => {
    const { backend, tool, tracker, agentsMdTracker } = setup();
    await backend.set!("/deck/AGENTS.md", file("Deck rule"));
    await backend.set!("/deck/slide.html", file("Slide"));
    for (const input of [
      { file_path: "/home/agent/deck/missing.html" },
      { file_path: "/home/agent/deck" },
      { file_path: "relative" },
      { file_path: "/home/agent/deck/slide.html", offset: 99 },
      { file_path: "/home/agent/deck/AGENTS.md", offset: 99 },
    ]) {
      const out = await tool.execute(input, ctx);
      expect(out.isError).toBe(true);
      expect(out.content).not.toContain("<agents-md");
      expect(tracker.wasRead("s1", input.file_path)).toBe(false);
      expect(agentsMdTracker.seen("s1", "/home/agent/deck/AGENTS.md")).toBeUndefined();
    }
    const valid = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    expect(valid.content).toContain('<agents-md path="/home/agent/deck/AGENTS.md">');
  });

  it("direct read of AGENTS.md records seen and marks path read", async () => {
    const { backend, tool, tracker, agentsMdTracker } = setup();
    await backend.set!("/deck/AGENTS.md", file("Deck rule"));
    await backend.set!("/deck/slide.html", file("Slide"));
    const out = await tool.execute({ file_path: "/home/agent/deck/AGENTS.md" }, ctx);
    expect(out.content).toBe("     1\tDeck rule");
    expect(tracker.wasRead("s1", "/home/agent/deck/AGENTS.md")).toBe(true);
    expect(agentsMdTracker.seen("s1", "/home/agent/deck/AGENTS.md")).toBe(1);
    const sibling = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    expect(sibling.content).not.toContain("<agents-md");
  });

  it("read_file attaches nothing after agent writes or edits AGENTS.md", async () => {
    const { backend, tool, tracker, agentsMdTracker, mounts } = setup();
    await backend.set!("/deck/slide.html", file("Slide"));
    const write = writeFileTool(mounts, tracker, agentsMdTracker);
    const edit = editFileTool(mounts, tracker, agentsMdTracker);
    const written = await write.execute({ file_path: "/home/agent/deck/AGENTS.md", content: "Old rule" }, ctx);
    expect(written.isError).toBeUndefined();
    const first = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    expect(first.content).not.toContain("<agents-md");
    const edited = await edit.execute({ file_path: "/home/agent/deck/AGENTS.md", old_string: "Old", new_string: "New" }, ctx);
    expect(edited.isError).toBeUndefined();
    const next = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    expect(next.content).not.toContain("<agents-md");
  });

  it("unreadable AGENTS.md is skipped and target file returned", async () => {
    const { backend, tracker, agentsMdTracker } = setup();
    await backend.set!("/deck/slide.html", file("Slide"));
    const broken = { ...backend, get: (rel: string) => rel.endsWith("AGENTS.md") ? Promise.reject(new Error("unreadable")) : backend.get(rel) };
    const tool = readFileTool([{ prefix: "/home/agent", backend: broken }], tracker, agentsMdTracker);
    const out = await tool.execute({ file_path: "/home/agent/deck/slide.html" }, ctx);
    expect(out.content).toBe("     1\tSlide");
    expect(out.isError).toBeUndefined();
  });
  it("R1 — numbered lines, no truncation note", async () => {
    const { backend, tool } = setup();
    await backend.set!("/notes.md", { content: "line one\nline two\nline three\nline four", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    const out = await tool.execute({ file_path: "/home/agent/notes.md" }, ctx);
    expect(out.content).toBe("     1\tline one\n     2\tline two\n     3\tline three\n     4\tline four");
  });

  it("R2 — offset and limit exactly covering the rest: no truncation note", async () => {
    const { backend, tool } = setup();
    await backend.set!("/notes.md", { content: "l1\nl2\nl3\nl4", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    const out = await tool.execute({ file_path: "/home/agent/notes.md", offset: 3, limit: 2 }, ctx);
    expect(out.content).toBe("     3\tl3\n     4\tl4");
  });

  it("R3 — offset and limit short of the end: shows the truncation note", async () => {
    const { backend, tool } = setup();
    const content = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join("\n");
    await backend.set!("/notes.md", { content, encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    const out = await tool.execute({ file_path: "/home/agent/notes.md", offset: 3, limit: 2 }, ctx);
    expect(out.content).toBe("     3\tl3\n     4\tl4\n… Showing lines 3–4 of 10. Use offset and limit to read more.");
  });

  it("R4 — a trailing newline is not shown and not counted", async () => {
    const { backend, tool } = setup();
    await backend.set!("/notes.md", { content: "a\nb\n", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    const out = await tool.execute({ file_path: "/home/agent/notes.md" }, ctx);
    expect(out.content).toBe("     1\ta\n     2\tb");
  });

  it("R5 — empty content reports empty, and marks the path read", async () => {
    const { backend, tool, tracker } = setup();
    await backend.set!("/empty.md", { content: "", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    const out = await tool.execute({ file_path: "/home/agent/empty.md" }, ctx);
    expect(out.content).toBe("The file /home/agent/empty.md is empty.");
    expect(out.isError).toBeUndefined();
    expect(tracker.wasRead("s1", "/home/agent/empty.md")).toBe(true);
  });

  it("R6 — a path with no file and no mount does not exist", async () => {
    const { tool } = setup();
    const out = await tool.execute({ file_path: "/notes.md" }, ctx);
    expect(out.content).toBe("Error: /notes.md does not exist.");
    expect(out.isError).toBe(true);
  });

  it("R7 — a folder path reports it is a folder", async () => {
    const { backend, tool } = setup();
    await backend.set!("/deck/1.html", { content: "<p>slide</p>", encoding: "utf8", mimeType: "text/html", mtimeMs: 1 });
    const out = await tool.execute({ file_path: "/home/agent/deck" }, ctx);
    expect(out.content).toBe("Error: /home/agent/deck is a folder. Use glob_files to list it.");
    expect(out.isError).toBe(true);
  });

  it("R8 — an offset outside the file fails", async () => {
    const { backend, tool } = setup();
    await backend.set!("/notes.md", { content: "a\nb\nc\nd", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    const zero = await tool.execute({ file_path: "/home/agent/notes.md", offset: 0 }, ctx);
    expect(zero.content).toBe("Error: offset 0 is outside the file (4 lines).");
    expect(zero.isError).toBe(true);
    const past = await tool.execute({ file_path: "/home/agent/notes.md", offset: 99 }, ctx);
    expect(past.content).toBe("Error: offset 99 is outside the file (4 lines).");
    expect(past.isError).toBe(true);
  });

  it("R9 — a relative file_path is an error outcome, not a thrown exception", async () => {
    const { tool } = setup();
    const out = await tool.execute({ file_path: "notes.md" }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toBe("Error: paths must be absolute, for example /home/agent/notes.md.");
  });

  it("R10 — a stored image returns the Image text and a decodable data URL", async () => {
    const { backend, tool } = setup();
    const b64 = Buffer.from("fake-png-bytes").toString("base64");
    await backend.set!("/rainbow.png", { content: b64, encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    const out = await tool.execute({ file_path: "/home/agent/rainbow.png" }, ctx);
    expect(out.content).toMatch(/^Image \/home\/agent\/rainbow\.png \(image\/png, \d+\.\d KB\)\.$/);
    expect(out.images?.[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
    const decoded = out.images![0].dataUrl.split(",")[1];
    expect(decoded).toBe(b64);
  });

  it("R11 — reading any file marks it read", async () => {
    const { backend, tool, tracker } = setup();
    await backend.set!("/notes.md", { content: "hi", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 });
    await tool.execute({ file_path: "/home/agent/notes.md" }, ctx);
    expect(tracker.wasRead("s1", "/home/agent/notes.md")).toBe(true);
  });
});

// The read budget bounds the numbered output without changing small reads.
describe("read_file output budget", () => {
  const file = (content: string) => ({ content, encoding: "utf8" as const, mimeType: "text/plain", mtimeMs: 1 });
  const budget = 12_000;
  const numbered = (start: number, arr: string[]) =>
    arr.map((t, i) => `${String(start + i).padStart(6)}\t${t}`).join("\n");

  function longFile(lines: string[]) {
    const backend = MemoryBackend();
    const tracker = createReadTracker();
    const tool = readFileTool([{ prefix: "/home/agent", backend }], tracker, undefined, budget);
    return backend.set!("/big.txt", file(lines.join("\n"))).then(() => ({ backend, tracker, tool }));
  }

  it("returns a maximal PARTIAL prefix and the whole result fits the budget", async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
    const { tool, tracker } = await longFile(lines);
    const out = await tool.execute({ file_path: "/home/agent/big.txt" }, ctx);

    expect(out.content.length).toBeLessThanOrEqual(budget);
    const m = /lines 1–(\d+) of 1000 shown/.exec(out.content);
    expect(m).toBeTruthy();
    const b = Number(m![1]);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(1000);
    expect(out.content.endsWith(`[PARTIAL view — lines 1–${b} of 1000 shown. Use offset and limit to read more.]`)).toBe(true);
    expect(out.content).not.toContain("Showing lines");
    expect(tracker.wasRead("s1", "/home/agent/big.txt")).toBe(true);

    // Maximal-prefix invariant: one more line plus its recalculated notice would not fit.
    const nextNotice = `\n[PARTIAL view — lines 1–${b + 1} of 1000 shown. Use offset and limit to read more.]`;
    expect(numbered(1, lines.slice(0, b + 1)).length + nextNotice.length).toBeGreaterThan(budget);
  });

  it("an explicit limit over the budget errors and records nothing", async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
    const { tool, tracker } = await longFile(lines);
    const out = await tool.execute({ file_path: "/home/agent/big.txt", limit: 2000 }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain("over the 12,000 limit");
    expect(tracker.wasRead("s1", "/home/agent/big.txt")).toBe(false);
  });

  it("an explicit offset over the budget errors", async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
    const { tool } = await longFile(lines);
    const out = await tool.execute({ file_path: "/home/agent/big.txt", offset: 1 }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain("over the 12,000 limit");
  });

  it("a single 48,210-character line reports its raw length", async () => {
    const { tool } = await longFile(["x".repeat(48_210)]);
    const out = await tool.execute({ file_path: "/home/agent/big.txt" }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toBe(
      "Error: Line 1 is 48,210 characters, over the 12,000 limit. Use search_files with -o to pull values out of it.",
    );
  });

  it("a line that fits alone but not with its notice uses the empty-fit error", async () => {
    const { tool } = await longFile(["A".repeat(11_990), "B"]);
    const out = await tool.execute({ file_path: "/home/agent/big.txt" }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain("Line 1 is 11,990 characters");
  });

  it("honours and prints a custom budget", async () => {
    const backend = MemoryBackend();
    const tool = readFileTool([{ prefix: "/home/agent", backend }], createReadTracker(), undefined, 100);
    await backend.set!("/big.txt", file("A".repeat(200)));
    const out = await tool.execute({ file_path: "/home/agent/big.txt" }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain("over the 100 limit");
  });

  it("an exact numbered length equalling the budget is a normal small read", async () => {
    const backend = MemoryBackend();
    const expected = "     1\tabc";
    const tool = readFileTool([{ prefix: "/home/agent", backend }], createReadTracker(), undefined, expected.length);
    await backend.set!("/small.txt", file("abc"));
    const out = await tool.execute({ file_path: "/home/agent/small.txt" }, ctx);
    expect(out.content).toBe(expected);
  });
});
