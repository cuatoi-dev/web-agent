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
  { id: "anthropic-sonnet-nonstream", label: "Sonnet (non-stream)",         endpoint: `${GATEWAY_BASE}/api/anthropic`, wireFormat: "anthropic", model: "sonnet",                    streaming: false },
  { id: "anthropic-sonnet-stream",    label: "Sonnet (stream)",             endpoint: `${GATEWAY_BASE}/api/anthropic`, wireFormat: "anthropic", model: "sonnet",                    streaming: true  },
  { id: "openai-sonnet-stream",       label: "Sonnet OpenAI (stream)",      endpoint: `${GATEWAY_BASE}/api/openai/v1`, wireFormat: "openai",    model: "sonnet",                    streaming: true  },
  { id: "openai-sonnet-nonstream",    label: "Sonnet OpenAI (non-stream)",  endpoint: `${GATEWAY_BASE}/api/openai/v1`, wireFormat: "openai",    model: "sonnet",                    streaming: false },
  { id: "gemini-flash-stream",        label: "Gemini Flash (stream)",       endpoint: `${GATEWAY_BASE}/api/gemini`,    wireFormat: "gemini",    model: "gemini-flash-lite-latest",  streaming: true  },
  { id: "gemini-flash-nonstream",     label: "Gemini Flash (non-stream)",   endpoint: `${GATEWAY_BASE}/api/gemini`,    wireFormat: "gemini",    model: "gemini-flash-lite-latest",  streaming: false },
];
