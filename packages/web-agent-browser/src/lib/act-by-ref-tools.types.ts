// 131/002 — the file spec shared by upload-files.ts, action-journal.ts and
// panel-page-tools-network-dialog.ts, plus the bridge's own askMainWorld
// signature. Named for the act-by-ref tools that first introduced FileSpec
// (122/001); not renamed, because three modules still import it by this path.

/** One `page_upload_file` file (124/003). Exactly one content form is set:
 *  `text`, `base64`, or `size` with a one-character `fill`. */
export interface FileSpec {
  name: string;
  mimeType: string;
  text?: string;
  base64?: string;
  size?: number;
  fill?: string;
}

export type FileSpecCheck = { ok: true; files: FileSpec[] } | { ok: false; error: string };

/** bridge.ts's own `askMainWorld` signature. */
export type AskMainWorld = <T>(
  request: Record<string, unknown> & { type: string },
  replyType: string,
  fromReply: (data: unknown) => T,
  timeoutMs?: number,
) => Promise<T>;
