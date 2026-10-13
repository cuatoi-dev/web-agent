// Pure mapping helpers for the Anthropic provider: tool schema lookup, tool
// choice, response and finish-reason mapping. Split out of
// anthropic-provider.ts; the code is unchanged apart from being exported so
// the provider can import it.
import { fromAnthropicResponse } from "./message-converter.js";
import type {
  FinishReason, ProviderResult, Tool, ToolChoice,
} from "./provider.types.js";
import type { Message, StopReason, ToolChoiceParam } from "./wire.types.js";

// ---------------------------------------------------------------------------
// requiredArgsByTool: tool name -> the non-empty `required` list from its JSON
// Schema. Only tools that declare at least one required argument appear, so a
// lookup miss means "this tool is fine with no arguments" — which is exactly
// how the end-of-stream flush uses it.
//
// `Tool.input_schema` is typed `{ type: "object"; [key: string]: unknown }`
// (../types.ts:16-20), so `required` arrives as `unknown`. Everything is narrowed
// before it is read: a tool list that is absent, a schema that is missing, and
// a `required` that is not an array of strings all produce no entry rather than
// a throw. A malformed schema must never break a stream.
// ---------------------------------------------------------------------------
export function requiredArgsByTool(tools: Tool[] | undefined): Map<string, string[]> {
  const byTool = new Map<string, string[]>();
  for (const tool of tools ?? []) {
    const schema = tool?.input_schema as { required?: unknown } | undefined;
    const required = schema?.required;
    if (!Array.isArray(required)) continue;
    const names = required.filter((r): r is string => typeof r === "string");
    if (names.length > 0) byTool.set(tool.name, names);
  }
  return byTool;
}

// ---------------------------------------------------------------------------
// mapToolChoice: our ToolChoice → Anthropic tool_choice param
// ---------------------------------------------------------------------------
export function mapToolChoice(tc: ToolChoice): ToolChoiceParam {
  switch (tc.type) {
    case "auto":     return { type: "auto" };
    case "required": return { type: "any" };
    case "none":     return { type: "auto" }; // Anthropic has no "none", skip silently
    case "tool":     return { type: "tool", name: tc.toolName };
  }
}

// ---------------------------------------------------------------------------
// fromAnthropicMessage: maps Message → ProviderResult
// ---------------------------------------------------------------------------
export function fromAnthropicMessage(response: Message): ProviderResult {
  const legacy = fromAnthropicResponse(response);

  return {
    content: legacy.content,
    finishReason: mapFinishReason(response.stop_reason),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? undefined,
    },
    warnings: [],
  };
}

// Normalized finishReason mapping
export function mapFinishReason(raw: StopReason): FinishReason {
  switch (raw) {
    case "end_turn":      return "stop";
    case "tool_use":      return "tool-calls";
    case "max_tokens":    return "length";
    case "stop_sequence": return "stop";
    case "refusal":       return "content-filter";
    case "pause_turn":    return "other";
    default:              return "unknown";
  }
}
