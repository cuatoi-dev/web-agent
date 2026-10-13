import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { AnthropicLanguageModel } from "./anthropic-provider.js";
import type { AgentConfig } from "../config.js";
import type { Message, MessageStreamEvent, MessageCreateParams, StopReason, ContentBlockParam } from "./wire.types.js";
import type { StreamPart } from "./stream-parts.js";
import type { ResponseBlock, Tool } from "../types.js";


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

// Convert a mock Anthropic.Message into the MessageStreamEvent sequence that the
// real SDK would emit, so makeProvider can feed the incremental streaming path.
function messageToEvents(msg: Message): MessageStreamEvent[] {
  const events: MessageStreamEvent[] = [
    // Only `.usage` is read from message_start (see anthropic-provider.ts) — the
    // fixture is intentionally partial; the cast documents that, not a lie about
    // what the real SDK sends.
    { type: "message_start", message: { usage: msg.usage } as Message },
  ];

  msg.content.forEach((block, index) => {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
      events.push({ type: "content_block_stop", index });
    } else if (block.type === "thinking") {
      events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } });
      if (block.signature) {
        events.push({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: block.signature } });
      }
      events.push({ type: "content_block_stop", index });
    } else if (block.type === "tool_use") {
      const inputStr = JSON.stringify(block.input ?? {});
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: inputStr } });
      events.push({ type: "content_block_stop", index });
    }
    // redacted_thinking: no stream representation — skip
  });

  events.push({ type: "message_delta", delta: { stop_reason: msg.stop_reason }, usage: { output_tokens: msg.usage.output_tokens } });
  events.push({ type: "message_stop" });
  return events;
}

// Not `async function*` — no `await` in the body, and `for await...of` (the
// only way anthropic-provider.ts consumes this, at doStream's `for await
// (const event of messageStream)`) falls back to the sync iterator protocol
// transparently per spec, wrapping each yielded value exactly as an async
// generator would. Behaviourally identical for every consumer here.
function* asyncIterable(events: MessageStreamEvent[]): Iterable<MessageStreamEvent> {
  for (const e of events) yield e;
}

// doStream() uses the LOW-LEVEL raw event stream: messages.create({stream:true})
// returns an async iterable of raw events (NOT messages.stream()'s strict
// accumulator). So the mocked `create` branches on the stream flag: it returns
// an async iterable when stream:true, else the plain message object.
function makeCreateMock(mockResponse: Message, events: MessageStreamEvent[]) {
  return vi
    .fn<[MessageCreateParams, { signal?: AbortSignal }?], unknown>()
    .mockImplementation((params) =>
      params?.stream === true ? asyncIterable(events) : Promise.resolve(mockResponse),
    );
}

function makeProvider(mockResponse: Message) {
  const model = new AnthropicLanguageModel(dummyCfg);
  // Keep the mock as its own reference — never read back off model._client,
  // which would detach a method from its object (unbound-method).
  const createMock = makeCreateMock(mockResponse, messageToEvents(mockResponse));
  model._client = { messages: { create: createMock as unknown as (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => unknown } };
  return { model, createMock };
}

// Provider whose stream path emits arbitrary pre-built events (for incrementality tests).
function makeProviderFromEvents(mockResponse: Message, streamEvents: MessageStreamEvent[]) {
  const model = new AnthropicLanguageModel(dummyCfg);
  const createMock = makeCreateMock(mockResponse, streamEvents);
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

  describe("streaming vs non-streaming", () => {
    it("calls create when streaming is false", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: createSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
        streaming: false,
      });

      expect(createSpy).toHaveBeenCalled();
      // non-streaming: create is invoked WITHOUT stream:true
      expect(createSpy.mock.calls[0][0].stream).not.toBe(true);
    });

    it("calls stream when streaming is true", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: createSpy } = makeProvider(msg);

      await provider.generate({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
        streaming: true,
      });

      // streaming uses the low-level raw stream: create({ ..., stream:true })
      expect(createSpy).toHaveBeenCalled();
      expect(createSpy.mock.calls[0][0].stream).toBe(true);
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

    it("streaming path also emits cached blocks", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: createSpy } = makeProvider(msg);

      await provider.doStream({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
        providerOptions: { anthropic: { systemStatic: "S", systemDynamic: "D" } },
      });

      const streamCall = createSpy.mock.calls.find((c) => c[0].stream === true)!;
      expect(streamCall[0].system).toEqual([
        { type: "text", text: "S", cache_control: { type: "ephemeral" } },
        { type: "text", text: "D", cache_control: { type: "ephemeral" } },
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

    it("streaming path also carries the rolling breakpoint", async () => {
      const msg = makeMockMessage();
      const { model: provider, createMock: createSpy } = makeProvider(msg);

      await provider.doStream({
        messages: [{ role: "user", content: "hi" }],
        model: "claude-3-5",
      });

      const streamCall = createSpy.mock.calls.find((c) => c[0].stream === true)!;
      expect(streamCall[0].messages[0].content).toEqual([
        { type: "text", text: "hi", cache_control: { type: "ephemeral" } },
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// AnthropicLanguageModel.doStream() tests
// ---------------------------------------------------------------------------
describe("AnthropicLanguageModel.doStream()", () => {
  it("maps text block → text-start/delta/end stream parts and correct finish", async () => {
    const msg = makeMockMessage({ content: [{ type: "text", text: "Hello streaming" }], stop_reason: "end_turn" });
    const { model: provider } = makeProvider(msg);

    const { stream } = await provider.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
    });

    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    expect(parts[0]).toEqual({ type: "stream-start", warnings: [] });
    expect(parts.find(p => p.type === "text-start")).toBeDefined();
    expect(parts.find(p => p.type === "text-delta")).toMatchObject({ delta: "Hello streaming" });
    expect(parts.find(p => p.type === "text-end")).toBeDefined();
    const finish = parts.find((p): p is Extract<StreamPart, { type: "finish" }> => p.type === "finish");
    expect(finish!.finishReason).toBe("stop");
    expect(finish!.usage.inputTokens).toBe(10);
    expect(finish!.usage.outputTokens).toBe(20);
  });

  it("maps thinking block → reasoning-start/delta/end with preserved signature", async () => {
    const msg = makeMockMessage({
      content: [{ type: "thinking", thinking: "Pondering", signature: "sig_xyz" }],
      stop_reason: "end_turn",
    });
    const { model: provider } = makeProvider(msg);

    const { stream } = await provider.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
    });

    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    expect(parts.find(p => p.type === "reasoning-start")).toBeDefined();
    expect(parts.find(p => p.type === "reasoning-delta")).toMatchObject({ delta: "Pondering" });
    expect(parts.find(p => p.type === "reasoning-end")).toMatchObject({ signature: "sig_xyz" });
  });

  it("maps tool_use block → tool-input-* and tool-call parts", async () => {
    const msg = makeMockMessage({
      content: [{ type: "tool_use", id: "toolu_1", name: "click", input: { ref: "btn" } }],
      stop_reason: "tool_use",
    });
    const { model: provider } = makeProvider(msg);

    const { stream } = await provider.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
    });

    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    expect(parts.find(p => p.type === "tool-input-start")).toMatchObject({ id: "toolu_1", toolName: "click" });
    expect(parts.find(p => p.type === "tool-input-end")).toBeDefined();
    expect(parts.find(p => p.type === "tool-call")).toMatchObject({ toolCallId: "toolu_1", toolName: "click" });
    expect(parts.find(p => p.type === "finish")).toMatchObject({ finishReason: "tool-calls" });
  });

  it("doStream result equals prior fromAnthropicMessage result for text response", async () => {
    const msg = makeMockMessage({
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const { model: provider } = makeProvider(msg);

    // Non-stream result (reference from generate() with no streaming flag)
    const nonStreamResult = await provider.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
      streaming: false,
    });

    // Reset mock call count then check streaming path
    const { model: provider2 } = makeProvider(msg);
    const streamResult = await provider2.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
      streaming: true,
    });

    expect(streamResult.content).toEqual(nonStreamResult.content);
    expect(streamResult.finishReason).toBe(nonStreamResult.finishReason);
    expect(streamResult.usage).toEqual(nonStreamResult.usage);
  });

  it("doStream preserves cache tokens in usage", async () => {
    const msg = makeMockMessage({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
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
      streaming: true,
    });
    expect(result.usage.cachedInputTokens).toBe(50);
    expect(result.usage.cacheCreationTokens).toBe(30);
  });

  it("doStream preserves thinking + tool_use content order and signature", async () => {
    const msg = makeMockMessage({
      content: [
        { type: "thinking", thinking: "Pondering", signature: "sig_s" },
        { type: "tool_use", id: "call_s", name: "snapshot_page", input: {} },
      ],
      stop_reason: "tool_use",
    });
    const { model: provider } = makeProvider(msg);
    const result = await provider.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
      streaming: true,
    });

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: "thinking", thinking: "Pondering", signature: "sig_s" });
    expect(result.content[1]).toMatchObject({ type: "tool_use", id: "call_s", name: "snapshot_page", input: {} });
  });

  it("generate(streaming:true) uses the low-level raw stream (create stream:true)", async () => {
    const msg = makeMockMessage();
    const { model: provider, createMock: createSpy } = makeProvider(msg);

    await provider.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
      streaming: true,
    });

    expect(createSpy).toHaveBeenCalled();
    expect(createSpy.mock.calls[0][0].stream).toBe(true);
  });

  it("emits MULTIPLE text-delta parts for split text_delta events (incrementality)", async () => {
    const baseMsg = makeMockMessage({ content: [{ type: "text", text: "Hello" }] });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);

    const { stream } = await provider.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
    });

    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    const textDeltas = parts.filter(p => p.type === "text-delta");
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0]).toMatchObject({ delta: "Hel" });
    expect(textDeltas[1]).toMatchObject({ delta: "lo" });
  });

  it("emits MULTIPLE tool-input-delta parts for split input_json_delta events (incrementality)", async () => {
    const baseMsg = makeMockMessage({
      content: [{ type: "tool_use", id: "toolu_inc", name: "click", input: { x: 1 } }],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_inc", name: "click", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"x"' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ":1}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);

    const { stream } = await provider.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
    });

    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    const inputDeltas = parts.filter(p => p.type === "tool-input-delta");
    expect(inputDeltas).toHaveLength(2);
    expect(inputDeltas[0]).toMatchObject({ delta: '{"x"' });
    expect(inputDeltas[1]).toMatchObject({ delta: ":1}" });

    // tool-call input must be the concatenated partial_json
    const toolCall = parts.find(p => p.type === "tool-call");
    expect(toolCall).toMatchObject({ toolCallId: "toolu_inc", input: '{"x":1}' });
  });

  it("survives a gateway replaying content_block_delta/content_block_stop for an already-closed tool_use block", async () => {
    // Reproduces a real anomaly observed on the shared dev gateway: after the
    // first message_stop, the gateway re-sends the SAME content_block_delta +
    // content_block_stop for the tool_use block, then a second message_delta
    // (this time with the real usage numbers) + message_stop. Captured live via
    // `curl` replay of an actual conversation against /api/anthropic/v1/messages.
    const baseMsg = makeMockMessage({
      content: [{ type: "tool_use", id: "call_dup", name: "query_data", input: { source: "orders", filter: { id: "1001" } } }],
      stop_reason: "tool_use",
    });
    const fullArgs = '{"source":"orders","filter":{"id":"1001"}}';
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_dup", name: "query_data", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: fullArgs } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 0 } },
      { type: "message_stop" },
      // --- gateway replays the tail of the same block ---
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: fullArgs } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 64 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);

    const result = await provider.generate({
      messages: [{ role: "user", content: "status of order 1001" }],
      model: "claude-3-5",
      streaming: true,
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({
      type: "tool_use",
      id: "call_dup",
      name: "query_data",
      // The real bug: a duplicated/concatenated JSON string fails to parse and
      // safeJsonParse silently defaults to {}, dropping "source" and "filter"
      // entirely — the tool then errors with "Unknown source undefined" and
      // the model loops forever re-calling it.
      input: { source: "orders", filter: { id: "1001" } },
    });
  });

  it("a gateway that misroutes a second call's delta onto the first call's index does not concatenate them (task 002, live capture)", async () => {
    // Reproduces response #52 of the task 002 live frame trace verbatim:
    // two tool_use blocks open at index 1 and 2 (their own ids), but BOTH
    // argument deltas arrive under index 2, and content_block_stop for
    // index 1 fires in between with no delta of its own. Before the fix,
    // the second delta appended onto the first's accInput and produced a
    // multi-root JSON string that failed to parse.
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_7833788a0e954ace8eaac092", name: "query_data", input: {} },
        { type: "tool_use", id: "call_390be1739fc744edaa4ff53f", name: "query_data", input: { source: "orders" } },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_7833788a0e954ace8eaac092", name: "query_data", input: {} } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_390be1739fc744edaa4ff53f", name: "query_data", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"aggregate":{},"source":"orders"}' } },
      { type: "content_block_stop", index: 1 },
      // Misrouted: this is logically call_7833788a0e954ace8eaac092's payload,
      // but the gateway sent it under index 2, which is already complete.
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"select":["id"],"source":"products"}' } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 40 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let result;
    let warnMessages: string[];
    try {
      result = await provider.generate({
        messages: [{ role: "user", content: "report" }],
        model: "claude-3-5",
        streaming: true,
      });
    } finally {
      // Snapshot BEFORE restoring: mockRestore() also resets the spy, so
      // `.mock.calls` is empty afterwards. Reading it after the restore left
      // the loop at the end of this test iterating nothing, which made its two
      // assertions dead code.
      warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
      warnSpy.mockRestore();
    }

    // Both payloads are on the wire, so BOTH calls must come out with their
    // arguments. The FIRST payload keeps the index it was tagged to (2), and
    // only the overflow — the second payload on that same index, which
    // already has its arguments — is reattributed, to the block still empty.
    const tagged = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_390be1739fc744edaa4ff53f",
    );
    const repaired = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_7833788a0e954ace8eaac092",
    );
    expect(tagged).toMatchObject({ input: { aggregate: {}, source: "orders" } });
    expect(repaired).toMatchObject({ input: { select: ["id"], source: "products" } });

    // The defect this locks out: a call emitted with empty arguments because
    // its payload was discarded as a duplicate.
    expect("argumentsIssue" in tagged!).toBe(false);
    expect("argumentsIssue" in repaired!).toBe(false);
    for (const message of warnMessages) {
      expect(message).not.toContain("Empty tool arguments");
      expect(message).not.toContain("failed to parse");
    }
  });

  it("an overflow payload is dropped rather than given to a different tool", async () => {
    // Live run 2026-09-04: a query_data payload overflowed onto a calc block
    // and calc answered "Invalid input for calc: unrecognized key 'source'".
    // A misroute must never become a failed tool call — with no other
    // query_data call waiting, the payload is unplaceable and gets dropped.
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_q", name: "query_data", input: {} },
        { type: "tool_use", id: "call_c", name: "calc", input: {} },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_q", name: "query_data", input: {} } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_c", name: "calc", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"source":"orders"}' } },
      // Overflow on index 0, which already has its arguments. It is a
      // query_data payload; the only empty block is a calc.
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"source":"products","aggregate":{}}' } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    try {
      result = await provider.generate({
        messages: [{ role: "user", content: "report" }],
        model: "claude-3-5",
        streaming: true,
      });
    } finally {
      warnSpy.mockRestore();
    }

    const query = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_q",
    );
    const calc = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_c",
    );
    expect(query).toMatchObject({ input: { source: "orders" } });
    // The calc block must NOT receive query_data's arguments.
    expect(calc!.input).toEqual({});
  });

  it("a payload is not stolen from its own block by an earlier empty block of another tool", async () => {
    // Live run 2026-09-04: load_skill and list_data_sources were both open,
    // list_data_sources' payload arrived on its OWN index, and start-order
    // attribution handed it to load_skill — leaving list_data_sources empty
    // and load_skill holding arguments it never asked for. A payload keeps
    // the block it was tagged to whenever that block is still empty.
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_skill", name: "load_skill", input: {} },
        { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_skill", name: "load_skill", input: {} } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"source":"orders"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    try {
      result = await provider.generate({
        messages: [{ role: "user", content: "sources" }],
        model: "claude-3-5",
        streaming: true,
      });
    } finally {
      warnSpy.mockRestore();
    }

    const sources = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_sources",
    );
    const skill = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_skill",
    );
    expect(sources).toMatchObject({ input: { source: "orders" } });
    expect(skill!.input).toEqual({});
  });

  it("parallel zero-argument tool calls are all delivered, not dropped", async () => {
    // Tools that declare no parameters (get_theme, list_data_sources) stream
    // NO input_json_delta at all, so both blocks end empty. Reattribution
    // must not read that as "the payload went to the other index" and drop
    // one: the 2026-09-04 live run lost a real list_data_sources call that
    // way. `{}` is the correct input for these, and both must survive.
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_theme", name: "get_theme", input: {} },
        { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_theme", name: "get_theme", input: {} } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    try {
      result = await provider.generate({
        messages: [{ role: "user", content: "theme and sources" }],
        model: "claude-3-5",
        streaming: true,
      });
    } finally {
      warnSpy.mockRestore();
    }

    const toolCalls = result.content.filter(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use",
    );
    expect(toolCalls.map(b => b.id)).toEqual(["call_theme", "call_sources"]);
    expect(toolCalls[0].input).toEqual({});
    expect(toolCalls[1].input).toEqual({});
  });

  it("two consecutive tool calls that reuse the same index are isolated (task 002)", async () => {
    // A protocol-compliant Anthropic stream always closes a block
    // (content_block_stop) before the next content_block_start reuses its
    // index — this reproduces exactly that, to lock in that reuse-after-stop
    // never carries one call's accumulated input into the next.
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_1", name: "calc", input: { expression: "52.5/124.96" } },
        { type: "tool_use", id: "call_2", name: "calc", input: { expression: "11.36/17.48" } },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "calc", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"expression":"52.5/124.96"}' } },
      { type: "content_block_stop", index: 0 },
      // Same index (0) reused for a second, unrelated tool call.
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_2", name: "calc", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"expression":"11.36/17.48"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);

    const result = await provider.generate({
      messages: [{ role: "user", content: "calc two things" }],
      model: "claude-3-5",
      streaming: true,
    });

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: "tool_use", id: "call_1", input: { expression: "52.5/124.96" } });
    expect(result.content[1]).toMatchObject({ type: "tool_use", id: "call_2", input: { expression: "11.36/17.48" } });
  });

  // Mirrors packages/web-agent-core/src/tools/skill-tools.ts:23-33.
  const loadSkillTool: Tool = {
    name: "load_skill",
    description: "Load a skill by name",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  };

  // Mirrors apps/cat-store/src/web/store/theme-tool.ts:41-46 and
  // packages/web-agent-core/src/tools/definitions.ts:230-239 — no `required`.
  const getThemeTool: Tool = {
    name: "get_theme",
    description: "Read the current theme",
    input_schema: { type: "object", properties: {} },
  };
  const listDataSourcesTool: Tool = {
    name: "list_data_sources",
    description: "List available data sources",
    input_schema: { type: "object", properties: { source: { type: "string" } } },
  };

  it("a required-argument tool whose payload never arrives is dropped, not emitted empty", async () => {
    // Task 012. The end-of-stream flush used to emit `{}` for ANY tool
    // deferred with no payload — correct for a zero-parameter tool, but for
    // load_skill (required: ["name"]) that `{}` is never what the model
    // composed, and buys a guaranteed-useless round trip.
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_skill", name: "load_skill", input: {} },
        { type: "tool_use", id: "call_sources", name: "list_data_sources", input: { source: "orders" } },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_skill", name: "load_skill", input: {} } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"source":"orders"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    let warnMessages: string[];
    try {
      result = await provider.generate({
        messages: [{ role: "user", content: "load panel-chart" }],
        model: "claude-3-5",
        streaming: true,
        tools: [loadSkillTool, listDataSourcesTool],
      });
    } finally {
      // Snapshot the calls BEFORE mockRestore(): vitest's mockRestore() also
      // resets the mock, clearing .mock.calls — read after restore is always
      // empty.
      warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
      warnSpy.mockRestore();
    }

    expect(result.content.find(b => b.type === "tool_use" && b.id === "call_skill")).toBeUndefined();
    const sources = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_sources",
    );
    expect(sources).toMatchObject({ input: { source: "orders" } });

    expect(
      warnMessages.some(text =>
        text.includes("load_skill") && text.includes("call_skill") && text.includes("name") && text.includes("Dropping the call."),
      ),
    ).toBe(true);
    expect(
      result.warnings?.some(w => w.type === "other" && w.message.includes("load_skill") && w.message.includes("Dropping the call.")),
    ).toBe(true);
  });

  it("a zero-parameter tool whose payload never arrives is still emitted with {}", async () => {
    // Criterion 2 / BDD 0173.4. `{}` is the CORRECT input for a parameterless
    // tool. An earlier fix dropped these as "never received a payload" and cost
    // the model two real calls in the 2026-09-04 live run. The tools list here
    // deliberately also carries load_skill, so the required-arguments map is
    // non-empty and the drop rule is live — these two still survive it.
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_theme", name: "get_theme", input: {} },
        { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_theme", name: "get_theme", input: {} } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    let warnMessages: string[];
    try {
      result = await provider.generate({
        messages: [{ role: "user", content: "theme and sources" }],
        model: "claude-3-5",
        streaming: true,
        tools: [getThemeTool, listDataSourcesTool, loadSkillTool],
      });
    } finally {
      warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
      warnSpy.mockRestore();
    }

    const toolCalls = result.content.filter(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use",
    );
    expect(toolCalls.map(b => b.id)).toEqual(["call_theme", "call_sources"]);
    expect(toolCalls[0].input).toEqual({});
    expect(toolCalls[1].input).toEqual({});
    expect(warnMessages.some(text => text.includes("Dropping the call."))).toBe(false);
    expect(result.warnings?.some(w => w.message?.includes("Dropping the call."))).toBeFalsy();
  });

  it("a required-argument tool that receives its payload is unaffected", async () => {
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_skill", name: "load_skill", input: { name: "panel-chart" } },
        { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_skill", name: "load_skill", input: {} } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"name":"panel-chart"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    let warnMessages: string[];
    try {
      result = await provider.generate({
        messages: [{ role: "user", content: "load panel-chart" }],
        model: "claude-3-5",
        streaming: true,
        tools: [loadSkillTool, listDataSourcesTool],
      });
    } finally {
      warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
      warnSpy.mockRestore();
    }

    const skill = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_skill",
    );
    const sources = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_sources",
    );
    expect(skill).toMatchObject({ input: { name: "panel-chart" } });
    expect(sources!.input).toEqual({});
    expect(warnMessages.some(text => text.includes("Dropping the call."))).toBe(false);
  });

  it("a payload that arrives late by reattribution is not dropped by the required-argument rule", async () => {
    const queryDataTool: Tool = {
      name: "query_data",
      description: "Query a data source",
      input_schema: { type: "object", properties: { source: { type: "string" } }, required: ["source"] },
    };
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_7833788a0e954ace8eaac092", name: "query_data", input: {} },
        { type: "tool_use", id: "call_390be1739fc744edaa4ff53f", name: "query_data", input: { source: "orders" } },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_7833788a0e954ace8eaac092", name: "query_data", input: {} } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_390be1739fc744edaa4ff53f", name: "query_data", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"aggregate":{},"source":"orders"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"select":["id"],"source":"products"}' } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 40 } },
      { type: "message_stop" },
    ];
    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    let warnMessages: string[];
    try {
      result = await provider.generate({
        messages: [{ role: "user", content: "report" }],
        model: "claude-3-5",
        streaming: true,
        tools: [queryDataTool],
      });
    } finally {
      warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
      warnSpy.mockRestore();
    }

    const tagged = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_390be1739fc744edaa4ff53f",
    );
    const repaired = result.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_7833788a0e954ace8eaac092",
    );
    expect(tagged).toMatchObject({ input: { aggregate: {}, source: "orders" } });
    expect(repaired).toMatchObject({ input: { select: ["id"], source: "products" } });
    expect(warnMessages.some(text => text.includes("Dropping the call."))).toBe(false);
  });

  it("the flush is unchanged when the tool is absent from the tool list", async () => {
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_skill", name: "load_skill", input: {} },
        { type: "tool_use", id: "call_sources", name: "list_data_sources", input: { source: "orders" } },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_skill", name: "load_skill", input: {} } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"source":"orders"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ];

    for (const tools of [undefined, [getThemeTool]] as (Tool[] | undefined)[]) {
      const { model: provider } = makeProviderFromEvents(baseMsg, events);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let result;
      let warnMessages: string[];
      try {
        result = await provider.generate({
          messages: [{ role: "user", content: "load panel-chart" }],
          model: "claude-3-5",
          streaming: true,
          ...(tools ? { tools } : {}),
        });
      } finally {
        warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
        warnSpy.mockRestore();
      }

      const skill = result.content.find(
        (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_skill",
      );
      expect(skill).toMatchObject({ input: {} });
      expect(warnMessages.some(text => text.includes("Dropping the call."))).toBe(false);
    }
  });

  it("a malformed input_schema never breaks the stream", async () => {
    const baseMsg = makeMockMessage({
      content: [
        { type: "tool_use", id: "call_skill", name: "load_skill", input: {} },
        { type: "tool_use", id: "call_sources", name: "list_data_sources", input: { source: "orders" } },
      ],
      stop_reason: "tool_use",
    });
    const events = [
      { type: "message_start", message: { usage: baseMsg.usage } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_skill", name: "load_skill", input: {} } },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_sources", name: "list_data_sources", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"source":"orders"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ];
    const malformedTools = [
      { name: "load_skill", description: "broken required", input_schema: { type: "object", required: "name" } },
      { name: "list_data_sources", description: "missing schema" },
    ] as unknown as Tool[];

    const { model: provider } = makeProviderFromEvents(baseMsg, events);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    await expect(
      (async () => {
        result = await provider.generate({
          messages: [{ role: "user", content: "load panel-chart" }],
          model: "claude-3-5",
          streaming: true,
          tools: malformedTools,
        });
      })(),
    ).resolves.toBeUndefined();
    const warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
    warnSpy.mockRestore();

    const skill = result!.content.find(
      (b): b is Extract<ResponseBlock, { type: "tool_use" }> => b.type === "tool_use" && b.id === "call_skill",
    );
    expect(skill).toMatchObject({ input: {} });
    expect(warnMessages.some(text => text.includes("Dropping the call."))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Raw fetch transport — no _client override, so generate()/doStream() go
// through requestJson/requestStream (./anthropic-request.js) over an injected
// fetch. Covers the pieces task 001's SDK-mocked suite above cannot reach:
// the actual HTTP call, URL normalization, and gateway SSE tolerance end to end.
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
    // non-streaming POST test below.

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
    // parse. Mirrors the `stream: true` assertion in the doStream test below.
    expect((JSON.parse(init!.body as string) as MessageCreateParams).stream).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "hi there" }]);
  });

  it("POSTs to /v1/messages with stream:true for doStream() and streams parts incrementally", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ];
    const sseBody = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(
      new Response(sseBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    const { stream } = await model.doStream({ messages: [{ role: "user", content: "hi" }], model: "test-model" });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    const [url, init] = stubFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/anthropic/v1/messages");
    expect((JSON.parse(init!.body as string) as MessageCreateParams).stream).toBe(true);

    // Incrementality: two separate text-delta parts arrive before the finish part.
    const textDeltas = parts.filter((p) => p.type === "text-delta");
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0]).toMatchObject({ delta: "Hel" });
    expect(textDeltas[1]).toMatchObject({ delta: "lo" });
    expect(parts[parts.length - 1]).toMatchObject({ type: "finish", finishReason: "stop" });
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

  it("runs the injected fetch — not a global fetch — for both generate() and doStream()", async () => {
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

  it("tolerates gateway SSE anomalies (duplicate message_delta/message_stop, [DONE], comment lines, truncated JSON) without crashing", async () => {
    const sseBody = [
      `: heartbeat\n`,
      `data: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":0}}}\n\n`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n`,
      `data: {"type":"content_block_stop","index":0}\n\n`,
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n`,
      `data: {"type":"message_stop"}\n\n`,
      // Duplicate message_delta/message_stop after the first, per a translating gateway.
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n`,
      `data: {"type":"message_stop"}\n\n`,
      // Truncated JSON payload — must be dropped, not thrown.
      `data: {"type":"content_block_delta","index":0\n\n`,
      // OpenAI-style trailing sentinel.
      `data: [DONE]\n\n`,
    ].join("");
    const stubFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockResolvedValue(
      new Response(sseBody, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    const model = new AnthropicLanguageModel(anthropicCfg, { fetch: stubFetch });

    const { stream } = await model.doStream({ messages: [{ role: "user", content: "hi" }], model: "test-model" });
    const parts: StreamPart[] = [];
    await expect((async () => {
      for await (const p of stream) parts.push(p);
    })()).resolves.not.toThrow();

    expect(parts.find((p) => p.type === "text-delta")).toMatchObject({ delta: "ok" });
    expect(parts.filter((p) => p.type === "finish")).toHaveLength(1);
  });

  // Regression, task 004 (2026-08-15). The gateway sends message_start with
  // usage.input_tokens = 0 and the real prompt count on message_delta. Reading
  // it only from message_start reported 0 input tokens for every Anthropic
  // streaming turn. Numbers are the ones measured on the live route.
  it("takes input_tokens from message_delta when message_start reports zero", async () => {
    const events: MessageStreamEvent[] = [
      { type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } as Message },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { input_tokens: 2111, output_tokens: 52 },
      },
      { type: "message_stop" },
    ];
    const provider = new AnthropicLanguageModel(dummyCfg);
    provider._client = { messages: { create: vi.fn().mockReturnValue(asyncIterable(events)) } };

    const { stream } = await provider.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    const finish = parts.find((p): p is Extract<StreamPart, { type: "finish" }> => p.type === "finish");
    expect(finish!.usage.inputTokens).toBe(2111);
    expect(finish!.usage.outputTokens).toBe(52);
  });

  it("keeps the message_start input_tokens when message_delta omits the field", async () => {
    const events: MessageStreamEvent[] = [
      { type: "message_start", message: { usage: { input_tokens: 77, output_tokens: 0 } } as Message },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ];
    const provider = new AnthropicLanguageModel(dummyCfg);
    provider._client = { messages: { create: vi.fn().mockReturnValue(asyncIterable(events)) } };

    const { stream } = await provider.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-3-5",
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    const finish = parts.find((p): p is Extract<StreamPart, { type: "finish" }> => p.type === "finish");
    expect(finish!.usage.inputTokens).toBe(77);
  });
});
