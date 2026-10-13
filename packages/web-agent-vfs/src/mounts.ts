import type { VfsMount, VfsOptions, VfsResolution, VfsResolvedEntry } from "./types.js";
export type { VfsResolvedEntry };
import { normalize } from "./paths.js";
import { StorageBackend } from "./backends/storage.js";

/** The three default mount points, in table order. */
export const TMP = "/tmp";
export const HOME = "/home/agent";
export const SHARED = "/home/shared";

/** A host configuration mistake. Thrown from `buildMounts`, which runs inside
 *  the provider's `load()`, so core logs it and the session runs with no file
 *  tools (the provider is `required: false`). Not exported from index.ts. */
export class ConfigError extends Error {}

/** Two prefixes overlap when they are equal, or one is inside the other. */
export function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
}

export function buildMounts(options: VfsOptions = {}): VfsMount[] {
  const mounts: VfsMount[] = [
    { prefix: TMP, backend: options.tmp ?? StorageBackend(sessionStorage, "web-agent-vfs:tmp:") },
    { prefix: HOME, backend: options.home ?? StorageBackend(localStorage, "web-agent-vfs:home:") },
    { prefix: SHARED, backend: options.shared ?? StorageBackend(localStorage, "web-agent-vfs:shared:") },
  ];
  for (const [path, backend] of Object.entries(options.mounts ?? {})) {
    const p = normalize(path);
    if (p === "/") {
      throw new ConfigError(`vfsTools: cannot mount ${p} — it overlaps ${TMP}`);
    }
    const clash = mounts.find((m) => overlaps(p, m.prefix));
    if (clash) {
      throw new ConfigError(`vfsTools: cannot mount ${p} — it overlaps ${clash.prefix}`);
    }
    mounts.push({ prefix: p, backend });
  }
  return mounts;
}

/** The mount with the LONGEST matching prefix, so a host mount at
 *  /home/agent/x would win over /home/agent — which buildMounts refuses, but
 *  the rule is what makes any future nesting predictable. */
export function resolve(mounts: VfsMount[], path: unknown): VfsResolution {
  const p = normalize(path);
  let best: VfsMount | null = null;
  for (const m of mounts) {
    if ((p === m.prefix || p.startsWith(m.prefix + "/")) && (!best || m.prefix.length > best.prefix.length)) {
      best = m;
    }
  }
  if (!best) return { p, mount: null };
  return { p, mount: best, rel: p.slice(best.prefix.length) || "/" };
}

export function canWrite(m: VfsMount | null): boolean {
  return m !== null && typeof m.backend.set === "function";
}

export function canDelete(m: VfsMount | null): boolean {
  return m !== null && typeof m.backend.delete === "function";
}

export function writablePrefixes(mounts: VfsMount[]): string[] {
  return mounts.filter((m) => canWrite(m)).map((m) => m.prefix);
}

/** The error for a write, edit, delete or move into a mount with no `set`. */
export function readOnlyMessage(p: string, m: VfsMount | null, mounts: VfsMount[]): string {
  const attached = m?.external ? ` The user attached ${m.prefix} read only.` : "";
  return `Error: ${p} is read-only.${attached} Writable paths: ${writablePrefixes(mounts).join(", ")}.`;
}

/** A folder exists only while a file lives under it. */
export async function isFolder(m: VfsMount, rel: string): Promise<boolean> {
  if (rel === "/") return true;
  const entries = await m.backend.list(rel);
  return entries.some((e) => e.path.startsWith(rel + "/"));
}

/** Every file at or under `base`, across all mounts covering or inside `base`.
 *  `base` is a normalized absolute path. */
export async function filesUnder(mounts: VfsMount[], base: string): Promise<VfsResolvedEntry[]> {
  const entries: VfsResolvedEntry[] = [];
  for (const m of mounts) {
    let relBase: string;
    if (m.prefix === base || m.prefix.startsWith(base + "/") || base === "/") {
      relBase = "/";
    } else if (base.startsWith(m.prefix + "/")) {
      relBase = base.slice(m.prefix.length);
    } else {
      continue;
    }
    const list = await m.backend.list(relBase);
    for (const e of list) {
      entries.push({
        abs: m.prefix + e.path,
        mount: m,
        rel: e.path,
        ...e,
      });
    }
  }
  return entries;
}
