/** The message from a thrown value, whatever it is. `catch` binds `unknown`,
 *  and a rejected promise can carry a non-Error, so this narrows rather than
 *  asserting. Same text the `err?.message || String(err)` sites produced
 *  before this helper existed — an empty message falls back to `String(err)`
 *  (e.g. "Error") rather than surfacing a blank string. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = err.message;
    if (typeof m === "string" && m) return m;
  }
  return String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The name and message for `The code threw <name>: <message>`, read off CDP's
 *  ExceptionDetails. `exception.description` is "<Name>: <message>" plus a
 *  stack (measured 2026-09-19), so only its first line is used. Lives here
 *  (rather than in panel-page-tools-script.ts, where it originated) so
 *  debugger-helper-world.ts can use it without an import cycle through
 *  types.ts. */
export function thrownFromDetails(details: Record<string, unknown>): { name: string; message: string } {
  const ex = isRecord(details.exception) ? details.exception : {};
  const name = str(ex.className) ?? "Error";
  const description = str(ex.description) ?? "";
  const firstLine = description.split("\n")[0] ?? "";
  const message = firstLine.startsWith(`${name}: `)
    ? firstLine.slice(name.length + 2)
    : firstLine || str(ex.value) || str(details.text) || "";
  return { name, message };
}
