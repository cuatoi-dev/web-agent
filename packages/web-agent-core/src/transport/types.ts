// Shapes the transport modules declare. The provider contract itself lives in
// `provider.types.ts`; the vendor wire formats live in `wire.types.ts` and the
// `*-wire.types.ts` files beside it.
import type { AgentConfig } from "../config.types.js";
import type { ResponseBlock } from "../types.js";
import type {
  FinishReason,
  LanguageModel,
  NormalizedUsage,
  ProviderCallOptions,
  ProviderMetadata,
  ProviderResult,
  ProviderWarning,
} from "./provider.types.js";
import type { Message } from "./wire.types.js";

export interface AnthropicRequestOptions {
  /** Endpoint root, for example "/api/anthropic" or "https://host/v1". */
  baseURL: string;
  /** Path appended to baseURL, for example "/v1/messages". Caller-owned. */
  path: string;
  /** Every header the request needs. This helper adds none of its own. */
  headers: Record<string, string>;
  /** Request body; serialised with JSON.stringify. */
  body: unknown;
  /** Injected fetch. When given, this is the function that runs. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// LanguageModelMiddleware — minimal mirror of AI SDK LanguageModelV2Middleware
//
// wrapGenerate receives a `doGenerate` that accepts an
// optional override `params`. Middleware that needs to mutate call options
// (e.g. swap the abortSignal for a timed-out one — see withRetry) passes new
// params; middleware that doesn't simply calls it with no argument and the
// closure's captured params are used.
// ---------------------------------------------------------------------------

export interface LanguageModelMiddleware {
  transformParams?: (
    a: { type: "generate"; params: ProviderCallOptions },
  ) => ProviderCallOptions | Promise<ProviderCallOptions>;

  wrapGenerate?: (a: {
    doGenerate: (params?: ProviderCallOptions) => Promise<ProviderResult>;
    params: ProviderCallOptions;
    model: LanguageModel;
  }) => Promise<ProviderResult>;

  overrideProvider?: (a: { model: LanguageModel }) => string;
  overrideModelId?: (a: { model: LanguageModel }) => string;
}

export type ProviderFactory = (cfg: AgentConfig, opts?: { fetch?: typeof fetch }) => LanguageModel;

export interface MockError {
  message?: string;   // default "Mock provider error"
  status?: number;    // set on thrown err as status AND statusCode
  name?: string;      // e.g. "AbortError"; default "Error"
}

export interface MockResponse {
  content?: ResponseBlock[];
  text?: string;
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  finishReason?: FinishReason;
  usage?: NormalizedUsage;
  warnings?: ProviderWarning[];
  providerMetadata?: ProviderMetadata;
  error?: MockError;
  /** Hold the call open for this many milliseconds before resolving. Rejects
   *  with AbortError if the call's signal aborts first. */
  delayMs?: number;
}

export type MockScript =
  | MockResponse
  | MockResponse[]
  | ((opts: ProviderCallOptions) => MockResponse);

export interface ToGeminiContentsOptions {
  imageInputEnabled?: boolean;
  modelSupportsVision?: boolean;
  /** toolCallId -> thoughtSignature, from a previous response. */
  thoughtSignatures?: Record<string, string>;
}

export interface GeminiTranslatedResponse {
  message: Message;
  finishReason: FinishReason;
  /** Present only when the response reported it. Never defaulted to 0. */
  reasoningTokens?: number;
  /** toolCallId -> thoughtSignature. Empty/absent when the turn had no call. */
  thoughtSignatures?: Record<string, string>;
}

export interface OpenAITranslatedResponse {
  message: Message;
  finishReason: FinishReason;
  /** Present only when the response reported it. Never defaulted to 0. */
  reasoningTokens?: number;
}
