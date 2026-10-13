import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import type { ReadTracker, VfsMount } from "../types.js";
import { canWrite, isFolder, readOnlyMessage, resolve } from "../mounts.js";
import { basename, VfsPathError } from "../paths.js";
import type { AgentsMdTracker } from "../agents-md-tracker.js";
import { IMAGE_TYPES, isVisibleFile, mimeFromPath } from "../mime.js";
import { WRITE_FILE_DESCRIPTION, WRITE_FILE_SCHEMA } from "./schemas.js";

/** True for text that is valid base64. `atob` is the browser's own decoder
 *  and jsdom provides it, so no dependency is needed. */
export function isBase64(s: string): boolean {
  try {
    atob(s);
    return true;
  } catch {
    return false;
  }
}

/** The one quota message both write_file and edit_file produce. */
export function writeFailure(p: string, prefix: string, err: unknown): ToolOutcome {
  const e = err as { name?: string; message?: string };
  const why = e?.name === "QuotaExceededError"
    ? `the storage for ${prefix} is full.`
    : String(e?.message ?? err);
  return { content: `Error: could not write ${p}: ${why}`, isError: true };
}

const EXTERNAL_WRITE_ERROR = "Error: Only text files and PNG, JPEG, GIF or WebP images can be written.";

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

export function writeFileTool(mounts: VfsMount[], tracker: ReadTracker, agentsMdTracker?: AgentsMdTracker): CustomToolDef {
  return {
    name: "write_file",
    description: WRITE_FILE_DESCRIPTION,
    inputSchema: WRITE_FILE_SCHEMA,
    execute: async (input, ctx) => {
      let p: string, mount: VfsMount | null, rel: string | undefined;
      try {
        ({ p, mount, rel } = resolve(mounts, input.file_path));
      } catch (err) {
        return fail(err instanceof VfsPathError ? err.message : String(err));
      }
      if (!canWrite(mount) || !mount || !rel) {
        return fail(readOnlyMessage(p, mount, mounts));
      }
      if (await isFolder(mount, rel)) {
        return fail(`Error: ${p} is a folder.`);
      }
      const encoding = input.encoding === "base64" ? "base64" : "utf8";
      const content = typeof input.content === "string" ? input.content : "";
      let mimeType: string;
      if (encoding === "base64") {
        const mimeType_ = typeof input.mime_type === "string" ? input.mime_type : undefined;
        if (!mimeType_) {
          return fail("Error: mime_type is required when encoding is base64.");
        }
        if (!IMAGE_TYPES.includes(mimeType_)) {
          return fail(mount.external
            ? EXTERNAL_WRITE_ERROR
            : `Error: binary files must be images (image/png, image/jpeg, image/gif, image/webp). Got ${mimeType_}.`);
        }
        if (!isBase64(content)) {
          return fail("Error: content is not valid base64.");
        }
        mimeType = mimeType_;
      } else {
        mimeType = typeof input.mime_type === "string" ? input.mime_type : mimeFromPath(p);
      }
      if (mount.external && !isVisibleFile(basename(p), mimeType)) {
        return fail(EXTERNAL_WRITE_ERROR);
      }
      const existing = await mount.backend.get(rel);
      if (existing && !tracker.wasRead(ctx.sessionId, p)) {
        return fail(`Error: ${p} already exists and has not been read in this chat. Read it with read_file first.`);
      }
      const readMtime = tracker.readMtime(ctx.sessionId, p);
      if (mount.external && existing && readMtime !== undefined && existing.mtimeMs > readMtime) {
        return fail(`Error: ${p} changed on disk since you read it. Read it again with read_file.`);
      }
      const file = { content, encoding, mimeType, mtimeMs: Date.now() } as const;
      let savedMtime: number = file.mtimeMs;
      try {
        await mount.backend.set!(rel, file);
        if (mount.external) {
          const after = await mount.backend.get(rel);
          if (!after) throw new Error(`File does not exist: ${p}`);
          savedMtime = after.mtimeMs;
        }
      } catch (err) {
        return writeFailure(p, mount.prefix, err);
      }
      tracker.markRead(ctx.sessionId, p, savedMtime);
      if (basename(p) === "AGENTS.md") agentsMdTracker?.record(ctx.sessionId, p, savedMtime);
      return { content: existing ? `The file ${p} has been updated.` : `File created successfully at: ${p}` };
    },
    phrase: ({ input, failed }, agent) => {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      return failed
        ? (filePath ? `${agent} could not write ${filePath}` : `${agent} could not write a file`)
        : `${agent} wrote ${filePath}`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
