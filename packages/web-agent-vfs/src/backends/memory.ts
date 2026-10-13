import type { VfsBackend, VfsEntry, VfsFile } from "../types.js";

/** Entries of `m` at or under `relDir`. Shared by both backends so the two
 *  agree on what "under" means. */
export function isUnder(rel: string, relDir: string): boolean {
  return relDir === "/" || rel === relDir || rel.startsWith(relDir + "/");
}

export function entryOf(rel: string, file: VfsFile): VfsEntry {
  return {
    path: rel,
    mimeType: file.mimeType,
    encoding: file.encoding,
    mtimeMs: file.mtimeMs,
    size: file.content.length,
  };
}

/** An in-memory backend, for tests and for a host that wants a scratch
 *  mount. No quota. */
export function MemoryBackend(): VfsBackend {
  const files = new Map<string, VfsFile>();
  return {
    get: (rel) => Promise.resolve(files.get(rel)),
    list: (relDir) =>
      Promise.resolve(
        [...files.entries()]
          .filter(([rel]) => isUnder(rel, relDir))
          .map(([rel, file]) => entryOf(rel, file)),
      ),
    set: (rel, file) => {
      files.set(rel, file);
      return Promise.resolve();
    },
    delete: (rel) => {
      files.delete(rel);
      return Promise.resolve();
    },
  };
}
