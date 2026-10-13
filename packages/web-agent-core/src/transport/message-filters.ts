import type { ModelMessage } from "../types.js";

/**
 * Drop assistant messages that carry no content.
 *
 * An empty `end_turn` is a completed turn and is no longer retried
 * (`middleware.ts` `isEmptyResult`), so `loop/agent.ts` journals
 * `{ role: "assistant", content: [] }` for it. Sending that back on the next
 * request asks the model to continue from a turn that says nothing — the
 * shape the empty response was observed with on 2026-09-09.
 *
 * The message stays in the journal and in `compose()`, so the transcript and
 * the `user → assistant → user` invariant (`context-validate.ts` I2) are
 * unchanged. Only the wire request drops it. Two consecutive user messages
 * are legal on this gateway — Anthropic combines consecutive same-role turns
 * (verified against the live endpoint 2026-09-04, `context-validate.ts:22-25`).
 */
export function dropEmptyAssistantMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.filter(
    (m) =>
      m.role !== "assistant" ||
      (typeof m.content === "string" ? m.content.length > 0 : m.content.length > 0),
  );
}
