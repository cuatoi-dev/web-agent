import { describe, it, expect, vi } from "vitest";
import { getAbsoluteBaseURL } from "./provider.js";
import { parseAnthropicSseText } from "./sse-reader.js";
import { AnthropicLanguageModel } from "./anthropic-provider.js";
import type { AgentConfig } from "../config.js";

const dummyCfg: AgentConfig = {
  baseURL: "/api/openai/v1",
  model: "test-model",
  maxIterations: 12,
  turnTimeoutMs: 120_000,
  queryResultMaxChars: 6_000,
  wideSourceFieldThreshold: 40,
  persist: false,
  context: {
    kTurnsVerbatim: 3,
    contextLength: 110_000,
    autoCompactPercent: 50_000 / 110_000,
    charsPerToken: 4,
    jsonOverhead: 1.15,
    compactionMaxTokens: 700,
  },
  endpointType: "openai",
  thinking: { enabled: false },
  generation: {},
};

describe("getAbsoluteBaseURL", () => {
  it("passes through absolute URLs unchanged", () => {
    expect(getAbsoluteBaseURL("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });
  it("resolves relative URLs against window.location.origin in browser-like (jsdom) env", () => {
    expect(getAbsoluteBaseURL("/api/anthropic/v1")).toBe("http://localhost:3000/api/anthropic/v1");
  });
});

describe("parseAnthropicSseText", () => {
  it("successfully parses complete SSE stream of text and thinking", () => {
    const sse = [
      `event: message_start`,
      `data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":10}}}`,
      ``,
      `event: content_block_start`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"sig_abc"}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Deep thinking"}}`,
      ``,
      `event: content_block_stop`,
      `data: {"type":"content_block_stop","index":0}`,
      ``,
      `event: content_block_start`,
      `data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello world"}}`,
      ``,
      `event: content_block_stop`,
      `data: {"type":"content_block_stop","index":1}`,
      ``,
      `event: message_delta`,
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}`,
      ``,
      `event: message_stop`,
      `data: {"type":"message_stop"}`,
      `data: [DONE]`
    ].join("\n");

    const message = parseAnthropicSseText(sse);
    expect(message).toBeDefined();
    expect(message!.id).toBe("msg_123");
    expect(message!.stop_reason).toBe("end_turn");
    expect(message!.usage.input_tokens).toBe(10);
    expect(message!.usage.output_tokens).toBe(20);
    expect(message!.content).toHaveLength(2);
    expect(message!.content[0]).toEqual({ type: "thinking", thinking: "Deep thinking", signature: "sig_abc" });
    expect(message!.content[1]).toEqual({ type: "text", text: "Hello world" });
  });

  it("successfully parses tool_use SSE stream", () => {
    const sse = [
      `event: message_start`,
      `data: {"type":"message_start","message":{"id":"msg_456","type":"message","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":5}}}`,
      ``,
      `event: content_block_start`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_999","name":"click","input":{}}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"ref\\":\\""}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"12\\"}"}}`,
      ``,
      `event: content_block_stop`,
      `data: {"type":"content_block_stop","index":0}`,
      ``,
      `event: message_delta`,
      `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}`,
      ``,
      `event: message_stop`,
      `data: {"type":"message_stop"}`
    ].join("\n");

    const message = parseAnthropicSseText(sse);
    expect(message).toBeDefined();
    expect(message!.id).toBe("msg_456");
    expect(message!.stop_reason).toBe("tool_use");
    expect(message!.content).toHaveLength(1);
    expect(message!.content[0]).toEqual({ type: "tool_use", id: "tu_999", name: "click", input: { ref: "12" } });
  });
});

describe("AnthropicLanguageModel — injected fetch", () => {
  const anthropicCfg: AgentConfig = { ...dummyCfg, baseURL: "/api/anthropic", endpointType: "anthropic" };

  it("runs the injected fetch, not window.fetch, for a non-streaming call", async () => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(
      new Response(JSON.stringify({
        id: "msg_ok",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    const result = await model.generate({ messages: [{ role: "user", content: "hi" }], model: "test-model" });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("posts to baseURL + /v1/messages", async () => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(
      new Response(JSON.stringify({
        id: "msg_ok",
        type: "message",
        role: "assistant",
        content: [],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    await model.generate({ messages: [{ role: "user", content: "hi" }], model: "test-model" });

    const [url] = stubFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/anthropic/v1/messages");
  });
});
