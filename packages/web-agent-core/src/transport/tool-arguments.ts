import type { ToolArgumentContext, ToolArgumentParse } from "./tool-arguments.types.js";

export type { ToolArgumentContext, ToolArgumentParse } from "./tool-arguments.types.js";

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------
/**
 * Parse accumulated tool-call arguments, substituting `{}` when that is not
 * possible. The substitution used to be silent, which made an unparsable
 * payload and a model that sent no arguments at all indistinguishable. Both
 * now warn, with different wording, so a live trace can tell them apart.
 */
export function safeJsonParse(
  s: string,
  context?: ToolArgumentContext,
): ToolArgumentParse {
  const where = `tool "${context?.toolName ?? "unknown"}" (id ${context?.toolCallId ?? "unknown"})`;

  if (s.trim() === "") {
    console.warn(
      `[web-agent] Empty tool arguments for ${where}: the model sent no argument JSON. Substituting {}.`,
    );
    return { input: {}, issue: "empty" };
  }

  try {
    return { input: JSON.parse(s) as Record<string, unknown> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[web-agent] Tool arguments failed to parse for ${where}: ${message}. Payload: ${s}. Substituting {}.`,
    );
    return { input: {}, issue: "unparsable" };
  }
}
