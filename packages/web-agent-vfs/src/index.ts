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
import { bundleHtmlTool } from "./tools/bundle-html.js";
import { attachFolderProvider } from "./attach-folder-provider.js";
import { saveToolResult, TOOL_RESULT_DIR } from "./tool-results.js";
import { memoryBlocks, MEMORY_PROMPT_SNIPPET, resolveMemoryOptions } from "./user-memory.js";

export type { MemoryOptions, ResolvedMemory, VfsBackend, VfsEntry, VfsFile, VfsHandle, VfsMountInfo, VfsOptions, VfsResolvedEntry, VfsToolProvider } from "./types.js";
export type { FolderStore, SavedFolder } from "./attach-folder-provider.types.js";
export { memorySkills } from "./memory-skills.js";
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
  // 104/001 — null when the host did not turn memory on.
  const memory = resolveMemoryOptions(options?.memory);

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
  const folderProvider = attachFolderProvider(vfs, { store: options?.folderStore, seedAgentsMd: options?.seedAgentsMd });

  return {
    name: "vfs",
    required: false,
    vfs,
    // 104/002 — `memorySkills(vfs)` reads this back, so the skill text names
    // the configured paths and limits. Null when memory is off.
    memory,
    attachmentProviders: [folderProvider],
    hooks: {
      onUserPrompt: async ({ parts, sessionId, firstInChat, displayText }) => {
        if (!firstInChat) return;
        try {
          for (const file of await vfs.list(TOOL_RESULT_DIR)) {
            try { await vfs.delete(file.abs); } catch { /* Continue cleanup. */ }
          }
        } catch { /* Continue prompt handling. */ }
        // 127/007 — the restore must finish first, so a remembered folder's
        // AGENTS.md is in the first message after a reload.
        await folderProvider.ready;
        const paths = [
          "/home/agent/AGENTS.md",
          ...folderProvider.mountedFolders().map((m) => `${m.prefix}/AGENTS.md`),
        ];
        const blocks: string[] = [];
        for (const path of paths) {
          let res: ReturnType<typeof resolve>;
          try {
            res = resolve(getMounts(), path);
          } catch {
            return;
          }
          if (!res.mount || !res.rel) continue;
          let f: import("./types.js").VfsFile | undefined;
          try {
            f = await res.mount.backend.get(res.rel);
          } catch {
            continue;
          }
          if (!f || f.encoding !== "utf8") continue;
          agentsMdTracker.record(sessionId, path, f.mtimeMs);
          blocks.push(`<agents-md path="${path}">\n${f.content}\n</agents-md>`);
        }
        // 104/001 — memory blocks go after every AGENTS.md block, in the same
        // prepended text part. getMounts() already succeeded in the loop above:
        // "/home/agent/AGENTS.md" is always in `paths`, and a mount error
        // returned from the hook there.
        if (memory) blocks.push(...(await memoryBlocks(getMounts(), memory)));
        if (blocks.length === 0) return;
        return {
          parts: [{ type: "text", text: blocks.join("\n\n") + "\n\n" }, ...parts],
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
        // 104/001 — one memory guideline line, only when memory is on.
        // write_file carries it because read_file already carries the
        // <agents-md> snippet and a tool def holds one snippet.
        memory
          ? { ...writeFileTool(mounts, tracker, agentsMdTracker), promptSnippet: MEMORY_PROMPT_SNIPPET }
          : writeFileTool(mounts, tracker, agentsMdTracker),
        editFileTool(mounts, tracker, agentsMdTracker),
        globFilesTool(mounts),
        searchFilesTool(mounts),
        deleteFileTool(mounts, tracker),
        moveFileTool(mounts, tracker),
        jsonGetTool(mounts, tracker),
        jsonEditTool(mounts, tracker),
        bundleHtmlTool(vfs),
      ];
    },
  };
}
