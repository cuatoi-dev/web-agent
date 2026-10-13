// The saved-output marker, and the parser that recognises it. A long tool
// result is replaced with a `<saved-output>` block by a tool provider's
// `onPostTool` hook; a UI package uses this parser to read the block back
// without knowing anything about files or mounts.

export const SAVED_OUTPUT_TAG = "saved-output";

/**
 * Parse a saved-output header at the START of `text`. Returns `null` when the
 * text does not begin with the marker, or the attributes are malformed.
 *
 * The grammar is anchored and exact:
 * `<saved-output( path="…")? chars="…"( saved="false")?>`
 * The path attribute is absent on the unsaved form, and on a saved result the
 * path is only needed when the model must read the rest back.
 */
export function parseSavedOutput(text: string): {
  path: string | undefined;
  chars: number;
  saved: boolean;
} | null {
  const m = /^<saved-output( path="([^"]+)")? chars="(\d+)"( saved="false")?>/.exec(text);
  if (!m) return null;
  return { path: m[2], chars: Number(m[3]), saved: m[4] === undefined };
}
