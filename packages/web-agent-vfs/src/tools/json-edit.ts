import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import type { ReadTracker, VfsMount } from "../types.js";
import { canWrite, readOnlyMessage, resolve } from "../mounts.js";
import { VfsPathError } from "../paths.js";
import { applyJsonChanges } from "../json/apply.js";
import type { JsonEditChange } from "../json/apply.types.js";
import { JSON_EDIT_DESCRIPTION, JSON_EDIT_SCHEMA } from "./schemas.js";
import { writeFailure } from "./write-file.js";

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

export function jsonEditTool(mounts: VfsMount[], tracker: ReadTracker): CustomToolDef {
  return {
    name: "json_edit",
    description: JSON_EDIT_DESCRIPTION,
    inputSchema: JSON_EDIT_SCHEMA,
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

      const existing = await mount.backend.get(rel);
      let doc: unknown;
      if (!existing) {
        doc = {};
      } else {
        if (existing.encoding !== "utf8") {
          return fail(`Error: ${p} is not a text file.`);
        }
        try {
          doc = JSON.parse(existing.content);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return fail(`${p} is not valid JSON: ${msg}`);
        }
      }

      const changes = Array.isArray(input.changes) ? (input.changes as JsonEditChange[]) : [];
      const applied = applyJsonChanges(doc, changes);
      if (!applied.success) {
        return fail(applied.error);
      }

      const content = JSON.stringify(applied.doc, null, 2);
      const mtimeMs = Date.now();
      let savedMtime = mtimeMs;
      try {
        await mount.backend.set!(rel, {
          content,
          encoding: "utf8",
          mimeType: "application/json",
          mtimeMs,
        });
        if (mount.external) {
          const after = await mount.backend.get(rel);
          if (!after) throw new Error(`File does not exist: ${p}`);
          savedMtime = after.mtimeMs;
        }
      } catch (err) {
        return writeFailure(p, mount.prefix, err);
      }

      tracker.markRead(ctx.sessionId, p, savedMtime);
      return {
        content: `${changes.length} change(s) saved to ${p}.\n` + applied.report.join("\n"),
      };
    },
    phrase: ({ input, failed }, agent) => {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      if (failed) {
        return filePath ? `${agent} could not change ${filePath}` : `${agent} could not change a file`;
      }
      const changes = Array.isArray(input.changes) ? input.changes.length : 0;
      return `${agent} changed ${filePath} (${changes} changes)`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
