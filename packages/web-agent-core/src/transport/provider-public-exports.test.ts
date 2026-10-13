import { describe, it, expect, vi } from "vitest";
import {
  providerRegistry,
  createAnthropicLanguageModel,
  createOpenAILanguageModel,
  createGeminiLanguageModel,
  wrapProvider,
  withRetry,
  DEFAULT_CONFIG,
  type AgentConfig,
} from "../index.js";

// These tests import ONLY from the package entry point ("../index.js") the way
// a host does. They prove the seam is public — a test that reached into
// src/transport/* would only prove the internals work.

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function anthropicMessage(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello from the wrapped provider" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
    ...fields,
  };
}

describe("public provider seam (package entry point)", () => {
  it("exports providerRegistry and built-in model factory functions from package entry point", () => {
    expect(typeof providerRegistry.register).toBe("function");
    expect(typeof createAnthropicLanguageModel).toBe("function");
    expect(typeof createOpenAILanguageModel).toBe("function");
    expect(typeof createGeminiLanguageModel).toBe("function");
    expect(typeof wrapProvider).toBe("function");
    expect(typeof withRetry).toBe("function");
  });

  it("allows registering and retrieving a custom provider via the public seam", () => {
    // A host composes a built-in provider under its own endpointType name.
    providerRegistry.register("custom-public", (cfg, opts) =>
      wrapProvider(createAnthropicLanguageModel(cfg, opts), {
        overrideProvider: () => "custom-public",
      }),
    );

    const cfg = {
      ...DEFAULT_CONFIG,
      endpointType: "custom-public",
      model: "claude-3-5",
    } as AgentConfig;
    const model = providerRegistry.get(cfg);
    expect(model.provider).toBe("custom-public");
    expect(model.modelId).toBe("claude-3-5");
  });

  it("wraps built-in Anthropic model to inject custom auth header reaching fetch", async () => {
    const wireFetch = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValue(jsonResponse(anthropicMessage()));
    const hostFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("X-Custom-Auth", "token-123");
      return wireFetch(input, { ...init, headers });
    };

    const model = createAnthropicLanguageModel(
      { ...DEFAULT_CONFIG, model: "claude-3-5", baseURL: "/api/anthropic" },
      { fetch: hostFetch },
    );
    const result = await model.generate({
      messages: [{ role: "user", content: "test" }],
      model: "claude-3-5",
    });

    expect(result.content[0]).toEqual({ type: "text", text: "Hello from the wrapped provider" });
    expect(wireFetch).toHaveBeenCalledTimes(1);
    const [url, init] = wireFetch.mock.calls[0];
    // The provider always calls fetch with a plain string URL; cast through a
    // structural type with a genuine toString so `no-base-to-string` accepts
    // it (RequestInfo | URL as declared could be a Request, which has no
    // custom toString, but this call site never receives one).
    const stringableUrl = url as { toString(): string };
    expect(stringableUrl.toString()).toContain("/api/anthropic/v1/messages");
    expect(new Headers(init?.headers).get("X-Custom-Auth")).toBe("token-123");
  });

  it("constructs built-in Gemini and OpenAI models directly", () => {
    const openai = createOpenAILanguageModel({
      ...DEFAULT_CONFIG,
      endpointType: "openai",
      baseURL: "/api/openai/v1",
      model: "gpt-4o",
    });
    expect(openai.provider).toBe("openai");
    expect(openai.modelId).toBe("gpt-4o");
    expect(typeof openai.generate).toBe("function");

    const gemini = createGeminiLanguageModel({
      ...DEFAULT_CONFIG,
      endpointType: "gemini",
      baseURL: "/api/gemini",
      model: "gemini-flash-lite-latest",
    });
    expect(gemini.provider).toBe("gemini");
    expect(gemini.modelId).toBe("gemini-flash-lite-latest");
    expect(typeof gemini.generate).toBe("function");
  });
});
