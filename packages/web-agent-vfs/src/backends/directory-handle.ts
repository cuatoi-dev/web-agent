import type { VfsBackend, VfsEntry, VfsFile } from "../types.js";
import { basename, dirname, normalize } from "../paths.js";
import { isImageExt, isVisibleFile, mimeFromPath } from "../mime.js";

const SKIPPED = new Set([".git", "node_modules"]);
const WRITE_ERROR = "Only text files and PNG, JPEG, GIF or WebP images can be written.";

function isMissing(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "NotFoundError" || name === "TypeMismatchError";
}

function segmentsOf(rel: string): string[] {
  return normalize(rel).split("/").filter((s) => s !== "");
}

function toBase64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

/**
 * A folder on the user's disk (or any `FileSystemDirectoryHandle`) as a VFS
 * backend. The host supplies a handle it is already allowed to use.
 *
 * Only text files and PNG, JPEG, GIF and WebP images are visible. `.git` and
 * `node_modules` are skipped. Nothing is cached, so every read sees the disk's
 * current modification time. With `writable: false` the backend has no `set`
 * and no `delete`.
 */
export function DirectoryBackend(
  root: FileSystemDirectoryHandle,
  options: { writable: boolean },
): VfsBackend {
  async function directory(rel: string, create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
    const segs = segmentsOf(rel);
    if (segs.some((s) => SKIPPED.has(s))) return undefined;
    let dir = root;
    for (const seg of segs) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create });
      } catch (err) {
        if (isMissing(err)) return undefined;
        throw err;
      }
    }
    return dir;
  }

  async function fileHandle(rel: string, create: boolean): Promise<FileSystemFileHandle | undefined> {
    const segs = segmentsOf(rel);
    if (segs.length === 0 || segs.some((s) => SKIPPED.has(s))) return undefined;
    const parent = await directory(dirname(rel), create);
    if (!parent) return undefined;
    try {
      return await parent.getFileHandle(basename(rel), { create });
    } catch (err) {
      if (isMissing(err)) return undefined;
      throw err;
    }
  }

  async function* walk(dir: FileSystemDirectoryHandle, prefix: string): AsyncGenerator<[string, File]> {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") {
        if (SKIPPED.has(name)) continue;
        yield* walk(handle as FileSystemDirectoryHandle, prefix + name + "/");
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        if (isVisibleFile(name, file.type)) yield [prefix + name, file];
      }
    }
  }

  const backend: VfsBackend = {
    async get(rel: string): Promise<VfsFile | undefined> {
      const h = await fileHandle(rel, false);
      if (!h) return undefined;
      const file = await h.getFile();
      if (!isVisibleFile(basename(rel), file.type)) return undefined;
      const mimeType = mimeFromPath(rel);
      if (isImageExt(rel)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { content: toBase64(bytes), encoding: "base64", mimeType, mtimeMs: file.lastModified };
      }
      return { content: await file.text(), encoding: "utf8", mimeType, mtimeMs: file.lastModified };
    },
    async list(relDir: string): Promise<VfsEntry[]> {
      const start = await directory(relDir, false);
      if (!start) return [];
      const base = normalize(relDir);
      const entries: VfsEntry[] = [];
      for await (const [path, file] of walk(start, base === "/" ? "/" : base + "/")) {
        entries.push({
          path,
          mimeType: mimeFromPath(path),
          encoding: isImageExt(path) ? "base64" : "utf8",
          mtimeMs: file.lastModified,
          size: file.size,
        });
      }
      return entries;
    },
  };

  if (options.writable) {
    backend.set = async (rel: string, file: VfsFile): Promise<void> => {
      if (!isVisibleFile(basename(rel), file.mimeType)) throw new Error(WRITE_ERROR);
      const h = await fileHandle(rel, true);
      if (!h) throw new Error("File does not exist: " + rel);
      const w = await h.createWritable();
      if (file.encoding === "base64") {
        const bin = atob(file.content);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await w.write(bytes);
      } else {
        await w.write(file.content);
      }
      await w.close();
    };
    backend.delete = async (rel: string): Promise<void> => {
      const parent = await directory(dirname(rel), false);
      if (!parent) throw new Error("File does not exist: " + rel);
      try {
        await parent.removeEntry(basename(rel));
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "NotFoundError") {
          throw new Error("File does not exist: " + rel, { cause: err });
        }
        throw err;
      }
    };
  }

  return backend;
}
