import { describe, it, expect, vi } from "vitest";
import { getAbsoluteBaseURL } from "./provider.js";
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

describe("AnthropicLanguageModel — injected fetch", () => {
  const anthropicCfg: AgentConfig = { ...dummyCfg, baseURL: "/api/anthropic", endpointType: "anthropic" };

  it("runs the injected fetch, not window.fetch, for one request", async () => {
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
