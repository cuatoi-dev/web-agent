import { GATEWAY_BASE } from "./constants";
import type { PresetEntry } from "./types";

export type { PresetEntry } from "./types";

/** Combinations against the gateway: sonnet over Anthropic and OpenAI wire
 *  formats, and gemini-flash-lite-latest over Gemini wire format.
 *
 *  The path each wire format needs is fixed by the core providers:
 *    - openai:    ".../api/openai/v1"  -> provider appends "/chat/completions"
 *    - anthropic: ".../api/anthropic"  -> provider appends "/v1/messages"
 *    - gemini:    ".../api/gemini"     -> provider appends
 *      "/v1beta/models/{model}:generateContent", so NO "/v1" suffix. */
export const PRESET_ENTRIES: PresetEntry[] = [
  { id: "anthropic-sonnet", label: "Sonnet", endpoint: `${GATEWAY_BASE}/api/anthropic`, wireFormat: "anthropic", model: "sonnet", vision: true, provider: "Gateway" },
  { id: "openai-sonnet", label: "Sonnet OpenAI", endpoint: `${GATEWAY_BASE}/api/openai/v1`, wireFormat: "openai", model: "sonnet", vision: true, provider: "Gateway" },
  { id: "gemini-flash", label: "Gemini Flash", endpoint: `${GATEWAY_BASE}/api/gemini`, wireFormat: "gemini", model: "gemini-flash-lite-latest", vision: true, provider: "Gateway" },
];
