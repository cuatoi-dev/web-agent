import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import { get, toPath } from "lodash-es";
import type { ReadTracker, VfsMount } from "../types.js";
import { resolve } from "../mounts.js";
import { VfsPathError } from "../paths.js";
import { matches, pick } from "../json/match.js";
import { JSON_GET_DESCRIPTION, JSON_GET_SCHEMA } from "./schemas.js";

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

export function jsonGetTool(mounts: VfsMount[], tracker: ReadTracker): CustomToolDef {
  return {
    name: "json_get",
    description: JSON_GET_DESCRIPTION,
    inputSchema: JSON_GET_SCHEMA,
    execute: async (input, ctx) => {
      let p: string, mount: VfsMount | null, rel: string | undefined;
      try {
        ({ p, mount, rel } = resolve(mounts, input.file_path));
      } catch (err) {
        return fail(err instanceof VfsPathError ? err.message : String(err));
      }
      const f = mount && rel ? await mount.backend.get(rel) : undefined;
      if (!f) {
        return fail(`${p} does not exist.`);
      }
      if (f.encoding !== "utf8") {
        return fail(`${p} is not a text file.`);
      }
      let doc: unknown;
      try {
        doc = JSON.parse(f.content);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return fail(`${p} is not valid JSON: ${msg}`);
      }

      const pathStr = typeof input.path === "string" ? input.path : undefined;
      const node = pathStr ? (get(doc, toPath(pathStr)) as unknown) : doc;
      if (node === undefined) {
        return fail(`Nothing at ${pathStr} in ${p}.`);
      }

      let out: string;
      if (!Array.isArray(node)) {
        out = JSON.stringify(node, null, 2);
      } else {
        const where = input.where && typeof input.where === "object" ? (input.where as Record<string, unknown>) : undefined;
        const fields = Array.isArray(input.fields) ? (input.fields as string[]) : undefined;
        const matched: [number, unknown][] = [];
        for (let i = 0; i < node.length; i++) {
          if (!where || matches(node[i], where)) {
            matched.push([i, node[i]]);
          }
        }
        const off = typeof input.offset === "number" && input.offset >= 0 ? input.offset : 0;
        const lim = typeof input.limit === "number" && input.limit > 0 ? input.limit : 50;
        const page = matched.slice(off, off + lim);
        const targetName = pathStr || "the document";
        out = `${matched.length} of ${node.length} items in ${targetName} match.`;
        for (const [i, item] of page) {
          const shown = fields ? pick(item, fields) : item;
          out += `\n[${i}] ` + JSON.stringify(shown);
        }
        if (off + lim < matched.length) {
          out += `\n… ${matched.length - off - lim} more. Use offset to see them.`;
        }
      }

      tracker.markRead(ctx.sessionId, p, f.mtimeMs);
      return { content: out };
    },
    phrase: ({ input, outcomeSummary, failed }, agent) => {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      if (failed) {
        return filePath ? `${agent} could not read ${filePath}` : `${agent} could not read a file`;
      }
      const match = outcomeSummary ? outcomeSummary.match(/^(\d+) of \d+ items in (.*) match\./) : null;
      if (match) {
        const count = match[1];
        const pathText = match[2];
        return `${agent} read ${pathText} in ${filePath} (${count} match)`;
      }
      const path = typeof input.path === "string" && input.path ? input.path : "the document";
      return `${agent} read ${path} in ${filePath}`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
