import type { AgentConfig } from "../config.types.js";
import type { ProviderFactory } from "./types.js";
export type { ProviderFactory } from "./types.js";
import type { LanguageModel } from "./provider.types.js";
import { createAnthropicLanguageModel } from "./anthropic-provider.js";
import { createOpenAILanguageModel } from "./openai-provider.js";
import { createGeminiLanguageModel } from "./gemini-provider.js";
import { createMockProvider, ECHO_SCRIPT, type MockScript } from "./mock-provider.js";
import { wrapProvider, withRetry } from "./middleware.js";

const factories = new Map<string, ProviderFactory>();

export const providerRegistry = {
  register(endpointType: string, factory: ProviderFactory): void {
    factories.set(endpointType, factory);
  },

  get(cfg: AgentConfig, opts?: { fetch?: typeof fetch }): LanguageModel {
    const factory = factories.get(cfg.endpointType);
    if (!factory) {
      throw new Error(`[providerRegistry] No provider registered for endpointType "${cfg.endpointType}"`);
    }
    return factory(cfg, opts);
  },
};

// Real providers are wrapped with withRetry so empty/dead streams (the
// `[DONE]`-only / hung-SSE case from combo gateways) and transient failures are
// retried with a per-request timeout instead of crashing the turn.
providerRegistry.register("anthropic", (cfg, opts) =>
  wrapProvider(createAnthropicLanguageModel(cfg, opts), withRetry(cfg)));
providerRegistry.register("openai", (cfg, opts) =>
  wrapProvider(createOpenAILanguageModel(cfg, opts), withRetry(cfg)));
providerRegistry.register("gemini", (cfg, opts) =>
  wrapProvider(createGeminiLanguageModel(cfg, opts), withRetry(cfg)));

// ---------------------------------------------------------------------------
// Mock provider — deterministic, network-free; script supplied via setMockScript
// ---------------------------------------------------------------------------

let _mockScript: MockScript = ECHO_SCRIPT;

export function setMockScript(s: MockScript): void {
  _mockScript = s;
}

// Wrapped with withRetry too, so mock-tier e2e can deterministically exercise
// the same transport-level retry/backoff behavior (maxRetries, onRetryAttempt)
// as the real providers — e.g. scripted retryable errors via MockResponse.error.
providerRegistry.register("mock", (cfg) => wrapProvider(createMockProvider(_mockScript), withRetry(cfg)));
