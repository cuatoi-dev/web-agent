import { describe, it, expect } from "vitest";
import { toAnthropicMessages, fromAnthropicResponse } from "./message-converter.js";
import type { ModelMessage } from "../types.js";
import type { Message, ContentBlockParam, ImageBlockParam, ToolResultBlockParam, ContentBlock } from "./wire.types.js";

// ---------------------------------------------------------------------------
// toAnthropicMessages
// ---------------------------------------------------------------------------
describe("toAnthropicMessages — system", () => {
  it("extracts system string content into top-level system field", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ];
    const { system, messages } = toAnthropicMessages(msgs, []);
    expect(system).toBe("You are helpful.");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("extracts system from ContentPart[] (text parts joined)", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: [{ type: "text", text: "Line 1" }, { type: "text", text: "Line 2" }] },
    ];
    const { system } = toAnthropicMessages(msgs, []);
    expect(system).toBe("Line 1\nLine 2");
  });

  it("omits system key when no system message", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "Hi" }];
    const { system } = toAnthropicMessages(msgs, []);
    expect(system).toBeUndefined();
  });
});

describe("toAnthropicMessages — user", () => {
  it("an assistant message with no content is not sent", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [] },
      { role: "user", content: "still there?" },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.role === "user")).toBe(true);
    expect(messages.every((m) => !(Array.isArray(m.content) && m.content.length === 0))).toBe(true);
  });

  it("passes string content through unchanged", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "Hello" }];
    const { messages } = toAnthropicMessages(msgs, []);
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("converts text part", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    expect(messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "Hello" }] });
  });

  it("converts image part — splits data URL into media_type + base64 data", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", image: "data:image/png;base64,abc123==", mediaType: "image/png" },
        ],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const block = (messages[0].content as ImageBlockParam[])[0];
    expect(block.type).toBe("image");
    expect(block.source.type).toBe("base64");
    expect(block.source.media_type).toBe("image/png");
    expect(block.source.data).toBe("abc123==");
  });

  it("handles image/jpeg media_type correctly", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", image: "data:image/jpeg;base64,/9j/4AA==", mediaType: "image/jpeg" },
        ],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const block = (messages[0].content as ImageBlockParam[])[0];
    expect(block.source.media_type).toBe("image/jpeg");
    expect(block.source.data).toBe("/9j/4AA==");
  });

  it("falls back to fallbackMediaType when dataUrl has no comma", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [{ type: "image", image: "rawbase64data", mediaType: "image/webp" }] },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const block = (messages[0].content as ImageBlockParam[])[0];
    expect(block.source.media_type).toBe("image/webp");
    expect(block.source.data).toBe("rawbase64data");
  });

  it("mixes text + image parts", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look:" },
          { type: "image", image: "data:image/png;base64,xyz", mediaType: "image/png" },
        ],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const blocks = messages[0].content as ContentBlockParam[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: "Look:" });
    expect(blocks[1].type).toBe("image");
  });
});

describe("toAnthropicMessages — assistant", () => {
  it("passes string content through unchanged", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    expect(messages[1]).toEqual({ role: "assistant", content: "Hello!" });
  });

  it("converts text part", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Hello!" }] });
  });

  it("converts tool-call part → tool_use block", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Do it" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Using tool." },
          { type: "tool-call", toolCallId: "tc_1", toolName: "click", input: { ref: "42" } },
        ],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const blocks = messages[1].content as ContentBlockParam[];
    expect(blocks[0]).toEqual({ type: "text", text: "Using tool." });
    expect(blocks[1]).toEqual({ type: "tool_use", id: "tc_1", name: "click", input: { ref: "42" } });
  });
});

describe("toAnthropicMessages — tool role", () => {
  it("converts tool role → user message with tool_result block", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Do it" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc_1", toolName: "click", input: {} }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc_1", toolName: "click", output: "Clicked." }],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    expect(messages[2].role).toBe("user");
    const blocks = messages[2].content as ToolResultBlockParam[];
    expect(blocks[0]).toEqual({ type: "tool_result", tool_use_id: "tc_1", content: "Clicked." });
  });

  it("sets is_error on error results", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Do it" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc_2", toolName: "click", input: {} }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc_2", toolName: "click", output: "Element not found.", isError: true }],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const block = (messages[2].content as ToolResultBlockParam[])[0];
    expect(block.is_error).toBe(true);
  });

  it("converts multiple tool-result parts into multiple tool_result blocks in one user message", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Do two things" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc_a", toolName: "click", input: {} },
          { type: "tool-call", toolCallId: "tc_b", toolName: "fill", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "tc_a", toolName: "click", output: "OK_a" },
          { type: "tool-result", toolCallId: "tc_b", toolName: "fill", output: "OK_b" },
        ],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const blocks = messages[2].content as ToolResultBlockParam[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tool_use_id).toBe("tc_a");
    expect(blocks[1].tool_use_id).toBe("tc_b");
  });

  it("serializes object output via outputToString", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Do it" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc_3", toolName: "query_state", input: {} }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc_3", toolName: "query_state", output: { value: "state data" } }],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const block = (messages[2].content as ToolResultBlockParam[])[0];
    expect(block.content).toBe("state data");
  });

  it("serializes output.content string", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Do it" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc_4", toolName: "click", input: {} }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc_4", toolName: "click", output: { content: "result" } }],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const block = (messages[2].content as ToolResultBlockParam[])[0];
    expect(block.content).toBe("result");
  });

  it("JSON.stringifies unknown object output", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: "Do it" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc_5", toolName: "click", input: {} }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc_5", toolName: "click", output: { foo: "bar" } }],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, []);
    const block = (messages[2].content as ToolResultBlockParam[])[0];
    expect(block.content).toBe('{"foo":"bar"}');
  });
});

// ---------------------------------------------------------------------------
// fromAnthropicResponse
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    container: null,
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...overrides,
  } as Message;
}

describe("fromAnthropicResponse — content blocks", () => {
  it("converts text block", () => {
    const msg = makeMessage({ content: [{ type: "text", text: "Hello!" }] });
    const result = fromAnthropicResponse(msg);
    expect(result.content).toEqual([{ type: "text", text: "Hello!" }]);
  });

  it("converts tool_use block", () => {
    const msg = makeMessage({
      content: [{ type: "tool_use", id: "tu_1", name: "click", input: { ref: "5" }, caller: { type: "direct" } }] as unknown as ContentBlock[],
      stop_reason: "tool_use",
    });
    const result = fromAnthropicResponse(msg);
    expect(result.content).toEqual([{ type: "tool_use", id: "tu_1", name: "click", input: { ref: "5" } }]);
  });

  it("skips unknown block types", () => {
    const msg = makeMessage({ content: [{ type: "unknown_block", data: "..." } as unknown as ContentBlock] });
    const result = fromAnthropicResponse(msg);
    expect(result.content).toHaveLength(0);
  });

  it("handles mixed text + tool_use", () => {
    const msg = makeMessage({
      content: [
        { type: "text", text: "I will call a tool." },
        { type: "tool_use", id: "tu_2", name: "fill", input: { ref: "7", value: "hello" }, caller: { type: "direct" } },
      ] as unknown as ContentBlock[],
      stop_reason: "tool_use",
    });
    const result = fromAnthropicResponse(msg);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: "text", text: "I will call a tool." });
    expect(result.content[1].type).toBe("tool_use");
  });

  it("handles empty content array", () => {
    const msg = makeMessage({ content: [] });
    const result = fromAnthropicResponse(msg);
    expect(result.content).toHaveLength(0);
  });
});

describe("fromAnthropicResponse — stopReason", () => {
  it.each([
    ["end_turn", "end_turn"],
    ["tool_use", "tool_use"],
    ["max_tokens", "max_tokens"],
    ["stop_sequence", "stop_sequence"],
    ["pause_turn", "end_turn"],
    ["refusal", "end_turn"],
    [null, "end_turn"],
  ] as const)("maps %s → %s", (raw, expected) => {
    const msg = makeMessage({ stop_reason: raw });
    expect(fromAnthropicResponse(msg).stopReason).toBe(expected);
  });
});

describe("fromAnthropicResponse — usage", () => {
  it("maps input_tokens + output_tokens", () => {
    const msg = makeMessage();
    const { usage } = fromAnthropicResponse(msg);
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(5);
  });

  it("includes cacheReadTokens when non-null", () => {
    const msg = makeMessage();
    msg.usage.cache_read_input_tokens = 200;
    const { usage } = fromAnthropicResponse(msg);
    expect(usage.cacheReadTokens).toBe(200);
  });

  it("includes cacheCreationTokens when non-null", () => {
    const msg = makeMessage();
    msg.usage.cache_creation_input_tokens = 300;
    const { usage } = fromAnthropicResponse(msg);
    expect(usage.cacheCreationTokens).toBe(300);
  });

  it("leaves cacheReadTokens undefined when null", () => {
    const msg = makeMessage();
    const { usage } = fromAnthropicResponse(msg);
    expect(usage.cacheReadTokens).toBeUndefined();
  });

  it("leaves cacheCreationTokens undefined when null", () => {
    const msg = makeMessage();
    const { usage } = fromAnthropicResponse(msg);
    expect(usage.cacheCreationTokens).toBeUndefined();
  });
});

describe("thinking and redacted_thinking round-trip", () => {
  it("fromAnthropicResponse parses thinking and redacted_thinking blocks", () => {
    const msg: Message = {
      id: "msg_think",
      type: "message",
      role: "assistant",
      model: "mock",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [
        { type: "thinking", thinking: "Deep thoughts", signature: "sig_123" },
        { type: "redacted_thinking", data: "redacted_bytes" },
        { type: "text", text: "Final response" },
      ],
    };

    const res = fromAnthropicResponse(msg);
    expect(res.content).toHaveLength(3);
    expect(res.content[0]).toEqual({ type: "thinking", thinking: "Deep thoughts", signature: "sig_123" });
    expect(res.content[1]).toEqual({ type: "redacted_thinking", data: "redacted_bytes" });
    expect(res.content[2]).toEqual({ type: "text", text: "Final response" });
  });

  it("toAnthropicMessages converts thinking and redacted_thinking parts inside assistant messages", () => {
    const msgs = [
      { role: "user" as const, content: "Solve this" },
      {
        role: "assistant" as const,
        content: [
          { type: "thinking" as const, thinking: "Step 1...", signature: "sig_abc" },
          { type: "redacted_thinking" as const, data: "redacted_xyz" },
          { type: "text" as const, text: "Solved!" },
        ],
      },
    ];

    const { messages } = toAnthropicMessages(msgs, []);
    expect(messages).toHaveLength(2);
    const assistantBlocks = messages[1].content as ContentBlockParam[];
    expect(assistantBlocks).toHaveLength(3);
    expect(assistantBlocks[0]).toEqual({ type: "thinking", thinking: "Step 1...", signature: "sig_abc" });
    expect(assistantBlocks[1]).toEqual({ type: "redacted_thinking", data: "redacted_xyz" });
    expect(assistantBlocks[2]).toEqual({ type: "text", text: "Solved!" });
  });
});

import type { ProviderWarning } from "./provider.types.js";

describe("toAnthropicMessages — vision/image support", () => {
  it("Vision Model (Success): maps ImagePart to base64 block and returns no warning", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, warnings, {
      modelId: "claude-3-5-sonnet",
      modelSupportsVision: true,
    });
    expect(warnings).toHaveLength(0);
    const content = messages[0].content as ContentBlockParam[];
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "abc" },
    });
  });

  it("FilePart Base64 (Success): maps FilePart to base64 block and returns no warning", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "file", data: "data:image/jpeg;base64,/9j/4AA==", mediaType: "image/jpeg" }],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, warnings, {
      modelId: "claude-3-5-sonnet",
      modelSupportsVision: true,
    });
    expect(warnings).toHaveLength(0);
    const content = messages[0].content as ContentBlockParam[];
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AA==" },
    });
  });

  it("FilePart URL (Warning & Drop): drops the HTTP URL part and returns an unsupported image-url warning", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look here" },
          { type: "file", data: "https://example.com/image.png", mediaType: "image/png" }
        ],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, warnings, {
      modelId: "claude-3-5-sonnet",
      modelSupportsVision: true,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      type: "unsupported",
      feature: "image-url",
      details: "Anthropic does not support image URLs directly; only base64 data is supported.",
    });
    const content = messages[0].content as ContentBlockParam[];
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "Look here" });
  });

  it("Text-Only Model (Warning & Drop): drops the part and returns a warning when model heuristic says text-only", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look here" },
          { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
        ],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, warnings, {
      modelId: "claude-2",
      modelSupportsVision: false,
    });
    expect(warnings).toHaveLength(1);
    expect((warnings[0] as Extract<ProviderWarning, { type: "unsupported" }>).feature).toBe("image-input");
    const content = messages[0].content as ContentBlockParam[];
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "Look here" });
  });

  it("Config Disabled (Warning & Drop): drops the part and returns a warning when imageInputEnabled is false", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look here" },
          { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }
        ],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, warnings, {
      modelId: "claude-3-5-sonnet",
      modelSupportsVision: true,
      imageInputEnabled: false,
    });
    expect(warnings).toHaveLength(1);
    expect((warnings[0] as Extract<ProviderWarning, { type: "unsupported" }>).feature).toBe("image-input");
    const content = messages[0].content as ContentBlockParam[];
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "Look here" });
  });

  it("imageInput: true precedence: maps the image even if model heuristic is false", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }],
      },
    ];
    const { messages } = toAnthropicMessages(msgs, warnings, {
      modelId: "claude-2",
      modelSupportsVision: false,
      imageInputEnabled: true,
    });
    expect(warnings).toHaveLength(0);
    const content = messages[0].content as ContentBlockParam[];
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "abc" },
    });
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
      toAnthropicMessages(msgs, warnings, { modelId: "claude-3-5-sonnet", modelSupportsVision: true })
    ).toThrow("Invalid image: base64 payload is empty");
  });

  it("throws an error when image part has header-only data URL", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image: "data:image/png;base64,", mediaType: "image/png" }],
      },
    ];
    expect(() =>
      toAnthropicMessages(msgs, warnings, { modelId: "claude-3-5-sonnet", modelSupportsVision: true })
    ).toThrow("Invalid image: base64 payload is empty");
  });
});

