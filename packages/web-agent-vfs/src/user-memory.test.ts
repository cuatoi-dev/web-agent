import { describe, expect, it } from "vitest";
import { vfsTools, MemoryBackend } from "./index.js";
import { MEMORY_PROMPT_SNIPPET } from "./user-memory.js";
import type { VfsBackend } from "./types.js";

const textFile = (content: string) => ({ content, encoding: "utf8" as const, mimeType: "text/markdown", mtimeMs: 1 });
const first = { parts: [] as { type: "text"; text: string }[], sessionId: "s1", firstInChat: true, displayText: "hi" };
const AGENTS = '<agents-md path="/home/agent/AGENTS.md">\nRoot rule\n</agents-md>';
const USER = '<memory path="/home/shared/USER.md">\nName: Alex\n</memory>';
const MEM = '<memory path="/home/agent/MEMORY.md">\nLikes cats\n</memory>';
const MISSING = '<memory path="/home/shared/USER.md" missing="true">USER.md does not exist yet. Offer the onboarding skill.</memory>';

async function setup(opts: { agents?: boolean; user?: string; mem?: string } = {}) {
  const tmp = MemoryBackend(), home = MemoryBackend(), shared = MemoryBackend();
  if (opts.agents) await home.set!("/AGENTS.md", textFile("Root rule"));
  if (opts.user !== undefined) await shared.set!("/USER.md", textFile(opts.user));
  if (opts.mem !== undefined) await home.set!("/MEMORY.md", textFile(opts.mem));
  return { tmp, home, shared };
}

describe("vfsTools memory", () => {
  it("V1: memory off: the first message is unchanged and no tool carries the memory guideline", async () => {
    const { tmp, home, shared } = await setup({ agents: true, user: "Name: Alex", mem: "Likes cats" });
    for (const p of [vfsTools({ tmp, home, shared }), vfsTools({ tmp, home, shared, memory: false })]) {
      const r = await p.hooks!.onUserPrompt!(first);
      expect(r?.parts?.[0]).toEqual({ type: "text", text: AGENTS + "\n\n" });
      const defs = await p.load();
      expect(defs.some((d) => d.promptSnippet === MEMORY_PROMPT_SNIPPET)).toBe(false);
    }
  });

  it("V2: memory: true loads USER.md then MEMORY.md after AGENTS.md, first message only", async () => {
    const { tmp, home, shared } = await setup({ agents: true, user: "Name: Alex", mem: "Likes cats" });
    const p = vfsTools({ tmp, home, shared, memory: true });
    const r = await p.hooks!.onUserPrompt!({
      parts: [{ type: "text", text: "typed" }],
      sessionId: "s1",
      firstInChat: true,
      displayText: "typed",
    });
    expect(r?.parts?.[0]).toEqual({ type: "text", text: AGENTS + "\n\n" + USER + "\n\n" + MEM + "\n\n" });
    expect(r?.parts?.slice(1)).toEqual([{ type: "text", text: "typed" }]);
    expect(r?.userDisplayText).toBe("typed");
    expect(await p.hooks!.onUserPrompt!({ ...first, firstInChat: false })).toBeUndefined();

    // memory: {} gives the same parts[0] as memory: true
    const pEmpty = vfsTools({ tmp, home, shared, memory: {} });
    const rEmpty = await pEmpty.hooks!.onUserPrompt!(first);
    expect(rEmpty?.parts?.[0]).toEqual({ type: "text", text: AGENTS + "\n\n" + USER + "\n\n" + MEM + "\n\n" });
  });

  it("V3: a file over its limit is cut with the note and the file is not changed", async () => {
    const { tmp, home, shared } = await setup({ user: "a".repeat(2500), mem: "b".repeat(4001) });
    const p = vfsTools({ tmp, home, shared, memory: true });
    const r = await p.hooks!.onUserPrompt!(first);
    const text = (r?.parts?.[0] as { text: string })?.text ?? "";
    expect(text).toContain(
      '<memory path="/home/shared/USER.md">\n' +
        "a".repeat(2000) +
        "\n[cut at 2000 characters: merge or remove entries with the remember skill]\n</memory>",
    );
    expect(text).toContain(
      '<memory path="/home/agent/MEMORY.md">\n' +
        "b".repeat(4000) +
        "\n[cut at 4000 characters: merge or remove entries with the remember skill]\n</memory>",
    );
    expect((await shared.get("/USER.md"))!.content.length).toBe(2500);
    expect((await home.get("/MEMORY.md"))!.content.length).toBe(4001);
  });

  it("V4: a file exactly at its limit is not cut", async () => {
    const { tmp, home, shared } = await setup({ user: "a".repeat(2000) });
    const p = vfsTools({ tmp, home, shared, memory: true });
    const r = await p.hooks!.onUserPrompt!(first);
    const text = (r?.parts?.[0] as { text: string })?.text ?? "";
    expect(text).toContain('USER.md">\n' + "a".repeat(2000) + "\n</memory>");
    expect(text).not.toContain("[cut at");
  });

  it("V5: a missing USER.md adds the onboarding hint; onboarding false adds nothing; a missing MEMORY.md adds nothing", async () => {
    const { tmp, home, shared } = await setup();
    const pOn = vfsTools({ tmp, home, shared, memory: true });
    const rOn = await pOn.hooks!.onUserPrompt!(first);
    expect(rOn?.parts?.[0]).toEqual({ type: "text", text: MISSING + "\n\n" });

    const pOff = vfsTools({ tmp, home, shared, memory: { onboarding: false } });
    const rOff = await pOff.hooks!.onUserPrompt!(first);
    expect(rOff).toBeUndefined();

    const withUser = await setup({ user: "Name: Alex" });
    const pUserOnly = vfsTools({ ...withUser, memory: true });
    const rUserOnly = await pUserOnly.hooks!.onUserPrompt!(first);
    expect((rUserOnly?.parts?.[0] as { text: string })?.text).toBe(USER + "\n\n");
  });

  it("V6: custom paths and limits are honoured", async () => {
    const { tmp, home, shared } = await setup();
    await home.set!("/me.md", textFile("abcdefgh"));
    await shared.set!("/notes/mem.md", textFile("wxyz"));
    const p = vfsTools({
      tmp,
      home,
      shared,
      memory: {
        userPath: "/home/agent/me.md",
        memoryPath: "/home/shared/notes/mem.md",
        userMaxChars: 5,
        memoryMaxChars: 3,
      },
    });
    const r = await p.hooks!.onUserPrompt!(first);
    expect((r?.parts?.[0] as { text: string })?.text).toBe(
      '<memory path="/home/agent/me.md">\nabcde\n[cut at 5 characters: merge or remove entries with the remember skill]\n</memory>\n\n' +
        '<memory path="/home/shared/notes/mem.md">\nwxy\n[cut at 3 characters: merge or remove entries with the remember skill]\n</memory>\n\n',
    );

    const empty = await setup();
    const pCustomMissing = vfsTools({
      ...empty,
      memory: {
        userPath: "/home/agent/me.md",
      },
    });
    const rCustomMissing = await pCustomMissing.hooks!.onUserPrompt!(first);
    expect((rCustomMissing?.parts?.[0] as { text: string })?.text).toBe(
      '<memory path="/home/agent/me.md" missing="true">USER.md does not exist yet. Offer the onboarding skill.</memory>\n\n',
    );
  });

  it("V7: a read error skips that file and keeps the other", async () => {
    const { tmp, home, shared } = await setup({ mem: "Likes cats" });
    const broken: VfsBackend = {
      ...shared,
      get: () => Promise.reject(new Error("down")),
    };
    const p = vfsTools({ tmp, home, shared: broken, memory: true });
    const r = await p.hooks!.onUserPrompt!(first);
    expect((r?.parts?.[0] as { text: string })?.text).toBe(MEM + "\n\n");

    const base64Setup = await setup();
    await base64Setup.shared.set!("/USER.md", { ...textFile("aW1n"), encoding: "base64" });
    const pBase64 = vfsTools({ ...base64Setup, memory: true });
    const rBase64 = await pBase64.hooks!.onUserPrompt!(first);
    expect((rBase64?.parts?.[0] as { text: string })?.text).toMatch(new RegExp(`^${MISSING}`));
  });

  it("V8: memory on: exactly one tool carries the memory guideline, and read_file keeps its own", async () => {
    const { tmp, home, shared } = await setup();
    const p = vfsTools({ tmp, home, shared, memory: true });
    const defs = await p.load();
    expect(defs.filter((d) => d.promptSnippet === MEMORY_PROMPT_SNIPPET).map((d) => d.name)).toEqual(["write_file"]);
    expect(defs.find((d) => d.name === "read_file")!.promptSnippet).toContain("<agents-md");
    expect(typeof defs.find((d) => d.name === "write_file")!.execute).toBe("function");
  });
});
