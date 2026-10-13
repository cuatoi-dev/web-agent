export type Mode = "read only" | "read and write";

export interface Attached {
  prefix: string;
  mode: Mode;
  lineSent: boolean;
}

export interface PendingLine {
  prefix: string;
  kind: "attach" | "remove";
  mode?: Mode;
  text: string;
}

/** `showDirectoryPicker` is not in TypeScript 5.9's DOM lib. */
export type DirectoryPicker = (options: { mode: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
