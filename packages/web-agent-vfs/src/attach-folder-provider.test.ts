import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AttachmentProvider, ToolContext } from "@cuatoi/web-agent-core";
import { vfsTools } from "./index.js";
import { MemoryBackend } from "./backends/memory.js";

function file(path: string, body: string | Uint8Array, type: string, lastModified = 1000): File {
  const f = new File([body], path.split("/").pop()!, { type, lastModified });
  Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}

function fakeDir(name: string, files: Record<string, string>): FileSystemDirectoryHandle {
  const fileHandle = (n: string) => ({
    kind: "file" as const,
    name: n,
    getFile: () => Promise.resolve(new File([files[n]], n, { type: "text/csv" })),
  });
  return {
    kind: "directory" as const,
    name,
    async *entries() {
      for (const n of Object.keys(files)) {
        await Promise.resolve();
        yield [n, fileHandle(n)] as [string, ReturnType<typeof fileHandle>];
      }
    },
    getDirectoryHandle: () => Promise.reject(Object.assign(new Error("nf"), { name: "NotFoundError" })),
    getFileHandle: (n: string) => {
      if (!(n in files)) return Promise.reject(Object.assign(new Error("nf"), { name: "NotFoundError" }));
      return Promise.resolve(fileHandle(n));
    },
  } as unknown as FileSystemDirectoryHandle;
}

const THREE = { "q3-sales.csv": "a", "q3-costs.csv": "b", "q3-headcount.csv": "c" };

function stubPicker(impl: (o: { mode: string }) => Promise<FileSystemDirectoryHandle>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("showDirectoryPicker", fn);
  vi.stubGlobal("isSecureContext", true);
  return fn;
}

describe("attachFolderProvider", () => {
  let tools: ReturnType<typeof vfsTools>;
  let p: AttachmentProvider;

  beforeEach(() => {
    tools = vfsTools({ tmp: MemoryBackend(), home: MemoryBackend(), shared: MemoryBackend() });
    p = tools.attachmentProviders![0];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const chipTexts = () => [...p.slot!()!.querySelectorAll(".wa-folder-chip span:not(wa-icon)")].map((s) => s.textContent);
  const noticeText = () => p.slot!()!.querySelector(".wa-folder-notice")?.textContent ?? null;
  const payload = { parts: [{ type: "text" as const, text: "Summarise" }], sessionId: "s1", firstInChat: false, displayText: "Summarise" };

  it("choices: two entries with the folder API", () => {
    stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    expect(p.choices!()).toEqual([
      { id: "ro", label: "Attach folder (read only)" },
      { id: "rw", label: "Attach folder (read and write)" },
    ]);
  });

  it("choices: one copy entry without the folder API", () => {
    expect(p.choices!()).toEqual([{ id: "copy", label: "Attach folder (read-only copy)" }]);
  });

  it("choices: one copy entry outside a secure context", () => {
    vi.stubGlobal("showDirectoryPicker", vi.fn());
    vi.stubGlobal("isSecureContext", false);
    expect(p.choices!()).toEqual([{ id: "copy", label: "Attach folder (read-only copy)" }]);
  });

  it("static presentation", () => {
    expect(p.id).toBe("folder");
    expect(p.label).toBe("Attach folder");
    expect(p.icon).toBe("folder");
    expect(p.hasPending()).toBe(false);
  });

  it("pick ro mounts read only", async () => {
    const fn = stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    await p.pick("ro");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ mode: "read" });
    expect(tools.vfs.mounts().find((m) => m.prefix === "/share/reports")).toMatchObject({
      writable: false,
      deletable: false,
      external: true,
    });
    expect(chipTexts()).toEqual(["/share/reports · read only"]);
    expect(p.slot!()!.querySelector('button[aria-label="Remove /share/reports"]')).not.toBeNull();
    expect(p.hasPending()).toBe(false);
  });

  it("pick rw mounts read and write", async () => {
    const fn = stubPicker(() => Promise.resolve(fakeDir("site", { "a.css": "x" })));
    await p.pick("rw");
    expect(fn).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(tools.vfs.mounts().find((m) => m.prefix === "/share/site")).toMatchObject({
      writable: true,
    });
    expect(chipTexts()).toEqual(["/share/site · read and write"]);
  });

  it("same name gets -2 and -3", async () => {
    stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    await p.pick("ro");
    await p.pick("ro");
    await p.pick("ro");
    expect(tools.vfs.mounts().map((m) => m.prefix).filter((x) => x.startsWith("/share/"))).toEqual([
      "/share/reports",
      "/share/reports-2",
      "/share/reports-3",
    ]);
  });

  it("AbortError attaches nothing and shows the notice", async () => {
    stubPicker(() => Promise.reject(new DOMException("x", "AbortError")));
    await p.pick("ro");
    expect(tools.vfs.mounts().filter((m) => m.prefix.startsWith("/share/"))).toEqual([]);
    expect(noticeText()).toBe("No folder was attached.");
    stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    await p.pick("ro");
    expect(noticeText()).toBeNull();
  });

  it("NotAllowedError behaves like AbortError", async () => {
    stubPicker(() => Promise.reject(new DOMException("x", "NotAllowedError")));
    await p.pick("ro");
    expect(tools.vfs.mounts().filter((m) => m.prefix.startsWith("/share/"))).toEqual([]);
    expect(noticeText()).toBe("No folder was attached.");
  });

  it("other picker errors reject", async () => {
    stubPicker(() => Promise.reject(Object.assign(new Error("sec"), { name: "SecurityError" })));
    await expect(p.pick("ro")).rejects.toMatchObject({ name: "SecurityError" });
    expect(noticeText()).toBeNull();
  });

  it("subscribe is notified on attach", async () => {
    stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    const l = vi.fn();
    p.subscribe!(l);
    await p.pick("ro");
    expect(l).toHaveBeenCalled();
  });

  it("the next message carries the attach line and the chip", async () => {
    stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    await p.pick("ro");
    const r = await p.onUserPrompt(payload);
    expect(r).toBeDefined();
    expect(r!.parts[0]).toEqual({
      type: "text",
      text: "The user attached the folder /share/reports (read only, 3 files).\n\n",
    });
    expect(r!.parts.slice(1)).toEqual(payload.parts);
    expect(r!.userDisplayText).toBe("Summarise");
    expect(r!.meta).toEqual({
      attachmentChips: [{ providerId: "folder", label: "/share/reports · read only" }],
    });
    const nextR = await p.onUserPrompt(payload);
    expect(nextR).toBeUndefined();
  });

  it("remove after a send tells the model", async () => {
    stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    await p.pick("ro");
    await p.onUserPrompt(payload);
    const removeBtn = p.slot!()!.querySelector<HTMLButtonElement>('button[aria-label="Remove /share/reports"]')!;
    removeBtn.click();
    expect(tools.vfs.mounts().find((m) => m.prefix === "/share/reports")).toBeUndefined();
    expect(chipTexts()).toEqual([]);
    const r = await p.onUserPrompt(payload);
    expect(r).toBeDefined();
    expect(r!.parts[0].type === "text" && r!.parts[0].text).toBe("The user removed the folder /share/reports.\n\n");
    expect(r!.meta).toBeUndefined();
  });

  it("attach then remove before a send tells nothing", async () => {
    stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    await p.pick("ro");
    const removeBtn = p.slot!()!.querySelector<HTMLButtonElement>('button[aria-label="Remove /share/reports"]')!;
    removeBtn.click();
    const r = await p.onUserPrompt(payload);
    expect(r).toBeUndefined();
  });

  it("two folders, one removed before send", async () => {
    stubPicker((o) => Promise.resolve(o.mode === "readwrite" ? fakeDir("site", { "a.css": "x" }) : fakeDir("reports", THREE)));
    await p.pick("ro");
    await p.pick("rw");
    const removeBtn = p.slot!()!.querySelector<HTMLButtonElement>('button[aria-label="Remove /share/reports"]')!;
    removeBtn.click();
    const r = await p.onUserPrompt(payload);
    expect(r).toBeDefined();
    expect(r!.parts[0].type === "text" && r!.parts[0].text).toBe(
      "The user attached the folder /share/site (read and write, 1 files).\n\n",
    );
    expect(r!.meta).toEqual({
      attachmentChips: [{ providerId: "folder", label: "/share/site · read and write" }],
    });
  });

  it("read_file on a removed folder says it does not exist", async () => {
    stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    await p.pick("ro");
    const tl = await tools.load();
    const removeBtn = p.slot!()!.querySelector<HTMLButtonElement>('button[aria-label="Remove /share/reports"]')!;
    removeBtn.click();
    const readFile = tl.find((t) => t.name === "read_file")!;
    const res = await readFile.execute({ file_path: "/share/reports/q3-sales.csv" }, { sessionId: "s1" } as ToolContext);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Error: /share/reports/q3-sales.csv does not exist.");
  });

  it("copy: attaches through the hidden webkitdirectory input", async () => {
    const input = p.slot!()!.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    expect(input.hidden).toBe(true);
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await p.pick("copy");
    expect(click).toHaveBeenCalledTimes(1);
    Object.defineProperty(input, "files", {
      value: [
        file("reports/a.csv", "x,y", "text/csv"),
        file("reports/b.xlsx", "b", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        file("reports/.git/config", "c", ""),
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(chipTexts()).toEqual(["/share/reports · read only"]));
    expect((await tools.vfs.list("/share/reports")).map((e) => e.abs)).toEqual(["/share/reports/a.csv"]);
    const r = await p.onUserPrompt(payload);
    expect(r!.parts[0].type === "text" && r!.parts[0].text).toBe(
      "The user attached the folder /share/reports (read only, 1 files).\n\n",
    );
  });

  it("copy: every write tool reports read only", async () => {
    const input = p.slot!()!.querySelector('input[type="file"]') as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    await p.pick("copy");
    Object.defineProperty(input, "files", {
      value: [file("reports/a.csv", "x,y", "text/csv")],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(chipTexts()).toEqual(["/share/reports · read only"]));

    const tl = await tools.load();
    const ctx = { sessionId: "s1" } as ToolContext;
    const writeTool = tl.find((t) => t.name === "write_file")!;
    const editTool = tl.find((t) => t.name === "edit_file")!;
    const deleteTool = tl.find((t) => t.name === "delete_file")!;
    const moveTool = tl.find((t) => t.name === "move_file")!;

    const w = await writeTool.execute({ file_path: "/share/reports/new.txt", content: "x" }, ctx);
    expect(w.isError).toBe(true);
    expect(w.content).toContain("is read-only. The user attached /share/reports read only.");

    const e = await editTool.execute({ file_path: "/share/reports/a.csv", old_string: "x", new_string: "z" }, ctx);
    expect(e.isError).toBe(true);
    expect(e.content).toContain("is read-only. The user attached /share/reports read only.");

    const d = await deleteTool.execute({ file_path: "/share/reports/a.csv" }, ctx);
    expect(d.isError).toBe(true);
    expect(d.content).toContain("is read-only. The user attached /share/reports read only.");

    const m = await moveTool.execute({ source_path: "/share/reports/a.csv", destination_path: "/tmp/a.csv" }, ctx);
    expect(m.isError).toBe(true);
    expect(m.content).toContain("is read-only. The user attached /share/reports read only.");
  });

  it("copy: an empty selection shows the notice", async () => {
    const input = p.slot!()!.querySelector('input[type="file"]') as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    await p.pick("copy");
    Object.defineProperty(input, "files", { value: [], configurable: true });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(noticeText()).toBe("Nothing attached: the folder has no files."));
    expect(tools.vfs.mounts().filter((m) => m.prefix.startsWith("/share/"))).toEqual([]);
  });

  it("copy: the input is cleared after each change", async () => {
    const input = p.slot!()!.querySelector('input[type="file"]') as HTMLInputElement;
    vi.spyOn(input, "click").mockImplementation(() => {});
    await p.pick("copy");
    Object.defineProperty(input, "files", {
      value: [file("reports/a.csv", "x,y", "text/csv")],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(chipTexts()).toEqual(["/share/reports · read only"]));
    expect(input.value).toBe("");
  });

  it("pick with no or unknown id does nothing", async () => {
    const fn = stubPicker(() => Promise.resolve(fakeDir("reports", THREE)));
    await p.pick();
    await p.pick("zz");
    expect(tools.vfs.mounts().filter((m) => m.prefix.startsWith("/share/"))).toEqual([]);
    expect(noticeText()).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});
