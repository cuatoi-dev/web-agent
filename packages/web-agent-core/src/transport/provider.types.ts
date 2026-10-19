// Reuse from types.ts — no duplication
import type { ResponseBlock, Tool } from "../types.js";
export type { ResponseBlock, Tool };

export type FinishReason =
  | "stop"           // end_turn, stop_sequence
  | "length"         // max_tokens
  | "tool-calls"     // tool_use
  | "content-filter" // refusal
  | "error"
  | "other"          // pause_turn, etc.
  | "unknown";       // null / unexpected

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;      // OpenAI/Gemini: reasoning token count, when reported
  cachedInputTokens?: number;    // Anthropic: cache_read_input_tokens
  cacheCreationTokens?: number;  // Anthropic: cache_creation_input_tokens
}

export type ProviderWarning =
  | { type: "unsupported"; feature: string; details?: string }
  | { type: "other"; message: string };

export type ToolChoice =
  | { type: "auto" }
  | { type: "required" }
  | { type: "none" }
  | { type: "tool"; toolName: string };

// Escape hatch for provider-specific inputs/outputs — keyed by provider name.
export type ProviderOptions  = Record<string, Record<string, unknown>>;
export type ProviderMetadata = Record<string, Record<string, unknown>>;

export interface ProviderCallOptions {
  messages: import("../types.js").ModelMessage[];
  systemPrompt?: string;
  model: string;
  tools?: Tool[];
  toolChoice?: ToolChoice;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  seed?: number;
  abortSignal?: AbortSignal;
  /** Provider-specific escape hatch. e.g. `{ anthropic: { thinking: { type:"enabled", budget_tokens:1024 } } }` */
  providerOptions?: ProviderOptions;
}

export interface ProviderResult {
  content: ResponseBlock[];
  finishReason: FinishReason;
  usage: NormalizedUsage;
  warnings?: ProviderWarning[];
  providerMetadata?: ProviderMetadata;
}

export interface LanguageModel {
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls?: {
    [mimeType: string]: RegExp[];
  };
  generate(opts: ProviderCallOptions): Promise<ProviderResult>;
}
