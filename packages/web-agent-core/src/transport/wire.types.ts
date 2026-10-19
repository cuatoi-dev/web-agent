// Anthropic wire types — the first-class internal representation of
// web-agent-core. Hand-written on purpose: only the fields this codebase sends
// or reads are declared, derived from the call sites, not from the SDK's full
// type surface. Verified against the vendor's messages and prompt-caching
// documentation on 2026-08-14.

/** Only `ephemeral` exists today. `ttl` is not sent by this codebase. */
export interface CacheControlEphemeral {
  type: "ephemeral";
}

export interface TextBlockParam {
  type: "text";
  text: string;
  cache_control?: CacheControlEphemeral;
}

export interface Base64ImageSource {
  type: "base64";
  media_type: string;
  data: string;
}

export interface ImageBlockParam {
  type: "image";
  source: Base64ImageSource;
  cache_control?: CacheControlEphemeral;
}

export interface ToolUseBlockParam {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  cache_control?: CacheControlEphemeral;
  extra_content?: Record<string, unknown>;
}

export interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: CacheControlEphemeral;
}

/**
 * Thinking blocks cannot carry an explicit `cache_control` (vendor prompt-caching
 * docs, checked 2026-08-14), so no such field is declared here.
 */
export interface ThinkingBlockParam {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface RedactedThinkingBlockParam {
  type: "redacted_thinking";
  data: string;
}

export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | RedactedThinkingBlockParam;

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
}

export interface Tool {
  name: string;
  description?: string;
  input_schema: { type: "object"; [key: string]: unknown };
  cache_control?: CacheControlEphemeral;
}

export type ToolChoiceParam =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

export interface ThinkingConfigParam {
  type: "enabled";
  budget_tokens: number;
}

export interface MessageCreateParams {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  system?: string | TextBlockParam[];
  tools?: Tool[];
  tool_choice?: ToolChoiceParam;
  thinking?: ThinkingConfigParam;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | null;

/** Response content blocks — what comes back, not what is sent. */
export interface TextBlock          { type: "text";              text: string }
export interface ThinkingBlock      { type: "thinking";          thinking: string; signature?: string }
export interface RedactedThinkingBlock { type: "redacted_thinking"; data: string }
export interface ToolUseBlock       { type: "tool_use";          id: string; name: string; input: unknown; extra_content?: Record<string, unknown> }

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ToolUseBlock;

export interface Message {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: ContentBlock[];
  stop_reason: StopReason;
  stop_sequence?: string | null;
  usage: Usage;
}
