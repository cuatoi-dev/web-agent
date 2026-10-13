import { describe, it, expect, vi } from "vitest";
import {
  OpenAILanguageModel,
  createOpenAILanguageModel,
} from "./openai-provider.js";
import { fromOpenAIResponse } from "./openai-to-anthropic.js";
import { fromAnthropicResponse } from "./message-converter.js";
import { wrapProvider } from "./middleware.js";
import type { ProviderCallOptions } from "./provider.types.js";
import type { AgentConfig } from "../config.js";
import type { OpenAIChatCompletionCreateParams, OpenAIChatCompletionChunk } from "./openai-wire.types.js";
import type { StreamPart } from "./stream-parts.js";

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
// OpenAILanguageModel.doStream() tests
// ---------------------------------------------------------------------------
describe("OpenAILanguageModel.doStream()", () => {
  const baseCfg: AgentConfig = {
    endpointType: "openai",
    baseURL: "http://localhost:11434/v1",
    model: "gpt-4o",
  } as AgentConfig;

  function makeModel(mockChunks: OpenAIChatCompletionChunk[]) {
    const model = new OpenAILanguageModel(baseCfg);
    const mockCreate = vi.fn().mockResolvedValue(
      (async function* () {
        // `require-await`: no internal await, but this must stay an async
        // generator — the production consumer reaches for
        // stream[Symbol.asyncIterator](), which a sync generator doesn't
        // implement (task 018's trap; see middleware.ts:368).
        await Promise.resolve();
        for (const c of mockChunks) yield c;
      })()
    );
    model._client = { chat: { completions: { create: mockCreate } } };
    return { model, mockCreate };
  }

  it("text + usage: emits stream-start, text-start/delta/end, finish with usage", async () => {
    const { model } = makeModel([
      { choices: [{ delta: { content: "Hello" }, finish_reason: null }], usage: null },
      { choices: [{ delta: { content: " world" }, finish_reason: null }], usage: null },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]);

    const { stream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    expect(parts[0]).toEqual({ type: "stream-start", warnings: [] });
    expect(parts.find((p) => p.type === "text-start")).toBeDefined();
    expect(parts.filter((p) => p.type === "text-delta").map((p) => p.delta)).toEqual([
      "Hello",
      " world",
    ]);
    expect(parts.find((p) => p.type === "text-end")).toBeDefined();
    const finish = parts.find((p) => p.type === "finish")!;
    expect(finish).toMatchObject({ type: "finish", finishReason: "stop" });
    expect(finish.usage.inputTokens).toBe(10);
    expect(finish.usage.outputTokens).toBe(5);
  });

  it("tool_calls: chunked deltas produce tool-input-* and tool-call parts", async () => {
    const { model } = makeModel([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "weather", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
        usage: null,
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"loc"' } }],
            },
            finish_reason: null,
          },
        ],
        usage: null,
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: ':"NYC"}' } }],
            },
            finish_reason: null,
          },
        ],
        usage: null,
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: null },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 8 } },
    ]);

    const { stream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    expect(parts.find((p) => p.type === "tool-input-start")).toMatchObject({
      id: "call_1",
      toolName: "weather",
    });
    expect(
      parts.filter((p) => p.type === "tool-input-delta").map((p) => p.delta)
    ).toEqual(['{"loc"', ':"NYC"}']);
    expect(parts.find((p) => p.type === "tool-input-end")).toBeDefined();
    const toolCall = parts.find((p) => p.type === "tool-call");
    expect(toolCall).toMatchObject({
      toolCallId: "call_1",
      toolName: "weather",
      input: '{"loc":"NYC"}',
    });
    expect(parts.find((p) => p.type === "finish")).toMatchObject({
      finishReason: "tool-calls",
    });
  });

  it("topK warning surfaces in stream-start.warnings on doStream", async () => {
    const { model } = makeModel([
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
      { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const { stream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
      topK: 50,
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);
    const startPart = parts.find((p) => p.type === "stream-start")!;
    expect(startPart.warnings).toHaveLength(1);
    const w = startPart.warnings[0];
    expect(w.type).toBe("unsupported");
    if (w.type === "unsupported") expect(w.feature).toBe("topK");
  });

  it("equality: reassembled doStream result deep-equals non-stream fromOpenAIResponse for text response", async () => {
    const msgContent = "I can help with that.";
    const usageObj = {
      prompt_tokens: 10,
      completion_tokens: 8,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    };

    // Non-stream result (reference)
    const translated = fromOpenAIResponse({
      choices: [{ message: { content: msgContent }, finish_reason: "stop" }],
      usage: usageObj,
    });
    const nonStreamContent = fromAnthropicResponse(translated.message).content;

    // Stream result via doStream + reassembleStream
    const { model } = makeModel([
      { choices: [{ delta: { content: msgContent }, finish_reason: null }], usage: null },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
      { choices: [], usage: usageObj },
    ]);
    const { stream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });
    const { reassembleStream } = await import("./stream-parts.js");
    const streamResult = await reassembleStream(stream);

    expect(streamResult.content).toEqual(nonStreamContent);
    expect(streamResult.finishReason).toBe(translated.finishReason);
    expect(streamResult.usage.inputTokens).toBe(10);
    expect(streamResult.usage.outputTokens).toBe(8);
  });

  it("streaming doStream yields exactly one tool-call part for a single tool execution across fragmented chunks", async () => {
    const { model } = makeModel([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "add_to_cart", arguments: '{"productId":"p05"' } }] }, finish_reason: null }], usage: null },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ',"qty":1}' } }] }, finish_reason: null }], usage: null },
      { choices: [{ delta: { tool_calls: [{ id: "call_1", function: { name: "add_to_cart" } }] }, finish_reason: null }], usage: null },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: null },
    ]);
    const { stream } = await model.doStream({
      messages: [{ role: "user", content: "add item" }],
      model: "gpt-4o",
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    const toolCallParts = parts.filter(p => p.type === "tool-call");
    expect(toolCallParts).toHaveLength(1);
    expect(toolCallParts[0]).toEqual({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "add_to_cart",
      input: '{"productId":"p05","qty":1}',
    });
  });

  it("equality: reassembled doStream with tool call deep-equals non-stream fromOpenAIResponse", async () => {
    const usageObj = {
      prompt_tokens: 12,
      completion_tokens: 15,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    };

    // Non-stream result (reference)
    const translated = fromOpenAIResponse({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "call_99",
                type: "function",
                function: { name: "add_to_cart", arguments: '{"productId":"p05","qty":1}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: usageObj,
    });
    const nonStreamContent = fromAnthropicResponse(translated.message).content;

    // Stream result via doStream + reassembleStream
    const { model } = makeModel([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_99",
                  type: "function",
                  function: { name: "add_to_cart", arguments: '{"productId":"p05"' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
        usage: null,
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ',"qty":1}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
        usage: null,
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: null },
      { choices: [], usage: usageObj },
    ]);
    const { stream } = await model.doStream({
      messages: [{ role: "user", content: "add item" }],
      model: "gpt-4o",
    });
    const { reassembleStream } = await import("./stream-parts.js");
    const streamResult = await reassembleStream(stream);

    expect(streamResult.content).toEqual(nonStreamContent);
    expect(streamResult.finishReason).toBe("tool-calls");
    expect(streamResult.usage.inputTokens).toBe(12);
    expect(streamResult.usage.outputTokens).toBe(15);
  });

  it("generate({ streaming:true }) delegates to doStream and returns correct ProviderResult", async () => {
    const model = new OpenAILanguageModel(baseCfg);
    const mockCreate = vi.fn<[OpenAIChatCompletionCreateParams, { signal?: AbortSignal }?], unknown>().mockResolvedValue(
      (async function* () {
        // `require-await`: no internal await, but this must stay an async
        // generator — see makeModel() above.
        await Promise.resolve();
        yield { choices: [{ delta: { content: "Streamed" }, finish_reason: null }], usage: null };
        yield { choices: [{ delta: {}, finish_reason: "stop" }], usage: null };
        yield { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } };
      })()
    );
    model._client = { chat: { completions: { create: mockCreate as unknown as RealCreate } } };

    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
      streaming: true,
    });

    expect(result.content).toEqual([{ type: "text", text: "Streamed" }]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage.inputTokens).toBe(5);
    expect(result.usage.outputTokens).toBe(3);
    // Streaming params were passed
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.stream).toBe(true);
    expect(callArgs.stream_options).toEqual({ include_usage: true });
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

  it("streaming sends stream_options.include_usage: true", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n' +
              'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n' +
              "data: [DONE]\n\n"
          )
        );
        controller.close();
      },
    });

    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );

    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });
    const { stream: partStream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });

    const parts: StreamPart[] = [];
    for await (const p of partStream) parts.push(p);

    const body = JSON.parse(
      stubFetch.mock.calls[0][1]!.body as string,
    ) as OpenAIChatCompletionCreateParams;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });

    const finish = parts.find((p) => p.type === "finish")!;
    expect(finish.usage.inputTokens).toBe(5);
    expect(finish.usage.outputTokens).toBe(2);
  });

  it("streaming yields parts incrementally before body completion", async () => {
    let controllerRef: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controllerRef = c;
      },
    });

    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );

    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });
    const { stream: partStream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });

    const iterator = partStream[Symbol.asyncIterator]();
    const encoder = new TextEncoder();

    // Start stream
    const firstPromise = iterator.next();

    // Enqueue chunk 1
    controllerRef!.enqueue(
      encoder.encode(
        'data: {"choices":[{"delta":{"content":"Part 1"},"finish_reason":null}]}\n\n'
      )
    );

    const item1 = await firstPromise;
    expect(item1.value).toEqual({ type: "stream-start", warnings: [] });

    const item2 = await iterator.next();
    expect(item2.value).toEqual({ type: "text-start", id: "text_0" });

    const item3 = await iterator.next();
    expect(item3.value).toEqual({
      type: "text-delta",
      id: "text_0",
      delta: "Part 1",
    });

    // Enqueue chunk 2 & finish
    controllerRef!.enqueue(
      encoder.encode(
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
      )
    );
    controllerRef!.close();

    const item4 = await iterator.next();
    expect(item4.value).toEqual({ type: "text-end", id: "text_0" });

    const item5 = await iterator.next();
    expect(item5.value).toMatchObject({ type: "finish", finishReason: "stop" });
  });

  it("tolerates gateway duplicated [DONE] and post-[DONE] chunk", async () => {
    const encoder = new TextEncoder();
    const sseBody =
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
      "data: [DONE]\n\n" +
      'data: {"choices":[],"cost":"0","usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n' +
      "data: [DONE]\n\n";

    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(encoder.encode(sseBody));
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );

    const model = new OpenAILanguageModel(cfg, { fetch: stubFetch });
    const { stream: partStream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });

    const parts: StreamPart[] = [];
    for await (const p of partStream) parts.push(p);

    expect(parts.filter((p) => p.type === "text-delta").map((p) => p.delta)).toEqual([
      "Hello",
    ]);
    const finish = parts.find((p) => p.type === "finish")!;
    expect(finish.usage.inputTokens).toBe(10);
    expect(finish.usage.outputTokens).toBe(3);
  });

  it("_client is an own property from construction and wrapProvider forwards it", () => {
    const model = new OpenAILanguageModel(cfg);
    expect("_client" in model).toBe(true);

    const mockClient = { chat: { completions: { create: vi.fn() } } };
    model._client = mockClient;

    const wrapped = wrapProvider(model, []);
    expect((wrapped as { _client?: unknown })._client).toBe(mockClient);
  });

  it("cache token fields are absent on a usage produced from an OpenAI response (task 086-003)", async () => {
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
