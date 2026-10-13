import { describe, it, expect, beforeEach, vi } from "vitest";
import { runTurn } from "./run-turn.js";
import { ContextManager } from "./context-manager.js";
import { createPageAgent } from "./agent.js";
import { ToolContext, CustomToolDef } from "../tools/build-tools.js";
import { AgentConfig } from "../config.js";
import { z } from "zod";
import type { Message, MessageCreateParams } from "../transport/wire.types.js";
import type { ContentPart, ModelMessage } from "../types.js";
import type { StreamPart } from "../transport/stream-parts.js";

/** `_client.messages.create`'s real declared type (see anthropic-provider.ts).
 * Test mocks are typed narrowly against the real SDK's MessageCreateParams,
 * which the wider Record<string, unknown> production signature doesn't
 * accept without a bridge — this is a type-only cast, not a behavior change. */
type RealCreate = (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => unknown;

// 007: core no longer ships snapshot_page/click — this loop-machinery test
// stubs two tools NAMED "snapshot_page"/"click" (via cfg.tools) purely so
// ContextManager's classifyParts() (loop/context-helpers.ts) tags their
// tool-result journal entries as "tool_result_snapshot"/"tool_result_action"
// the same way it does for the real DOM package's tools of the same name —
// the loop itself doesn't care what a tool does.
const stubDomTools: CustomToolDef[] = [
  {
    name: "snapshot_page",
    description: "stub",
    inputSchema: z.object({}).strict(),
    execute: () => Promise.resolve({ content: "generation: 1\n[1] button \"Add to cart\"" }),
  },
  {
    name: "click",
    description: "stub",
    inputSchema: z.object({ ref: z.string() }).strict(),
    execute: () => Promise.resolve({ content: "Clicked." }),
  },
];

const TEST_CFG: AgentConfig = {
  baseURL: "http://localhost:8080/api/openai/v1",
  model: "test-model",
  maxIterations: 3,
  turnTimeoutMs: 5000,
  queryResultMaxChars: 500,
  wideSourceFieldThreshold: 40,
  persist: false,
  tools: () => stubDomTools,
  context: {
    kTurnsVerbatim: 1,
    contextLength: 3000,
    autoCompactPercent: 1000 / 3000,
    charsPerToken: 4,
    jsonOverhead: 1.15,
    compactionMaxTokens: 100,
  },
  endpointType: "anthropic",
  thinking: { enabled: false },
  generation: {}
};

function mkTextResp(text: string): Message {
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

function mkToolResp(id: string, name: string, input: Record<string, unknown> = {}): Message {
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

describe("runTurn Integration", () => {
  let cm: ContextManager;
  let ctx: ToolContext;

  beforeEach(() => {
    cm = new ContextManager(TEST_CFG.context);

    ctx = {
      app: {
        appName: "Test Store",
        appDescription: "cat store demo"
      },
      signal: new AbortController().signal
    };
  });

  it("completes a multi-step loop successfully: tool_use x2 then text", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>();
    mockCreate
      .mockResolvedValueOnce(mkToolResp("call-1", "snapshot_page", {}))
      .mockResolvedValueOnce(mkToolResp("call-2", "click", { ref: "e1" }))
      .mockResolvedValueOnce(mkTextResp("Add complete. Cart total is $10."));

    const agent = createPageAgent(TEST_CFG, ctx, cm);
    agent._client = { messages: { create: mockCreate as unknown as RealCreate } };

    const controller = new AbortController();
    const result = await runTurn(agent, cm, ctx, "Add item", controller.signal, TEST_CFG);

    expect(result.stopReason).toBe("end_turn");
    expect(result.assistantText).toBe("Add complete. Cart total is $10.");

    const journal = cm.journal;
    expect(journal.length).toBeGreaterThan(4);
    expect(journal.some(j => j.meta.kinds.includes("tool_result_snapshot"))).toBe(true);
    expect(journal.some(j => j.meta.kinds.includes("tool_result_action"))).toBe(true);
  });

  it("limits step count and returns max_iterations when limit is breached", async () => {
    const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(mkToolResp("inf-call", "snapshot_page", {}));

    const agent = createPageAgent({ ...TEST_CFG, maxIterations: 2 }, ctx, cm);
    agent._client = { messages: { create: mockCreate as unknown as RealCreate } };

    const controller = new AbortController();
    const result = await runTurn(agent, cm, ctx, "Loop infinitely", controller.signal, { ...TEST_CFG, maxIterations: 2 });

    expect(result.stopReason).toBe("max_iterations");
  });

  it("handles abort clean and rolls back/stops with consistent journal", async () => {
    const mockCreate = vi.fn<[MessageCreateParams, { signal?: AbortSignal }], Promise<Message>>().mockImplementation((_body, opts) => {
      if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Promise((_res, rej) => {
        opts.signal?.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")));
        setTimeout(() => rej(new DOMException("aborted", "AbortError")), 200);
      });
    });

    const agent = createPageAgent(TEST_CFG, ctx, cm);
    agent._client = { messages: { create: mockCreate as unknown as RealCreate } };

    const controller = new AbortController();

    setTimeout(() => {
      controller.abort();
    }, 50);

    const result = await runTurn(agent, cm, ctx, "Run and abort", controller.signal, TEST_CFG);
    expect(result.stopReason).toBe("aborted");
    expect(result.error?.kind).toBe("aborted");

    expect(() => cm.validateWorkingContext(cm.compose())).not.toThrow();
  });

  describe("multimodal input", () => {
    it("accepts UserMessageInput and journals an array-content user message", async () => {
      const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(mkTextResp("I see an image."));

      const agent = createPageAgent(TEST_CFG, ctx, cm);
      agent._client = { messages: { create: mockCreate as unknown as RealCreate } };

      const result = await runTurn(
        agent, cm, ctx,
        { text: "describe this", images: [{ dataUrl: "data:image/png;base64,abc", mediaType: "image/png" }] },
        new AbortController().signal,
        TEST_CFG
      );

      expect(result.stopReason).toBe("end_turn");
      const userEntry = cm.journal.find(e => e.msg.role === "user");
      expect(userEntry).toBeDefined();
      expect(Array.isArray(userEntry!.msg.content)).toBe(true);
      const parts = userEntry!.msg.content as ContentPart[];
      expect(parts[0]).toEqual({ type: "text", text: "describe this" });
      expect(parts[1].type).toBe("image");
      expect((parts[1] as { image: string }).image).toBe("data:image/png;base64,abc");
    });

    it("accepts a plain string and journals a string-content user message (string convenience)", async () => {
      const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(mkTextResp("Hello back"));

      const agent = createPageAgent(TEST_CFG, ctx, cm);
      agent._client = { messages: { create: mockCreate as unknown as RealCreate } };

      const result = await runTurn(
        agent, cm, ctx,
        "hello",
        new AbortController().signal,
        TEST_CFG
      );

      expect(result.stopReason).toBe("end_turn");
      const userEntry = cm.journal.find(e => e.msg.role === "user");
      expect(userEntry).toBeDefined();
      expect(userEntry!.msg.content).toBe("hello");
    });

    it("accepts images and passes them through to the agent", async () => {
      const mockCreate = vi.fn<[MessageCreateParams], Promise<Message>>().mockResolvedValue(mkTextResp("An image was provided."));

      const agent = createPageAgent(TEST_CFG, ctx, cm);
      agent._client = { messages: { create: mockCreate as unknown as RealCreate } };

      const result = await runTurn(
        agent, cm, ctx,
        { text: "what is this", images: [{ dataUrl: "data:image/jpeg;base64,xyz", mediaType: "image/jpeg" }] },
        new AbortController().signal,
        TEST_CFG
      );

      expect(result.stopReason).toBe("end_turn");
      expect(result.assistantText).toBe("An image was provided.");
    });

    it("forwards onStreamPart to agent.generate", async () => {
      const stub = {
        generate: vi.fn<
          [{ messages: ModelMessage[]; abortSignal: AbortSignal; onStep?: () => void; onStreamPart?: (part: StreamPart) => void }],
          Promise<{ text: string; response: { messages: ModelMessage[] }; steps: unknown[] }>
        >(() => Promise.resolve({
          text: "ok",
          response: { messages: [] },
          steps: [],
        })),
      };
      const spy = vi.fn();
      await runTurn(
        stub as unknown as ReturnType<typeof createPageAgent>,
        cm,
        ctx,
        "hi",
        new AbortController().signal,
        TEST_CFG,
        undefined,
        spy,
      );

      expect(stub.generate).toHaveBeenCalledTimes(1);
      const passedCallback = stub.generate.mock.calls[0][0].onStreamPart;
      expect(typeof passedCallback).toBe("function");
      passedCallback!({ type: "text-delta", id: "t1", delta: "x" });
      expect(spy).toHaveBeenCalledWith({ type: "text-delta", id: "t1", delta: "x" });
    });
  });

  // 007: the "block"-tier adversarial-injection defense (SEC5 §12) moved with
  // the DOM tools — it's now covered at the unit level by
  // packages/web-agent-dom/src/adapters/dom-adapter.test.ts ("block returns
  // terminal message and does NOT click") and end to end by cat-store's
  // fenced-ui.mock.spec.ts. This file only owns loop machinery now, which has
  // nothing to do with permission enforcement.
});
