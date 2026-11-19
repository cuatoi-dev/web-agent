// page_upload_file's checks and VFS path resolution, run in the
// panel before anything is sent to the tab, and the size text of its result.
import type { VfsFile, VfsHandle } from "@cuatoi/web-agent-vfs";
import { MAX_UPLOAD_BYTES } from "./constants";
import { base64ByteLength } from "./debugger-network";
import { errorMessage } from "./error-message";
import type { FileSpec, ResolvedFiles } from "./types";

export type { ResolvedFiles };

/** Same extension map as `packages/web-agent-vfs/src/mime.ts:5-28`. Kept here
 *  because `@cuatoi/web-agent-vfs` does not export `mimeFromPath`, and upload
 *  falls back to `"application/octet-stream"` (not `"text/plain"`) when a path
 *  has no known extension. */
const BY_EXTENSION: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  csv: "text/csv",
  xml: "application/xml",
  svg: "image/svg+xml",
  yml: "application/yaml",
  yaml: "application/yaml",
  tsv: "text/tab-separated-values",
  tsx: "text/typescript",
  jsx: "text/javascript",
  toml: "application/toml",
  ini: "text/plain",
  sql: "text/plain",
  sh: "text/plain",
  py: "text/plain",
  java: "text/plain",
  kt: "text/plain",
  go: "text/plain",
  rs: "text/plain",
  c: "text/plain",
  h: "text/plain",
  cpp: "text/plain",
  cs: "text/plain",
  rb: "text/plain",
  php: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function basename(p: string): string {
  const segs: string[] = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") segs.pop();
    else segs.push(s);
  }
  return segs[segs.length - 1] ?? "";
}

export function mimeFromPath(p: string): string | undefined {
  const base = basename(p);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return BY_EXTENSION[base.slice(dot + 1).toLowerCase()];
}

export async function resolveFiles(input: unknown, vfs: VfsHandle): Promise<ResolvedFiles> {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "Pass at least one file." };
  const files: FileSpec[] = [];
  const sources: (string | undefined)[] = [];
  let total = 0;
  for (const raw of input) {
    const r = isRecord(raw) ? raw : {};
    const givenName = typeof r.name === "string" && r.name !== "" ? r.name : undefined;
    const givenMime = typeof r.mimeType === "string" && r.mimeType !== "" ? r.mimeType : undefined;
    const hasText = typeof r.text === "string";
    const hasBase64 = typeof r.base64 === "string";
    const hasSize = typeof r.size === "number";
    const hasFill = typeof r.fill === "string";
    const hasPath = typeof r.path === "string";
    const forms =
      (hasText ? 1 : 0) + (hasBase64 ? 1 : 0) + (hasSize && hasFill ? 1 : 0) + (hasPath ? 1 : 0);
    if (forms !== 1 || hasSize !== hasFill) {
      const label = givenName ?? (hasPath ? (r.path as string) : "");
      return {
        ok: false,
        error: `File "${label}": pass exactly one of text, base64, size and fill, or path.`,
      };
    }
    if (hasPath) {
      const path = r.path as string;
      let f: VfsFile | undefined;
      try {
        f = await vfs.get(path);
      } catch (e) {
        return { ok: false, error: `Cannot read ${path}: ${errorMessage(e)}` };
      }
      if (f === undefined) {
        return { ok: false, error: `No file at ${path}. Use glob_files to find it.` };
      }
      const name = givenName ?? basename(path);
      const mimeType = givenMime ?? mimeFromPath(path) ?? "application/octet-stream";
      if (f.encoding === "base64") {
        files.push({ name, mimeType, base64: f.content });
        total += base64ByteLength(f.content);
      } else {
        files.push({ name, mimeType, text: f.content });
        total += new TextEncoder().encode(f.content).length;
      }
      sources.push(path);
    } else {
      if (givenName === undefined || givenMime === undefined) {
        return { ok: false, error: `File "${givenName ?? ""}": pass name and mimeType.` };
      }
      if (hasText) {
        const text = r.text as string;
        files.push({ name: givenName, mimeType: givenMime, text });
        total += new TextEncoder().encode(text).length;
      } else if (hasBase64) {
        const base64 = r.base64 as string;
        files.push({ name: givenName, mimeType: givenMime, base64 });
        total += base64ByteLength(base64);
      } else {
        const fill = r.fill as string;
        const size = r.size as number;
        if (fill.length !== 1) return { ok: false, error: `File "${givenName}": fill must be one character.` };
        files.push({ name: givenName, mimeType: givenMime, size, fill });
        total += size;
      }
      sources.push(undefined);
    }
  }
  if (total > MAX_UPLOAD_BYTES) return { ok: false, error: "Uploads are limited to 10 MB in total." };
  return { ok: true, files, sources };
}

/** `8 B`, `2.1 KB`, `5.0 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
