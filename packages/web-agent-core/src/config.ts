import type {
  AgentConfig,
  ContextConfig,
  ModelOption,
  SpeedPreset,
} from "./config.types.js";
export type {
  AgentConfig,
  ContextConfig,
  CueKind,
  CuesConfig,
  GenerationConfig,
  ImageConfig,
  ModelOption,
  SpeedPreset,
} from "./config.types.js";

export const SPEED_PRESETS: Record<"slow" | "fast", SpeedPreset> = {
  slow: { travelPxPerSec: 600,  msPerWord: 220 },
  fast: { travelPxPerSec: 1400, msPerWord: 90 },
};

/**
 * Return the default proxy base URL for a given endpoint type.
 */
export function defaultBaseURLFor(type: "anthropic" | "openai" | "gemini"): string {
  if (type === "anthropic") return "/api/anthropic";
  if (type === "openai") return "/api/openai/v1";
  return "/api/gemini";
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  kTurnsVerbatim: 3,
  contextLength: 128_000,
  autoCompactPercent: 0.75,
  charsPerToken: 4,
  jsonOverhead: 1.15,
  compactionMaxTokens: 32_000,
};

/**
 * Default width above which a row query must project columns. Measured on
 * 2026-08-21 against the 300-column wide-fixture source at the default
 * 6,000-character result budget: 40 columns still returns 4 rows, 50
 * returns 2, 60 returns 1 and 80 returns none. Forty is the widest source
 * that still answers a row question unprojected.
 */
export const DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD = 40;

// No default model. The host must set `model`; a session created without one
// throws at session start (see controller-config.ts buildConfig).
export const DEFAULT_CONFIG: Omit<AgentConfig, "model"> = {
  baseURL: "/api/anthropic",
  maxIterations: 200,
  turnTimeoutMs: 120_000,
  queryResultMaxChars: 6_000,
  wideSourceFieldThreshold: DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD,
  persist: false,
  context: DEFAULT_CONTEXT_CONFIG,
  endpointType: "anthropic",
  thinking: { enabled: false },
  generation: { maxOutputTokens: 32_000, maxRetries: 3 },
  cues: { enabled: true, speed: "slow" },
  imageInput: true,
  requestTimeoutMs: 900_000,
  maxRetries: 5,
  appendSystemPrompt: undefined,
};

/**
 * Resolve a model id to its friendly label from the host `models` list.
 * Falls back to the raw id when the id is absent or has no label.
 */
export function resolveModelLabel(models: ModelOption[] | undefined, id: string): string {
  const hit = models?.find((m) => m.id === id);
  return hit?.label || id;
}
