import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import type { ReadTracker, VfsMount } from "../types.js";
import { isFolder, resolve } from "../mounts.js";
import { ancestors, basename, dirname, join, VfsPathError } from "../paths.js";
import type { AgentsMdTracker } from "../agents-md-tracker.js";
import { READ_FILE_DESCRIPTION, READ_FILE_SCHEMA } from "./schemas.js";

const DEFAULT_LIMIT = 2000;

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

export function readFileTool(mounts: VfsMount[], tracker: ReadTracker, agentsMdTracker?: AgentsMdTracker, readBudget = 12_000): CustomToolDef {
  return {
    name: "read_file",
    description: READ_FILE_DESCRIPTION,
    promptSnippet: 'Text inside an <agents-md path="…"> block is the full content of that AGENTS.md file, written by the user. It is already loaded: follow it, do not read that file again, and quote or explain it whenever the user asks what rules you have.',
    inputSchema: READ_FILE_SCHEMA,
    execute: async (input, ctx) => {
      let p: string, mount: VfsMount | null, rel: string | undefined;
      try {
        ({ p, mount, rel } = resolve(mounts, input.file_path));
      } catch (err) {
        return fail(err instanceof VfsPathError ? err.message : String(err));
      }
      const f = mount && rel ? await mount.backend.get(rel) : undefined;
      if (!f) {
        if (mount && rel && (await isFolder(mount, rel))) {
          return fail(`Error: ${p} is a folder. Use glob_files to list it.`);
        }
        return fail(`Error: ${p} does not exist.`);
      }
      const lines = f.encoding === "utf8" ? f.content.split("\n") : [];
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      const start = typeof input.offset === "number" ? input.offset : 1;
      const count = typeof input.limit === "number" ? input.limit : DEFAULT_LIMIT;
      if (f.encoding === "utf8" && lines.length > 0 && (start < 1 || start > lines.length)) {
        return fail(`Error: offset ${start} is outside the file (${lines.length} lines).`);
      }
      // Bound the numbered output. A failed budget check returns before any
      // tracker records or ancestor lookups, so nothing is marked read.
      const budget = readBudget.toLocaleString("en-US");
      let shown: string[] = [];
      let out = "";
      let partial = false;
      if (f.encoding === "utf8" && lines.length > 0) {
        shown = lines.slice(start - 1, start - 1 + count);
        const numbered = shown.map((text, i) => `${String(start + i).padStart(6)}\t${text}`);
        out = numbered.join("\n");
        if (out.length > readBudget) {
          if (input.offset !== undefined || input.limit !== undefined) {
            const rangeChars = out.length.toLocaleString("en-US");
            return fail(
              `Error: Lines ${start}–${start + shown.length - 1} are ${rangeChars} characters, over the ${budget} limit. Use a smaller limit, or search_files to find what you need.`,
            );
          }
          const prefix: string[] = [];
          let fitted = 0;
          for (let b = 1; b <= lines.length; b++) {
            prefix.push(`${String(b).padStart(6)}\t${lines[b - 1]}`);
            const notice = `\n[PARTIAL view — lines 1–${b} of ${lines.length} shown. Use offset and limit to read more.]`;
            if (prefix.join("\n").length + notice.length > readBudget) break;
            fitted = b;
          }
          if (fitted === 0) {
            const lineChars = lines[0].length.toLocaleString("en-US");
            return fail(
              `Error: Line 1 is ${lineChars} characters, over the ${budget} limit. Use search_files with -o to pull values out of it.`,
            );
          }
          out = prefix.slice(0, fitted).join("\n")
            + `\n[PARTIAL view — lines 1–${fitted} of ${lines.length} shown. Use offset and limit to read more.]`;
          partial = true;
        }
      }
      if (basename(p) === "AGENTS.md") {
        agentsMdTracker?.record(ctx.sessionId, p, f.mtimeMs);
      }
      const blocks: string[] = [];
      if (agentsMdTracker) {
        for (const dir of ancestors(dirname(p))) {
          const cand = join(dir, "AGENTS.md");
          if (cand === p) continue;
          let res: ReturnType<typeof resolve>;
          try {
            res = resolve(mounts, cand);
          } catch {
            continue;
          }
          if (!res.mount || !res.rel) continue;
          let candFile: import("../types.js").VfsFile | undefined;
          try {
            candFile = await res.mount.backend.get(res.rel);
          } catch {
            continue;
          }
          if (!candFile || candFile.encoding !== "utf8") continue;
          const m = agentsMdTracker.seen(ctx.sessionId, cand);
          if (m !== undefined && candFile.mtimeMs <= m) continue;
          blocks.push(`<agents-md path="${cand}">\n${candFile.content}\n</agents-md>`);
          agentsMdTracker.record(ctx.sessionId, cand, candFile.mtimeMs);
        }
      }
      const suffix = blocks.length > 0 ? "\n\n" + blocks.join("\n\n") : "";
      if (f.encoding === "base64") {
        tracker.markRead(ctx.sessionId, p, f.mtimeMs);
        const kb = (f.content.length / 1024).toFixed(1);
        return {
          content: `Image ${p} (${f.mimeType}, ${kb} KB).` + suffix,
          images: [{ dataUrl: `data:${f.mimeType};base64,${f.content}`, mediaType: f.mimeType }],
        };
      }
      if (lines.length === 0) {
        tracker.markRead(ctx.sessionId, p, f.mtimeMs);
        return { content: `The file ${p} is empty.` + suffix };
      }
      if (!partial && start - 1 + count < lines.length) {
        out += `\n… Showing lines ${start}–${start + shown.length - 1} of ${lines.length}. Use offset and limit to read more.`;
      }
      tracker.markRead(ctx.sessionId, p, f.mtimeMs);
      return { content: out + suffix };
    },
    phrase: ({ input, outcomeSummary, failed }, agent) => {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      if (failed) {
        return filePath ? `${agent} could not read ${filePath}` : `${agent} could not read a file`;
      }
      const lines = outcomeSummary ? outcomeSummary.split("\n") : [];
      if (lines.some((line) => line.startsWith('<agents-md path="'))) {
        return `${agent} read ${filePath}, with its AGENTS.md`;
      }
      return `${agent} read ${filePath}`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
