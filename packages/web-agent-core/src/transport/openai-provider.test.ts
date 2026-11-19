import { describe, it, expect, vi } from "vitest";
import {
  OpenAILanguageModel,
  createOpenAILanguageModel,
} from "./openai-provider.js";
import { wrapProvider } from "./middleware.js";
import type { ProviderCallOptions } from "./provider.types.js";
import type { AgentConfig } from "../config.js";
import type { OpenAIChatCompletionCreateParams } from "./openai-wire.types.js";

/** `_client.chat.completions.create`'s real declared type (see
 * openai-provider.ts). Test mocks are typed narrowly against the real SDK's
 * params shape, which the wider Record<string, unknown> production signature
 * doesn't accept without a bridge — this is a type-only cast, not a behavior
 * change. */
type RealCreate = (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => unknown;

// Helper for building JSON responses in tests
function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

// ---------------------------------------------------------------------------
// OpenAILanguageModel constructor / factory / mock tests
// ---------------------------------------------------------------------------
describe("OpenAILanguageModel", () => {
  it("exposes provider and modelId", () => {
    const cfg: AgentConfig = {
      endpointType: "openai",
      baseURL: "http://localhost:11434/v1",
      model: "gpt-4o",
    } as AgentConfig;
    const model = new OpenAILanguageModel(cfg);
    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-4o");
  });

  it("createOpenAILanguageModel factory works", () => {
    const cfg: AgentConfig = {
      endpointType: "openai",
      baseURL: "http://localhost:11434/v1",
      model: "gpt-4o-mini",
    } as AgentConfig;
    const model = createOpenAILanguageModel(cfg);
    expect(model).toBeInstanceOf(OpenAILanguageModel);
    expect(model.modelId).toBe("gpt-4o-mini");
  });

  it("generate() produces a warning for topK and delegates to client", async () => {
    const cfg: AgentConfig = {
      endpointType: "openai",
      baseURL: "http://localhost:11434/v1",
      model: "gpt-4o",
    } as AgentConfig;

    const model = new OpenAILanguageModel(cfg);
    // Mock the client
    const mockCreate = vi.fn<[OpenAIChatCompletionCreateParams, { signal?: AbortSignal }?], unknown>().mockResolvedValue({
      choices: [
        {
          message: { content: "Hello!", tool_calls: undefined },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
    });
    model._client = { chat: { completions: { create: mockCreate as unknown as RealCreate } } };

    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
      topK: 50,
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "Hello!" });
    expect(result.warnings).toHaveLength(1);
    const w = result.warnings![0];
    expect(w.type).toBe("unsupported");
    if (w.type === "unsupported") expect(w.feature).toBe("topK");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("generate() passes reasoning_effort for o-series models", async () => {
    const cfg: AgentConfig = {
      endpointType: "openai",
      baseURL: "http://localhost:11434/v1",
      model: "o3-mini",
    } as AgentConfig;

    const model = new OpenAILanguageModel(cfg);
    const mockCreate = vi.fn<[OpenAIChatCompletionCreateParams, { signal?: AbortSignal }?], unknown>().mockResolvedValue({
      choices: [
        {
          message: { content: "Reasoned!", tool_calls: undefined },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
    });
    model._client = { chat: { completions: { create: mockCreate as unknown as RealCreate } } };

    await model.generate({
      messages: [{ role: "user", content: "think" }],
      model: "o3-mini",
      maxOutputTokens: 500,
      providerOptions: { openai: { reasoning_effort: "high" } },
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.max_completion_tokens).toBe(500);
    expect(callArgs.reasoning_effort).toBe("high");
    expect(callArgs.max_tokens).toBeUndefined();
  });

  it("generate() passes standard params for non-reasoning models", async () => {
    const cfg: AgentConfig = {
      endpointType: "openai",
      baseURL: "http://localhost:11434/v1",
      model: "gpt-4o",
    } as AgentConfig;

    const model = new OpenAILanguageModel(cfg);
    const mockCreate = vi.fn<[OpenAIChatCompletionCreateParams, { signal?: AbortSignal }?], unknown>().mockResolvedValue({
      choices: [
        {
          message: { content: "", tool_calls: undefined },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    model._client = { chat: { completions: { create: mockCreate as unknown as RealCreate } } };

    await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 100,
      seed: 42,
      stopSequences: ["\n"],
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.top_p).toBe(0.9);
    expect(callArgs.max_tokens).toBe(100);
    expect(callArgs.seed).toBe(42);
    expect(callArgs.stop).toEqual(["\n"]);
    expect(callArgs.max_completion_tokens).toBeUndefined();
  });

  it("system string unchanged and never carries cache_control", async () => {
    const cfg: AgentConfig = {
      endpointType: "openai",
      baseURL: "http://localhost:11434/v1",
      model: "gpt-4o",
    } as AgentConfig;

    const model = new OpenAILanguageModel(cfg);
    const mockCreate = vi.fn<[OpenAIChatCompletionCreateParams, { signal?: AbortSignal }?], unknown>().mockResolvedValue({
      choices: [
        {
          message: { content: "Hello!", tool_calls: undefined },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
    });
    model._client = { chat: { completions: { create: mockCreate as unknown as RealCreate } } };

    await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
      systemPrompt: "<full>",
      providerOptions: { anthropic: { systemStatic: "S" } },
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0]).toEqual({ role: "system", content: "<full>" });
    expect(JSON.stringify(callArgs)).not.toContain("cache_control");
  });
});

// ---------------------------------------------------------------------------
// OpenAILanguageModel — raw fetch suite
// ---------------------------------------------------------------------------
describe("OpenAILanguageModel — injected fetch", () => {
  const cfg: AgentConfig = {
    endpointType: "openai",
    baseURL: "/api/openai/v1",
    model: "gpt-4o",
  } as AgentConfig;

  const RESPONSE_FIXTURE = {
    id: "chatcmpl-123",
    object: "chat.completion",
    created: 1677858288,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello from fetch!" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 9, completion_tokens: 12 },
  };

  it("runs the injected fetch, not window.fetch", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(RESPONSE_FIXTURE));
    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });

    const result = await model.generate({
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-4o",
    });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([{ type: "text", text: "Hello from fetch!" }]);
    expect(result.finishReason).toBe("stop");
  });

  it("posts to baseURL + /chat/completions", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(RESPONSE_FIXTURE));
    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });

    await model.generate({
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-4o",
    });

    const [url] = stubFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/openai/v1/chat/completions");
  });

  it("sends no Authorization header", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(RESPONSE_FIXTURE));
    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });

    await model.generate({
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-4o",
    });

    const [, init] = stubFetch.mock.calls[0];
    expect(init!.headers).toEqual({ "Content-Type": "application/json" });
    expect(init!.headers).not.toHaveProperty("Authorization");
  });

  it("the request body is byte-identical to the body the seam path receives (non-reasoning & reasoning models)", async () => {
    // 1. Non-reasoning model (gpt-4o)
    const optsNonReasoning: ProviderCallOptions = {
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-4o",
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 100,
      systemPrompt: "System prompt text",
    };

    const seenSeam1 = vi.fn<[OpenAIChatCompletionCreateParams, { signal?: AbortSignal }?], unknown>().mockResolvedValue(RESPONSE_FIXTURE);
    const modelSeam1 = new OpenAILanguageModel(cfg);
    modelSeam1._client = { chat: { completions: { create: seenSeam1 as unknown as RealCreate } } };
    await modelSeam1.generate(optsNonReasoning);

    const stubFetch1 = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(RESPONSE_FIXTURE));
    await new OpenAILanguageModel(cfg, { fetch: stubFetch1 }).generate(optsNonReasoning);

    expect(stubFetch1.mock.calls[0][1]!.body).toBe(
      JSON.stringify(seenSeam1.mock.calls[0][0])
    );

    // 2. Reasoning model (o3-mini)
    const optsReasoning: ProviderCallOptions = {
      messages: [{ role: "user", content: "think" }],
      model: "o3-mini",
      maxOutputTokens: 500,
      systemPrompt: "Developer prompt text",
      providerOptions: { openai: { reasoning_effort: "high" } },
    };

    const seenSeam2 = vi.fn<[OpenAIChatCompletionCreateParams, { signal?: AbortSignal }?], unknown>().mockResolvedValue(RESPONSE_FIXTURE);
    const modelSeam2 = new OpenAILanguageModel(cfg);
    modelSeam2._client = { chat: { completions: { create: seenSeam2 as unknown as RealCreate } } };
    await modelSeam2.generate(optsReasoning);

    const stubFetch2 = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(RESPONSE_FIXTURE));
    await new OpenAILanguageModel(cfg, { fetch: stubFetch2 }).generate(optsReasoning);

    expect(stubFetch2.mock.calls[0][1]!.body).toBe(
      JSON.stringify(seenSeam2.mock.calls[0][0])
    );
  });

  it("the request body carries exactly the expected keys and prompt placement", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(RESPONSE_FIXTURE));
    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });

    await model.generate({
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-4o",
      systemPrompt: "Be helpful",
    });

    const body = JSON.parse(
      stubFetch.mock.calls[0][1]!.body as string,
    ) as OpenAIChatCompletionCreateParams;
    expect(body).not.toHaveProperty("system");
    expect(body.messages[0]).toEqual({ role: "system", content: "Be helpful" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("sends one complete request: stream is false and the URL ends in /chat/completions", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(RESPONSE_FIXTURE));
    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });

    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });

    const url = stubFetch.mock.calls[0][0] as string;
    expect(url.endsWith("/chat/completions")).toBe(true);
    const body = JSON.parse(
      stubFetch.mock.calls[0][1]!.body as string,
    ) as OpenAIChatCompletionCreateParams;
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty("stream_options");
    expect(result.content).toEqual([{ type: "text", text: "Hello from fetch!" }]);
    expect(result.usage.inputTokens).toBe(9);
    expect(result.usage.outputTokens).toBe(12);
  });

  it("two tool calls in one reply yield two tool_use blocks with their own inputs", async () => {
    const twoCalls = {
      id: "chatcmpl-2",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_a", type: "function", function: { name: "write_file", arguments: '{"path":"a"}' } },
              { id: "call_b", type: "function", function: { name: "write_file", arguments: '{"path":"b"}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    };
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(twoCalls));
    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });

    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });

    expect(result.finishReason).toBe("tool-calls");
    expect(result.content).toEqual([
      { type: "tool_use", id: "call_a", name: "write_file", input: { path: "a" } },
      { type: "tool_use", id: "call_b", name: "write_file", input: { path: "b" } },
    ]);
  });

  it("_client is an own property from construction and wrapProvider forwards it", () => {
    const model = new OpenAILanguageModel(cfg);
    expect("_client" in model).toBe(true);

    const mockClient = { chat: { completions: { create: vi.fn() } } };
    model._client = mockClient;

    const wrapped = wrapProvider(model, []);
    expect((wrapped as { _client?: unknown })._client).toBe(mockClient);
  });

  it("cache token fields are absent on a usage produced from an OpenAI response", async () => {
    const responseWithCache = {
      id: "chatcmpl-123",
      choices: [
        {
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 5 },
      },
    };

    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(jsonResponse(responseWithCache));
    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });

    const result = await model.generate({
      messages: [{ role: "user", content: "hello" }],
      model: "gpt-4o",
    });

    expect("cachedInputTokens" in result.usage).toBe(false);
    expect("cacheCreationTokens" in result.usage).toBe(false);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(20);
  });
});
