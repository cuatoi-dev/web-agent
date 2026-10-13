import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import picomatch from "picomatch";
import type { VfsMount, VfsResolvedEntry } from "../types.js";
import { filesUnder, resolve } from "../mounts.js";
import { entryOf } from "../backends/memory.js";
import { normalize, VfsPathError } from "../paths.js";
import { SEARCH_FILES_DESCRIPTION, SEARCH_FILES_SCHEMA } from "./schemas.js";

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

function relative(base: string, abs: string): string {
  if (base === abs) return abs.slice(abs.lastIndexOf("/") + 1);
  if (base === "/") return abs.slice(1);
  if (abs.startsWith(base + "/")) return abs.slice(base.length + 1);
  return abs;
}

const LONG_LINE = 500;

function formatContentLine(file: string, n: number, text: string, showN: boolean, context: boolean): string {
  return text.length > LONG_LINE
    ? `${file}:${showN ? n + ":" : ""} [line omitted: ${text.length.toLocaleString("en-US")} characters, over ${LONG_LINE}]`
    : `${file}${context ? "-" : ":"}${showN ? n + (context ? "-" : ":") : ""}${text}`;
}

export function searchFilesTool(mounts: VfsMount[]): CustomToolDef {
  return {
    name: "search_files",
    description: SEARCH_FILES_DESCRIPTION,
    inputSchema: SEARCH_FILES_SCHEMA,
    execute: async (input) => {
      const pattern = typeof input.pattern === "string" ? input.pattern : "";
      const caseInsensitive = input["-i"] === true;
      const multiline = input.multiline === true;
      let re: RegExp;
      try {
        re = new RegExp(pattern, "g" + (caseInsensitive ? "i" : "") + (multiline ? "ms" : ""));
      } catch (e) {
        return fail("Error: invalid regular expression: " + (e instanceof Error ? e.message : String(e)));
      }

      let base: string;
      try {
        base = normalize(typeof input.path === "string" ? input.path : "/home/agent");
      } catch (err) {
        return fail(err instanceof VfsPathError ? err.message : String(err));
      }

      const { mount, rel } = resolve(mounts, base);
      let files: VfsResolvedEntry[];
      const singleFile = mount && rel ? await mount.backend.get(rel) : undefined;
      if (mount && rel && singleFile) {
        files = [{ abs: base, mount, rel, ...entryOf(rel, singleFile) }];
      } else {
        files = await filesUnder(mounts, base);
      }

      files = files.filter((f) => f.encoding === "utf8");

      if (typeof input.glob === "string" && input.glob.length > 0) {
        const globPattern = input.glob;
        const gm = picomatch(globPattern, { dot: true, basename: !globPattern.includes("/") });
        files = files.filter((f) => gm(relative(base, f.abs)));
      }

      files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.abs.localeCompare(b.abs));

      const mode = typeof input.output_mode === "string" ? input.output_mode : "files_with_matches";
      const before = typeof input["-B"] === "number"
        ? input["-B"]
        : typeof input["-C"] === "number"
          ? input["-C"]
          : typeof input.context === "number"
            ? input.context
            : 0;
      const after = typeof input["-A"] === "number"
        ? input["-A"]
        : typeof input["-C"] === "number"
          ? input["-C"]
          : typeof input.context === "number"
            ? input.context
            : 0;
      const showN = input["-n"] !== false;
      const onlyMatching = input["-o"] === true;

      const items: string[] = [];
      let total = 0;
      let filesMatched = 0;

      for (const f of files) {
        const record = await f.mount.backend.get(f.rel);
        if (!record || record.encoding !== "utf8") continue;
        const text = record.content;
        const lines = text.split("\n");

        const hitLines: number[] = [];
        const lineMatchesMap = new Map<number, string[]>();
        let fileMatches = 0;

        if (multiline) {
          re.lastIndex = 0;
          const allMatches = [...text.matchAll(re)];
          if (allMatches.length === 0) continue;
          fileMatches = allMatches.length;
          for (const m of allMatches) {
            const lineNum = text.slice(0, m.index ?? 0).split("\n").length;
            if (!lineMatchesMap.has(lineNum)) {
              hitLines.push(lineNum);
              lineMatchesMap.set(lineNum, []);
            }
            lineMatchesMap.get(lineNum)!.push(m[0]);
          }
        } else {
          for (let i = 0; i < lines.length; i++) {
            re.lastIndex = 0;
            const line = lines[i];
            const m = line.match(re);
            if (m && m.length > 0) {
              hitLines.push(i + 1);
              fileMatches += m.length;
              lineMatchesMap.set(i + 1, m);
            }
          }
          if (hitLines.length === 0) continue;
        }

        filesMatched += 1;
        total += fileMatches;

        if (mode === "files_with_matches") {
          items.push(f.abs);
        } else if (mode === "count") {
          items.push(`${f.abs}:${fileMatches}`);
        } else if (mode === "content") {
          const hitLinesSet = new Set(hitLines);
          if (before === 0 && after === 0) {
            for (const n of hitLines) {
              if (onlyMatching) {
                for (const m of lineMatchesMap.get(n) ?? []) {
                  items.push(`${f.abs}:${showN ? n + ":" : ""}${m}`);
                }
              } else {
                items.push(formatContentLine(f.abs, n, lines[n - 1], showN, false));
              }
            }
          } else {
            const groups: [number, number][] = [];
            for (const h of hitLines) {
              const start = Math.max(1, h - before);
              const end = Math.min(lines.length, h + after);
              const last = groups[groups.length - 1];
              if (last && start <= last[1] + 1) {
                last[1] = Math.max(last[1], end);
              } else {
                groups.push([start, end]);
              }
            }

            for (const group of groups) {
              if (items.length > 0 && items[items.length - 1] !== "--") {
                items.push("--");
              }
              for (let n = group[0]; n <= group[1]; n++) {
                if (hitLinesSet.has(n)) {
                  if (onlyMatching) {
                    for (const m of lineMatchesMap.get(n) ?? []) {
                      items.push(`${f.abs}:${showN ? n + ":" : ""}${m}`);
                    }
                  } else {
                    items.push(formatContentLine(f.abs, n, lines[n - 1], showN, false));
                  }
                } else {
                  items.push(formatContentLine(f.abs, n, lines[n - 1], showN, true));
                }
              }
            }
          }
        }
      }

      if (mode === "count" && total > 0) {
        items.push(`Found ${total} matches in ${filesMatched} files.`);
      }

      if (total === 0) {
        return { content: "No matches found." };
      }

      const limit = typeof input.head_limit === "number" ? input.head_limit : 250;
      const off = typeof input.offset === "number" ? input.offset : 0;
      const page = limit === 0 ? items.slice(off) : items.slice(off, off + limit);

      if (page.length === 0 && off > 0) {
        return { content: `No results at offset ${off}.` };
      }

      let out = page.join("\n");
      if (page.length < items.length - off) {
        out += `\n[Showing results with pagination = limit: ${limit}, offset: ${off}]`;
      }
      return { content: out };
    },
    phrase: ({ input, failed }, agent) => {
      const pattern = typeof input.pattern === "string" ? input.pattern : "";
      const p = typeof input.path === "string" ? input.path : "/home/agent";
      if (failed) {
        return pattern ? `${agent} could not search ${p} for "${pattern}"` : `${agent} could not search ${p}`;
      }
      return `${agent} searched ${p} for "${pattern}"`;
    },
    inProgressPhrase: (agent) => `${agent} is working with files…`,
  };
}
