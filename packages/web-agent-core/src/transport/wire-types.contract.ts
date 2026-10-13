// A compiling sample, not a test. It proves the local wire types accept the
// exact object literal that transport/anthropic-provider.ts:92-107 builds today,
// with no cast. If this file stops compiling, the types no longer fit the real
// request. `satisfies` is used so no widening hides a mismatch.
//
// This file deliberately does not import anything from the providers — task 001
// switches nothing over.
import type { MessageCreateParams, MessageParam, Tool } from "./wire.types.js";

const sampleMessages: MessageParam[] = [
  { role: "user", content: "hello" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "one moment" },
      { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "SG" } },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: "31C",
        is_error: false,
        cache_control: { type: "ephemeral" },
      },
    ],
  },
];

const sampleTools: Tool[] = [
  { name: "get_weather", description: "Look up the weather", input_schema: { type: "object" } },
];

/**
 * Mirrors the return of AnthropicLanguageModel.buildParams
 * (transport/anthropic-provider.ts:92-107) field for field, including the
 * conditional spreads, so the annotation is proven against the real shape.
 */
export const SAMPLE_REQUEST = {
  model: "claude-opus-5",
  max_tokens: 4096,
  system: [
    { type: "text", text: "static system", cache_control: { type: "ephemeral" } },
    { type: "text", text: "dynamic system", cache_control: { type: "ephemeral" } },
  ],
  messages: sampleMessages,
  tools: sampleTools,
  tool_choice: { type: "tool", name: "get_weather" },
  thinking: { type: "enabled", budget_tokens: 1024 },
  stop_sequences: ["\n\nHuman:"],
} satisfies MessageCreateParams;

/** The other branch of buildParams: sampling parameters instead of thinking. */
export const SAMPLE_REQUEST_SAMPLING = {
  model: "claude-opus-5",
  max_tokens: 4096,
  messages: [{ role: "user", content: "hi" }],
  temperature: 0.2,
  top_p: 0.9,
  top_k: 40,
} satisfies MessageCreateParams;

/** A plain string system prompt — the else branch at anthropic-provider.ts:84-86. */
export const SAMPLE_REQUEST_STRING_SYSTEM = {
  model: "claude-opus-5",
  max_tokens: 4096,
  system: "you are helpful",
  messages: [{ role: "user", content: "hi" }],
} satisfies MessageCreateParams;
