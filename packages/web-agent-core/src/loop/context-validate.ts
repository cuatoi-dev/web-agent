import type { ModelMessage, ToolResultPart } from "../types.js";
import { SUMMARY_PREFIX } from "./context-assembly.js";

export function validateContextInvariants(msgs: ModelMessage[], mode: "assert" | "warn"): void {
  if (msgs.length === 0) return;

  const raise = (errStr: string) => {
    if (mode === "assert") {
      throw new Error(errStr);
    } else {
      console.warn(errStr);
    }
  };

  // I2: First message role is user or system
  const firstRole = msgs[0].role;
  if (firstRole !== "user" && firstRole !== "system") {
    raise("I2 violation: First message must be user or system.");
    return;
  }

  // 107/002: a rebuilt context starts with the compaction summary and the
  // first kept turn is a user message, so exactly ONE user→user pair is
  // legal — at the head. Anthropic combines consecutive same-role turns
  // (verified against the live endpoint, 2026-09-04).
  const startsWithSummary =
    msgs[0].role === "user" &&
    typeof msgs[0].content === "string" &&
    msgs[0].content.startsWith(SUMMARY_PREFIX);

  // Alternating roles
  let prevRole: string | null = null;
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const role = msg.role;
    if (prevRole !== null) {
      if (prevRole === "user" && role !== "assistant") {
        if (!(startsWithSummary && i === 1)) {
          raise("I2 violation: User message must be followed by assistant.");
          return;
        }
      }
      if (prevRole === "assistant" && role !== "user" && role !== "tool") {
        raise("I2 violation: Assistant message must be followed by user or tool.");
        return;
      }
      if (prevRole === "tool" && role !== "assistant") {
        raise("I2 violation: Tool message must be followed by assistant.");
        return;
      }
      if (prevRole === "system" && role !== "user") {
        raise("I2 violation: System message must be followed by user.");
        return;
      }
    }
    prevRole = role;
  }

  // I1: Every tool-call part has a matching tool-result part by toolCallId
  const calls = new Set<string>();
  const results = new Set<string>();

  for (const msg of msgs) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-call") {
          calls.add(part.toolCallId);
        } else if (part.type === "tool-result") {
          results.add(part.toolCallId);
        }
      }
    }
  }

  for (const id of calls) {
    if (!results.has(id)) {
      raise(`I1 violation: Tool call with ID "${id}" has no matching tool result.`);
      return;
    }
  }
  for (const id of results) {
    if (!calls.has(id)) {
      raise(`I1 violation: Tool result with ID "${id}" has no matching tool call.`);
      return;
    }
  }

  // I4: Latest snapshot result is verbatim
  let latestSnapshot: ToolResultPart | null = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      const found = [...msg.content].reverse().find((p) => p.type === "tool-result" && p.toolName === "snapshot_page") as
        | ToolResultPart
        | undefined;
      if (found) {
        latestSnapshot = found;
        break;
      }
    }
  }
  if (latestSnapshot !== null && latestSnapshot.redacted) {
    raise("I4 violation: The latest snapshot page tool result was redacted.");
    return;
  }
}
