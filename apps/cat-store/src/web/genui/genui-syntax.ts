import { Parser } from "acorn";
import { getLineAndColumn, type Violation } from "./genui-rules";

/** A <script type> the browser executes as JavaScript. Anything else — most
 *  importantly `application/json` — is a data block: the browser never runs it,
 *  so acorn must never parse it. Matches the HTML specification's own split. */
export const EXECUTABLE_SCRIPT_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
  "module/javascript",
]);

/** Reads the `type` attribute out of a matched `<script …>` open tag. Returns
 *  "" when the attribute is absent, which is the executable default. */
export function scriptTypeOf(openTag: string): string {
  const m = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(openTag);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim().toLowerCase();
}

export function isExecutableScriptTag(openTag: string): boolean {
  return EXECUTABLE_SCRIPT_TYPES.has(scriptTypeOf(openTag));
}

export function checkSyntax(source: string): Violation[] {
  const scriptRegex = /(<script\b[^>]*>)([\s\S]*?)<\/script>/gi;
  const violations: Violation[] = [];
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(source)) !== null) {
    if (!isExecutableScriptTag(match[1])) continue;
    const scriptContent = match[2];
    if (!scriptContent.trim()) continue;

    // Calculate line pad so acorn's loc.line matches the original source line number
    const contentStartIndex = match.index + match[0].indexOf(scriptContent);
    const { line: startLine, column: startColumn } = getLineAndColumn(source, contentStartIndex);
    const paddedScript = "\n".repeat(startLine - 1) + " ".repeat(startColumn - 1) + scriptContent;

    try {
      Parser.parse(paddedScript, {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
      });
    } catch (err: unknown) {
      const acornErr = err as { message: string; loc?: { line: number; column: number } };
      const line = acornErr.loc?.line ?? startLine;
      const column = acornErr.loc ? acornErr.loc.column + 1 : startColumn;
      const cleanMessage = acornErr.message.replace(/\s*\(\d+:\d+\)$/, "");

      violations.push({
        ruleId: "syntax-error",
        message: `JavaScript syntax error: ${cleanMessage}`,
        line,
        column,
      });
    }
  }

  return violations;
}
