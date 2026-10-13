// Shapes used by `stream-parts.ts`. Kept in their own file so the module
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

/** One in-flight OpenAI-style tool call tracked by `StreamingToolCallTracker`. */
export interface TrackedToolCall {
  id: string;
  name: string;
  args: string;
  hasFinished: boolean;
}

export interface TextAcc     { kind: "text";      id: string; text: string }
export interface ReasoningAcc { kind: "reasoning"; id: string; text: string; signature: string }
/** `complete` flips only when a `tool-call` part arrives. A block created by
 *  `tool-input-start` and never completed carries no arguments at all — the
 *  deltas are not accumulated (see the `tool-input-delta` case in `stream-parts.ts`) — so it
 *  is dropped rather than emitted with `input: {}`. */
export interface ToolAcc     { kind: "tool";      id: string; name: string; input: string; complete: boolean; extra_content?: Record<string, unknown> }
export type BlockAcc = TextAcc | ReasoningAcc | ToolAcc;
