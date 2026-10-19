import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { z } from "zod";
import { runBareTurn, buildGenerateSettings, createPageAgent } from "./agent.js";
import { toAnthropicMessages } from "../transport/message-converter.js";
import type { ModelMessage, ContentPart } from "../types.js";
import { AgentConfig } from "../config.js";
import { buildSystemPrompt } from "../prompt/system-prompt.js";
import { ContextManager } from "./context-manager.js";
import type { AuditEntry } from "./context-manager.js";
import type { ToolContext, CustomToolDef } from "../tools/build-tools.js";
import { AgentError } from "./errors.js";
import type { Message, MessageCreateParams, ContentBlockParam, ImageBlockParam } from "../transport/wire.types.js";
import { createMockProvider } from "../transport/mock-provider.js";
import type { ProviderWarning } from "../transport/provider.types.js";

/** The shape of `_client.messages.create`'s mock in these tests — one request
 * param object in, an Anthropic message back (or a rejection). */
type CreateMock = Mock<[MessageCreateParams], Promise<Message>>;

/** `_client.messages.create`'s real declared type (see anthropic-provider.ts).
 * Test mocks are typed narrowly against the real SDK's MessageCreateParams,
 * which the wider Record<string, unknown> production signature doesn't
 * accept without a bridge — this is a type-only cast, not a behavior change. */
type RealCreate = (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => unknown;

/** Build a mock Anthropic response body. */
function mockAnthropicResponse(text: string, status = 200) {
  const body = JSON.stringify({
    id: "msg_mock",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    model: "mock-model",
    usage: {
      input_tokens: 5,
      output_tokens: 2,
    },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

const testCfg: AgentConfig = {
  baseURL: "http://localhost:8080/api/openai/v1",
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
  endpointType: "anthropic",
  thinking: { enabled: false },
  generation: {},
};

describe("runBareTurn", () => {
  it("resolves with text on 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockAnthropicResponse("Hello there!"));
    const result = await runBareTurn("Say hi", testCfg, { fetch: mockFetch });
    expect(result).toBe("Hello there!");
  });

  it("rejects with AgentError kind=bad_request on 400", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockAnthropicResponse("Bad request", 400));
    try {
      await runBareTurn("Say hi", testCfg, { fetch: mockFetch });
      expect.fail("expected rejection");
    } catch (err: unknown) {
      expect((err as AgentError).name).toBe("AgentError");
      expect((err as AgentError).kind).toBe("bad_request");
    }
  });

  it("rejects with AgentError kind=rate_limit on 429 after retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockAnthropicResponse("Rate limited", 429));
    try {
      await runBareTurn("Say hi", { ...testCfg, maxRetries: 1 }, { fetch: mockFetch });
      expect.fail("expected rejection");
    } catch (err: unknown) {
      expect((err as AgentError).name).toBe("AgentError");
      expect((err as AgentError).kind).toBe("rate_limit");
    }
  });

  it("rejects with AgentError kind=aborted when signal is already aborted", async () => {
    const aborted = AbortSignal.abort();
    const mockFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation((_input, init) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
      }
      return Promise.resolve(mockAnthropicResponse("hi"));
    });
    try {
      await runBareTurn("Say hi", testCfg, { fetch: mockFetch, signal: aborted });
      expect.fail("expected rejection");
    } catch (err: unknown) {
      expect((err as AgentError).name).toBe("AgentError");
      expect((err as AgentError).kind).toBe("aborted");
    }
  });

  it("uses cfg.fetch when opts.fetch is omitted", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockAnthropicResponse("Reply via cfg.fetch"));
    const result = await runBareTurn("Say hi", { ...testCfg, fetch: mockFetch });
    expect(result).toBe("Reply via cfg.fetch");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("prefers opts.fetch over cfg.fetch when both are provided", async () => {
    const cfgFetch = vi.fn().mockResolvedValue(mockAnthropicResponse("From cfg"));
    const optFetch = vi.fn().mockResolvedValue(mockAnthropicResponse("From opt"));
    const result = await runBareTurn("Say hi", { ...testCfg, fetch: cfgFetch }, { fetch: optFetch });
    expect(result).toBe("From opt");
    expect(optFetch).toHaveBeenCalledTimes(1);
    expect(cfgFetch).not.toHaveBeenCalled();
  });
});

describe("buildGenerateSettings", () => {
  it("maps generation config temperature", () => {
    const cfg = { ...testCfg, generation: { temperature: 0.7 } };
    const settings = buildGenerateSettings(cfg);
    expect(settings.temperature).toBe(0.7);
  });

  it("maps generation config topK and topP", () => {
    const cfg = { ...testCfg, generation: { topK: 40, topP: 0.9 } };
    const settings = buildGenerateSettings(cfg);
    expect(settings.topK).toBe(40);
    expect(settings.topP).toBe(0.9);
  });

  it("maps generation config maxOutputTokens", () => {
    const cfg = { ...testCfg, generation: { maxOutputTokens: 2048 } };
    const settings = buildGenerateSettings(cfg);
    expect(settings.maxOutputTokens).toBe(2048);
  });

  it("maps generation config stopSequences", () => {
    const cfg = { ...testCfg, generation: { stopSequences: ["END"] } };
    const settings = buildGenerateSettings(cfg);
    expect(settings.stopSequences).toEqual(["END"]);
  });

  it("maps generation config seed", () => {
    const cfg = { ...testCfg, generation: { seed: 42 } };
    const settings = buildGenerateSettings(cfg);
    expect(settings.seed).toBe(42);
  });

  it("maps generation config penalties", () => {
    const cfg = { ...testCfg, generation: { frequencyPenalty: 0.5, presencePenalty: 0.3 } };
    const settings = buildGenerateSettings(cfg);
    expect(settings.frequencyPenalty).toBe(0.5);
    expect(settings.presencePenalty).toBe(0.3);
  });

  it("defaults maxRetries to 3", () => {
    const cfg = { ...testCfg, generation: {} };
    const settings = buildGenerateSettings(cfg);
    expect(settings.maxRetries).toBe(3);
  });

  it("maps generation config maxRetries", () => {
    const cfg = { ...testCfg, generation: { maxRetries: 5 } };
    const settings = buildGenerateSettings(cfg);
    expect(settings.maxRetries).toBe(5);
  });

  it("appends appendSystemPrompt to instructions when app is provided", () => {
    const app = { appName: "Test", appDescription: "Test app" };
    const cfg = { ...testCfg, appendSystemPrompt: "Extra instructions." };
    const settings = buildGenerateSettings(cfg, app);
    expect(settings.instructions).toContain("Extra instructions.");
    expect(settings.instructions).toContain(buildSystemPrompt(app));
  });

  it("returns only appendSystemPrompt when no app is provided", () => {
    const cfg = { ...testCfg, appendSystemPrompt: "Standalone instructions." };
    const settings = buildGenerateSettings(cfg);
    expect(settings.instructions).toBe("Standalone instructions.");
  });

  it("returns systemStatic/systemDynamic when app is provided", () => {
    const app = { appName: "Test", appDescription: "Test app", route: "/cart" };
    const cfg = { ...testCfg };
    const settings = buildGenerateSettings(cfg, app);
    expect(settings.systemStatic).toBeDefined();
    expect(settings.systemStatic).toContain("# Tool guidelines");
    expect(settings.systemStatic).not.toContain("Current route:");
    expect(settings.systemDynamic).toBeDefined();
    expect(settings.systemDynamic).toContain("Current route:");
  });

  it("systemStatic/systemDynamic undefined when no app", () => {
    const cfg = { ...testCfg };
    const settings = buildGenerateSettings(cfg);
    expect(settings.systemStatic).toBeUndefined();
    expect(settings.systemDynamic).toBeUndefined();
  });

  it("appendSystemPrompt is included in systemStatic", () => {
    const app = { appName: "Test", appDescription: "Test app" };
    const cfg = { ...testCfg, appendSystemPrompt: "Extra." };
    const settings = buildGenerateSettings(cfg, app);
    expect(settings.systemStatic).toContain("Extra.");
    expect(settings.systemStatic!.endsWith("Extra.")).toBe(true);
  });
});

function anthropicTextResponse(text: string): Message {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    model: "test",
    usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function anthropicToolUseResponse(id: string, name: string, input: unknown = {}): Message {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    model: "test",
    usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function anthropicMultiToolUseResponse(calls: Array<{ id: string; name: string; input?: unknown }>): Message {
  return {
    id: "msg_x", type: "message", role: "assistant",
    content: calls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input ?? {} })),
    stop_reason: "tool_use", stop_sequence: null, model: "test",
    usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}
const IMG_A = "data:image/png;base64,AAAA";
const IMG_B = "data:image/png;base64,BBBB";
function imageTool(name: string, urls: string[]): CustomToolDef {
  return {
    name, description: name, inputSchema: z.object({}),
    execute: () => Promise.resolve({ content: `${name} done`, images: urls.map((dataUrl) => ({ dataUrl, mediaType: "image/png" })) }),
  };
}
// The last user message of a captured request, as Anthropic blocks.
function lastUserBlocks(call: MessageCreateParams): ContentBlockParam[] {
  const last = call.messages[call.messages.length - 1];
  return last.content as ContentBlockParam[];
}

function makeAgent(opts: { cfg?: Partial<AgentConfig>; mockCreate: CreateMock }) {
  const ctx: ToolContext = {
    app: { appName: "Test" },
    signal: new AbortController().signal,
  };
  const cm = {
    compose: (): ModelMessage[] => [],
    recordStep: vi.fn<[ModelMessage[], AuditEntry[]?, Record<string, { dataUrl: string; mediaType: string }[]>?], void>(),
    commitTurn: vi.fn<[ModelMessage[]?], void>(),
    recordUsage: vi.fn<[{ inputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number } | number], void>(),
  };
  const agent = createPageAgent({ ...testCfg, ...(opts.cfg ?? {}) }, ctx, cm as unknown as ContextManager);
  agent._client = { messages: { create: opts.mockCreate as unknown as RealCreate } };
  return { agent, ctx, cm };
}

describe("PageAgent.generate() — prepareStep / onStepFinish / delta", () => {
  it.each([
    { imageInput: false, model: "sonnet", reachesModel: false },
    { imageInput: undefined, model: "text-model", reachesModel: false },
    { imageInput: undefined, model: "sonnet", reachesModel: true },
    { imageInput: true, model: "text-model", reachesModel: true },
  ])("sends tool image labels only with their images ($imageInput, $model)", async ({ imageInput, model, reachesModel }) => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>()
      .mockResolvedValueOnce(anthropicToolUseResponse("call_1", "img_a"))
      .mockResolvedValueOnce(anthropicTextResponse("done"));
    const ctx: ToolContext = { app: { appName: "Test" }, signal: new AbortController().signal };
    const cm = new ContextManager(testCfg.context);
    const user: ModelMessage = { role: "user", content: "hello" };
    cm.appendUser(user);
    const agent = createPageAgent({
      ...testCfg, imageInput, model, tools: () => [imageTool("img_a", [IMG_A, IMG_B])],
    }, ctx, cm);
    agent._client = { messages: { create: mockCreate as unknown as RealCreate } };

    await agent.generate({ messages: [user], abortSignal: ctx.signal });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const request = mockCreate.mock.calls[1][0];
    const blocks = request.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
    const images = blocks.filter((block) => block.type === "image");
    const labels = blocks.filter((block) => block.type === "text" && block.text.startsWith("Image from tool "));
    expect(images).toHaveLength(reachesModel ? 2 : 0);
    expect(labels).toHaveLength(images.length);
    expect(JSON.stringify(request.messages)).toContain("img_a done");
    if (reachesModel) {
      expect(lastUserBlocks(request).map((block) => block.type)).toEqual(["text", "image", "text", "image"]);
      expect(images.map((image) => image.source.data)).toEqual(["AAAA", "BBBB"]);
      expect(labels.map((label) => label.text)).toEqual(["Image from tool img_a:", "Image from tool img_a:"]);
    } else {
      expect(request.messages).toHaveLength(3);
    }
    expect(cm.journal.find((entry) => entry.msg.role === "tool")?.meta.toolImages).toEqual({
      call_1: [
        { dataUrl: IMG_A, mediaType: "image/png" },
        { dataUrl: IMG_B, mediaType: "image/png" },
      ],
    });
  });

  it("one tool, two images produces two image parts after labels (003 U4)", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(anthropicToolUseResponse("call_1", "img_a"))
      .mockResolvedValueOnce(anthropicTextResponse("done"));
    const { agent, ctx, cm } = makeAgent({
      mockCreate,
      cfg: { imageInput: true, tools: () => [imageTool("img_a", [IMG_A, IMG_B])] },
    });

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const callArg = mockCreate.mock.calls[1][0];
    const blocks = lastUserBlocks(callArg);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({ type: "text", text: "Image from tool img_a:" });
    expect(blocks[1].type).toBe("image");
    expect((blocks[1] as ImageBlockParam).source.data).toBe("AAAA");
    expect((blocks[1] as ImageBlockParam).source.media_type).toBe("image/png");
    expect(blocks[2]).toEqual({ type: "text", text: "Image from tool img_a:" });
    expect(blocks[3].type).toBe("image");
    expect((blocks[3] as ImageBlockParam).source.data).toBe("BBBB");
    expect((blocks[3] as ImageBlockParam).source.media_type).toBe("image/png");

    // U8b check:
    expect(cm.recordStep.mock.calls[0][2]).toEqual({
      call_1: [
        { dataUrl: IMG_A, mediaType: "image/png" },
        { dataUrl: IMG_B, mediaType: "image/png" },
      ],
    });
    expect(cm.recordStep.mock.calls[1][2]).toEqual({});
  });

  it("two tools in one step sends both images in call order (003 U5)", async () => {
    // Before 003 only the last image (BBBB) was sent.
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(
        anthropicMultiToolUseResponse([
          { id: "c1", name: "img_a" },
          { id: "c2", name: "img_b" },
        ]),
      )
      .mockResolvedValueOnce(anthropicTextResponse("done"));
    const { agent, ctx } = makeAgent({
      mockCreate,
      cfg: {
        imageInput: true,
        tools: () => [imageTool("img_a", [IMG_A]), imageTool("img_b", [IMG_B])],
      },
    });

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const callArg = mockCreate.mock.calls[1][0];
    const blocks = lastUserBlocks(callArg);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({ type: "text", text: "Image from tool img_a:" });
    expect((blocks[1] as ImageBlockParam).source.data).toBe("AAAA");
    expect(blocks[2]).toEqual({ type: "text", text: "Image from tool img_b:" });
    expect((blocks[3] as ImageBlockParam).source.data).toBe("BBBB");
  });

  it("each image is sent once (003 U6)", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(anthropicToolUseResponse("c1", "img_a"))
      .mockResolvedValueOnce(anthropicToolUseResponse("c2", "noop"))
      .mockResolvedValueOnce(anthropicTextResponse("done"));
    const noopTool: CustomToolDef = {
      name: "noop",
      description: "noop",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "ok" }),
    };
    const { agent, ctx } = makeAgent({
      mockCreate,
      cfg: {
        imageInput: true,
        tools: () => [imageTool("img_a", [IMG_A]), noopTool],
      },
    });

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(mockCreate).toHaveBeenCalledTimes(3);
    const call2 = mockCreate.mock.calls[1][0];
    expect(lastUserBlocks(call2).some((b) => b.type === "image" && b.source.data === "AAAA")).toBe(true);

    const call3 = mockCreate.mock.calls[2][0];
    for (const msg of call3.messages) {
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          expect(b.type).not.toBe("image");
        }
      }
    }
  });

  it("text-only model drops image from wire but hands to journal (003 U7)", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(anthropicToolUseResponse("call_1", "img_a"))
      .mockResolvedValueOnce(anthropicTextResponse("done"));
    const { agent, ctx, cm } = makeAgent({
      mockCreate,
      cfg: { imageInput: false, tools: () => [imageTool("img_a", [IMG_A, IMG_B])] },
    });

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const callArg = mockCreate.mock.calls[1][0];
    for (const msg of callArg.messages) {
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          expect(b.type).not.toBe("image");
        }
      }
    }
    expect(cm.recordStep.mock.calls[0][2]).toEqual({
      call_1: [
        { dataUrl: IMG_A, mediaType: "image/png" },
        { dataUrl: IMG_B, mediaType: "image/png" },
      ],
    });

    const warnings: ProviderWarning[] = [];
    const converted = toAnthropicMessages(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Image from tool img_a:" },
            { type: "image", image: IMG_A, mediaType: "image/png" },
          ],
        },
      ],
      warnings,
      { imageInputEnabled: false },
    );
    expect(warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ feature: "image-input" })]),
    );
    const lastConverted = converted.messages[converted.messages.length - 1];
    expect(
      (lastConverted.content as ContentBlockParam[]).some((b) => b.type === "image"),
    ).toBe(false);
  });

  it("no tool returned images: no extra user message (003 U8)", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("done"));
    const { agent, ctx } = makeAgent({ mockCreate });

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(mockCreate).toHaveBeenCalled();
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.messages).toHaveLength(1);
    expect(callArg.messages[0].role).toBe("user");
    expect(callArg.messages[0].content).toEqual([
      { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("cm.recordStep called with delta on first step (prevMsgCount=0)", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("done"));
    const { agent, ctx, cm } = makeAgent({ mockCreate });

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(cm.recordStep).toHaveBeenCalledTimes(1);
    const delta = cm.recordStep.mock.calls[0][0];
    expect(delta).toHaveLength(1);
    expect(delta[0].role).toBe("assistant");
    expect((delta[0].content as { text: string }[])[0].text).toBe("done");
  });

  it("cm.recordStep records only delta on second tool step", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(anthropicToolUseResponse("call-1", "snapshot_page"))
      .mockResolvedValueOnce(anthropicTextResponse("done"));

    const { agent, ctx, cm } = makeAgent({ mockCreate });
    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });

    expect(cm.recordStep).toHaveBeenCalledTimes(2);
    const delta1 = cm.recordStep.mock.calls[0][0];
    expect(delta1).toHaveLength(2);
    expect(delta1[0].role).toBe("assistant");
    expect(delta1[1].role).toBe("tool");

    const delta2 = cm.recordStep.mock.calls[1][0];
    expect(delta2).toHaveLength(1);
    expect(delta2[0].role).toBe("assistant");
    expect((delta2[0].content as { text: string }[])[0].text).toBe("done");
  });

  it("cm.recordStep records unique delta across three steps", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(anthropicToolUseResponse("call-1", "snapshot_page"))
      .mockResolvedValueOnce(anthropicToolUseResponse("call-2", "click", { ref: "btn" }))
      .mockResolvedValueOnce(anthropicTextResponse("done"));

    const { agent, ctx, cm } = makeAgent({ mockCreate });
    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });

    expect(cm.recordStep).toHaveBeenCalledTimes(3);
    expect(cm.recordStep.mock.calls[0][0]).toHaveLength(2);
    expect(cm.recordStep.mock.calls[1][0]).toHaveLength(2);
    expect(cm.recordStep.mock.calls[2][0]).toHaveLength(1);
  });

  it("prevMsgCount resets to 0 at the start of each generate() call", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("done"));
    const { agent, ctx, cm } = makeAgent({ mockCreate });

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(cm.recordStep).toHaveBeenCalledTimes(1);
    expect(cm.recordStep.mock.calls[0][0]).toHaveLength(1);

    cm.recordStep.mockReset();

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(cm.recordStep).toHaveBeenCalledTimes(1);
    expect(cm.recordStep.mock.calls[0][0]).toHaveLength(1);
  });

  it("each createPageAgent instance has independent prevMsgCount", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("done"));
    const { agent: agentA, ctx: ctxA, cm: cmA } = makeAgent({ mockCreate });
    const { agent: agentB, ctx: ctxB, cm: cmB } = makeAgent({ mockCreate });

    await agentA.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctxA.signal });
    expect(cmA.recordStep).toHaveBeenCalledTimes(1);
    expect(cmA.recordStep.mock.calls[0][0]).toHaveLength(1);

    await agentB.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctxB.signal });
    expect(cmB.recordStep).toHaveBeenCalledTimes(1);
    expect(cmB.recordStep.mock.calls[0][0]).toHaveLength(1);
  });

  it("audit entries passed alongside delta (toolName/input/output present)", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(anthropicToolUseResponse("call-1", "snapshot_page"))
      .mockResolvedValueOnce(anthropicTextResponse("done"));

    const { agent, ctx, cm } = makeAgent({ mockCreate });
    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });

    expect(cm.recordStep).toHaveBeenCalledTimes(2);
    const auditArg = cm.recordStep.mock.calls[0][1];
    expect(auditArg).toBeDefined();
    expect(auditArg).toHaveLength(1);
    expect(auditArg![0].name).toBe("snapshot_page");
    expect(auditArg![0].input).toEqual({});
  });

  it("throws AbortError if abortSignal is aborted before generate", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("done"));
    const { agent } = makeAgent({ mockCreate });
    const controller = new AbortController();
    controller.abort();

    await expect(
      agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: controller.signal })
    ).rejects.toThrow(/aborted|AbortError/);
  });

  it("extracts final text correctly", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("hello world"));
    const { agent, ctx } = makeAgent({ mockCreate });

    const result = await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(result.text).toBe("hello world");
  });

  it("respects maxIterations and stops with tool-calls finishReason", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicToolUseResponse("call-inf", "snapshot_page"));
    const { agent, ctx } = makeAgent({ cfg: { maxIterations: 3 }, mockCreate });

    const result = await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[2].finishReason).toBe("tool-calls");
  });

  it("populates step usage correctly", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("done"));
    const { agent, ctx } = makeAgent({ mockCreate });

    const result = await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(result.steps[0].usage.inputTokens).toBe(5);
    expect(result.steps[0].usage.outputTokens).toBe(2);
  });
});

describe("PageAgent.generate() and runBareTurn() — thinking and error taxonomy", () => {
  it("createPageAgent().generate() includes thinking config and omits temperature/topP/topK when enabled", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("done"));
    const { agent, ctx } = makeAgent({
      cfg: {
        thinking: { enabled: true, budgetTokens: 2048 },
        generation: { temperature: 0.7, topP: 0.9, topK: 40 },
      },
      mockCreate,
    });

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(callArg.temperature).toBeUndefined();
    expect(callArg.top_p).toBeUndefined();
    expect(callArg.top_k).toBeUndefined();
  });

  it("createPageAgent().generate() captures thinking blocks and replays them verbatim on next tool turn", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "test",
      content: [
        { type: "thinking", thinking: "Pondering", signature: "sig_abc" },
        { type: "tool_use", id: "call_1", name: "snapshot_page", input: {} },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 10 },
    }).mockResolvedValueOnce(anthropicTextResponse("done"));

    const { agent, ctx } = makeAgent({
      cfg: { thinking: { enabled: true, budgetTokens: 1024 } },
      mockCreate,
    });

    const result = await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // First call returned thinking block in response.messages
    expect(result.response.messages[0].role).toBe("assistant");
    const assistantContent = result.response.messages[0].content as ContentPart[];
    expect(assistantContent[0]).toEqual({ type: "thinking", thinking: "Pondering", signature: "sig_abc" });

    // Second call replayed the thinking block verbatim inside assistant message
    const secondCallArg = mockCreate.mock.calls[1][0];
    const replayedAssistantMsg = secondCallArg.messages[1];
    expect(replayedAssistantMsg.role).toBe("assistant");
    expect((replayedAssistantMsg.content as ContentBlockParam[])[0]).toEqual({
      type: "thinking",
      thinking: "Pondering",
      signature: "sig_abc",
    });
  });

  it("createPageAgent().generate() throws typed AgentError on HTTP errors or aborts", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockRejectedValue({ status: 429, message: "Rate limit exceeded" });
    const { agent, ctx } = makeAgent({ mockCreate, cfg: { maxRetries: 0 } });

    await expect(
      agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal })
    ).rejects.toMatchObject({ name: "AgentError", kind: "rate_limit" });
  });

  it("agent.generate calls cm.recordUsage on step completion with correct tokens", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue({
      id: "msg_x",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      model: "test",
      usage: {
        input_tokens: 120,
        output_tokens: 15,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 10,
      },
    });

    const ctx: ToolContext = {
      app: { appName: "Test" },
      signal: new AbortController().signal,
    };
    const realCm = new ContextManager(testCfg.context);
    const agent = createPageAgent(testCfg, ctx, realCm);
    agent._client = { messages: { create: mockCreate as unknown as RealCreate } };

    const recordUsageSpy = vi.spyOn(realCm, "recordUsage");

    await agent.generate({ messages: [{ role: "user", content: "hello" }], abortSignal: ctx.signal });

    expect(recordUsageSpy).toHaveBeenCalledWith({
      inputTokens: 120,
      outputTokens: 15,
      cacheReadTokens: 80,
      cacheCreationTokens: 10,
    });

    const expectedTokens = 210 + realCm.estimateTokens(realCm.journal.slice(realCm.journal.length - 1).map(e => e.msg));
    expect(realCm.getUsage().tokens).toBeCloseTo(expectedTokens);
  });

  it("runBareTurn passes thinking options when enabled and omits temperature/topP/topK", async () => {
    let capturedReq!: MessageCreateParams;
    const mockFetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation((_url, init) => {
      capturedReq = JSON.parse(init!.body as string) as MessageCreateParams;
      return Promise.resolve(mockAnthropicResponse("Reply"));
    });

    const cfg: AgentConfig = {
      ...testCfg,
      thinking: { enabled: true, budgetTokens: 512 },
      generation: { temperature: 0.5, topP: 0.8, topK: 20 },
    };

    const res = await runBareTurn("Test prompt", cfg, { fetch: mockFetch });
    expect(res).toBe("Reply");
    expect(capturedReq.thinking).toEqual({ type: "enabled", budget_tokens: 512 });
    expect(capturedReq.temperature).toBeUndefined();
    expect(capturedReq.top_p).toBeUndefined();
    expect(capturedReq.top_k).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createMockProvider integration — registry injection (030-5)
// ---------------------------------------------------------------------------
import { createMockProvider } from "../transport/mock-provider.js";
import { setMockScript } from "../transport/registry.js";

describe("createMockProvider — agent loop integration (030-5)", () => {
  it("direct _model injection: tool-call-then-text script drives the full loop deterministically", async () => {
    const ctx: ToolContext = {
      app: { appName: "Test" },
      signal: new AbortController().signal,
    };
    const cm = { compose: () => [], recordStep: vi.fn(), commitTurn: vi.fn(), recordUsage: vi.fn() } as unknown as ContextManager;
    const agent = createPageAgent({ ...testCfg, maxIterations: 12 }, ctx, cm);

    // Script: turn 1 → tool call (snapshot_page), turn 2 → final text
    const mockModel = createMockProvider([
      { toolCalls: [{ id: "tc1", name: "snapshot_page", input: {} }] },
      { text: "done" },
    ]);
    agent._model = mockModel;

    const result = await agent.generate({
      messages: [{ role: "user", content: "go" }],
      abortSignal: ctx.signal,
    });

    expect(result.text).toBe("done");
  });

  it("registry injection via endpointType:mock + setMockScript drives the loop", async () => {
    setMockScript({ text: "registry-reply" });

    const ctx: ToolContext = {
      app: { appName: "Test" },
      signal: new AbortController().signal,
    };
    const cm = { compose: () => [], recordStep: vi.fn(), commitTurn: vi.fn(), recordUsage: vi.fn() } as unknown as ContextManager;
    const agent = createPageAgent(
      { ...testCfg, endpointType: "mock" as const, maxIterations: 3 },
      ctx,
      cm,
    );

    const result = await agent.generate({
      messages: [{ role: "user", content: "hello" }],
      abortSignal: ctx.signal,
    });

    expect(result.text).toBe("registry-reply");
  });
});

describe("PageAgent — runtime model swap (067)", () => {
  it("setModel changes the model sent on the next generate() call", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue({
      id: "msg_x", type: "message", role: "assistant",
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn", stop_sequence: null, model: "test",
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const { agent, ctx } = makeAgent({ mockCreate });
    agent.setModel("s");
    await agent.generate({ messages: [{ role: "user", content: "hi" }], abortSignal: ctx.signal });
    expect(mockCreate.mock.calls[0][0].model).toBe("s");
  });

  it("modelId getter returns the active id and defaults to cfg.model", () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    const { agent } = makeAgent({ mockCreate });
    // Before any swap, should equal the config model
    expect(agent.modelId).toBe(testCfg.model);
    agent.setModel("s");
    expect(agent.modelId).toBe("s");
  });

  it("no setModel keeps cfg.model on the wire (regression)", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue({
      id: "msg_x", type: "message", role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn", stop_sequence: null, model: "test",
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const { agent, ctx } = makeAgent({ mockCreate });
    await agent.generate({ messages: [{ role: "user", content: "hi" }], abortSignal: ctx.signal });
    expect(mockCreate.mock.calls[0][0].model).toBe(testCfg.model);
  });
});

describe("PageAgent — onStep callback (074)", () => {
  it("calls opts.onStep once per recorded step", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(anthropicToolUseResponse("call-1", "snapshot_page"))
      .mockResolvedValueOnce(anthropicTextResponse("done"));

    const { agent, ctx, cm } = makeAgent({ mockCreate });
    const onStep = vi.fn();

    await agent.generate({
      messages: [{ role: "user", content: "hello" }],
      abortSignal: ctx.signal,
      onStep,
    });

    // 2 steps: tool step + text step → recordStep called twice, onStep called twice
    expect(cm.recordStep).toHaveBeenCalledTimes(2);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it("onStep omitted does not throw (optional regression)", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(anthropicTextResponse("ok"));
    const { agent, ctx } = makeAgent({ mockCreate });

    await expect(
      agent.generate({ messages: [{ role: "user", content: "hi" }], abortSignal: ctx.signal })
    ).resolves.toBeDefined();
  });
});

// 001: the executor's error verdict must survive the loop onto the wire.
describe("a failing tool result reaches the provider request as is_error (001)", () => {
  function flagTestCfg(): Partial<AgentConfig> {
    return {
      tools: () => [
        {
          name: "boom_tool",
          description: "throws",
          inputSchema: { type: "object", properties: {} },
          execute: () => Promise.reject(new Error("boom from tool")),
        },
        {
          name: "fine_tool",
          description: "succeeds",
          inputSchema: { type: "object", properties: {} },
          execute: () => Promise.resolve({ content: "all fine" }),
        },
      ],
    };
  }

  it("carries isError onto the part and is_error onto the wire for a throwing tool", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>()
      .mockResolvedValueOnce(anthropicToolUseResponse("call-1", "boom_tool"))
      .mockResolvedValueOnce(anthropicTextResponse("reported the failure"));
    const { agent, ctx } = makeAgent({ cfg: flagTestCfg(), mockCreate });

    const result = await agent.generate({
      messages: [{ role: "user", content: "go" }],
      abortSignal: ctx.signal,
    });
    expect(result.text).toBe("reported the failure");

    const toolMsg = result.response.messages.find((m) => m.role === "tool")!;
    const part = (toolMsg.content as Array<{ type: string; [k: string]: unknown }>).find(
      (p) => p.type === "tool-result",
    )!;
    expect(part.isError).toBe(true);
    expect(part.output).toBe("boom from tool");

    const wire = toAnthropicMessages(result.response.messages, []).messages;
    const userMsg = wire.find((m) => m.role === "user")!;
    const block = (userMsg.content as unknown as Array<{ type: string; [k: string]: unknown }>).find(
      (b) => b.type === "tool_result",
    )!;
    expect(block.is_error).toBe(true);
    expect(String(block.content)).toContain("boom from tool");
  });

  it("omits isError and is_error entirely for a passing tool", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>()
      .mockResolvedValueOnce(anthropicToolUseResponse("call-1", "fine_tool"))
      .mockResolvedValueOnce(anthropicTextResponse("done"));
    const { agent, ctx } = makeAgent({ cfg: flagTestCfg(), mockCreate });

    const result = await agent.generate({
      messages: [{ role: "user", content: "go" }],
      abortSignal: ctx.signal,
    });

    const toolMsg = result.response.messages.find((m) => m.role === "tool")!;
    const part = (toolMsg.content as Array<{ type: string; [k: string]: unknown }>).find(
      (p) => p.type === "tool-result",
    )!;
    expect(Object.prototype.hasOwnProperty.call(part, "isError")).toBe(false);
    expect(part.output).toBe("all fine");

    const wire = toAnthropicMessages(result.response.messages, []).messages;
    const userMsg = wire.find((m) => m.role === "user")!;
    const block = (userMsg.content as unknown as Array<{ type: string; [k: string]: unknown }>).find(
      (b) => b.type === "tool_result",
    )!;
    expect(Object.prototype.hasOwnProperty.call(block, "is_error")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tool-argument handling and audit propagation, driven by complete model
// results. The context manager, the agent loop and the tool dispatch are real;
// only the model is scripted.
// ---------------------------------------------------------------------------

type ToolUseResult = Extract<import("../types.js").ResponseBlock, { type: "tool_use" }>;

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
  argumentsIssue?: "empty" | "unparsable",
): ToolUseResult {
  return { type: "tool_use", id, name, input, ...(argumentsIssue ? { argumentsIssue } : {}) };
}

async function runScripted(
  toolStep: ToolUseResult[],
  tools: CustomToolDef[],
) {
  const mockModel = createMockProvider([
    { content: toolStep, finishReason: "tool-calls" },
    { text: "done", finishReason: "stop" },
  ]);
  const ctx: ToolContext = {
    app: { appName: "Test" },
    signal: new AbortController().signal,
  };
  const cm = new ContextManager(testCfg.context);
  cm.appendUser({ role: "user", content: "test" });
  const agent = createPageAgent({ ...testCfg, tools: () => tools }, ctx, cm);
  agent._model = mockModel;
  const result = await agent.generate({
    messages: cm.compose(),
    abortSignal: new AbortController().signal,
  });
  return { cm, result };
}

function toolResultOf(cm: ContextManager) {
  const toolEntry = cm.journal.find((e) => e.msg.role === "tool");
  expect(toolEntry).toBeDefined();
  const part = (toolEntry!.msg.content as Array<{ type: string; isError?: boolean; output: string }>).find(
    (p) => p.type === "tool-result",
  );
  expect(part).toBeDefined();
  return part!;
}

describe("PageAgent — complete tool-call results", () => {
  it("one reply with two tool calls runs both tools with their own inputs", async () => {
    const seen: Array<{ tool: string; input: unknown }> = [];
    const mk = (name: string): CustomToolDef => ({
      name,
      description: name,
      inputSchema: z.object({ path: z.string() }),
      execute: (input: unknown) => {
        seen.push({ tool: name, input });
        return Promise.resolve({ content: `${name} ok` });
      },
    });
    const { cm } = await runScripted(
      [toolUse("call_a", "read_a", { path: "a" }), toolUse("call_b", "read_b", { path: "b" })],
      [mk("read_a"), mk("read_b")],
    );
    expect(seen).toEqual([
      { tool: "read_a", input: { path: "a" } },
      { tool: "read_b", input: { path: "b" } },
    ]);
    const toolEntry = cm.journal.find((e) => e.msg.role === "tool");
    const results = (toolEntry!.msg.content as Array<{ type: string; toolCallId: string }>).filter(
      (p) => p.type === "tool-result",
    );
    expect(results.map((r) => r.toolCallId)).toEqual(["call_a", "call_b"]);
  });
});

describe("PageAgent — argumentsIssue is not journaled to the assistant message", () => {
  it("argumentsIssue never reaches the assistant message ContentPart", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { cm } = await runScripted([toolUse("call_bad", "snapshot_page", {}, "unparsable")], []);
      const assistantEntry = cm.journal.find((e) => e.msg.role === "assistant");
      expect(assistantEntry).toBeDefined();
      const toolCallPart = (assistantEntry!.msg.content as ContentPart[]).find(
        (p): p is Extract<ContentPart, { type: "tool-call" }> => p.type === "tool-call",
      );
      expect(toolCallPart).toBeDefined();
      // Only these four keys are expected — no argumentsIssue.
      expect(Object.keys(toolCallPart!)).toEqual(["type", "toolCallId", "toolName", "input"]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("an unparsable tool payload produces the parse-failure result (003)", async () => {
    const pingExecutor = vi.fn().mockResolvedValue({ content: "pong" });
    const pingTool: CustomToolDef = {
      name: "ping",
      description: "ping tool",
      inputSchema: z.object({ a: z.string() }).strict(),
      execute: pingExecutor,
    };
    const { cm } = await runScripted([toolUse("call_bad", "ping", {}, "unparsable")], [pingTool]);
    expect(pingExecutor).not.toHaveBeenCalled();
    const part = toolResultOf(cm);
    expect(part.isError).toBe(true);
    expect(part.output).toContain("Could not read the arguments for ping");
    expect(part.output).not.toContain("Invalid input for");
    expect(part.output).not.toContain("required");
  });

  it("an empty tool payload still runs an all-optional tool (003)", async () => {
    const pingExecutor = vi.fn().mockResolvedValue({ content: "pong" });
    const pingTool: CustomToolDef = {
      name: "ping",
      description: "ping tool",
      inputSchema: z.object({ a: z.string().optional() }),
      execute: pingExecutor,
    };
    const { cm } = await runScripted([toolUse("call_empty", "ping", {}, "empty")], [pingTool]);
    expect(pingExecutor).toHaveBeenCalledTimes(1);
    expect(pingExecutor.mock.calls[0][0]).toEqual({});
    const part = toolResultOf(cm);
    expect(part.output).toBe("pong");
    expect(part.isError).toBeUndefined();
  });

  it("an empty tool payload for a required-argument tool reports the missing property (003)", async () => {
    const pingExecutor = vi.fn().mockResolvedValue({ content: "pong" });
    const pingTool: CustomToolDef = {
      name: "ping",
      description: "ping tool",
      inputSchema: z.object({ a: z.string() }).strict(),
      execute: pingExecutor,
    };
    const { cm } = await runScripted([toolUse("call_empty", "ping", {}, "empty")], [pingTool]);
    expect(pingExecutor).not.toHaveBeenCalled();
    const part = toolResultOf(cm);
    expect(part.isError).toBe(true);
    expect(part.output).toContain("a: Required");
    expect(part.output).not.toContain("Could not read the arguments");
  });

  describe("AuditEntry.failed propagation", () => {
    it("marks audit as failed for unparsable arguments", async () => {
      const echoTool: CustomToolDef = {
        name: "echo",
        description: "echo tool",
        inputSchema: z.object({ text: z.string() }),
        execute: vi.fn().mockResolvedValue({ content: "ok" }),
      };
      const { cm } = await runScripted([toolUse("call_bad", "echo", {}, "unparsable")], [echoTool]);
      expect(cm.audit).toHaveLength(1);
      expect(cm.audit[0].failed).toBe(true);
      expect(cm.audit[0].outcomeSummary).toContain("Could not read the arguments for echo");
    });

    it("marks audit as failed for schema validation errors", async () => {
      const echoTool: CustomToolDef = {
        name: "echo",
        description: "echo tool",
        inputSchema: z.object({ text: z.string() }),
        execute: vi.fn().mockResolvedValue({ content: "ok" }),
      };
      const { cm } = await runScripted([toolUse("call_inv", "echo", {}, "empty")], [echoTool]);
      expect(cm.audit[0].failed).toBe(true);
    });

    it("marks audit as failed for throwing tools", async () => {
      const boomTool: CustomToolDef = {
        name: "boom",
        description: "exploding tool",
        inputSchema: z.object({}),
        execute: vi.fn().mockRejectedValue(new Error("disk write error")),
      };
      const { cm } = await runScripted([toolUse("call_throw", "boom", {})], [boomTool]);
      expect(cm.audit[0].failed).toBe(true);
      expect(cm.audit[0].outcomeSummary).toContain("disk write error");
    });

    it("marks audit as failed for unknown tools", async () => {
      const { cm } = await runScripted([toolUse("call_unk", "ghost_tool", {})], []);
      expect(cm.audit[0].failed).toBe(true);
      expect(cm.audit[0].outcomeSummary).toContain("Unknown tool: ghost_tool");
      expect(cm.audit[0].unknownTool).toBe(true);
    });

    it("marks audit as failed=false for successful tool calls", async () => {
      const execute = vi.fn().mockResolvedValue({ content: "all good" });
      const okTool: CustomToolDef = {
        name: "ok_tool",
        description: "working tool",
        inputSchema: z.object({}),
        execute,
      };
      const { cm } = await runScripted([toolUse("call_ok", "ok_tool", {})], [okTool]);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(cm.audit[0].failed).toBe(false);
    });
  });
});
