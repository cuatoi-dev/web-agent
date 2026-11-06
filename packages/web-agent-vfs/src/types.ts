// Every shape the VFS declares: the file record, the directory entry, the
// host-implemented backend, the mount table and the factory options.

/** One stored file. `content` is UTF-8 text, or base64 when `encoding` is
 *  "base64" (images only — see IMAGE_TYPES in mime.ts). */
export interface VfsFile {
  content: string;
  encoding: "utf8" | "base64";
  mimeType: string;
  mtimeMs: number;
}

/** One file's metadata, with no content. `path` is mount-relative and starts
 *  with "/". `size` is `content.length` for the built-in backends and the
 *  file's byte size for a folder on the user's disk. */
export interface VfsEntry {
  path: string;
  mimeType: string;
  encoding: "utf8" | "base64";
  mtimeMs: number;
  size: number;
}

/** Metadata of an entry with its absolute path and originating mount. */
export interface VfsResolvedEntry extends VfsEntry {
  abs: string;
  mount: VfsMount;
  rel: string;
}

/** A store behind one mount. `set` absent = read-only; `delete` absent =
 *  cannot delete. Same optional-method pattern as core's SkillRegistry. */
export interface VfsBackend {
  get(rel: string): Promise<VfsFile | undefined>;
  /** Every file at or under `relDir`, metadata only. `relDir` is "/" for the
   *  whole mount. */
  list(relDir: string): Promise<VfsEntry[]>;
  set?(rel: string, file: VfsFile): Promise<void>;
  delete?(rel: string): Promise<void>;
}

/** One row of the mount table. `prefix` is a normalised absolute path. */
export interface VfsMount {
  prefix: string;
  backend: VfsBackend;
  /** True when the files live on the user's disk. */
  external?: boolean;
  /** True for a mount added by `VfsHandle.mount`; only these can be removed. */
  runtime?: boolean;
}

/** What `resolve()` returns. `mount` is null when no mount covers the path;
 *  `rel` is then undefined. */
export interface VfsResolution {
  p: string;
  mount: VfsMount | null;
  rel?: string;
}

/** 104/001 — agent memory files loaded into the first message of a chat.
 *  `memory: true` is the same as `memory: {}`: every default applies. */
export interface MemoryOptions {
  /** Default "/home/shared/USER.md". */
  userPath?: string;
  /** Default "/home/agent/MEMORY.md". */
  memoryPath?: string;
  /** Default 2000. Longer content is cut, with a note. */
  userMaxChars?: number;
  /** Default 4000. Longer content is cut, with a note. */
  memoryMaxChars?: number;
  /** Default true. When USER.md is missing, add a hint to offer onboarding. */
  onboarding?: boolean;
}

export type ResolvedMemory = Required<MemoryOptions>;

/** `vfsTools(options)`. Each of the three defaults can be replaced, and
 *  `mounts` adds host mounts at any free path. */
export interface VfsOptions {
  /** Remembers attached folders across page loads. */
  folderStore?: import("./attach-folder-provider.types.js").FolderStore;
  /** Starter for writable attached folders without AGENTS.md. */
  seedAgentsMd?: string;
  toolResults?: { maxChars?: number; previewChars?: number };
  tmp?: VfsBackend;
  home?: VfsBackend;
  shared?: VfsBackend;
  mounts?: Record<string, VfsBackend>;
  /** Absent or false = memory off. */
  memory?: boolean | MemoryOptions;
}

/** The per-chat record of which files were read. Keyed by
 *  `ToolContext.sessionId`, or "" when the host supplies none. */
export interface ReadTracker {
  markRead(sessionId: string | undefined, p: string, mtimeMs: number): void;
  readMtime(sessionId: string | undefined, p: string): number | undefined;
  wasRead(sessionId: string | undefined, p: string): boolean;
  forget(sessionId: string | undefined, p: string): void;
  moveRead(sessionId: string | undefined, from: string, to: string): void;
  /** Forgets every read of `prefix` or a path under it, in every chat. */
  forgetUnder(prefix: string): void;
}

/** Public metadata for one mount exposed by the vfs handle. */
export interface VfsMountInfo {
  prefix: string;
  writable: boolean;
  deletable: boolean;
  external: boolean;
  tabScoped?: boolean;
}

/** The direct programmatic handle on the virtual file system. */
export interface VfsHandle {
  mounts(): VfsMountInfo[];
  list(prefix: string): Promise<VfsResolvedEntry[]>;
  get(absPath: string): Promise<VfsFile | undefined>;
  /** Writes directly, overwriting without the tools' read tracker. */
  write(absPath: string, content: string | Blob): Promise<void>;
  delete(absPath: string): Promise<void>;
  /** Adds a mount at run time. Throws ConfigError when `prefix` overlaps one. */
  mount(prefix: string, backend: VfsBackend, options?: { external?: boolean }): void;
  /** Removes a mount added by `mount`. Returns false when there is none. */
  unmount(prefix: string): boolean;
  /** Calls `listener` after every mount or unmount, and after every successful
   *  `write`. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** ToolProvider returned by vfsTools() carrying the extra vfs handle. */
export type VfsToolProvider = import("@cuatoi/web-agent-core").ToolProvider & {
  vfs: VfsHandle;
};

