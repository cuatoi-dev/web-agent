import type { VfsBackend, VfsEntry, VfsFile } from "../types.js";
import { isImageExt, isVisibleFile, mimeFromPath } from "../mime.js";
import { isUnder } from "./memory.js";

const SKIPPED = new Set([".git", "node_modules"]);

/** Reads one file: images as base64 (no data-URL prefix), everything else
 *  as text. FileReader works in every browser and in jsdom. */
function readFile(f: File, asBase64: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const out = typeof r.result === "string" ? r.result : "";
      resolve(asBase64 ? out.slice(out.indexOf(",") + 1) : out);
    };
    r.onerror = () => reject(r.error ?? new Error(`Cannot read ${f.name}`));
    if (asBase64) r.readAsDataURL(f);
    else r.readAsText(f);
  });
}

/**
 * A read-only copy of a folder the user chose through
 * `<input type="file" webkitdirectory>`. Every visible file's content is
 * read when the backend is created, so a later change on disk is not seen.
 * Visibility is the same rule as `DirectoryBackend`: text and the four
 * image types, and nothing under `.git` or `node_modules`. No `set`, no
 * `delete`.
 */
export async function FileListBackend(files: File[]): Promise<VfsBackend> {
  const store = new Map<string, { file: VfsFile; size: number }>();
  await Promise.all(files.map(async (f) => {
    const segs = f.webkitRelativePath.split("/");
    if (segs.some((s) => SKIPPED.has(s))) return;
    const rel = "/" + segs.slice(1).join("/");
    const name = segs[segs.length - 1];
    if (!isVisibleFile(name, f.type)) return;
    const image = isImageExt(name);
    const content = await readFile(f, image);
    store.set(rel, {
      file: { content, encoding: image ? "base64" : "utf8", mimeType: mimeFromPath(rel), mtimeMs: f.lastModified },
      size: f.size,
    });
  }));
  return {
    get: (rel) => Promise.resolve(store.get(rel)?.file),
    list: (relDir) =>
      Promise.resolve(
        [...store.entries()]
          .filter(([rel]) => isUnder(rel, relDir))
          .map(([rel, { file, size }]): VfsEntry => ({
            path: rel, mimeType: file.mimeType, encoding: file.encoding, mtimeMs: file.mtimeMs, size,
          })),
      ),
  };
}
