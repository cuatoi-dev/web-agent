import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { AnthropicLanguageModel } from "./anthropic-provider.js";
import type { AgentConfig } from "../config.js";
import type { Message, MessageCreateParams, StopReason, ContentBlockParam } from "./wire.types.js";


const dummyCfg: AgentConfig = {
  baseURL: "/api/anthropic/v1",
  model: "claude-3-5",
  maxIterations: 12,
  turnTimeoutMs: 120_000,
  queryResultMaxChars: 6_000,
  wideSourceFieldThreshold: 40,
  persist: false,
  context: {
    kTurnsVerbatim: 3,
    contextLength: 110_000,
    autoCompactPercent: 0.5,
    charsPerToken: 4,
    jsonOverhead: 1.15,
    compactionMaxTokens: 700,
  },
  endpointType: "anthropic",
  thinking: { enabled: false },
  generation: {},
};

function makeMockMessage(fields: Partial<Message> = {}): Message {
  return {
    id: "msg_123",
    type: "message",
    role: "assistant",
    model: "claude-3-5",
    content: [{ type: "text", text: "Hello" }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 20,
    },
    ...fields,
  };
}

// The mocked `create` resolves the plain message object, as the real client does
// for a non-streaming request.
function makeCreateMock(mockResponse: Message) {
  return vi
    .fn<[MessageCreateParams, { signal?: AbortSignal }?], unknown>()
    .mockImplementation(() => Promise.resolve(mockResponse));
}

function makeProvider(mockResponse: Message) {
  const model = new AnthropicLanguageModel(dummyCfg);
  // Keep the mock as its own reference — never read back off model._client,
  // which would detach a method from its object (unbound-method).
  const createMock = makeCreateMock(mockResponse);
  model._client = { messages: { create: createMock as unknown as (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => unknown } };
  return { model, createMock };
}

describe("AnthropicLanguageModel", () => {
  describe("finishReason normalization", () => {
    const testCases: { raw: StopReason; expected: string }[] = [
      { raw: "end_turn", expected: "stop" },
      { raw: "tool_use", expected: "tool-calls" },
      { raw: "max_tokens", expected: "length" },
      { raw: "stop_sequence", expected: "stop" },
      { raw: "pause_turn", expected: "other" },
      { raw: "refusal", expected: "content-filter" },
      { raw: null, expected: "unknown" },
    ];

    for (const { raw, expected } of testCases) {
      it(`maps raw stop_reason "${raw}" to finishReason "${expected}"`, async () => {
        const msg = makeMockMessage({ stop_reason: raw });
        const { model: provider } = makeProvider(msg);
        const result = await provider.generate({
          messages: [{ role: "user", content: "hi" }],
          model: "claude-3-5",
        });
        expect(result.finishReason).toBe(expected);
      });
    }
  });

  describe("usage normalization", () => {
    it("maps basic input/output tokens", async () => {
      const msg = makeMockMessage({
        usage: { input_tokens: 100, output_tokens: 20 },
      });
      const { model: provider } = makeProvider(msg);
      const result = await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
      });
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(20);
    });

    it("maps cache tokens when present", async () => {
      const msg = makeMockMessage({
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 30,
        },
      });
      const { model: provider } = makeProvider(msg);
      const result = await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
      });
      expect(result.usage.cachedInputTokens).toBe(50);
      expect(result.usage.cacheCreationTokens).toBe(30);
    });

    it("leaves cache tokens undefined when null/absent", async () => {
      const msg = makeMockMessage({
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      });
      const { model: provider } = makeProvider(msg);
      const result = await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
      });
      expect(result.usage.cachedInputTokens).toBeUndefined();
      expect(result.usage.cacheCreationTokens).toBeUndefined();
    });
  });

  describe("content round-trip", () => {
    it("maps all supported block types", async () => {
      const msg = makeMockMessage({
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", id: "tu_1", name: "click", input: { target: "btn" } },
          { type: "thinking", thinking: "pondering", signature: "sig1" },
          { type: "redacted_thinking", data: "encrypted" },
        ],
      });
      const { model: provider } = makeProvider(msg);
      const result = await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
      });

      expect(result.content).toHaveLength(4);
      expect(result.content[0]).toEqual({ type: "text", text: "Hello" });
      expect(result.content[1]).toEqual({ type: "tool_use", id: "tu_1", name: "click", input: { target: "btn" } });
      expect(result.content[2]).toEqual({ type: "thinking", thinking: "pondering", signature: "sig1" });
      expect(result.content[3]).toEqual({ type: "redacted_thinking", data: "encrypted" });
    });
  });

  describe("thinking via providerOptions", () => {
    it("configures thinking and removes generation knobs when enabled", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
        temperature: 0.5,
        topP: 0.9,
        topK: 40,
        providerOptions: {
          anthropic: {
            thinking: { type: "enabled", budget_tokens: 2048 },
          },
        },
      });

      expect(generateSpy).toHaveBeenCalled();
      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      expect(calledParams.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
      expect(calledParams.temperature).toBeUndefined();
      expect(calledParams.top_p).toBeUndefined();
      expect(calledParams.top_k).toBeUndefined();
    });

    it("passes temperature/top_p/top_k when thinking is disabled", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
        temperature: 0.5,
        topP: 0.9,
        topK: 40,
      });

      expect(generateSpy).toHaveBeenCalled();
      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      expect(calledParams.thinking).toBeUndefined();
      expect(calledParams.temperature).toBe(0.5);
      expect(calledParams.top_p).toBe(0.9);
      expect(calledParams.top_k).toBe(40);
    });
  });

  describe("toolChoice mapping", () => {
    const testCases = [
      { input: { type: "auto" } as const, expected: { type: "auto" } },
      { input: { type: "required" } as const, expected: { type: "any" } },
      { input: { type: "none" } as const, expected: { type: "auto" } },
      { input: { type: "tool", toolName: "click" } as const, expected: { type: "tool", name: "click" } },
    ];

    for (const { input, expected } of testCases) {
      it(`maps toolChoice ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, async () => {
        const msg = makeMockMessage();
        const { model: provider, createMock: generateSpy } = makeProvider(msg);

        await provider.generate({
          messages: [{ role: "user", content: "hi" }],
          model: "claude-3-5",
          tools: [{ name: "click", description: "click it", input_schema: { type: "object", properties: {} } }],
          toolChoice: input,
        });

        expect(generateSpy).toHaveBeenCalled();
        const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
        expect(calledParams.tool_choice).toEqual(expected);
      });
    }
  });

  describe("complete requests", () => {
    it("sends stream:false, even when the ignored streaming option is true", async () => {
      for (const streaming of [false, true, undefined]) {
        const { model: provider, createMock } = makeProvider(makeMockMessage());
        const opts = {
          messages: [{ role: "user" as const, content: "hi" }],
          model: "claude-3-5",
          ...(streaming === undefined ? {} : { streaming }),
        };
        await provider.generate(opts);
        expect(createMock.mock.calls[0][0].stream).toBe(false);
      }
    });

    it("returns two tool-use blocks with distinct ids, names and inputs", async () => {
      const msg = makeMockMessage({
        content: [
          { type: "tool_use", id: "call_a", name: "read_file", input: { path: "a" } },
          { type: "tool_use", id: "call_b", name: "write_file", input: { path: "b" } },
        ],
        stop_reason: "tool_use",
      });
      const { model: provider } = makeProvider(msg);

      const result = await provider.generate({ messages: [{ role: "user", content: "hi" }], model: "claude-3-5" });

      expect(result.finishReason).toBe("tool-calls");
      expect(result.content).toEqual([
        { type: "tool_use", id: "call_a", name: "read_file", input: { path: "a" } },
        { type: "tool_use", id: "call_b", name: "write_file", input: { path: "b" } },
      ]);
    });
  });

  describe("warnings and systemPrompt", () => {
    it("always returns warnings array", async () => {
      const msg = makeMockMessage();
      const { model: provider } = makeProvider(msg);
      const result = await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
      });
      expect(result.warnings).toEqual([]);
    });

    it("sends systemPrompt parameter if specified", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
        systemPrompt: "You are helpful.",
      });

      expect(generateSpy).toHaveBeenCalled();
      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      expect(calledParams.system).toBe("You are helpful.");
    });

    it("does not send system parameter if systemPrompt is absent", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
      });

      expect(generateSpy).toHaveBeenCalled();
      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      expect(calledParams.system).toBeUndefined();
    });
  });

  describe("prompt caching", () => {
    it("sends two cached system blocks when systemStatic + systemDynamic provided", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
        providerOptions: { anthropic: { systemStatic: "S", systemDynamic: "D" } },
      });

      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      expect(calledParams.system).toEqual([
        { type: "text", text: "S", cache_control: { type: "ephemeral" } },
        { type: "text", text: "D", cache_control: { type: "ephemeral" } },
      ]);
    });

    it("sends a single cached static block when only systemStatic provided", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
        providerOptions: { anthropic: { systemStatic: "S" } },
      });

      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      expect(calledParams.system).toEqual([
        { type: "text", text: "S", cache_control: { type: "ephemeral" } },
      ]);
    });
  });

  describe("rolling history cache breakpoint", () => {
    it("marks the last block of a string-content last message as one cached text block", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
      });

      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      expect(calledParams.messages[0].content).toEqual([
        { type: "text", text: "hi", cache_control: { type: "ephemeral" } },
      ]);
    });

    it("marks only the last tool_result block of an array last message", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [
          { role: "user", content: "q" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "a" },
              { type: "tool-call", toolCallId: "t1", toolName: "click", input: {} },
            ],
          },
          { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "click", output: "ok" }] },
        ],
        model: "claude-3-5",
      });

      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      const lastMessage = calledParams.messages[calledParams.messages.length - 1];
      const lastContent = lastMessage.content as ContentBlockParam[];
      const lastBlock = lastContent[lastContent.length - 1];
      expect((lastBlock as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    });

    it("adds exactly one message-level cache_control across all messages", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [
          { role: "user", content: "q" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "a" },
              { type: "tool-call", toolCallId: "t1", toolName: "click", input: {} },
            ],
          },
          { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "click", output: "ok" }] },
        ],
        model: "claude-3-5",
      });

      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      const occurrences = (JSON.stringify(calledParams.messages).match(/cache_control/g) || []).length;
      expect(occurrences).toBe(1);
    });

    it("marks only the final block of a multi-block last message", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "first" },
              { type: "text", text: "second" },
            ],
          },
        ],
        model: "claude-3-5",
      });

      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      const lastMessage = calledParams.messages[0];
      const lastContent = lastMessage.content as ContentBlockParam[];
      expect((lastContent[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
      expect((lastContent[1] as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    });

    it("is a no-op for an empty messages array", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      await provider.generate({ messages: [], model: "claude-3-5" });

      const calledParams = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];
      expect(calledParams.messages).toEqual([]);
    });

    it("keeps a message's content shape stable whether or not it currently carries the rolling breakpoint", async () => {
      // Stage-B regression (task 001): the breakpoint used to convert ONLY the
      // last message's bare string into a block array. Once a later request's
      // breakpoint moved past that message (e.g. compaction's appended turn),
      // it reverted to a bare string — a real content-shape change, not just
      // an annotation change, which broke Anthropic's cache prefix match at
      // exactly that message.
      const msg = makeMockMessage();
      const { model: provider, createMock: generateSpy } = makeProvider(msg);

      // Call 1: "hi four" is the LAST message — it gets the breakpoint.
      await provider.generate({
        messages: [{ role: "user", content: "hi four" }],
        model: "claude-3-5",
      });
      const firstCall = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[0][0];

      // Call 2: an appended message means "hi four" is no longer last.
      await provider.generate({
        messages: [
          { role: "user", content: "hi four" },
          { role: "user", content: "summarise" },
        ],
        model: "claude-3-5",
      });
      const secondCall = (generateSpy as unknown as Mock<[MessageCreateParams], unknown>).mock.calls[1][0];

      const stripCacheControl = (content: unknown) =>
        (content as { type: string; text: string }[]).map(({ type, text }) => ({ type, text }));

      expect(Array.isArray(firstCall.messages[0].content)).toBe(true);
      expect(Array.isArray(secondCall.messages[0].content)).toBe(true);
      expect(stripCacheControl(secondCall.messages[0].content)).toEqual(
        stripCacheControl(firstCall.messages[0].content),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Raw fetch transport — no _client override, so generate() goes through
// requestJson (./anthropic-request.js) over an injected fetch. Covers the
// pieces the SDK-mocked suite above cannot reach: the actual HTTP call and
// URL normalization.
// ---------------------------------------------------------------------------
describe("AnthropicLanguageModel — raw fetch transport", () => {
  const anthropicCfg: AgentConfig = { ...dummyCfg, baseURL: "/api/anthropic" };

  function jsonResponse(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Property/invariant assertions against the wire format, not a pasted
  // literal — no pre-change body was ever captured (see task file Outcome
  // note), so these check the actual vendor wire-format rules directly
  // rather than comparing to a recorded reference body.
  it("request body for a plain call: max_tokens default and cache_control placement", async () => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(jsonResponse(makeMockMessage()));
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    await model.generate({ messages: [{ role: "user", content: "hi" }], model: "test-model" });

    const [, init] = stubFetch.mock.calls[0];
    const body = JSON.parse(init!.body as string) as MessageCreateParams;

    // The exact-key-set assertion that used to sit here was removed: its only
    // repair on any deliberate request-shape change was to paste the new list,
    // so it tested nothing. `stream` is pinned by its own assertion in the
    // POST test below.

    // max_tokens defaults to 4096 when the caller supplies none.
    expect(body.max_tokens).toBe(4096);

    // The rolling cache breakpoint lands on the last (only) content block of
    // the last (only) message.
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "hi", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("request body: system prompt is sent as a top-level `system` field, not folded into `messages`", async () => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(jsonResponse(makeMockMessage()));
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "test-model",
      systemPrompt: "be terse",
    });

    const body = JSON.parse(stubFetch.mock.calls[0][1]!.body as string) as MessageCreateParams;
    expect(body.system).toBe("be terse");
    expect(body.messages).toHaveLength(1);
    expect(body.messages.every((m) => (m.role as string) !== "system")).toBe(true);
  });

  it("request body: thinking branch sends `thinking`, strips temperature/top_p/top_k, and never puts cache_control on a thinking block", async () => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(jsonResponse(makeMockMessage()));
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "test-model",
      temperature: 0.5,
      topP: 0.9,
      topK: 40,
      providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: 512 } } },
    });

    const body = JSON.parse(stubFetch.mock.calls[0][1]!.body as string) as MessageCreateParams;
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 512 });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");

    // Anthropic request bodies never carry a thinking content block (thinking
    // blocks only ever appear in responses), so the rolling cache breakpoint
    // still lands on the last text block of the last message, not a thinking
    // block.
    const lastMessage = body.messages[body.messages.length - 1];
    const lastContent = lastMessage.content as ContentBlockParam[];
    const lastBlock = lastContent[lastContent.length - 1];
    expect(lastBlock.type).toBe("text");
    expect((lastBlock as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
  });

  it("POSTs to /v1/messages for a non-streaming call and parses the JSON response", async () => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(jsonResponse(makeMockMessage({ content: [{ type: "text", text: "hi there" }] })));
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    const result = await model.generate({ messages: [{ role: "user", content: "hi" }], model: "test-model" });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const [url, init] = stubFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/anthropic/v1/messages");
    expect(init!.method).toBe("POST");
    // Sent EXPLICITLY as false, not omitted: a gateway may read a missing
    // `stream` field as streaming and answer with SSE, which this path cannot
    // parse.
    expect((JSON.parse(init!.body as string) as MessageCreateParams).stream).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "hi there" }]);
  });

  it.each([
    ["/api/anthropic", "http://localhost:3000/api/anthropic/v1/messages"],
    ["/api/anthropic/v1", "http://localhost:3000/api/anthropic/v1/messages"],
    ["/api/anthropic/v1/", "http://localhost:3000/api/anthropic/v1/messages"],
  ])("normalizes baseURL %s to %s (never doubles /v1)", async (baseURL, expectedURL) => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(jsonResponse(makeMockMessage()));
    const model = new AnthropicLanguageModel({ ...dummyCfg, baseURL }, { fetch: stubFetch });

    await model.generate({ messages: [{ role: "user", content: "hi" }], model: "test-model" });

    expect(stubFetch.mock.calls[0][0]).toBe(expectedURL);
  });

  it("runs the injected fetch — not a global fetch — for generate()", async () => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(jsonResponse(makeMockMessage()));
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    await model.generate({ messages: [{ role: "user", content: "hi" }], model: "test-model" });
    expect(stubFetch).toHaveBeenCalledTimes(1);
  });

  it("prompt caching: cache_control reaches the request body and cache tokens populate NormalizedUsage", async () => {
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(jsonResponse(makeMockMessage({
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 30 },
    })));
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "test-model",
      providerOptions: { anthropic: { systemStatic: "S" } },
    });

    const body = JSON.parse(stubFetch.mock.calls[0][1]!.body as string) as MessageCreateParams;
    expect(body.system).toEqual([{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
    expect(result.usage.cachedInputTokens).toBe(50);
    expect(result.usage.cacheCreationTokens).toBe(30);
  });
});
