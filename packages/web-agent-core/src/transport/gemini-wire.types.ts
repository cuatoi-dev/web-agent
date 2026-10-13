// Gemini generateContent wire types. Hand-written on purpose: only the fields
// this codebase sends or reads are declared, derived from the call sites rather
// than from the SDK's full type surface. Field names verified against a live
// probe of the project's own key on 2026-08-15.

// --- request -------------------------------------------------------------

/** Base64 attachment. Verified: camelCase `inlineData`/`mimeType` is accepted. */
export interface GeminiBlob {
  mimeType: string;
  data: string;
}

export interface GeminiFunctionCall {
  /** Present on live responses (e.g. "call_286085"); optional per the API. */
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface GeminiFunctionResponse {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export interface GeminiPart {
  text?: string;
  inlineData?: GeminiBlob;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
  /**
   * Sibling of `functionCall`, not nested inside it. Must be echoed back on a
   * functionCall part in history or the API returns 400 (probe, 2026-08-15).
   */
  thoughtSignature?: string;
  /** True on a thinking part, for models that return thinking text. */
  thought?: boolean;
}

export interface GeminiContent {
  /** "user" or "model". Absent on some streamed frames. */
  role?: string;
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  /** Standard JSON Schema, incl. `additionalProperties`/`$schema`/`$ref`/`$defs`.
   *  NOT `parameters` (a restricted OpenAPI 3.0 subset that rejects those
   *  keywords): a live browser run against `zod-to-json-schema`-generated tool
   *  schemas 400'd on `parameters` with "Unknown name \"additionalProperties\" …
   *  Cannot find field" on 2026-08-15. Verified live the same day that
   *  `parametersJsonSchema` accepts the same payload and returns a correct
   *  `functionCall`, including with `$ref`/`$defs`. */
  parametersJsonSchema?: Record<string, unknown>;
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export type GeminiFunctionCallingMode = "AUTO" | "ANY" | "NONE";

export interface GeminiToolConfig {
  functionCallingConfig: {
    mode: GeminiFunctionCallingMode;
    allowedFunctionNames?: string[];
  };
}

export interface GeminiGenerationConfig {
  /** Optional here, unlike Anthropic's required max_tokens. Never defaulted. */
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  seed?: number;
}

/**
 * No `model` field on purpose: the model and the action live in the URL path
 * (`/v1beta/models/<model>:generateContent`). gemini-provider.ts composes the path.
 */
export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiContent;
  tools?: GeminiTool[];
  toolConfig?: GeminiToolConfig;
  generationConfig?: GeminiGenerationConfig;
}

// --- response ------------------------------------------------------------

/** Documented values plus `string`, because a gateway may send its own. */
export type GeminiFinishReason = string;

/**
 * The counts are disjoint: prompt + candidates + thoughts = total (probe:
 * 3 + 1 + 59 = 63). `totalTokenCount` must never be mapped to output tokens.
 * Every field is optional; `thoughtsTokenCount` is absent on non-thinking turns.
 */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

export interface GeminiCandidate {
  /** Absent when the candidate was blocked before any part was produced. */
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: GeminiFinishReason;
  index?: number;
  /** e.g. "Model generated function call(s)." Informational only. */
  finishMessage?: string;
}

export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
  responseId?: string;
  promptFeedback?: { blockReason?: string };
}

/** A streamed frame has the same shape as a complete response. */
export type GeminiStreamChunk = GeminiGenerateContentResponse;
