import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import type { ReadTracker, VfsMount } from "../types.js";
import { canDelete, canWrite, isFolder, readOnlyMessage, resolve } from "../mounts.js";
import { basename, VfsPathError } from "../paths.js";
import { MOVE_FILE_DESCRIPTION, MOVE_FILE_SCHEMA } from "./schemas.js";

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

export function moveFileTool(mounts: VfsMount[], tracker: ReadTracker): CustomToolDef {
  return {
    name: "move_file",
    description: MOVE_FILE_DESCRIPTION,
    inputSchema: MOVE_FILE_SCHEMA,
    execute: async (input, ctx) => {
      let srcP: string, srcMount: VfsMount | null, srcRel: string | undefined;
      let dstP: string, dstMount: VfsMount | null, dstRel: string | undefined;
      try {
        ({ p: srcP, mount: srcMount, rel: srcRel } = resolve(mounts, input.source_path));
        ({ p: dstP, mount: dstMount, rel: dstRel } = resolve(mounts, input.destination_path));
      } catch (err) {
        return fail(err instanceof VfsPathError ? err.message : String(err));
      }

      const f = srcMount && srcRel ? await srcMount.backend.get(srcRel) : undefined;
      if (!f) {
        return fail(`Error: ${srcP} does not exist.`);
      }
      if (!canDelete(srcMount) || !srcMount || !srcRel) {
        return fail(srcMount?.external
          ? readOnlyMessage(srcP, srcMount, mounts)
          : `Error: ${srcP} is read-only, so it cannot be moved.`);
      }
      if (!canWrite(dstMount) || !dstMount || !dstRel) {
        return fail(readOnlyMessage(dstP, dstMount, mounts));
      }
      const dstExisting = await dstMount.backend.get(dstRel);
      if (dstExisting || (await isFolder(dstMount, dstRel))) {
        return fail(`Error: ${dstP} already exists.`);
      }

      if (srcMount.external || dstMount.external) {
        if (!ctx.confirmInteraction) {
          return fail(`Error: moving ${srcP} needs the user's confirmation, and this app cannot ask. Not performed.`);
        }
        const ok = await ctx.confirmInteraction({
          action: "move",
          title: `Move ${basename(srcP)} on your disk?`,
          message: `The agent wants to move ${srcP} to ${dstP}.`,
          confirmLabel: "Move",
          cancelLabel: "Cancel",
        });
        if (!ok) return { content: `Moving ${srcP} was not confirmed by the user; not performed.` };
      }

      await dstMount.backend.set!(dstRel, f);
      try {
        await srcMount.backend.delete!(srcRel);
      } catch (e) {
        await dstMount.backend.delete!(dstRel);
        return fail(`Error: could not move ${srcP}: ${e instanceof Error ? e.message : String(e)}`);
      }

      tracker.moveRead(ctx.sessionId, srcP, dstP);
      return { content: `Moved ${srcP} to ${dstP}.` };
    },
    phrase: ({ input, failed }, agent) => {
      const src = typeof input.source_path === "string" ? input.source_path : "";
      const dst = typeof input.destination_path === "string" ? input.destination_path : "";
      if (failed) {
        return src ? `${agent} could not move ${src}` : `${agent} could not move a file`;
      }
      return `${agent} moved ${src || "a file"} to ${dst || "another file"}`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
