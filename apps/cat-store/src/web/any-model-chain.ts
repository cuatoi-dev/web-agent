import {
  createFallbackProviderFactory,
  providerRegistry,
  type FallbackChainEntry,
} from "@cuatoi/web-agent-core";

/** The `endpointType` the "Any model" switcher entry selects. Host-owned: core
 *  ships the chain provider but registers no chain, because `AgentConfig`
 *  carries no entry list for one to read. */
export const ANY_MODEL_ENDPOINT_TYPE = "fallback-chain";

/** Every combination the switcher offers, in fallback order: "Any model" tries
 *  all six, so anything reachable from the picker is reachable from the chain.
 *
 *  Order is non-streaming before streaming on each path, and Anthropic before
 *  OpenAI before Gemini — the non-streaming Anthropic path is the default entry,
 *  so the chain starts where an ordinary session starts and only widens from
 *  there.
 *
 *  Paths match the reverse proxy routes in web-agent-core docs/providers.md and
 *  the suffix each provider appends — see agent-panel-config.ts for the detail. */
export const ANY_MODEL_CHAIN: FallbackChainEntry[] = [
  { endpointType: "anthropic", model: "sonnet",                   baseURL: "/api/anthropic",  streaming: false },
  { endpointType: "anthropic", model: "sonnet",                   baseURL: "/api/anthropic",  streaming: true  },
  { endpointType: "openai",    model: "sonnet",                   baseURL: "/api/openai/v1",  streaming: false },
  { endpointType: "openai",    model: "sonnet",                   baseURL: "/api/openai/v1",  streaming: true  },
  { endpointType: "gemini",    model: "gemini-flash-lite-latest", baseURL: "/api/gemini",     streaming: false },
  { endpointType: "gemini",    model: "gemini-flash-lite-latest", baseURL: "/api/gemini",     streaming: true  },
];

// Registered once, at module load, so the cursor inside the factory lives for
// the whole page load and survives every panel rebuild.
providerRegistry.register(
  ANY_MODEL_ENDPOINT_TYPE,
  createFallbackProviderFactory(ANY_MODEL_CHAIN),
);
