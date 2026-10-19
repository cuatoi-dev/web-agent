// Pure mapping helpers for the Anthropic provider: tool
// choice, response and finish-reason mapping. Split out of
// anthropic-provider.ts; the code is unchanged apart from being exported so
// the provider can import it.
import { fromAnthropicResponse } from "./message-converter.js";
import type {
  FinishReason, ProviderResult, ToolChoice,
} from "./provider.types.js";
import type { Message, StopReason, ToolChoiceParam } from "./wire.types.js";

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
