import { describe, it, expect } from "vitest";
import { providerRegistry, setMockScript } from "./registry.js";
import { AnthropicLanguageModel } from "./anthropic-provider.js";
import { OpenAILanguageModel } from "./openai-provider.js";
import { GeminiLanguageModel } from "./gemini-provider.js";
import type { LanguageModel } from "./provider.types.js";
import { DEFAULT_CONFIG, type AgentConfig } from "../config.js";
import type { TextBlock } from "../types.js";

describe("providerRegistry", () => {
  it("allows registering and retrieving a custom provider", () => {
    const mockModel: LanguageModel = {
      provider: "test-provider",
      modelId: "test-model",
      generate: () => Promise.resolve({
        content: [],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    };

    providerRegistry.register("test-provider", () => mockModel);

    const cfg = { ...DEFAULT_CONFIG, endpointType: "test-provider", model: "test-model" } as AgentConfig;
    const retrieved = providerRegistry.get(cfg);
    expect(retrieved.provider).toBe("test-provider");
    expect(retrieved).toBe(mockModel);
  });

  it("throws when getting an unregistered provider", () => {
    const cfg = { ...DEFAULT_CONFIG, endpointType: "nonexistent", model: "test-model" } as AgentConfig;
    expect(() => providerRegistry.get(cfg)).toThrow(
      /No provider registered for endpointType "nonexistent"/
    );
  });

  it("automatically registers anthropic provider (retry-wrapped)", () => {
    const cfg = { ...DEFAULT_CONFIG, endpointType: "anthropic", model: "claude-3-5" } as AgentConfig;
    const model = providerRegistry.get(cfg);
    // Real providers are wrapped with withRetry, so the returned model is the
    // transparent wrapper (not the raw class) but preserves identity.
    expect(model).not.toBeInstanceOf(AnthropicLanguageModel);
    expect(model.provider).toBe("anthropic");
    expect(model.modelId).toBe("claude-3-5");
    expect(typeof model.generate).toBe("function");
  });

  it("automatically registers openai provider (retry-wrapped)", () => {
    const cfg = { ...DEFAULT_CONFIG, endpointType: "openai", model: "gpt-4o" } as AgentConfig;
    const model = providerRegistry.get(cfg);
    expect(model).not.toBeInstanceOf(OpenAILanguageModel);
    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-4o");
    expect(typeof model.generate).toBe("function");
  });

  it("automatically registers gemini provider (retry-wrapped)", () => {
    const cfg = { ...DEFAULT_CONFIG, endpointType: "gemini", model: "gemini-flash-lite-latest" } as AgentConfig;
    const model = providerRegistry.get(cfg);
    expect(model).not.toBeInstanceOf(GeminiLanguageModel);
    expect(model.provider).toBe("gemini");
    expect(model.modelId).toBe("gemini-flash-lite-latest");
    expect(typeof model.generate).toBe("function");
  });

  it("supports re-registering a provider to replace it", () => {
    // Save the original model so the test can restore it afterwards
    const originalCfg = { ...DEFAULT_CONFIG, endpointType: "anthropic", model: "claude-3-5" } as AgentConfig;
    const originalModel = providerRegistry.get(originalCfg);

    const mockModel: LanguageModel = {
      provider: "mock-anthropic",
      modelId: "mock-model",
      generate: () => Promise.resolve({
        content: [],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    };

    providerRegistry.register("anthropic", () => mockModel);

    const model = providerRegistry.get(originalCfg);
    expect(model.provider).toBe("mock-anthropic");

    // Register a factory that returns the saved original model
    providerRegistry.register("anthropic", () => originalModel);
  });

  it("mock provider registered as endpointType:mock with provider===mock", () => {
    const cfg = { ...DEFAULT_CONFIG, endpointType: "mock" as const, model: "mock-model" };
    const model = providerRegistry.get(cfg);
    expect(model.provider).toBe("mock");
  });

  it("setMockScript changes script used by endpointType:mock", async () => {
    setMockScript({ text: "scripted-reply" });
    const cfg = { ...DEFAULT_CONFIG, endpointType: "mock" as const, model: "mock-model" };
    const model = providerRegistry.get(cfg);
    const r = await model.generate({ messages: [{ role: "user", content: "hi" }], model: "mock-model" });
    expect((r.content[0] as TextBlock).text).toBe("scripted-reply");
  });
});
