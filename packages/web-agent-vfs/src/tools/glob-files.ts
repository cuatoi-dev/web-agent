import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import picomatch from "picomatch";
import type { VfsMount } from "../types.js";
import { filesUnder } from "../mounts.js";
import { normalize, VfsPathError } from "../paths.js";
import { GLOB_FILES_DESCRIPTION, GLOB_FILES_SCHEMA } from "./schemas.js";

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

export function globFilesTool(mounts: VfsMount[]): CustomToolDef {
  return {
    name: "glob_files",
    description: GLOB_FILES_DESCRIPTION,
    inputSchema: GLOB_FILES_SCHEMA,
    execute: async (input) => {
      let base: string;
      try {
        base = normalize(typeof input.path === "string" ? input.path : "/home/agent");
      } catch (err) {
        return fail(err instanceof VfsPathError ? err.message : String(err));
      }
      const pattern = typeof input.pattern === "string" ? input.pattern : "";
      const entries = await filesUnder(mounts, base);
      const match = picomatch(pattern, { dot: true });
      const hits = entries.filter((e) =>
        match(pattern.startsWith("/") ? e.abs : e.abs.slice(base.length + (base === "/" ? 0 : 1))),
      );
      hits.sort((a, b) => b.mtimeMs - a.mtimeMs || a.abs.localeCompare(b.abs));
      if (hits.length === 0) {
        return { content: "No files found." };
      }
      const top100 = hits.slice(0, 100).map((e) => e.abs);
      let out = top100.join("\n");
      if (hits.length > 100) {
        out += `\n(Showing 100 of ${hits.length} files, newest first. Narrow the pattern or path to see the rest.)`;
      }
      return { content: out };
    },
    phrase: ({ input, failed }, agent) => {
      const pattern = typeof input.pattern === "string" ? input.pattern : "";
      const p = typeof input.path === "string" ? input.path : "/home/agent";
      if (failed) {
        return pattern ? `${agent} could not list ${pattern} in ${p}` : `${agent} could not list files in ${p}`;
      }
      return `${agent} listed ${pattern || "files"} in ${p}`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
