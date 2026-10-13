import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { moveFileTool } from "./move-file.js";
import { editFileTool } from "./edit-file.js";
import { createReadTracker } from "../read-tracker.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsMount } from "../types.js";

const ctx = { sessionId: "s1" } as unknown as ToolContext;

describe("move_file", () => {
  it("M1 — moves file across mounts preserving content, mimeType, and mtimeMs", async () => {
    const tmp = MemoryBackend();
    const home = MemoryBackend();
    await tmp.set!("/draft.md", {
      content: "draft text",
      encoding: "utf8",
      mimeType: "text/markdown",
      mtimeMs: 12345,
    });

    const mounts: VfsMount[] = [
      { prefix: "/tmp", backend: tmp },
      { prefix: "/home/agent", backend: home },
    ];
    const tracker = createReadTracker();
    const tool = moveFileTool(mounts, tracker);

    const res = await tool.execute(
      { source_path: "/tmp/draft.md", destination_path: "/home/agent/notes/draft.md" },
      ctx,
    );
    expect(res.content).toBe("Moved /tmp/draft.md to /home/agent/notes/draft.md.");
    expect(res.isError).toBeUndefined();

    // Source is gone
    expect(await tmp.get("/draft.md")).toBeUndefined();

    // Destination has exact content, mimeType and mtimeMs
    const dst = await home.get("/notes/draft.md");
    expect(dst).toEqual({
      content: "draft text",
      encoding: "utf8",
      mimeType: "text/markdown",
      mtimeMs: 12345,
    });
  });

  it("M2 — fails if destination already exists as file or folder, keeping both untouched", async () => {
    const home = MemoryBackend();
    await home.set!("/a.md", { content: "a", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 10 });
    await home.set!("/b.md", { content: "b", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 20 });
    await home.set!("/dir/c.md", { content: "c", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 30 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const tracker = createReadTracker();
    const tool = moveFileTool(mounts, tracker);

    // Destination file exists
    const fileClash = await tool.execute(
      { source_path: "/home/agent/a.md", destination_path: "/home/agent/b.md" },
      ctx,
    );
    expect(fileClash.isError).toBe(true);
    expect(fileClash.content).toBe("Error: /home/agent/b.md already exists.");
    expect(await home.get("/a.md")).toBeDefined();
    expect((await home.get("/b.md"))?.content).toBe("b");

    // Destination folder exists
    const folderClash = await tool.execute(
      { source_path: "/home/agent/a.md", destination_path: "/home/agent/dir" },
      ctx,
    );
    expect(folderClash.isError).toBe(true);
    expect(folderClash.content).toBe("Error: /home/agent/dir already exists.");
    expect(await home.get("/a.md")).toBeDefined();
  });

  it("M3 — fails if source missing, source read-only, or destination read-only", async () => {
    const rw = MemoryBackend();
    await rw.set!("/a.md", { content: "a", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 10 });

    const ro = {
      get: (rel: string) =>
        rel === "/ro.md"
          ? Promise.resolve({ content: "ro", encoding: "utf8" as const, mimeType: "text/plain", mtimeMs: 10 })
          : Promise.resolve(undefined),
      list: () => Promise.resolve([]),
    };

    const mounts: VfsMount[] = [
      { prefix: "/rw", backend: rw },
      { prefix: "/ro", backend: ro },
    ];
    const tracker = createReadTracker();
    const tool = moveFileTool(mounts, tracker);

    // Source missing
    const missing = await tool.execute({ source_path: "/rw/missing.md", destination_path: "/rw/dest.md" }, ctx);
    expect(missing.isError).toBe(true);
    expect(missing.content).toBe("Error: /rw/missing.md does not exist.");

    // Source read-only
    const srcRo = await tool.execute({ source_path: "/ro/ro.md", destination_path: "/rw/dest.md" }, ctx);
    expect(srcRo.isError).toBe(true);
    expect(srcRo.content).toBe("Error: /ro/ro.md is read-only, so it cannot be moved.");

    // Destination read-only
    const dstRo = await tool.execute({ source_path: "/rw/a.md", destination_path: "/ro/a.md" }, ctx);
    expect(dstRo.isError).toBe(true);
    expect(dstRo.content).toBe("Error: /ro/a.md is read-only. Writable paths: /rw.");
  });

  it("M4 — rolls back destination copy if deleting source throws", async () => {
    const srcBackend = MemoryBackend();
    await srcBackend.set!("/a.md", { content: "a", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 10 });
    // Make delete throw
    srcBackend.delete = () => Promise.reject(new Error("disk locked"));

    const dstBackend = MemoryBackend();
    const mounts: VfsMount[] = [
      { prefix: "/src", backend: srcBackend },
      { prefix: "/dst", backend: dstBackend },
    ];
    const tracker = createReadTracker();
    const tool = moveFileTool(mounts, tracker);

    const res = await tool.execute({ source_path: "/src/a.md", destination_path: "/dst/a.md" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Error: could not move /src/a.md: disk locked");

    // Destination should be rolled back (deleted)
    expect(await dstBackend.get("/a.md")).toBeUndefined();
    // Source still exists
    expect(await srcBackend.get("/a.md")).toBeDefined();
  });

  it("M5 — transfers read status so destination can be edited immediately", async () => {
    const home = MemoryBackend();
    await home.set!("/draft.md", { content: "initial draft", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 10 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const tracker = createReadTracker();
    // Mark source as read
    tracker.markRead("s1", "/home/agent/draft.md", 10);

    const moveTool = moveFileTool(mounts, tracker);
    const editTool = editFileTool(mounts, tracker);

    await moveTool.execute(
      { source_path: "/home/agent/draft.md", destination_path: "/home/agent/final.md" },
      ctx,
    );

    // Editing destination should succeed without new read_file
    const editRes = await editTool.execute(
      { file_path: "/home/agent/final.md", old_string: "initial", new_string: "final" },
      ctx,
    );
    expect(editRes.isError).toBeUndefined();
    expect(editRes.content).toContain("has been updated");
    expect((await home.get("/final.md"))?.content).toBe("final draft");
  });

  it("M6 — phrase reports moved or could not move", () => {
    const tool = moveFileTool([], createReadTracker());
    expect(
      tool.phrase!(
        { input: { source_path: "/a.md", destination_path: "/b.md" }, outcomeSummary: "Moved /a.md to /b.md.", failed: false },
        "tesagent",
      ),
    ).toBe("tesagent moved /a.md to /b.md");
    expect(
      tool.phrase!(
        { input: { source_path: "/a.md", destination_path: "/b.md" }, outcomeSummary: "Error: nope", failed: true },
        "tesagent",
      ),
    ).toBe("tesagent could not move /a.md");
  });
});

describe("move_file with an attached folder", () => {
  const txt = { content: "# a", encoding: "utf8" as const, mimeType: "text/markdown", mtimeMs: 100 };
  type Detail = Parameters<NonNullable<ToolContext["confirmInteraction"]>>[0];

  function attached() {
    const disk = MemoryBackend();
    const home = MemoryBackend();
    const m = MemoryBackend();
    const mounts: VfsMount[] = [
      { prefix: "/home/agent", backend: home },
      { prefix: "/share/site", backend: disk, external: true },
      { prefix: "/share/reports", backend: { get: (r: string) => m.get(r), list: (r: string) => m.list(r) }, external: true },
    ];
    const tracker = createReadTracker();
    const asked: Detail[] = [];
    const confirming = (answer: boolean) =>
      ({ sessionId: "s1", confirmInteraction: (d: Detail) => { asked.push(d); return Promise.resolve(answer); } }) as unknown as ToolContext;
    return { disk, home, ro: m, tracker, asked, confirming, move: moveFileTool(mounts, tracker) };
  }

  it("asks once when the source is on the disk, and moves after Move", async () => {
    const { disk, tracker, asked, confirming, move } = attached();
    await disk.set!("/a.md", txt);
    tracker.markRead("s1", "/share/site/a.md", 100);
    const out = await move.execute({ source_path: "/share/site/a.md", destination_path: "/share/site/b.md" }, confirming(true));
    expect(out.content).toBe("Moved /share/site/a.md to /share/site/b.md.");
    expect(asked).toEqual([{
      action: "move",
      title: "Move a.md on your disk?",
      message: "The agent wants to move /share/site/a.md to /share/site/b.md.",
      confirmLabel: "Move",
      cancelLabel: "Cancel",
    }]);
    expect(await disk.get("/a.md")).toBeUndefined();
    expect(await disk.get("/b.md")).toBeDefined();
    expect(tracker.readMtime("s1", "/share/site/b.md")).toBe(100);
  });

  it("asks when only the destination is on the disk", async () => {
    const { home, disk, asked, confirming, move } = attached();
    await home.set!("/x.md", txt);
    await move.execute({ source_path: "/home/agent/x.md", destination_path: "/share/site/x.md" }, confirming(true));
    expect(asked).toHaveLength(1);
    expect(await disk.get("/x.md")).toBeDefined();
    expect(await home.get("/x.md")).toBeUndefined();
  });

  it("changes nothing after Cancel or with no callback", async () => {
    const { home, disk, tracker, confirming, move } = attached();
    await disk.set!("/a.md", txt);
    tracker.markRead("s1", "/share/site/a.md", 100);
    const cancelled = await move.execute({ source_path: "/share/site/a.md", destination_path: "/home/agent/a.md" }, confirming(false));
    expect(cancelled.content).toBe("Moving /share/site/a.md was not confirmed by the user; not performed.");
    const blind = await move.execute({ source_path: "/share/site/a.md", destination_path: "/home/agent/a.md" }, ctx);
    expect(blind.content).toBe("Error: moving /share/site/a.md needs the user's confirmation, and this app cannot ask. Not performed.");
    expect(blind.isError).toBe(true);
    expect(await disk.get("/a.md")).toBeDefined();
    expect(await home.get("/a.md")).toBeUndefined();
    expect(tracker.wasRead("s1", "/share/site/a.md")).toBe(true);
  });

  it("rolls back the destination when the source cannot be deleted", async () => {
    const disk = MemoryBackend();
    await disk.set!("/a.md", txt);
    const home = MemoryBackend();
    const failing = { ...disk, delete: () => Promise.reject(new Error("NotAllowedError")) };
    const mounts: VfsMount[] = [
      { prefix: "/home/agent", backend: home },
      { prefix: "/share/site", backend: failing, external: true },
    ];
    const out = await moveFileTool(mounts, createReadTracker()).execute(
      { source_path: "/share/site/a.md", destination_path: "/home/agent/a.md" },
      { sessionId: "s1", confirmInteraction: () => Promise.resolve(true) } as unknown as ToolContext,
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain("NotAllowedError");
    expect(await home.get("/a.md")).toBeUndefined();
  });

  it("never asks for an internal move", async () => {
    const { home, asked, confirming, move } = attached();
    await home.set!("/x.md", txt);
    const out = await move.execute({ source_path: "/home/agent/x.md", destination_path: "/home/agent/y.md" }, confirming(false));
    expect(out.content).toBe("Moved /home/agent/x.md to /home/agent/y.md.");
    expect(asked).toHaveLength(0);
  });

  it("fails before asking for a read-only endpoint or an existing destination", async () => {
    const { home, disk, asked, confirming, move } = attached();
    await home.set!("/x.md", txt);
    await disk.set!("/taken.md", txt);
    const ro = await move.execute({ source_path: "/home/agent/x.md", destination_path: "/share/reports/x.md" }, confirming(true));
    expect(ro.content).toBe("Error: /share/reports/x.md is read-only. The user attached /share/reports read only. Writable paths: /home/agent, /share/site.");
    const taken = await move.execute({ source_path: "/home/agent/x.md", destination_path: "/share/site/taken.md" }, confirming(true));
    expect(taken.content).toBe("Error: /share/site/taken.md already exists.");
    expect(asked).toHaveLength(0);
  });
});
