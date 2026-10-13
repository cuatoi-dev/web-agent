import { describe, expect, it } from "vitest";
import { vfsTools, MemoryBackend } from "./index.js";
import { buildTools, parseSavedOutput, type CustomToolDef, type ToolContext } from "@cuatoi/web-agent-core";
import type { VfsBackend } from "./types.js";

describe("vfsTools", () => {
  const textFile = (content: string) => ({ content, encoding: "utf8" as const, mimeType: "text/markdown", mtimeMs: 1 });

  it("provider hooks inject AGENTS.md on firstInChat and share the record with read_file", async () => {
    const home = MemoryBackend();
    await home.set!("/AGENTS.md", textFile("Keep slides under 40 words"));
    await home.set!("/deck/slide.html", textFile("Slide"));
    const provider = vfsTools({ home });
    const tools = await provider.load();
    const parts = [{ type: "text" as const, text: "skill body" }];
    const payload = { parts, sessionId: "s1", firstInChat: true, displayText: "/skill arg" };
    const result = await provider.hooks!.onUserPrompt!(payload);
    expect(result?.parts?.[0]).toEqual({ type: "text", text: '<agents-md path="/home/agent/AGENTS.md">\nKeep slides under 40 words\n</agents-md>\n\n' });
    expect(result?.parts?.slice(1)).toEqual(parts);
    expect(result?.userDisplayText).toBe("/skill arg");
    expect(await provider.hooks!.onUserPrompt!({ ...payload, firstInChat: false })).toBeUndefined();
    const read = tools.find((t) => t.name === "read_file")!;
    const out = await read.execute({ file_path: "/home/agent/deck/slide.html" }, { sessionId: "s1" } as ToolContext);
    expect(out.content).not.toContain("<agents-md");
    const newChat = await provider.hooks!.onUserPrompt!({ ...payload, sessionId: "s2" });
    expect(newChat?.parts?.[0]).toEqual(result?.parts?.[0]);
  });

  it("missing, binary, or unreadable AGENTS.md returns undefined without error", async () => {
    const home = MemoryBackend();
    const payload = { parts: [], firstInChat: true, displayText: "hello" };
    const provider = vfsTools({ home });
    await provider.load();
    expect(await provider.hooks!.onUserPrompt!(payload)).toBeUndefined();
    await home.set!("/AGENTS.md", { ...textFile("aW1hZ2U="), encoding: "base64" });
    expect(await provider.hooks!.onUserPrompt!(payload)).toBeUndefined();
    const broken = vfsTools({ home: { ...home, get: () => Promise.reject(new Error("unreadable")) } });
    await broken.load();
    expect(await broken.hooks!.onUserPrompt!(payload)).toBeUndefined();
  });

  it("tools other than read_file do not append blocks", async () => {
    const home = MemoryBackend();
    await home.set!("/AGENTS.md", textFile("Root rule"));
    const provider = vfsTools({ home });
    const tools = await provider.load();
    const ctx = { sessionId: "s1" } as ToolContext;
    const cases = [
      ["write_file", { file_path: "/note.txt", content: "Wrong mount" }],
      ["write_file", { file_path: "/home/agent/note.txt", content: "Note" }],
      ["edit_file", { file_path: "/home/agent/note.txt", old_string: "Note", new_string: "Changed" }],
      ["glob_files", { path: "/home/agent", pattern: "*" }],
      ["search_files", { path: "/home/agent", pattern: "Changed" }],
      ["move_file", { source_path: "/home/agent/note.txt", destination_path: "/home/agent/moved.txt" }],
      ["delete_file", { file_path: "/home/agent/moved.txt" }],
      ["json_get", { file_path: "/home/agent/deck/slide.html" }],
      ["json_edit", { file_path: "/home/agent/data.json", changes: [{ op: "set", path: "a", value: 1 }] }],
    ] as const;
    for (const [name, input] of cases) {
      const out = await tools.find((t) => t.name === name)!.execute(input, ctx);
      expect(out.content).not.toContain("<agents-md");
    }
  });
  it("returns one provider named vfs, required: false", () => {
    const provider = vfsTools();
    expect(provider.name).toBe("vfs");
    expect(provider.required).toBe(false);
  });

  it("load() resolves to the nine tool defs, each with a phrase and inProgressPhrase", async () => {
    const provider = vfsTools({ mounts: {} });
    const defs = await provider.load();
    expect(defs.map((d) => d.name)).toEqual([
      "read_file",
      "write_file",
      "edit_file",
      "glob_files",
      "search_files",
      "delete_file",
      "move_file",
      "json_get",
      "json_edit",
    ]);
    for (const def of defs) {
      expect(typeof def.phrase).toBe("function");
      expect(typeof def.inProgressPhrase).toBe("function");
    }
  });

  it("phrase() reports the failure and success wording", async () => {
    const provider = vfsTools({ mounts: {} });
    const defs = await provider.load();
    const [readDef] = defs;
    expect(readDef.phrase!({ input: { file_path: "/a.md" }, outcomeSummary: "nope", failed: true }, "tesagent")).toBe(
      "tesagent could not read /a.md",
    );
    expect(readDef.phrase!({ input: { file_path: "/a.md" }, outcomeSummary: "     1\thi", failed: false }, "tesagent")).toBe(
      "tesagent read /a.md",
    );

    const defsMap = new Map(defs.map((d) => [d.name, d]));
    expect(defsMap.get("glob_files")!.phrase!({ input: { pattern: "*.md", path: "/home/agent" }, outcomeSummary: "", failed: false }, "tesagent")).toBe(
      "tesagent listed *.md in /home/agent",
    );
    expect(defsMap.get("glob_files")!.phrase!({ input: { pattern: "*.md", path: "/home/agent" }, outcomeSummary: "storage error", failed: true }, "tesagent")).toBe(
      "tesagent could not list *.md in /home/agent",
    );
    expect(defsMap.get("search_files")!.phrase!({ input: { pattern: "revenue", path: "/home/agent" }, outcomeSummary: "", failed: false }, "tesagent")).toBe(
      'tesagent searched /home/agent for "revenue"',
    );
    expect(defsMap.get("search_files")!.phrase!({ input: { pattern: "revenue", path: "/home/agent" }, outcomeSummary: "search failed", failed: true }, "tesagent")).toBe(
      'tesagent could not search /home/agent for "revenue"',
    );
    expect(defsMap.get("delete_file")!.phrase!({ input: { file_path: "/a.md" }, outcomeSummary: "Deleted /a.md.", failed: false }, "tesagent")).toBe(
      "tesagent deleted /a.md",
    );
    expect(defsMap.get("delete_file")!.phrase!({ input: { file_path: "/a.md" }, outcomeSummary: "Permission denied", failed: true }, "tesagent")).toBe(
      "tesagent could not delete /a.md",
    );
    expect(defsMap.get("delete_file")!.phrase!({ input: {}, outcomeSummary: "Invalid input", failed: true }, "tesagent")).toBe(
      "tesagent could not delete a file",
    );
    expect(defsMap.get("move_file")!.phrase!({ input: { source_path: "/a.md", destination_path: "/b.md" }, outcomeSummary: "Moved /a.md to /b.md.", failed: false }, "tesagent")).toBe(
      "tesagent moved /a.md to /b.md",
    );
    expect(defsMap.get("move_file")!.phrase!({ input: { source_path: "/a.md", destination_path: "/b.md" }, outcomeSummary: "Destination exists", failed: true }, "tesagent")).toBe(
      "tesagent could not move /a.md",
    );
    expect(defsMap.get("move_file")!.phrase!({ input: {}, outcomeSummary: "Could not read the arguments for move_file: tool did not run", failed: true }, "tesagent")).toBe(
      "tesagent could not move a file",
    );
  });

  it("inProgressPhrase() reports the working-with-files line", async () => {
    const provider = vfsTools({ mounts: {} });
    const [readDef] = await provider.load();
    expect(readDef.inProgressPhrase!("tesagent")).toBe("tesagent is working with files…");
  });

  describe("vfs handle", () => {
    it("attaches a vfs handle with mounts(), list(), get(), delete()", () => {
      const provider = vfsTools();
      expect(provider.vfs).toBeDefined();
      expect(typeof provider.vfs.mounts).toBe("function");
      expect(typeof provider.vfs.list).toBe("function");
      expect(typeof provider.vfs.get).toBe("function");
      expect(typeof provider.vfs.delete).toBe("function");
    });

    it("mounts() returns mount info including prefixes and tabScoped flag", () => {
      const provider = vfsTools();
      const mounts = provider.vfs.mounts();
      expect(mounts.map((m) => m.prefix)).toEqual(["/tmp", "/home/agent", "/home/shared"]);
      const tmpMount = mounts.find((m) => m.prefix === "/tmp");
      expect(tmpMount?.tabScoped).toBe(true);
      expect(tmpMount?.writable).toBe(true);
      expect(tmpMount?.deletable).toBe(true);
    });

    it("list(), get(), and delete() operate against mounts", async () => {
      const mem = MemoryBackend();
      await mem.set("/test.txt", {
        content: "hello world",
        encoding: "utf8",
        mimeType: "text/plain",
        mtimeMs: 1000,
      });
      const provider = vfsTools({ home: mem });

      // list()
      const entries = await provider.vfs.list("/home/agent");
      expect(entries.some((e) => e.abs === "/home/agent/test.txt")).toBe(true);

      // get()
      const file = await provider.vfs.get("/home/agent/test.txt");
      expect(file?.content).toBe("hello world");

      const missing = await provider.vfs.get("/home/agent/nonexistent.txt");
      expect(missing).toBeUndefined();

      // delete()
      await provider.vfs.delete("/home/agent/test.txt");
      const deleted = await provider.vfs.get("/home/agent/test.txt");
      expect(deleted).toBeUndefined();
    });

    it("delete() throws on read-only mount or missing file", async () => {
      const readOnlyBackend = {
        get: () => Promise.resolve({ content: "ro", encoding: "utf8" as const, mimeType: "text/plain", mtimeMs: 1000 }),
        list: () => Promise.resolve([{ path: "/ro.txt", size: 2, mtimeMs: 1000, encoding: "utf8" as const, mimeType: "text/plain" }]),
      };
      const provider = vfsTools({
        mounts: {
          "/data": readOnlyBackend,
        },
      });

      await expect(provider.vfs.delete("/data/ro.txt")).rejects.toThrow(/read-only/);
      await expect(provider.vfs.delete("/unknown/file.txt")).rejects.toThrow(/not found/i);
    });

    it("mount table errors are thrown by both load() and vfs methods", async () => {
      const provider = vfsTools({
        mounts: {
          "/tmp/sub": MemoryBackend(), // clashes with /tmp
        },
      });

      await expect(provider.load()).rejects.toThrow(/overlaps/);
      expect(() => provider.vfs.mounts()).toThrow(/overlaps/);
    });
  });
});

describe("vfsTools run-time mounts", () => {
  const text = (content: string) => ({ content, encoding: "utf8" as const, mimeType: "text/plain", mtimeMs: 5 });
  const toolOf = (tools: Awaited<ReturnType<ReturnType<typeof vfsTools>["load"]>>, name: string) =>
    tools.find((t) => t.name === name)!;

  it("a mount added after load() is visible to the tools already loaded", async () => {
    const provider = vfsTools({ tmp: MemoryBackend(), home: MemoryBackend(), shared: MemoryBackend() });
    const tools = await provider.load();
    const extra = MemoryBackend();
    await extra.set!("/a.csv", text("x,y\n1,2\n"));
    provider.vfs.mount("/share/reports", extra, { external: true });
    const out = await toolOf(tools, "read_file").execute({ file_path: "/share/reports/a.csv" }, { sessionId: "s1" } as ToolContext);
    expect(out.content).toContain("x,y");
    const info = provider.vfs.mounts().find((m) => m.prefix === "/share/reports");
    expect(info?.external).toBe(true);
    expect(provider.vfs.mounts().filter((m) => m.external)).toHaveLength(1);
  });

  it("refuses a root, equal, parent or child prefix and leaves the table and listeners alone", () => {
    const provider = vfsTools({ tmp: MemoryBackend(), home: MemoryBackend(), shared: MemoryBackend() });
    let calls = 0;
    provider.vfs.subscribe(() => calls++);
    provider.vfs.mount("/share/reports", MemoryBackend(), { external: true });
    calls = 0;
    const before = provider.vfs.mounts().map((m) => m.prefix);
    for (const bad of ["/", "/tmp", "/home/agent/x", "/home", "/share/reports", "/share", "/share/reports/deep"]) {
      expect(() => provider.vfs.mount(bad, MemoryBackend())).toThrow(/overlaps/);
    }
    expect(provider.vfs.mounts().map((m) => m.prefix)).toEqual(before);
    expect(calls).toBe(0);
  });

  it("normalises the prefix and accepts an unrelated sibling", () => {
    const provider = vfsTools({ tmp: MemoryBackend(), home: MemoryBackend(), shared: MemoryBackend() });
    provider.vfs.mount("/share/reports/", MemoryBackend());
    provider.vfs.mount("/share/reports-old", MemoryBackend());
    expect(provider.vfs.mounts().map((m) => m.prefix)).toEqual(
      expect.arrayContaining(["/share/reports", "/share/reports-old"]),
    );
  });

  it("unmount removes only run-time mounts and fires one event; a failed unmount fires none", () => {
    const provider = vfsTools({
      tmp: MemoryBackend(), home: MemoryBackend(), shared: MemoryBackend(),
      mounts: { "/data": MemoryBackend() },
    });
    let calls = 0;
    const off = provider.vfs.subscribe(() => calls++);
    provider.vfs.mount("/share/reports", MemoryBackend(), { external: true });
    expect(calls).toBe(1);
    expect(provider.vfs.unmount("/home/agent")).toBe(false);
    expect(provider.vfs.unmount("/data")).toBe(false);
    expect(provider.vfs.unmount("/share/missing")).toBe(false);
    expect(calls).toBe(1);
    expect(provider.vfs.unmount("/share/reports")).toBe(true);
    expect(calls).toBe(2);
    expect(provider.vfs.mounts().map((m) => m.prefix)).not.toContain("/share/reports");
    expect(provider.vfs.mounts().map((m) => m.prefix)).toContain("/home/agent");
    off();
    provider.vfs.mount("/share/reports", MemoryBackend());
    expect(calls).toBe(2);
  });

  it("after unmount a read says the path does not exist, and a remount needs a fresh read in every chat", async () => {
    const provider = vfsTools({ tmp: MemoryBackend(), home: MemoryBackend(), shared: MemoryBackend() });
    const tools = await provider.load();
    const read = toolOf(tools, "read_file");
    const edit = toolOf(tools, "edit_file");
    const first = MemoryBackend();
    await first.set!("/n.md", text("one"));
    provider.vfs.mount("/share/site", first, { external: true });
    for (const sessionId of ["s1", "s2"]) {
      await read.execute({ file_path: "/share/site/n.md" }, { sessionId } as ToolContext);
    }
    provider.vfs.unmount("/share/site");
    const gone = await read.execute({ file_path: "/share/site/n.md" }, { sessionId: "s1" } as ToolContext);
    expect(gone.content).toBe("Error: /share/site/n.md does not exist.");
    const second = MemoryBackend();
    await second.set!("/n.md", text("two"));
    provider.vfs.mount("/share/site", second, { external: true });
    for (const sessionId of ["s1", "s2"]) {
      const out = await edit.execute(
        { file_path: "/share/site/n.md", old_string: "two", new_string: "three" },
        { sessionId } as ToolContext,
      );
      expect(out.content).toContain("has not been read in this chat");
    }
  });

  it("vfsTools registers exactly one folder attachment provider", () => {
    expect(vfsTools().attachmentProviders!.map((a) => a.id)).toEqual(["folder"]);
  });
});

// 002: the provider hook saves a long result through core, and a new chat
// clears only the saved-result folder.
describe("vfsTools long tool results (002)", () => {
  const textFile = (content: string) => ({ content, encoding: "utf8" as const, mimeType: "text/plain", mtimeMs: 1 });

  const ctxWith = (provider: ReturnType<typeof vfsTools>, hostSeen: unknown[]) =>
    ({
      app: { appName: "test" },
      signal: new AbortController().signal,
      sessionId: "s1",
      hooks: {
        onPostTool: [
          provider.hooks!.onPostTool!,
          (p: unknown) => { hostSeen.push(p); },
        ],
      },
    }) as unknown as ToolContext;

  it("saves a long result and exposes the preview to the host hook", async () => {
    const tmp = MemoryBackend();
    const provider = vfsTools({ tmp, home: MemoryBackend(), shared: MemoryBackend() });
    await provider.load();
    const big: CustomToolDef = {
      name: "big_tool",
      description: "big",
      inputSchema: { type: "object", properties: {} },
      execute: () => Promise.resolve({ content: "a".repeat(13_000) }),
    };
    const hostSeen: Array<{ outcome: { content: string } }> = [];
    const ctx = ctxWith(provider, hostSeen);
    const { executors } = buildTools(ctx, [big]);
    const res = await executors.big_tool({}, { abortSignal: ctx.signal, toolCallId: "call_x" });

    expect(parseSavedOutput(res.content)!.path).toBe("/tmp/tool-results/call_x.txt");
    expect((await tmp.get("/tool-results/call_x.txt"))!.content).toBe("a".repeat(13_000));
    expect(hostSeen).toHaveLength(1);
    expect(parseSavedOutput(hostSeen[0].outcome.content)!.saved).toBe(true);
  });

  it("saves a long thrown error and omits the stack from file and wire", async () => {
    const tmp = MemoryBackend();
    const provider = vfsTools({ tmp, home: MemoryBackend(), shared: MemoryBackend() });
    await provider.load();
    const tool: CustomToolDef = {
      name: "throw_tool",
      description: "throws",
      inputSchema: { type: "object", properties: {} },
      execute: () => {
        const e = new Error("E".repeat(13_000));
        e.stack = "STACK-SENTINEL";
        return Promise.reject(e);
      },
    };
    const ctx = ctxWith(provider, []);
    const { executors } = buildTools(ctx, [tool]);
    const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "call_err" });

    expect(res.isError).toBe(true);
    expect(res.content).not.toContain("STACK-SENTINEL");
    const stored = await tmp.get("/tool-results/call_err.txt");
    expect(stored!.content).toBe("E".repeat(13_000));
    expect(stored!.content).not.toContain("STACK-SENTINEL");
    expect(parseSavedOutput(res.content)!.saved).toBe(true);
  });

  it("a new chat deletes saved files and keeps other /tmp files", async () => {
    const tmp = MemoryBackend();
    await tmp.set!("/tool-results/a.txt", textFile("old"));
    await tmp.set!("/keep.txt", textFile("keep"));
    const provider = vfsTools({ tmp, home: MemoryBackend(), shared: MemoryBackend() });
    await provider.load();

    await provider.hooks!.onUserPrompt!({ parts: [], firstInChat: true, sessionId: "s1", displayText: "hi" });
    expect(await tmp.get("/tool-results/a.txt")).toBeUndefined();
    expect(await tmp.get("/keep.txt")).toBeDefined();
  });

  it("continues cleanup when one delete fails", async () => {
    const base = MemoryBackend();
    const tmp: VfsBackend = {
      ...base,
      delete: (rel) => (rel === "/tool-results/b.txt" ? Promise.reject(new Error("locked")) : base.delete!(rel)),
    };
    await tmp.set!("/tool-results/a.txt", textFile("a"));
    await tmp.set!("/tool-results/b.txt", textFile("b"));
    const provider = vfsTools({ tmp, home: MemoryBackend(), shared: MemoryBackend() });
    await provider.load();

    await provider.hooks!.onUserPrompt!({ parts: [], firstInChat: true, sessionId: "s1", displayText: "hi" });
    expect(await tmp.get("/tool-results/a.txt")).toBeUndefined();
    expect(await tmp.get("/tool-results/b.txt")).toBeDefined();
  });

  it("still injects AGENTS.md when the cleanup listing fails", async () => {
    const home = MemoryBackend();
    await home.set!("/AGENTS.md", textFile("Root rule"));
    const tmp: VfsBackend = {
      get: () => Promise.resolve(undefined),
      list: () => Promise.reject(new Error("listing down")),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const provider = vfsTools({ tmp, home, shared: MemoryBackend() });
    await provider.load();

    const result = await provider.hooks!.onUserPrompt!({ parts: [], firstInChat: true, sessionId: "s1", displayText: "hi" });
    expect(result?.parts?.[0]).toEqual({
      type: "text",
      text: '<agents-md path="/home/agent/AGENTS.md">\nRoot rule\n</agents-md>\n\n',
    });
  });
});
