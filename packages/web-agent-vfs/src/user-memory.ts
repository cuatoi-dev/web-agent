// 104/001 — USER.md and MEMORY.md, loaded into the first message of a chat
// when the host turns memory on. The loader never changes the files.
import type { MemoryOptions, ResolvedMemory, VfsFile, VfsMount, VfsOptions } from "./types.js";
import { resolve } from "./mounts.js";

/** The one `# Tool guidelines` line a memory-on provider adds. */
export const MEMORY_PROMPT_SNIPPET =
  "You have two memory files, shown at the start of each chat: USER.md (about the user) and MEMORY.md (what you learned). Change them only when the user asks you to remember, change or forget something, or agrees when you offer: 'Should I remember that?'. Use the remember skill to change them.";

/** `undefined` and `false` → null (off). `true` → every default. */
export function resolveMemoryOptions(memory: VfsOptions["memory"]): ResolvedMemory | null {
  if (memory === undefined || memory === false) return null;
  const o: MemoryOptions = memory === true ? {} : memory;
  return {
    userPath: o.userPath ?? "/home/shared/USER.md",
    memoryPath: o.memoryPath ?? "/home/agent/MEMORY.md",
    userMaxChars: o.userMaxChars ?? 2000,
    memoryMaxChars: o.memoryMaxChars ?? 4000,
    onboarding: o.onboarding ?? true,
  };
}

/** The `<memory>` blocks for the first message, USER.md first. */
export async function memoryBlocks(mounts: VfsMount[], mem: ResolvedMemory): Promise<string[]> {
  const files = [
    { path: mem.userPath, max: mem.userMaxChars, kind: "user" as const },
    { path: mem.memoryPath, max: mem.memoryMaxChars, kind: "memory" as const },
  ];
  const blocks: string[] = [];
  for (const { path, max, kind } of files) {
    let f: VfsFile | undefined;
    try {
      const res = resolve(mounts, path);
      f = res.mount && res.rel ? await res.mount.backend.get(res.rel) : undefined;
    } catch {
      // A read error (or a path resolve rejects) skips this file, as the
      // AGENTS.md loader does. No hint: the file may exist.
      continue;
    }
    if (!f || f.encoding !== "utf8") {
      if (kind === "user" && mem.onboarding) {
        blocks.push(`<memory path="${path}" missing="true">USER.md does not exist yet. Offer the onboarding skill.</memory>`);
      }
      continue; // a missing MEMORY.md adds nothing
    }
    let text = f.content;
    if (text.length > max) {
      text = text.slice(0, max) + `\n[cut at ${max} characters: merge or remove entries with the remember skill]`;
    }
    blocks.push(`<memory path="${path}">\n${text}\n</memory>`);
  }
  return blocks;
}
