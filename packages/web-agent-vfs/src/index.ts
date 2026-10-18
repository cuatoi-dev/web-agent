import type { CustomToolDef } from "@cuatoi/web-agent-core";
import type { VfsFile, VfsHandle, VfsMount, VfsMountInfo, VfsOptions, VfsToolProvider } from "./types.js";
import { buildMounts, canDelete, canWrite, ConfigError, filesUnder, isFolder, overlaps, readOnlyMessage, resolve } from "./mounts.js";
import { normalize } from "./paths.js";
import { mimeFromPath } from "./mime.js";
import { blobFile } from "./blob-file.js";
import { createReadTracker } from "./read-tracker.js";
import { createAgentsMdTracker } from "./agents-md-tracker.js";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { editFileTool } from "./tools/edit-file.js";
import { globFilesTool } from "./tools/glob-files.js";
import { searchFilesTool } from "./tools/search-files.js";
import { deleteFileTool } from "./tools/delete-file.js";
import { moveFileTool } from "./tools/move-file.js";
import { jsonGetTool } from "./tools/json-get.js";
import { jsonEditTool } from "./tools/json-edit.js";
import { attachFolderProvider } from "./attach-folder-provider.js";
import { saveToolResult, TOOL_RESULT_DIR } from "./tool-results.js";

export type { VfsBackend, VfsEntry, VfsFile, VfsHandle, VfsMountInfo, VfsOptions, VfsResolvedEntry, VfsToolProvider } from "./types.js";
export { MemoryBackend } from "./backends/memory.js";
export { StorageBackend } from "./backends/storage.js";
export { DirectoryBackend } from "./backends/directory-handle.js";

/**
 * The agent's virtual file system, as ONE `ToolProvider` for
 * `SessionConfig.toolProviders`.
 *
 * `required: false`: a bad mount configuration means the session runs with no
 * file tools, logged by core, rather than failing to start.
 *
 * The mount table is built inside `load()` or on first `vfs` access, so a
 * `ConfigError` rejects the load or throws on access rather than at import time.
 */
export function vfsTools(options?: VfsOptions): VfsToolProvider {
  let mountsCache: VfsMount[] | null = null;
  let mountError: Error | null = null;
  const tracker = createReadTracker();
  const agentsMdTracker = createAgentsMdTracker();
  const listeners = new Set<() => void>();
  const maxChars = options?.toolResults?.maxChars ?? 12_000;
  const previewChars = options?.toolResults?.previewChars ?? 2_000;

  function getMounts(): VfsMount[] {
    if (mountError) throw mountError;
    if (!mountsCache) {
      try {
        mountsCache = buildMounts(options);
      } catch (e) {
        mountError = e instanceof Error ? e : new Error(String(e));
        throw mountError;
      }
    }
    return mountsCache;
  }

  const vfs: VfsHandle = {
    mounts(): VfsMountInfo[] {
      const ms = getMounts();
      return ms.map((m) => ({
        prefix: m.prefix,
        writable: canWrite(m),
        deletable: canDelete(m),
        external: m.external === true,
        tabScoped: m.prefix === "/tmp" && options?.tmp === undefined,
      }));
    },
    async list(prefix: string) {
      const ms = getMounts();
      return filesUnder(ms, normalize(prefix));
    },
    async get(absPath: string) {
      const ms = getMounts();
      const res = resolve(ms, absPath);
      if (!res.mount || !res.rel) return undefined;
      return res.mount.backend.get(res.rel);
    },
    async write(absPath: string, content: string | Blob) {
      const ms = getMounts();
      const { p, mount, rel } = resolve(ms, absPath);
      if (!mount || !rel) {
        throw new Error(`No mount for ${absPath}`);
      }
      if (!canWrite(mount)) {
        throw new Error(readOnlyMessage(p, mount, ms));
      }
      if (await isFolder(mount, rel)) {
        throw new Error(`Error: ${p} is a folder.`);
      }
      // 127/003 — a direct write is not a tool call, so it neither needs nor
      // updates the read-before-overwrite tracker.
      const file: VfsFile = typeof content === "string"
        ? { content, encoding: "utf8" as const, mimeType: mimeFromPath(p), mtimeMs: Date.now() }
        : await blobFile(content, p);
      await mount.backend.set!(rel, file);
      for (const listener of listeners) listener();
    },
    async delete(absPath: string) {
      const ms = getMounts();
      const res = resolve(ms, absPath);
      if (!res.mount || !res.rel) {
        throw new Error(`File not found: ${absPath}`);
      }
      if (!canDelete(res.mount)) {
        throw new Error(`Cannot delete ${absPath}: mount ${res.mount.prefix} is read-only`);
      }
      await res.mount.backend.delete!(res.rel);
    },
    mount(prefix, backend, opts) {
      const p = normalize(prefix);
      const ms = getMounts();
      if (p === "/" || ms.some((m) => overlaps(p, m.prefix))) {
        throw new ConfigError(`vfs.mount: ${p} overlaps an existing mount`);
      }
      ms.push({ prefix: p, backend, external: opts?.external === true, runtime: true });
      for (const listener of listeners) listener();
    },
    unmount(prefix) {
      const p = normalize(prefix);
      const ms = getMounts();
      const i = ms.findIndex((m) => m.prefix === p && m.runtime === true);
      if (i < 0) return false;
      ms.splice(i, 1);
      tracker.forgetUnder(p);
      for (const listener of listeners) listener();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };

  // 128/003 — the composer's folder button, on the same handle as the tools.
  const folderProvider = attachFolderProvider(vfs);

  return {
    name: "vfs",
    required: false,
    vfs,
    attachmentProviders: [folderProvider],
    hooks: {
      onUserPrompt: async ({ parts, sessionId, firstInChat, displayText }) => {
        if (!firstInChat) return;
        try {
          for (const file of await vfs.list(TOOL_RESULT_DIR)) {
            try { await vfs.delete(file.abs); } catch { /* Continue cleanup. */ }
          }
        } catch { /* Continue prompt handling. */ }
        let res: ReturnType<typeof resolve>;
        try {
          res = resolve(getMounts(), "/home/agent/AGENTS.md");
        } catch {
          return;
        }
        if (!res.mount || !res.rel) return;
        let f: import("./types.js").VfsFile | undefined;
        try {
          f = await res.mount.backend.get(res.rel);
        } catch {
          return;
        }
        if (!f || f.encoding !== "utf8") return;
        agentsMdTracker.record(sessionId, "/home/agent/AGENTS.md", f.mtimeMs);
        const blockText = `<agents-md path="/home/agent/AGENTS.md">\n${f.content}\n</agents-md>`;
        return {
          parts: [{ type: "text", text: blockText + "\n\n" }, ...parts],
          userDisplayText: displayText,
        };
      },
      onPostTool: (payload) => saveToolResult(getMounts, payload, maxChars, previewChars),
    },
    async load(): Promise<CustomToolDef[]> {
      await Promise.resolve();
      const mounts = getMounts();
      return [
        readFileTool(mounts, tracker, agentsMdTracker, maxChars),
        writeFileTool(mounts, tracker, agentsMdTracker),
        editFileTool(mounts, tracker, agentsMdTracker),
        globFilesTool(mounts),
        searchFilesTool(mounts),
        deleteFileTool(mounts, tracker),
        moveFileTool(mounts, tracker),
        jsonGetTool(mounts, tracker),
        jsonEditTool(mounts, tracker),
      ];
    },
  };
}
