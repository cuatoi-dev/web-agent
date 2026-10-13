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
  streaming?: boolean;
  /**
   * Called by the transport every time bytes arrive from the response body,
   * including server-sent-events keep-alive comments that parse to no event.
   * `withRetry` uses it to tell a slow-but-live stream from a hung one: the
   * per-attempt deadline is time since the last call to this, not time to the
   * first content part. Providers must forward it to the reader; a provider
   * that never calls it keeps the old total-deadline behaviour.
   */
  onTransportProgress?: () => void;
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

// ---------------------------------------------------------------------------
// StreamPart — normalized stream-event union (mirrors AI SDK LanguageModelV2StreamPart)
// reasoning-start carries an optional signature for providers that supply one
// (e.g. Anthropic thinking blocks).
// ---------------------------------------------------------------------------
export type StreamPart =
  | { type: "stream-start"; warnings: ProviderWarning[] }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string; signature?: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string; signature?: string }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-input-end"; id: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string; extra_content?: Record<string, unknown> }
  // stream-restart: the retry middleware abandoned an attempt that had already
  // yielded content and is about to replay a fresh one into this same consumer.
  // Everything yielded before it belongs to a dead attempt and must be dropped.
  // Only `withRetry` emits it; no provider ever does. `attempt` is the 0-based
  // number of the attempt that follows, so a live trace can tell a retried turn
  // from a clean one.
  | { type: "stream-restart"; attempt: number }
  | { type: "finish"; finishReason: FinishReason; usage: NormalizedUsage; providerMetadata?: ProviderMetadata }
  | { type: "error"; error: unknown };

export interface LanguageModel {
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls?: {
    [mimeType: string]: RegExp[];
  };
  generate(opts: ProviderCallOptions): Promise<ProviderResult>;
  doStream?(opts: ProviderCallOptions): Promise<{ stream: AsyncIterable<StreamPart> }>;
}
