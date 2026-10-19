// Shapes used by `tool-arguments.ts`. Kept in their own file so the module
// that uses them declares no types of its own.
import type { ToolArgumentIssue } from "../types.js";

/** Context for the diagnostic warning only — it never changes the return value. */
export interface ToolArgumentContext {
  toolName?: string;
  toolCallId?: string;
}

/** What `safeJsonParse` produced, and whether it had to substitute `{}`.
 *  `issue` is absent when the payload parsed. */
export interface ToolArgumentParse {
  input: Record<string, unknown>;
  issue?: ToolArgumentIssue;
}
