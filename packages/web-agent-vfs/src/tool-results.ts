// The onPostTool hook for long tool results. A result over `maxChars` is saved
// in full under /tmp/tool-results/, and the model gets a short head-and-tail
// preview with the path and the tool to use for the rest. This module is
// internal to the package — it is not a public export.

import { SAVED_OUTPUT_TAG, type PostToolPayload, type PostToolResult } from "@cuatoi/web-agent-core";
import type { VfsMount } from "./types.js";
import { resolve } from "./mounts.js";

export const TOOL_RESULT_DIR = "/tmp/tool-results";

/** Results from these tools are already bounded by the tool itself, so saving
 *  them would only add a layer of indirection. */
const NEVER_SAVED = new Set(["read_file", "glob_files", "search_files"]);

function isJsonText(text: string): boolean {
  const lead = text.trimStart();
  if (!lead.startsWith("{") && !lead.startsWith("[")) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function savedBlock(
  path: string,
  chars: number,
  hint: string,
  head: string,
  omitted: number,
  tail: string,
  previewChars: number,
): string {
  const charsText = chars.toLocaleString("en-US");
  const omittedText = omitted.toLocaleString("en-US");
  const previewText = previewChars.toLocaleString("en-US");
  return [
    `<${SAVED_OUTPUT_TAG} path="${path}" chars="${chars}">`,
    `Output too large (${charsText} characters). Full output saved to ${path}.`,
    hint,
    "",
    `First ${previewText} characters:`,
    head,
    "",
    `… ${omittedText} characters omitted …`,
    "",
    `Last ${previewText} characters:`,
    tail,
    `</${SAVED_OUTPUT_TAG}>`,
  ].join("\n");
}

function unsavedBlock(
  chars: number,
  reason: string,
  head: string,
  omitted: number,
  tail: string,
  previewChars: number,
): string {
  const charsText = chars.toLocaleString("en-US");
  const omittedText = omitted.toLocaleString("en-US");
  const previewText = previewChars.toLocaleString("en-US");
  return [
    `<${SAVED_OUTPUT_TAG} chars="${chars}" saved="false">`,
    `Output too large (${charsText} characters). It could not be saved: ${reason}.`,
    `First ${previewText} characters: ${head}`,
    `… ${omittedText} characters omitted …`,
    `Last ${previewText} characters: ${tail}`,
    `</${SAVED_OUTPUT_TAG}>`,
  ].join("\n");
}

/**
 * Save a long tool result and replace its content with a preview block.
 * Returns `undefined` to leave the outcome unchanged. Any error that would
 * otherwise escape is turned into the unsaved preview, so the turn continues.
 */
export async function saveToolResult(
  getMounts: () => VfsMount[],
  payload: PostToolPayload,
  maxChars: number,
  previewChars: number,
): Promise<PostToolResult | void> {
  if (NEVER_SAVED.has(payload.name)) return;
  const text = payload.outcome.content;
  if (text.length <= maxChars) return;

  const toolCallId = payload.toolCallId ?? "result-" + Date.now();
  const head = text.slice(0, previewChars);
  const tail = text.slice(-previewChars);
  const omitted = text.length - 2 * previewChars;
  const isJson = isJsonText(text);
  const path = `${TOOL_RESULT_DIR}/${toolCallId}${isJson ? ".json" : ".txt"}`;
  const hint = isJson
    ? "It is JSON. Query it with json_get (path, where, fields, offset, limit)."
    : "Read more with read_file (offset, limit) or search it with search_files.";

  let block: string;
  try {
    const res = resolve(getMounts(), path);
    if (!res.mount || !res.rel) {
      throw new Error(`${path} has no writable mount`);
    }
    await res.mount.backend.set!(res.rel, {
      content: text,
      encoding: "utf8",
      mimeType: isJson ? "application/json" : "text/plain",
      mtimeMs: Date.now(),
    });
    block = savedBlock(path, text.length, hint, head, omitted, tail, previewChars);
  } catch (e) {
    const reason = (e as { name?: string })?.name === "QuotaExceededError"
      ? "the storage for /tmp is full"
      : e instanceof Error
        ? e.message
        : String(e);
    block = unsavedBlock(text.length, reason, head, omitted, tail, previewChars);
  }

  return { outcome: { ...payload.outcome, content: block } };
}
