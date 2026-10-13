import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { deleteFileTool } from "./delete-file.js";
import { globFilesTool } from "./glob-files.js";
import { createReadTracker } from "../read-tracker.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsMount } from "../types.js";

const ctx = { sessionId: "s1" } as unknown as ToolContext;

describe("delete_file", () => {
  it("D1 — deletes file successfully and disappears from glob and read tracker", async () => {
    const backend = MemoryBackend();
    await backend.set!("/notes.md", { content: "text", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });

    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend }];
    const tracker = createReadTracker();
    tracker.markRead("s1", "/home/agent/notes.md", 100);
    expect(tracker.wasRead("s1", "/home/agent/notes.md")).toBe(true);

    const delTool = deleteFileTool(mounts, tracker);
    const globTool = globFilesTool(mounts);

    const out = await delTool.execute({ file_path: "/home/agent/notes.md" }, ctx);
    expect(out.content).toBe("Deleted /home/agent/notes.md.");
    expect(out.isError).toBeUndefined();

    // Check backend
    const existing = await backend.get("/notes.md");
    expect(existing).toBeUndefined();

    // Check tracker
    expect(tracker.wasRead("s1", "/home/agent/notes.md")).toBe(false);

    // Check glob
    const globRes = await globTool.execute({ pattern: "*.md" }, ctx);
    expect(globRes.content).toBe("No files found.");
  });

  it("D2 — rejects folder, missing file, and read-only mount", async () => {
    const backend = MemoryBackend();
    await backend.set!("/notes/a.md", { content: "text", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 100 });

    const readOnlyBackend = {
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
    };

    const mounts: VfsMount[] = [
      { prefix: "/home/agent", backend },
      { prefix: "/ro", backend: readOnlyBackend },
    ];
    const tracker = createReadTracker();
    const tool = deleteFileTool(mounts, tracker);

    // Folder target
    const folderRes = await tool.execute({ file_path: "/home/agent/notes" }, ctx);
    expect(folderRes.isError).toBe(true);
    expect(folderRes.content).toBe("Error: /home/agent/notes is a folder; delete_file removes one file.");

    // Missing file
    const missingRes = await tool.execute({ file_path: "/home/agent/missing.md" }, ctx);
    expect(missingRes.isError).toBe(true);
    expect(missingRes.content).toBe("Error: /home/agent/missing.md does not exist.");

    // Read-only mount
    const roRes = await tool.execute({ file_path: "/ro/a.md" }, ctx);
    expect(roRes.isError).toBe(true);
    expect(roRes.content).toBe("Error: /ro/a.md is read-only. Writable paths: /home/agent.");
  });

  it("D3 — phrase reports deleted or could not delete", () => {
    const tool = deleteFileTool([], createReadTracker());
    expect(tool.phrase!({ input: { file_path: "/home/agent/a.md" }, outcomeSummary: "Deleted /home/agent/a.md.", failed: false }, "tesagent")).toBe(
      "tesagent deleted /home/agent/a.md",
    );
    expect(tool.phrase!({ input: { file_path: "/home/agent/a.md" }, outcomeSummary: "Error: nope", failed: true }, "tesagent")).toBe(
      "tesagent could not delete /home/agent/a.md",
    );
  });
});

describe("delete_file on an attached folder", () => {
  const txt = { content: "body{}", encoding: "utf8" as const, mimeType: "text/css", mtimeMs: 100 };
  type Detail = Parameters<NonNullable<ToolContext["confirmInteraction"]>>[0];

  function attached(writable = true) {
    const disk = MemoryBackend();
    const home = MemoryBackend();
    const view = writable ? disk : { get: (r: string) => disk.get(r), list: (r: string) => disk.list(r) };
    const mounts: VfsMount[] = [
      { prefix: "/home/agent", backend: home },
      { prefix: "/share/site", backend: view, external: true },
    ];
    const tracker = createReadTracker();
    const asked: Detail[] = [];
    const confirming = (answer: boolean) =>
      ({ sessionId: "s1", confirmInteraction: (d: Detail) => { asked.push(d); return Promise.resolve(answer); } }) as unknown as ToolContext;
    return { disk, home, tracker, asked, confirming, del: deleteFileTool(mounts, tracker) };
  }

  it("asks with the approved wording, and deletes after Delete", async () => {
    const { disk, tracker, asked, confirming, del } = attached();
    await disk.set!("/old.css", txt);
    tracker.markRead("s1", "/share/site/old.css", 100);
    const out = await del.execute({ file_path: "/share/site/old.css" }, confirming(true));
    expect(out.content).toBe("Deleted /share/site/old.css.");
    expect(asked).toEqual([{
      action: "delete",
      title: "Delete old.css from your disk?",
      message: "The agent wants to delete /share/site/old.css. This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      danger: true,
    }]);
    expect(await disk.get("/old.css")).toBeUndefined();
    expect(tracker.wasRead("s1", "/share/site/old.css")).toBe(false);
  });

  it("keeps the file and the read record after Cancel", async () => {
    const { disk, tracker, confirming, del } = attached();
    await disk.set!("/old.css", txt);
    tracker.markRead("s1", "/share/site/old.css", 100);
    const out = await del.execute({ file_path: "/share/site/old.css" }, confirming(false));
    expect(out.content).toBe("Deleting /share/site/old.css was not confirmed by the user; not performed.");
    expect(await disk.get("/old.css")).toBeDefined();
    expect(tracker.wasRead("s1", "/share/site/old.css")).toBe(true);
  });

  it("fails closed when the app cannot ask", async () => {
    const { disk, del } = attached();
    await disk.set!("/old.css", txt);
    const out = await del.execute({ file_path: "/share/site/old.css" }, ctx);
    expect(out.content).toBe("Error: deleting /share/site/old.css needs the user's confirmation, and this app cannot ask. Not performed.");
    expect(out.isError).toBe(true);
    expect(await disk.get("/old.css")).toBeDefined();
  });

  it("does not ask for an internal file", async () => {
    const { home, asked, confirming, del } = attached();
    await home.set!("/a.css", txt);
    const out = await del.execute({ file_path: "/home/agent/a.css" }, confirming(false));
    expect(out.content).toBe("Deleted /home/agent/a.css.");
    expect(asked).toHaveLength(0);
  });

  it("fails before asking for a read-only folder, a missing file and a folder", async () => {
    const ro = attached(false);
    await ro.disk.set!("/old.css", txt);
    const a = await ro.del.execute({ file_path: "/share/site/old.css" }, ro.confirming(true));
    expect(a.content).toBe("Error: /share/site/old.css is read-only. The user attached /share/site read only. Writable paths: /home/agent.");
    const rw = attached();
    await rw.disk.set!("/d/x.css", txt);
    const b = await rw.del.execute({ file_path: "/share/site/missing.css" }, rw.confirming(true));
    expect(b.content).toBe("Error: /share/site/missing.css does not exist.");
    const c = await rw.del.execute({ file_path: "/share/site/d" }, rw.confirming(true));
    expect(c.content).toContain("is a folder");
    expect(ro.asked.length + rw.asked.length).toBe(0);
  });
});
