import { describe, expect, it } from "vitest";
import { MemoryBackend } from "@cuatoi/web-agent-vfs";
import { testVfs } from "./test-vfs";
import { basename, formatSize, mimeFromPath, resolveFiles } from "./upload-files";

const FORM_ERROR = (label: string) => `File "${label}": pass exactly one of text, base64, size and fill, or path.`;

describe("upload-files", () => {
  it("U2.1: empty array or undefined returns error", async () => {
    const vfs = testVfs();
    expect(await resolveFiles([], vfs)).toEqual({ ok: false, error: "Pass at least one file." });
    expect(await resolveFiles(undefined, vfs)).toEqual({ ok: false, error: "Pass at least one file." });
  });

  it("U2.2: multiple forms (text+base64, path+text, path+base64, path+size+fill) return form error", async () => {
    const vfs = testVfs();
    await vfs.write("/home/agent/notes.md", "hello");
    expect(await resolveFiles([{ name: "a", mimeType: "text/plain", text: "hi", base64: "aGk=" }], vfs)).toEqual({
      ok: false,
      error: FORM_ERROR("a"),
    });
    for (const extra of [{ text: "hi" }, { base64: "aGk=" }, { size: 4, fill: "A" }]) {
      expect(await resolveFiles([{ path: "/home/agent/notes.md", ...extra }], vfs)).toEqual({
        ok: false,
        error: FORM_ERROR("/home/agent/notes.md"),
      });
    }
  });

  it("U2.3: size without fill and fill without size return form error (inline or with path)", async () => {
    const vfs = testVfs();
    expect(await resolveFiles([{ name: "a", mimeType: "text/plain", size: 10 }], vfs)).toEqual({
      ok: false,
      error: FORM_ERROR("a"),
    });
    expect(await resolveFiles([{ name: "a", mimeType: "text/plain", fill: "A" }], vfs)).toEqual({
      ok: false,
      error: FORM_ERROR("a"),
    });
    expect(await resolveFiles([{ path: "/home/agent/notes.md", size: 10 }], vfs)).toEqual({
      ok: false,
      error: FORM_ERROR("/home/agent/notes.md"),
    });
  });

  it("U2.4: no content form returns form error", async () => {
    const vfs = testVfs();
    expect(await resolveFiles([{ name: "a", mimeType: "text/plain" }], vfs)).toEqual({
      ok: false,
      error: FORM_ERROR("a"),
    });
    expect(await resolveFiles([{}], vfs)).toEqual({ ok: false, error: FORM_ERROR("") });
  });

  it("U2.5: fill with more than one character returns fill error", async () => {
    const vfs = testVfs();
    expect(
      await resolveFiles([{ name: "a", mimeType: "application/octet-stream", size: 3, fill: "AB" }], vfs),
    ).toEqual({ ok: false, error: 'File "a": fill must be one character.' });
  });

  it("U2.6: exceeding MAX_UPLOAD_BYTES returns limit error", async () => {
    const vfs = testVfs();
    expect(
      await resolveFiles([{ name: "a", mimeType: "application/octet-stream", size: 11534336, fill: "A" }], vfs),
    ).toEqual({ ok: false, error: "Uploads are limited to 10 MB in total." });
  });

  it("U2.7: exactly 10 MB succeeds", async () => {
    const vfs = testVfs();
    const res = await resolveFiles(
      [{ name: "a", mimeType: "application/octet-stream", size: 10485760, fill: "A" }],
      vfs,
    );
    expect(res.ok).toBe(true);
  });

  it("U2.8: UTF-8 multibyte characters count towards byte total", async () => {
    const vfs = testVfs();
    const res = await resolveFiles(
      [
        { name: "a", mimeType: "application/octet-stream", size: 10485759, fill: "A" },
        { name: "b", mimeType: "text/plain", text: "é" },
      ],
      vfs,
    );
    expect(res).toEqual({ ok: false, error: "Uploads are limited to 10 MB in total." });
  });

  it("U2.9: base64 decoded length counts towards byte total", async () => {
    const vfs = testVfs();
    const res = await resolveFiles(
      [
        { name: "a", mimeType: "application/octet-stream", size: 10485758, fill: "A" },
        { name: "b", mimeType: "application/octet-stream", base64: "aGk=" },
      ],
      vfs,
    );
    expect(res.ok).toBe(true);
  });

  it("U2.10: inline ok result keeps only the chosen content fields and undefined source", async () => {
    const vfs = testVfs();
    const res = await resolveFiles([{ name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" }], vfs);
    expect(res).toEqual({
      ok: true,
      files: [{ name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" }],
      sources: [undefined],
    });
  });

  it("U2.11: formatSize formats bytes, KB and MB", () => {
    expect(formatSize(8)).toBe("8 B");
    expect(formatSize(2150)).toBe("2.1 KB");
    expect(formatSize(5242880)).toBe("5.0 MB");
  });

  it("U2.12: inline file missing name or mimeType returns pass name and mimeType error", async () => {
    const vfs = testVfs();
    expect(await resolveFiles([{ mimeType: "text/plain", text: "hi" }], vfs)).toEqual({
      ok: false,
      error: 'File "": pass name and mimeType.',
    });
    expect(await resolveFiles([{ name: "a.txt", text: "hi" }], vfs)).toEqual({
      ok: false,
      error: 'File "a.txt": pass name and mimeType.',
    });
  });

  it("U2.13: path resolves a saved base64 PNG screenshot with default name and image/png", async () => {
    const vfs = testVfs();
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const shotPath = "/tmp/screenshots/2026-11-06-120300-tab42.png";
    await vfs.write(shotPath, new Blob([pngBytes], { type: "image/png" }));

    const res = await resolveFiles([{ path: shotPath }], vfs);
    expect(res).toEqual({
      ok: true,
      files: [
        {
          name: "2026-11-06-120300-tab42.png",
          mimeType: "image/png",
          base64: btoa(String.fromCharCode(...pngBytes)),
        },
      ],
      sources: [shotPath],
    });
  });

  it("U2.14: path resolves a UTF-8 markdown file with text/markdown", async () => {
    const vfs = testVfs();
    await vfs.write("/home/agent/notes.md", "# Café\n");

    const res = await resolveFiles([{ path: "/home/agent/notes.md" }], vfs);
    expect(res).toEqual({
      ok: true,
      files: [{ name: "notes.md", mimeType: "text/markdown", text: "# Café\n" }],
      sources: ["/home/agent/notes.md"],
    });
  });

  it("U2.15: name and mimeType override path defaults; unknown or missing extension defaults to application/octet-stream", async () => {
    const vfs = testVfs();
    await vfs.write("/home/agent/notes.md", "hello");
    await vfs.write("/home/agent/raw.bin", "payload");
    await vfs.write("/home/agent/README", "readme");

    expect(
      await resolveFiles([{ path: "/home/agent/notes.md", name: "renamed.txt", mimeType: "text/plain" }], vfs),
    ).toEqual({
      ok: true,
      files: [{ name: "renamed.txt", mimeType: "text/plain", text: "hello" }],
      sources: ["/home/agent/notes.md"],
    });

    expect(await resolveFiles([{ path: "/home/agent/raw.bin" }, { path: "/home/agent/README" }], vfs)).toEqual({
      ok: true,
      files: [
        { name: "raw.bin", mimeType: "application/octet-stream", text: "payload" },
        { name: "README", mimeType: "application/octet-stream", text: "readme" },
      ],
      sources: ["/home/agent/raw.bin", "/home/agent/README"],
    });
  });

  it("U2.16: one call mixes a path file and an inline CSV", async () => {
    const vfs = testVfs();
    await vfs.write("/home/agent/notes.md", "note");

    const res = await resolveFiles(
      [{ path: "/home/agent/notes.md" }, { name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" }],
      vfs,
    );
    expect(res).toEqual({
      ok: true,
      files: [
        { name: "notes.md", mimeType: "text/markdown", text: "note" },
        { name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" },
      ],
      sources: ["/home/agent/notes.md", undefined],
    });
  });

  it("U2.17: missing path, unmounted path, mount root, and folder path return No file at error", async () => {
    const vfs = testVfs();
    await vfs.write("/home/agent/dir/inside.txt", "x");

    for (const bad of ["/home/agent/missing.md", "/unmounted/a.txt", "/home/agent", "/home/agent/dir"]) {
      expect(await resolveFiles([{ path: bad }], vfs)).toEqual({
        ok: false,
        error: `No file at ${bad}. Use glob_files to find it.`,
      });
    }
  });

  it("U2.18: vfs.get rejection (including relative path) returns Cannot read error", async () => {
    const vfs = testVfs();
    const rel = await resolveFiles([{ path: "relative/notes.md" }], vfs);
    expect(rel.ok).toBe(false);
    if (!rel.ok) expect(rel.error).toMatch(/^Cannot read relative\/notes\.md: /);

    const brokenVfs = { ...vfs, get: () => Promise.reject(new Error("disk disconnected")) };
    expect(await resolveFiles([{ path: "/share/docs/a.txt" }], brokenVfs)).toEqual({
      ok: false,
      error: "Cannot read /share/docs/a.txt: disk disconnected",
    });
  });

  it("U2.19: path files exceeding 10 MB in total return 10 MB error", async () => {
    const vfs = testVfs();
    const sixMb = "A".repeat(6 * 1024 * 1024);
    await vfs.write("/home/agent/part1.txt", sixMb);
    await vfs.write("/home/agent/part2.txt", sixMb);

    expect(
      await resolveFiles([{ path: "/home/agent/part1.txt" }, { path: "/home/agent/part2.txt" }], vfs),
    ).toEqual({ ok: false, error: "Uploads are limited to 10 MB in total." });
  });

  it("U2.20: file in a runtime-mounted /share/<name> folder resolves by path", async () => {
    const vfs = testVfs();
    const share = MemoryBackend();
    await share.set!("/report.csv", {
      content: "id,total\n1,42\n",
      encoding: "utf8",
      mimeType: "text/csv",
      mtimeMs: 1,
    });
    vfs.mount("/share/reports", share, { external: true });

    expect(await resolveFiles([{ path: "/share/reports/report.csv" }], vfs)).toEqual({
      ok: true,
      files: [{ name: "report.csv", mimeType: "text/csv", text: "id,total\n1,42\n" }],
      sources: ["/share/reports/report.csv"],
    });
  });

  it("U2.21: basename and mimeFromPath handle nested paths, uppercase extensions, and dotfiles", () => {
    expect(basename("/tmp/screenshots/a.png")).toBe("a.png");
    expect(basename("/home/agent/sub/../notes.md")).toBe("notes.md");
    expect(basename("/")).toBe("");
    expect(mimeFromPath("/tmp/a.PNG")).toBe("image/png");
    expect(mimeFromPath("/home/agent/notes.MD")).toBe("text/markdown");
    expect(mimeFromPath("/home/agent/.env")).toBeUndefined();
    expect(mimeFromPath("/home/agent/unknown.xyz")).toBeUndefined();
  });
});
