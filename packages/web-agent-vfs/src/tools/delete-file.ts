import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import type { ReadTracker, VfsMount } from "../types.js";
import { canDelete, isFolder, readOnlyMessage, resolve } from "../mounts.js";
import { basename, VfsPathError } from "../paths.js";
import { DELETE_FILE_DESCRIPTION, DELETE_FILE_SCHEMA } from "./schemas.js";

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

export function deleteFileTool(mounts: VfsMount[], tracker: ReadTracker): CustomToolDef {
  return {
    name: "delete_file",
    description: DELETE_FILE_DESCRIPTION,
    inputSchema: DELETE_FILE_SCHEMA,
    execute: async (input, ctx) => {
      let p: string, mount: VfsMount | null, rel: string | undefined;
      try {
        ({ p, mount, rel } = resolve(mounts, input.file_path));
      } catch (err) {
        return fail(err instanceof VfsPathError ? err.message : String(err));
      }
      if (!canDelete(mount) || !mount || !rel) {
        return fail(readOnlyMessage(p, mount, mounts));
      }
      if (await isFolder(mount, rel)) {
        return fail(`Error: ${p} is a folder; delete_file removes one file.`);
      }
      const existing = await mount.backend.get(rel);
      if (!existing) {
        return fail(`Error: ${p} does not exist.`);
      }
      if (mount.external) {
        if (!ctx.confirmInteraction) {
          return fail(`Error: deleting ${p} needs the user's confirmation, and this app cannot ask. Not performed.`);
        }
        const ok = await ctx.confirmInteraction({
          action: "delete",
          title: `Delete ${basename(p)} from your disk?`,
          message: `The agent wants to delete ${p}. This cannot be undone.`,
          confirmLabel: "Delete",
          cancelLabel: "Cancel",
          danger: true,
        });
        if (!ok) return { content: `Deleting ${p} was not confirmed by the user; not performed.` };
      }
      await mount.backend.delete!(rel);
      tracker.forget(ctx.sessionId, p);
      return { content: `Deleted ${p}.` };
    },
    phrase: ({ input, failed }, agent) => {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      return failed
        ? (filePath ? `${agent} could not delete ${filePath}` : `${agent} could not delete a file`)
        : `${agent} deleted ${filePath}`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
