import type { AttachmentProvider } from "@cuatoi/web-agent-core";

export type Mode = "read only" | "read and write";

export interface Attached {
  prefix: string;
  mode: Mode;
  lineSent: boolean;
  /** The picker or saved handle. Copies have no handle. */
  handle?: FileSystemDirectoryHandle;
}

export interface PendingLine {
  prefix: string;
  kind: "attach" | "remove";
  mode?: Mode;
  text: string;
}

/** `showDirectoryPicker` is not in TypeScript 5.9's DOM lib. */
export type DirectoryPicker = (options: { mode: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;

/** One remembered folder. `name` is the `/share/<name>` it was mounted at. */
export interface SavedFolder {
  name: string;
  mode: Mode;
  handle: FileSystemDirectoryHandle;
}

/** Where the folder button keeps its folders between page loads. Supplied by
 *  the host; without one, a reload forgets every folder. */
export interface FolderStore {
  load(): Promise<SavedFolder[]>;
  save(folders: SavedFolder[]): Promise<void>;
}

export interface AttachFolderOptions {
  store?: FolderStore;
  /** Written to `<folder>/AGENTS.md` when the user attaches a read-and-write
   *  folder that has none. */
  seedAgentsMd?: string;
}

/** A saved folder that is not mounted: waiting for Allow, or gone. */
export interface Waiting extends SavedFolder {
  state: "needs permission" | "unavailable";
}

/** `queryPermission` and `requestPermission` are not in TypeScript 5.9's DOM lib. */
export type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
};

/** The provider the vfs package wires up: the composer button plus what the
 *  chat-start hook in index.ts needs. */
export type FolderProvider = AttachmentProvider & {
  /** Settles once the saved folders are restored (or there is no store). */
  ready: Promise<void>;
  /** The folders mounted right now. */
  mountedFolders(): { prefix: string; mode: Mode }[];
};
