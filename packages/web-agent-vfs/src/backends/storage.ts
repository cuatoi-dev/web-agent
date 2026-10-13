import type { VfsBackend, VfsEntry, VfsFile } from "../types.js";
import { entryOf, isUnder } from "./memory.js";

/** Parse, treating anything unparsable as absent. A corrupt key must never
 *  throw out of a tool — one bad value cannot break every file. */
function parse<T>(raw: string | null): T | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** A backend over a Web Storage object (`localStorage` or `sessionStorage`).
 *  `prefix` namespaces every key, so two mounts on the same Storage never
 *  collide and neither collides with the host page's own keys. */
export function StorageBackend(storage: Storage, prefix: string): VfsBackend {
  const fileKey = (rel: string) => `${prefix}f:${rel}`;
  const indexKey = `${prefix}index`;
  const readIndex = (): Record<string, VfsEntry> =>
    parse<Record<string, VfsEntry>>(storage.getItem(indexKey)) ?? {};

  return {
    get: (rel) => Promise.resolve(parse<VfsFile>(storage.getItem(fileKey(rel)))),
    list: (relDir) =>
      Promise.resolve(
        Object.entries(readIndex())
          .filter(([rel]) => isUnder(rel, relDir))
          .map(([, entry]) => entry),
      ),
    set: (rel, file) => {
      // A QuotaExceededError from either setItem is passed up unchanged; the
      // tools turn it into "the storage for <prefix> is full."
      storage.setItem(fileKey(rel), JSON.stringify(file));
      const idx = readIndex();
      idx[rel] = entryOf(rel, file);
      storage.setItem(indexKey, JSON.stringify(idx));
      return Promise.resolve();
    },
    delete: (rel) => {
      storage.removeItem(fileKey(rel));
      const idx = readIndex();
      delete idx[rel];
      storage.setItem(indexKey, JSON.stringify(idx));
      return Promise.resolve();
    },
  };
}
