import type { VfsBackend, VfsEntry, VfsFile } from "@cuatoi/web-agent-vfs";
import type { ChromeStorageArea } from "./chrome-storage-backend.types";

export type { ChromeStorageArea } from "./chrome-storage-backend.types";

/** One promise chain per namespace, shared by every backend object built in
 *  this page.
 *
 *  The side panel builds one `<agent-chat-panel>` per agent in the SAME page
 *  (`sidepanel.ts:116` `buildAgentPanel`, driven by the agent switcher), and
 *  every one of them mounts `/home/shared` on the same namespace. Two agents
 *  can therefore start a write at the same moment. Without this chain the
 *  second write reads the index before the first write has stored it, and the
 *  first file's index row is lost. */
const queues = new Map<string, Promise<void>>();

/** Runs `op` after everything already queued for `ns`.
 *
 *  The stored chain never stays rejected: a failed write must not stop the next
 *  one from running. The promise handed back to the caller is the one carrying
 *  `op`'s own rejection, so a `chrome.storage` error reaches the tool
 *  unchanged — which is what lets write_file report "the storage for … is
 *  full." */
function enqueue<T>(ns: string, op: () => Promise<T>): Promise<T> {
  const prev = queues.get(ns) ?? Promise.resolve();
  const result = prev.then(op, op);
  queues.set(
    ns,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/** `size` is `content.length`. Same rule as `entryOf` in
 *  `packages/web-agent-vfs/src/backends/memory.ts:9-17`; repeated here because
 *  that helper is internal to the vfs package and this backend lives in the
 *  extension. Keep the two in step. */
function entryOf(rel: string, file: VfsFile): VfsEntry {
  return {
    path: rel,
    mimeType: file.mimeType,
    encoding: file.encoding,
    mtimeMs: file.mtimeMs,
    size: file.content.length,
  };
}

/** Whether `rel` is at or under `relDir`. Same rule as `isUnder` in
 *  `packages/web-agent-vfs/src/backends/memory.ts:5-7`, repeated for the same
 *  reason. */
function isUnder(rel: string, relDir: string): boolean {
  return relDir === "/" || rel === relDir || rel.startsWith(relDir + "/");
}

/** A `VfsBackend` over one `chrome.storage` area.
 *
 *  `ns` namespaces every key, so two mounts on the same area never collide and
 *  neither collides with the extension's own keys (`agentSettings`,
 *  `savedSkills`, `enabledOrigins`, the agent store).
 *
 *  One file per key, plus one index key holding metadata only. That is what
 *  makes `list` cheap — it never reads a file value — and what keeps a write to
 *  the cost of one file plus the index, rather than rewriting the whole mount.
 */
export function ChromeStorageBackend(area: ChromeStorageArea, ns: string): VfsBackend {
  const fileKey = (rel: string) => `web-agent-vfs:${ns}:f:${rel}`;
  const indexKey = `web-agent-vfs:${ns}:index`;
  const readIndex = async (): Promise<Record<string, VfsEntry>> => {
    const got = await area.get(indexKey);
    return (got[indexKey] ?? {}) as Record<string, VfsEntry>;
  };

  return {
    get: async (rel) => {
      const key = fileKey(rel);
      const got = await area.get(key);
      return got[key] as VfsFile | undefined;
    },
    list: async (relDir) =>
      Object.entries(await readIndex())
        .filter(([rel]) => isUnder(rel, relDir))
        .map(([, entry]) => entry),
    set: (rel, file) =>
      enqueue(ns, async () => {
        const idx = await readIndex();
        idx[rel] = entryOf(rel, file);
        // ONE call, so the file and its index row can never land separately.
        await area.set({ [fileKey(rel)]: file, [indexKey]: idx });
      }),
    delete: (rel) =>
      enqueue(ns, async () => {
        const idx = await readIndex();
        delete idx[rel];
        await area.remove(fileKey(rel));
        await area.set({ [indexKey]: idx });
      }),
  };
}
