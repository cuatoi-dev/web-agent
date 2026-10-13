import { describe, it, expect, vi } from "vitest";
import {
  toOpenAIMessages,
  fromOpenAIResponse,
  OpenAIStreamTranslator,
} from "./openai-to-anthropic.js";
import { fromAnthropicResponse } from "./message-converter.js";
import type { ProviderWarning } from "./provider.types.js";
import type { ModelMessage, ToolCallPart, ToolResultPart } from "../types.js";
import type { OpenAIChatCompletion, OpenAIMessageParam, OpenAIContentPart } from "./openai-wire.types.js";
import type { MessageStreamEvent, ToolUseBlock } from "./wire.types.js";
import { isStreamEventType } from "./wire.types.js";

// ---------------------------------------------------------------------------
// toOpenAIMessages tests
// ---------------------------------------------------------------------------
describe("toOpenAIMessages", () => {
  it("an assistant message with no content is not sent", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [] },
      { role: "user", content: "still there?" },
    ];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role === "user")).toBe(true);
  });

  it("filters system messages (handled separately)", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      { role: "system", content: "You are a bot" },
      { role: "user", content: "hello" },
    ];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "user", content: "hello" });
  });

  it("maps user string messages directly", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [{ role: "user", content: "hello" }];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "user", content: "hello" });
  });

  it("maps user structured parts (text + image) with warning for image", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "describe this" },
          { type: "image", image: "data:image/png,abc", mediaType: "image/png" },
        ],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "describe this" },
        { type: "image_url", image_url: { url: "data:image/png,abc" } },
      ],
    });
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w.type).toBe("unsupported");
    if (w.type === "unsupported") expect(w.feature).toBe("image-input");
  });

  it("throws an error when image part has empty payload", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image: "data:,", mediaType: "image/png" }],
      },
    ];
    expect(() =>
      toOpenAIMessages(msgs, warnings, { modelSupportsVision: true })
    ).toThrow("Invalid image: base64 payload is empty");
  });

  it("throws an error in legacy mode when image part is empty", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image: "data:,", mediaType: "image/png" }],
      },
    ];
    expect(() => toOpenAIMessages(msgs, warnings, undefined)).toThrow(
      "Invalid image: base64 payload is empty"
    );
  });

  it("maps assistant string content", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [{ role: "assistant", content: "Sure!" }];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "assistant", content: "Sure!" });
  });

  it("maps assistant structured content with text and tool-call parts", () => {
    const warnings: ProviderWarning[] = [];
    const tcPart: ToolCallPart = {
      type: "tool-call",
      toolCallId: "call_123",
      toolName: "get_weather",
      input: { location: "NYC" },
    };
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Let me check" }, tcPart],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    const msg = result[0] as Extract<OpenAIMessageParam, { role: "assistant" }>;
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("Let me check");
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].id).toBe("call_123");
    expect(msg.tool_calls![0].function.name).toBe("get_weather");
    expect(JSON.parse(msg.tool_calls![0].function.arguments)).toEqual({
      location: "NYC",
    });
  });

  it("maps assistant content with only tool-calls (null content)", () => {
    const warnings: ProviderWarning[] = [];
    const tcPart: ToolCallPart = {
      type: "tool-call",
      toolCallId: "call_456",
      toolName: "search",
      input: { q: "test" },
    };
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [tcPart],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    const msg = result[0] as Extract<OpenAIMessageParam, { role: "assistant" }>;
    expect(msg.content).toBeNull();
    expect(msg.tool_calls).toHaveLength(1);
  });

  it("preserves extra_content on assistant tool-call parts", () => {
    const warnings: ProviderWarning[] = [];
    const tcPart: ToolCallPart = {
      type: "tool-call",
      toolCallId: "call_extra",
      toolName: "search",
      input: { query: "test" },
      extra_content: { google: { thought_signature: "sig_abc123" } },
    };
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [tcPart],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    const msg = result[0] as Extract<OpenAIMessageParam, { role: "assistant" }>;
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].extra_content).toEqual({
      google: { thought_signature: "sig_abc123" },
    });
  });

  it("maps tool result messages", () => {
    const warnings: ProviderWarning[] = [];
    const trPart: ToolResultPart = {
      type: "tool-result",
      toolCallId: "call_123",
      toolName: "get_weather",
      output: "Sunny",
    };
    const msgs: ModelMessage[] = [
      {
        role: "tool",
        content: [trPart],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: "Sunny",
    });
  });

  it("maps tool result with object output to JSON string", () => {
    const warnings: ProviderWarning[] = [];
    const trPart: ToolResultPart = {
      type: "tool-result",
      toolCallId: "call_789",
      toolName: "search",
      output: { results: ["a", "b"] },
    };
    const msgs: ModelMessage[] = [
      {
        role: "tool",
        content: [trPart],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('{"results":["a","b"]}');
  });
});

describe("toOpenAIMessages — vision/image support", () => {
  it("Vision Model (Success): maps ImagePart to image_url and returns NO warning", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: "data:image/png;base64,abc",
            mediaType: "image/png",
          },
        ],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings, {
      modelId: "gpt-4o",
      modelSupportsVision: true,
    });
    expect(warnings).toHaveLength(0);
    expect(result).toHaveLength(1);
    const content = result[0].content as OpenAIContentPart[];
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc" },
    });
  });

  it("FilePart Base64 (Success): maps FilePart (raw base64) to image_url data URL and returns NO warning", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "file", data: "abc", mediaType: "image/png" }],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings, {
      modelId: "gpt-4o",
      modelSupportsVision: true,
    });
    expect(warnings).toHaveLength(0);
    expect(result).toHaveLength(1);
    const content = result[0].content as OpenAIContentPart[];
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc" },
    });
  });

  it("FilePart URL (Success): maps FilePart (HTTP URL) to image_url direct URL and returns NO warning", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            data: "https://example.com/test.jpg",
            mediaType: "image/jpeg",
          },
        ],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings, {
      modelId: "gpt-4o",
      modelSupportsVision: true,
    });
    expect(warnings).toHaveLength(0);
    expect(result).toHaveLength(1);
    const content = result[0].content as OpenAIContentPart[];
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: "https://example.com/test.jpg" },
    });
  });

  it("Text-Only Model (Warning & Drop): drops the image/file part and returns a warning", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look here" },
          {
            type: "image",
            image: "data:image/png;base64,abc",
            mediaType: "image/png",
          },
        ],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings, {
      modelId: "gpt-3.5-turbo",
      modelSupportsVision: false,
    });
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w.type).toBe("unsupported");
    if (w.type === "unsupported") expect(w.feature).toBe("image-input");
    expect(result).toHaveLength(1);
    const content = result[0].content as OpenAIContentPart[];
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "Look here" });
  });

  it("Config Disabled (Warning & Drop): drops the image/file part and returns a warning when imageInputEnabled is false", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look here" },
          {
            type: "image",
            image: "data:image/png;base64,abc",
            mediaType: "image/png",
          },
        ],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings, {
      modelId: "gpt-4o",
      modelSupportsVision: true,
      imageInputEnabled: false,
    });
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w.type).toBe("unsupported");
    if (w.type === "unsupported") expect(w.feature).toBe("image-input");
    expect(result).toHaveLength(1);
    const content = result[0].content as OpenAIContentPart[];
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "Look here" });
  });

  it("imageInput: true precedence: maps the image even if model heuristic is false", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: "data:image/png;base64,abc",
            mediaType: "image/png",
          },
        ],
      },
    ];
    const result = toOpenAIMessages(msgs, warnings, {
      modelId: "gpt-3.5-turbo",
      modelSupportsVision: false,
      imageInputEnabled: true,
    });
    expect(warnings).toHaveLength(0);
    expect(result).toHaveLength(1);
    const content = result[0].content as OpenAIContentPart[];
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc" },
    });
  });
});

// ---------------------------------------------------------------------------
// fromOpenAIResponse tests
// ---------------------------------------------------------------------------
describe("fromOpenAIResponse — content", () => {
  it("maps text content", () => {
    const resp: OpenAIChatCompletion = {
      choices: [{ message: { content: "Hello!" }, finish_reason: "stop" }],
    };
    const translated = fromOpenAIResponse(resp);
    const parsedContent = fromAnthropicResponse(translated.message).content;
    expect(parsedContent).toHaveLength(1);
    expect(parsedContent[0]).toEqual({ type: "text", text: "Hello!" });
    expect(translated.finishReason).toBe("stop");
  });

  it("maps tool_calls safely", () => {
    const resp: OpenAIChatCompletion = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"loc":"NYC"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const translated = fromOpenAIResponse(resp);
    const parsedContent = fromAnthropicResponse(translated.message).content;
    expect(parsedContent).toHaveLength(1);
    expect(parsedContent[0]).toEqual({
      type: "tool_use",
      id: "call_1",
      name: "get_weather",
      input: { loc: "NYC" },
    });
    expect(translated.finishReason).toBe("tool-calls");
  });

  it("handles invalid JSON in tool arguments gracefully", () => {
    const resp: OpenAIChatCompletion = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_bad",
                type: "function",
                function: { name: "f", arguments: "{invalid" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const translated = fromOpenAIResponse(resp);
    const parsedContent = fromAnthropicResponse(translated.message).content;
    expect(parsedContent[0]).toEqual({
      type: "tool_use",
      id: "call_bad",
      name: "f",
      input: {},
    });
  });

  it("warns when tool arguments fail to parse", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const resp: OpenAIChatCompletion = {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_bad",
                  type: "function",
                  function: { name: "f", arguments: "{invalid" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
      const translated = fromOpenAIResponse(resp);
      const parsedContent = fromAnthropicResponse(translated.message).content;
      expect(parsedContent[0]).toEqual({
        type: "tool_use",
        id: "call_bad",
        name: "f",
        input: {},
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("f");
      expect(msg).toContain("call_bad");
      expect(msg).toContain("{invalid");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns when tool arguments are absent", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const resp: OpenAIChatCompletion = {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_none",
                  type: "function",
                  function: { name: "f" } as unknown as { name: string; arguments: string },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
      const translated = fromOpenAIResponse(resp);
      const parsedContent = fromAnthropicResponse(translated.message).content;
      expect(parsedContent[0]).toEqual({
        type: "tool_use",
        id: "call_none",
        name: "f",
        input: {},
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("no argument JSON");
      expect(msg).toContain("f");
      expect(msg).toContain("call_none");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn for valid tool arguments", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const resp: OpenAIChatCompletion = {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_ok",
                  type: "function",
                  function: { name: "f", arguments: '{"loc":"NYC"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
      const translated = fromOpenAIResponse(resp);
      const parsedContent = fromAnthropicResponse(translated.message).content;
      expect(parsedContent[0]).toEqual({
        type: "tool_use",
        id: "call_ok",
        name: "f",
        input: { loc: "NYC" },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("drops reasoning property from message content on non-streaming path", () => {
    const resp: OpenAIChatCompletion = {
      choices: [
        {
          message: { content: "Main text", reasoning: "Some reasoning" },
          finish_reason: "stop",
        },
      ],
    };
    const translated = fromOpenAIResponse(resp);
    const parsedContent = fromAnthropicResponse(translated.message).content;
    expect(parsedContent).toHaveLength(1);
    expect(parsedContent[0]).toEqual({ type: "text", text: "Main text" });
  });

  it("preserves extra_content in tool_use blocks", () => {
    const resp: OpenAIChatCompletion = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_extra",
                type: "function",
                function: { name: "get_weather", arguments: '{"loc":"NYC"}' },
                extra_content: { google: { thought_signature: "sig_xyz" } },
              },
            ],
          },
          finish_reason: "stop",
        },
      ],
    };
    const translated = fromOpenAIResponse(resp);
    expect(translated.message.content).toHaveLength(1);
    expect(translated.message.content[0]).toEqual({
      type: "tool_use",
      id: "call_extra",
      name: "get_weather",
      input: { loc: "NYC" },
      extra_content: { google: { thought_signature: "sig_xyz" } },
    });
    expect(translated.finishReason).toBe("tool-calls");
    expect(translated.message.stop_reason).toBe("tool_use");
  });
});

describe("fromOpenAIResponse — finish reasons", () => {
  it("maps all finish reasons correctly", () => {
    const makeResp = (finish_reason: string | null): OpenAIChatCompletion => ({
      choices: [{ message: { content: "" }, finish_reason }],
    });

    expect(fromOpenAIResponse(makeResp("stop")).finishReason).toBe("stop");
    expect(fromOpenAIResponse(makeResp("stop")).message.stop_reason).toBe("end_turn");

    expect(fromOpenAIResponse(makeResp("length")).finishReason).toBe("length");
    expect(fromOpenAIResponse(makeResp("length")).message.stop_reason).toBe("max_tokens");

    expect(fromOpenAIResponse(makeResp("tool_calls")).finishReason).toBe("tool-calls");
    expect(fromOpenAIResponse(makeResp("tool_calls")).message.stop_reason).toBe("tool_use");

    expect(fromOpenAIResponse(makeResp("content_filter")).finishReason).toBe("content-filter");
    expect(fromOpenAIResponse(makeResp("content_filter")).message.stop_reason).toBe("refusal");

    expect(fromOpenAIResponse(makeResp("error")).finishReason).toBe("error");
    expect(fromOpenAIResponse(makeResp("error")).message.stop_reason).toBeNull();

    expect(fromOpenAIResponse(makeResp(null)).finishReason).toBe("unknown");
    expect(fromOpenAIResponse(makeResp(null)).message.stop_reason).toBeNull();

    expect(fromOpenAIResponse(makeResp("some_custom")).finishReason).toBe("other");
    expect(fromOpenAIResponse(makeResp("some_custom")).message.stop_reason).toBeNull();
  });

  it("handles finish reasons when tool calls are present", () => {
    const makeRespWithTools = (finish_reason: string | null): OpenAIChatCompletion => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "test_fn", arguments: "{}" },
              },
            ],
          },
          finish_reason,
        },
      ],
    });

    // finish_reason: "stop" with tool calls -> normalized to tool-calls / tool_use (e.g. Gemini OpenAI proxy)
    expect(fromOpenAIResponse(makeRespWithTools("stop")).finishReason).toBe("tool-calls");
    expect(fromOpenAIResponse(makeRespWithTools("stop")).message.stop_reason).toBe("tool_use");

    // finish_reason: null with tool calls -> normalized to tool-calls / tool_use
    expect(fromOpenAIResponse(makeRespWithTools(null)).finishReason).toBe("tool-calls");
    expect(fromOpenAIResponse(makeRespWithTools(null)).message.stop_reason).toBe("tool_use");

    // finish_reason: "tool_calls" with tool calls -> tool-calls / tool_use
    expect(fromOpenAIResponse(makeRespWithTools("tool_calls")).finishReason).toBe("tool-calls");
    expect(fromOpenAIResponse(makeRespWithTools("tool_calls")).message.stop_reason).toBe("tool_use");

    // finish_reason: "length" with tool calls -> truncation preserved, NOT tool-calls!
    expect(fromOpenAIResponse(makeRespWithTools("length")).finishReason).toBe("length");
    expect(fromOpenAIResponse(makeRespWithTools("length")).message.stop_reason).toBe("max_tokens");

    // finish_reason: "content_filter" with tool calls -> refusal preserved!
    expect(fromOpenAIResponse(makeRespWithTools("content_filter")).finishReason).toBe("content-filter");
    expect(fromOpenAIResponse(makeRespWithTools("content_filter")).message.stop_reason).toBe("refusal");
  });
});

describe("fromOpenAIResponse — usage", () => {
  it("maps prompt and completion tokens to input/output tokens", () => {
    const resp: OpenAIChatCompletion = {
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };
    const translated = fromOpenAIResponse(resp);
    expect(translated.message.usage.input_tokens).toBe(10);
    expect(translated.message.usage.output_tokens).toBe(20);
  });

  // Task 086-003 specific requirement: cache token fields MUST be absent, never 0.
  it("ensures cache token fields are absent when usage is absent, 0, or non-zero (task 086-003)", () => {
    // 1. Usage absent
    const respNoUsage: OpenAIChatCompletion = {
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
    };
    const msg1 = fromOpenAIResponse(respNoUsage).message;
    expect("cache_read_input_tokens" in msg1.usage).toBe(false);
    expect("cache_creation_input_tokens" in msg1.usage).toBe(false);

    // 2. Gateway sends cached_tokens: 0
    const respZeroCache: OpenAIChatCompletion = {
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    };
    const msg2 = fromOpenAIResponse(respZeroCache).message;
    expect("cache_read_input_tokens" in msg2.usage).toBe(false);
    expect("cache_creation_input_tokens" in msg2.usage).toBe(false);

    // 3. Model reports cached_tokens: 5
    const respFiveCache: OpenAIChatCompletion = {
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 5 },
      },
    };
    const msg3 = fromOpenAIResponse(respFiveCache).message;
    expect("cache_read_input_tokens" in msg3.usage).toBe(false);
    expect("cache_creation_input_tokens" in msg3.usage).toBe(false);
  });

  it("maps reasoningTokens when reported and omits when absent", () => {
    const respWithReasoning: OpenAIChatCompletion = {
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        completion_tokens_details: { reasoning_tokens: 7 },
      },
    };
    expect(fromOpenAIResponse(respWithReasoning).reasoningTokens).toBe(7);

    const respNoReasoning: OpenAIChatCompletion = {
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };
    expect(fromOpenAIResponse(respNoReasoning).reasoningTokens).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OpenAIStreamTranslator tests
// ---------------------------------------------------------------------------
describe("OpenAIStreamTranslator", () => {
  it("translates text deltas into content_block_start, delta, and stop", () => {
    const translator = new OpenAIStreamTranslator();
    const events1 = translator.push({
      choices: [{ delta: { content: "Hello " } }],
    });
    expect(events1).toHaveLength(2);
    expect(events1[0]).toEqual({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    expect(events1[1]).toEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello " },
    });

    const events2 = translator.push({
      choices: [{ delta: { content: "world!" } }],
    });
    expect(events2).toHaveLength(1);
    expect(events2[0]).toEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "world!" },
    });

    const endEvents = translator.end();
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]).toEqual({ type: "content_block_stop", index: 0 });
  });

  it("ignores empty content string deltas", () => {
    const translator = new OpenAIStreamTranslator();
    const events = translator.push({
      choices: [{ delta: { content: "" } }],
    });
    expect(events).toHaveLength(0);
  });

  it("translates delta.reasoning / delta.reasoning_content to thinking block", () => {
    const translator = new OpenAIStreamTranslator();
    const events1 = translator.push({
      choices: [{ delta: { reasoning: "Thinking " } }],
    });
    expect(events1).toHaveLength(2);
    expect(events1[0]).toEqual({
      type: "content_block_start",
      index: 1,
      content_block: { type: "thinking", thinking: "" },
    });
    expect(events1[1]).toEqual({
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "Thinking " },
    });

    const events2 = translator.push({
      choices: [{ delta: { reasoning_content: "more..." } }],
    });
    expect(events2).toHaveLength(1);
    expect(events2[0]).toEqual({
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "more..." },
    });

    const endEvents = translator.end();
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]).toEqual({ type: "content_block_stop", index: 1 });
  });

  it("translates tool-call deltas and emits content_block_stop on finish or end", () => {
    const translator = new OpenAIStreamTranslator();

    // First chunk: tool id, name, partial argument '{"location"'
    const events1 = translator.push({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"location"' },
              },
            ],
          },
        },
      ],
    });

    expect(events1).toHaveLength(2);
    expect(events1[0]).toEqual({
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "call_1", name: "get_weather", input: {} },
    });
    expect(events1[1]).toEqual({
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"location"' },
    });

    // Second chunk: argument delta ':"NYC"}'
    const events2 = translator.push({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: ':"NYC"}' },
              },
            ],
          },
        },
      ],
    });

    expect(events2).toHaveLength(1);
    expect(events2[0]).toEqual({
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: ':"NYC"}' },
    });

    // Third chunk: finish_reason -> content_block_stop emitted
    const events3 = translator.push({
      choices: [
        {
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(events3).toHaveLength(2);
    expect(events3[0]).toEqual({
      type: "content_block_stop",
      index: 2,
    });
    expect(events3[1]).toEqual({
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 0 },
    });

    const endEvents = translator.end();
    expect(endEvents).toHaveLength(0);
  });

  it("does not emit duplicate content_block_start or content_block_stop for fragmented or repeated tool_calls chunks", () => {
    const translator = new OpenAIStreamTranslator();
    // Chunk 1: tool call started
    const e1 = translator.push({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "add_to_cart", arguments: '{"productId":"p05"' } }] } }],
    });
    // Chunk 2: args completed
    const e2 = translator.push({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ',"qty":1}' } }] } }],
    });
    // Chunk 3: gateway repeats tool call id or chunk without index
    const e3 = translator.push({
      choices: [{ delta: { tool_calls: [{ id: "call_1", function: { name: "add_to_cart" } }] } }],
    });
    // Chunk 4: finish_reason
    const e4 = translator.push({
      choices: [{ finish_reason: "tool_calls" }],
    });
    const eEnd = translator.end();

    const allEvents = [...e1, ...e2, ...e3, ...e4, ...eEnd];
    const startEvents = allEvents.filter(e => isStreamEventType(e, "content_block_start") && e.content_block?.type === "tool_use");
    const stopEvents = allEvents.filter(e => e.type === "content_block_stop");

    expect(startEvents).toHaveLength(1);
    expect(stopEvents).toHaveLength(1);
  });

  it("correctly handles multiple distinct tool calls in the same stream", () => {
    const translator = new OpenAIStreamTranslator();
    const e1 = translator.push({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: "add_to_cart", arguments: '{"productId":"p05","qty":1}' } },
              { index: 1, id: "call_2", type: "function", function: { name: "add_to_cart", arguments: '{"productId":"p01","qty":2}' } },
            ],
          },
        },
      ],
    });
    const e2 = translator.push({
      choices: [{ finish_reason: "tool_calls" }],
    });
    const eEnd = translator.end();

    const allEvents = [...e1, ...e2, ...eEnd];
    const startEvents = allEvents.filter(e => isStreamEventType(e, "content_block_start") && e.content_block?.type === "tool_use");
    const stopEvents = allEvents.filter(e => e.type === "content_block_stop");

    expect(startEvents).toHaveLength(2);
    expect(stopEvents).toHaveLength(2);
    const cbStart0 = (startEvents[0] as Extract<MessageStreamEvent, { type: "content_block_start" }>).content_block as ToolUseBlock;
    const cbStart1 = (startEvents[1] as Extract<MessageStreamEvent, { type: "content_block_start" }>).content_block as ToolUseBlock;
    expect(cbStart0.id).toBe("call_1");
    expect(cbStart1.id).toBe("call_2");
  });

  it("parallel tool calls streamed under the same index: 0 do not merge arguments (LiteLLM #21331)", () => {
    const translator = new OpenAIStreamTranslator();
    // Chunk 1: both calls open under index: 0, distinguished only by id —
    // the exact shape reported in LiteLLM #21331/#7621.
    const e1 = translator.push({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: "calc", arguments: "" } },
              { index: 0, id: "call_2", type: "function", function: { name: "calc", arguments: "" } },
            ],
          },
        },
      ],
    });
    // Chunk 2: argument deltas for each, still both under index: 0.
    const e2 = translator.push({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { arguments: '{"expression":"52.5/124.96"}' } },
              { index: 0, id: "call_2", function: { arguments: '{"expression":"11.36/17.48"}' } },
            ],
          },
        },
      ],
    });
    const e3 = translator.push({ choices: [{ finish_reason: "tool_calls" }] });
    const eEnd = translator.end();

    const allEvents = [...e1, ...e2, ...e3, ...eEnd];
    const startEvents = allEvents.filter(e => isStreamEventType(e, "content_block_start") && e.content_block?.type === "tool_use");
    expect(startEvents).toHaveLength(2);

    // Each block's own index only ever accumulates its own call's json —
    // never both concatenated into one.
    const deltasByIndex = new Map<number, string>();
    for (const e of allEvents) {
      if (isStreamEventType(e, "content_block_delta") && e.delta.type === "input_json_delta") {
        deltasByIndex.set(e.index, (deltasByIndex.get(e.index) ?? "") + e.delta.partial_json);
      }
    }
    const jsonStrings = [...deltasByIndex.values()];
    expect(jsonStrings).toHaveLength(2);
    for (const s of jsonStrings) {
      expect(() => JSON.parse(s)).not.toThrow();
    }
    expect(jsonStrings.sort()).toEqual(
      ['{"expression":"11.36/17.48"}', '{"expression":"52.5/124.96"}'].sort(),
    );

    const stopEvents = allEvents.filter(e => e.type === "content_block_stop");
    expect(stopEvents).toHaveLength(2);
  });

  it("skips tool call delta if initial chunk is missing id or name", () => {
    const translator = new OpenAIStreamTranslator();
    const events = translator.push({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: '{"a":1}' },
              },
            ],
          },
        },
      ],
    });
    expect(events).toHaveLength(0);
  });

  it("captures finishReason and usage from chunks", () => {
    const translator = new OpenAIStreamTranslator();
    translator.push({
      choices: [{ finish_reason: "stop" }],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        completion_tokens_details: { reasoning_tokens: 4 },
      },
    });

    expect(translator.finishReason).toBe("stop");
    expect(translator.reasoningTokens).toBe(4);
  });

  it("handles streaming finish reasons with active tool calls correctly", () => {
    // 1. finish_reason: "stop" with active tool call -> normalized to tool-calls / tool_use (Gemini proxy quirk)
    {
      const translator = new OpenAIStreamTranslator();
      translator.push({
        choices: [
          { delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "fn", arguments: "{}" } }] } },
        ],
      });
      const events = translator.push({
        choices: [{ finish_reason: "stop" }],
      });
      expect(translator.finishReason).toBe("tool-calls");
      const msgDelta = events.find((e) => e.type === "message_delta");
      expect(msgDelta).toBeDefined();
      expect((msgDelta as Extract<MessageStreamEvent, { type: "message_delta" }>).delta.stop_reason).toBe("tool_use");
    }

    // 2. finish_reason: "length" with active tool call -> preserves length / max_tokens
    {
      const translator = new OpenAIStreamTranslator();
      translator.push({
        choices: [
          { delta: { tool_calls: [{ index: 0, id: "c2", type: "function", function: { name: "fn", arguments: '{"in' } }] } },
        ],
      });
      const events = translator.push({
        choices: [{ finish_reason: "length" }],
      });
      expect(translator.finishReason).toBe("length");
      const msgDelta = events.find((e) => e.type === "message_delta");
      expect(msgDelta).toBeDefined();
      expect((msgDelta as Extract<MessageStreamEvent, { type: "message_delta" }>).delta.stop_reason).toBe("max_tokens");
    }

    // 3. finish_reason: "content_filter" with active tool call -> preserves content-filter / refusal
    {
      const translator = new OpenAIStreamTranslator();
      translator.push({
        choices: [
          { delta: { tool_calls: [{ index: 0, id: "c3", type: "function", function: { name: "fn", arguments: "{}" } }] } },
        ],
      });
      const events = translator.push({
        choices: [{ finish_reason: "content_filter" }],
      });
      expect(translator.finishReason).toBe("content-filter");
      const msgDelta = events.find((e) => e.type === "message_delta");
      expect(msgDelta).toBeDefined();
      expect((msgDelta as Extract<MessageStreamEvent, { type: "message_delta" }>).delta.stop_reason).toBe("refusal");
    }

    // 4. finish_reason: "tool_calls" with active tool call -> tool-calls / tool_use
    {
      const translator = new OpenAIStreamTranslator();
      translator.push({
        choices: [
          { delta: { tool_calls: [{ index: 0, id: "c4", type: "function", function: { name: "fn", arguments: "{}" } }] } },
        ],
      });
      const events = translator.push({
        choices: [{ finish_reason: "tool_calls" }],
      });
      expect(translator.finishReason).toBe("tool-calls");
      const msgDelta = events.find((e) => e.type === "message_delta");
      expect(msgDelta).toBeDefined();
      expect((msgDelta as Extract<MessageStreamEvent, { type: "message_delta" }>).delta.stop_reason).toBe("tool_use");
    }
  });

  it("preserves extra_content in streaming tool call start events", () => {
    const translator = new OpenAIStreamTranslator();
    const events = translator.push({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_stream_extra",
                type: "function",
                function: { name: "lookup", arguments: '{"k":"v"}' },
                extra_content: { google: { thought_signature: "stream_sig_123" } },
              },
            ],
          },
        },
      ],
    });
    const startEvent = events.find(
      (e) => isStreamEventType(e, "content_block_start") && e.content_block?.type === "tool_use"
    );
    expect(startEvent).toBeDefined();
    const startBlock = (startEvent as Extract<MessageStreamEvent, { type: "content_block_start" }>).content_block as ToolUseBlock;
    expect(startBlock.extra_content).toEqual({
      google: { thought_signature: "stream_sig_123" },
    });
  });
});
