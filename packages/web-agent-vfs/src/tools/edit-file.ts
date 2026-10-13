import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import type { ReadTracker, VfsMount } from "../types.js";
import { canWrite, readOnlyMessage, resolve } from "../mounts.js";
import { basename, VfsPathError } from "../paths.js";
import type { AgentsMdTracker } from "../agents-md-tracker.js";
import { EDIT_FILE_DESCRIPTION, EDIT_FILE_SCHEMA } from "./schemas.js";
import { writeFailure } from "./write-file.js";

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

/** Non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

export function editFileTool(mounts: VfsMount[], tracker: ReadTracker, agentsMdTracker?: AgentsMdTracker): CustomToolDef {
  return {
    name: "edit_file",
    description: EDIT_FILE_DESCRIPTION,
    inputSchema: EDIT_FILE_SCHEMA,
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
      const f = await mount.backend.get(rel);
      if (!f) {
        return fail(`Error: ${p} does not exist.`);
      }
      if (f.encoding === "base64") {
        return fail(`Error: ${p} is an image; edit_file changes text files only.`);
      }
      if (!tracker.wasRead(ctx.sessionId, p)) {
        return fail(`Error: ${p} has not been read in this chat. Read it with read_file first.`);
      }
      const readMtime = tracker.readMtime(ctx.sessionId, p);
      if (mount.external && readMtime !== undefined && f.mtimeMs > readMtime) {
        return fail(`Error: ${p} changed on disk since you read it. Read it again with read_file.`);
      }
      const oldString = typeof input.old_string === "string" ? input.old_string : "";
      const newString = typeof input.new_string === "string" ? input.new_string : "";
      if (oldString === "") {
        return fail("Error: old_string is empty.");
      }
      if (oldString === newString) {
        return fail("Error: old_string and new_string are the same.");
      }
      const n = countOccurrences(f.content, oldString);
      if (n === 0) {
        return fail(`Error: old_string was not found in ${p}.`);
      }
      const replaceAll = input.replace_all === true;
      if (n > 1 && !replaceAll) {
        return fail(`Error: found ${n} matches of old_string. Set replace_all to true, or add more context so it matches once.`);
      }
      const content = replaceAll
        ? f.content.split(oldString).join(newString)
        : f.content.slice(0, f.content.indexOf(oldString)) + newString + f.content.slice(f.content.indexOf(oldString) + oldString.length);
      const mtimeMs = Date.now();
      let savedMtime = mtimeMs;
      try {
        await mount.backend.set!(rel, { ...f, content, mtimeMs });
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
      return { content: `The file ${p} has been updated.${replaceAll ? ` Replaced ${n} occurrences.` : ""}` };
    },
    phrase: ({ input, failed }, agent) => {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      return failed
        ? (filePath ? `${agent} could not edit ${filePath}` : `${agent} could not edit a file`)
        : `${agent} edited ${filePath}`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
