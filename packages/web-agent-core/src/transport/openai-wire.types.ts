// OpenAI chat-completions wire types. Hand-written on purpose: only the fields
// this codebase sends or reads are declared, derived from the call sites rather
// than from the SDK's full type surface. Field names verified against the vendor
// API reference and a live probe of the project's own gateway on 2026-08-14.

export interface OpenAITool {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

export type OpenAIToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "function"; function: { name: string } };

/** Union as declared by openai@6.37.0 (resources/shared.d.ts:194). */
export type OpenAIReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  extra_content?: Record<string, unknown>;
}

export type OpenAIMessageParam =
  | { role: "system" | "developer"; content: string }
  | { role: "user"; content: string | OpenAIContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpenAIChatCompletionCreateParams {
  model: string;
  messages: OpenAIMessageParam[];
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: OpenAIReasoningEffort;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  seed?: number;
  stream?: boolean;
}

/** Every field optional: gateways omit parts of it (live probe, 2026-08-14). */
export interface OpenAICompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
    audio_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    audio_tokens?: number;
  };
}

/** Documented values, plus `string` because a gateway may send its own. */
export type OpenAIFinishReason = string | null;

export interface OpenAIResponseMessage {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  /** Non-standard; the project's gateway sends it. Not mapped into content. */
  reasoning?: string | null;
}

export interface OpenAIChoice {
  index?: number;
  message: OpenAIResponseMessage;
  finish_reason?: OpenAIFinishReason;
}

export interface OpenAIChatCompletion {
  id?: string;
  object?: string;
  model?: string;
  choices: OpenAIChoice[];
  usage?: OpenAICompletionUsage | null;
}
