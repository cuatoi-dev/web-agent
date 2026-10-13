// 124/003 — page_upload_file's checks, run in the panel before anything is
// sent to the tab, and the size text of its result.
import { MAX_UPLOAD_BYTES } from "./constants";
import { base64ByteLength } from "./debugger-network";
import type { FileSpec, FileSpecCheck } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type { FileSpecCheck };

export function checkFileSpecs(input: unknown): FileSpecCheck {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "Pass at least one file." };
  const files: FileSpec[] = [];
  let total = 0;
  for (const raw of input) {
    const r = isRecord(raw) ? raw : {};
    const name = typeof r.name === "string" ? r.name : "";
    const mimeType = typeof r.mimeType === "string" ? r.mimeType : "";
    const hasText = typeof r.text === "string";
    const hasBase64 = typeof r.base64 === "string";
    const hasSize = typeof r.size === "number";
    const hasFill = typeof r.fill === "string";
    const forms = (hasText ? 1 : 0) + (hasBase64 ? 1 : 0) + (hasSize && hasFill ? 1 : 0);
    if (forms !== 1 || hasSize !== hasFill) {
      return { ok: false, error: `File "${name}": pass text, base64, or size and fill.` };
    }
    if (hasText) {
      const text = r.text as string;
      files.push({ name, mimeType, text });
      total += new TextEncoder().encode(text).length;
    } else if (hasBase64) {
      const base64 = r.base64 as string;
      files.push({ name, mimeType, base64 });
      total += base64ByteLength(base64);
    } else {
      const fill = r.fill as string;
      const size = r.size as number;
      if (fill.length !== 1) return { ok: false, error: `File "${name}": fill must be one character.` };
      files.push({ name, mimeType, size, fill });
      total += size;
    }
  }
  if (total > MAX_UPLOAD_BYTES) return { ok: false, error: "Uploads are limited to 10 MB in total." };
  return { ok: true, files };
}

/** `8 B`, `2.1 KB`, `5.0 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
