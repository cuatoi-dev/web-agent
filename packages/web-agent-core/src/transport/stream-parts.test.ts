import { describe, it, expect, vi } from "vitest";
import { reassembleStream, safeJsonParse, StreamingToolCallTracker } from "./stream-parts.js";
import type { StreamPart } from "./stream-parts.js";

// Not async — no await in the body, and reassembleStream consumes it via
// for-await-of, which falls back to the sync iterator protocol transparently.
function makeStream(parts: StreamPart[]): Promise<AsyncIterable<StreamPart>> {
  return Promise.resolve((function* () { yield* parts; })() as unknown as AsyncIterable<StreamPart>);
}

// ---------------------------------------------------------------------------
// reassembleStream
// ---------------------------------------------------------------------------
describe("reassembleStream", () => {
  it("text-only stream → single TextBlock with concatenated deltas", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "a" },
      { type: "text-delta", id: "t1", delta: "bc" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 3 } },
    ]));
    expect(result.content).toEqual([{ type: "text", text: "abc" }]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
    expect(result.warnings).toEqual([]);
  });

  it("tool-call stream → ToolUseBlock with parsed input", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "tool-input-start", id: "call_1", toolName: "search" },
      { type: "tool-input-delta", id: "call_1", delta: '{"q"' },
      { type: "tool-input-delta", id: "call_1", delta: ':"test"}' },
      { type: "tool-input-end", id: "call_1" },
      { type: "tool-call", toolCallId: "call_1", toolName: "search", input: '{"q":"test"}' },
      { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 10, outputTokens: 8 } },
    ]));
    expect(result.content).toEqual([
      { type: "tool_use", id: "call_1", name: "search", input: { q: "test" } },
    ]);
    expect(result.finishReason).toBe("tool-calls");
  });

  it("text before tool-call → emission order preserved", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Hello" },
      { type: "text-end", id: "t1" },
      { type: "tool-input-start", id: "call_1", toolName: "fn" },
      { type: "tool-call", toolCallId: "call_1", toolName: "fn", input: "{}" },
      { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 5, outputTokens: 5 } },
    ]));
    expect(result.content[0]).toEqual({ type: "text", text: "Hello" });
    expect(result.content[1]).toMatchObject({ type: "tool_use", id: "call_1" });
  });

  it("reasoning deltas → ThinkingBlock with accumulated text and preserved signature", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "r1", signature: "sig_abc" },
      { type: "reasoning-delta", id: "r1", delta: "Ponder" },
      { type: "reasoning-delta", id: "r1", delta: "ing" },
      { type: "reasoning-end", id: "r1" },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 3, outputTokens: 2 } },
    ]));
    expect(result.content).toEqual([
      { type: "thinking", thinking: "Pondering", signature: "sig_abc" },
    ]);
  });

  it("reasoning-start without signature → signature defaults to empty string", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "Thinking" },
      { type: "reasoning-end", id: "r1" },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 2, outputTokens: 2 } },
    ]));
    expect(result.content[0]).toMatchObject({ type: "thinking", thinking: "Thinking", signature: "" });
  });

  it("error part → throws the carried error", async () => {
    const err = new Error("upstream failure");
    await expect(reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "error", error: err },
    ]))).rejects.toBe(err);
  });

  it("malformed tool-call input JSON → input:{} with argumentsIssue (no throw)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await reassembleStream(await makeStream([
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "c1", toolName: "f" },
        { type: "tool-call", toolCallId: "c1", toolName: "f", input: "{invalid" },
        { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1 } },
      ]));
      expect(result.content).toEqual([{ type: "tool_use", id: "c1", name: "f", input: {}, argumentsIssue: "unparsable" }]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("names the tool when reassembling a stream with an unparsable tool-call payload", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await reassembleStream(await makeStream([
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "call_1", toolName: "calc" },
        { type: "tool-call", toolCallId: "call_1", toolName: "calc", input: "{bad" },
        { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1 } },
      ]));
      expect(result.content).toEqual([{ type: "tool_use", id: "call_1", name: "calc", input: {}, argumentsIssue: "unparsable" }]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("calc");
      expect(msg).toContain("call_1");
      expect(msg).toContain("{bad");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a healthy tool block carries no argumentsIssue key", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "tool-input-start", id: "call_1", toolName: "search" },
      { type: "tool-call", toolCallId: "call_1", toolName: "search", input: '{"q":"test"}' },
      { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 10, outputTokens: 8 } },
    ]));
    expect(result.content).toHaveLength(1);
    expect("argumentsIssue" in result.content[0]).toBe(false);
  });

  it("drops a tool block that never received tool-call", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await reassembleStream(await makeStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "hi" },
        { type: "text-end", id: "t1" },
        { type: "tool-input-start", id: "c1", toolName: "search" },
        { type: "tool-input-delta", id: "c1", delta: '{"q"' },
        { type: "finish", finishReason: "length", usage: { inputTokens: 1, outputTokens: 1 } },
      ]));
      expect(result.content).toEqual([{ type: "text", text: "hi" }]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toContain("c1");
      expect(msg).toContain("search");
      expect(msg).toContain("Dropping incomplete tool block");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a stream whose only block is an incomplete tool call returns no content", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await reassembleStream(await makeStream([
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "c1", toolName: "search" },
        { type: "finish", finishReason: "length", usage: { inputTokens: 1, outputTokens: 1 } },
      ]));
      expect(result.content).toEqual([]);
      expect(result.finishReason).toBe("length");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a tool-call with no preceding tool-input-start is still emitted", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolCallId: "c9", toolName: "fn", input: '{"x":1}' },
      { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1 } },
    ]));
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "tool_use", id: "c9", name: "fn", input: { x: 1 } });
    expect("argumentsIssue" in result.content[0]).toBe(false);
  });

  it("stream-restart discards every block from the abandoned attempt", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "block_0" },
      { type: "text-delta", id: "block_0", delta: "dead" },
      { type: "text-end", id: "block_0" },
      { type: "tool-input-start", id: "old", toolName: "stale" },
      { type: "stream-restart", attempt: 1 },
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "block_0" },
      { type: "text-delta", id: "block_0", delta: "alive" },
      { type: "text-end", id: "block_0" },
      { type: "tool-input-start", id: "new", toolName: "fn" },
      { type: "tool-call", toolCallId: "new", toolName: "fn", input: '{"a":1}' },
      { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1 } },
    ]));
    expect(result.content).toEqual([
      { type: "text", text: "alive" },
      { type: "tool_use", id: "new", name: "fn", input: { a: 1 } },
    ]);
    expect(result.content.find((b) => "id" in b && (b as { id: string }).id === "old")).toBeUndefined();
  });

  it("stream-restart discards a block that reused the same positional id", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "block_0" },
      { type: "text-delta", id: "block_0", delta: "dead-text" },
      { type: "tool-input-start", id: "same-id", toolName: "fn" },
      { type: "stream-restart", attempt: 1 },
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "block_0" },
      { type: "text-delta", id: "block_0", delta: "alive-text" },
      { type: "tool-input-start", id: "same-id", toolName: "fn" },
      { type: "tool-call", toolCallId: "same-id", toolName: "fn", input: '{"b":2}' },
      { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1 } },
    ]));
    const text = result.content.find(b => b.type === "text");
    const tool = result.content.find(b => b.type === "tool_use") as { type: "tool_use"; input: Record<string, unknown> } | undefined;
    expect((text as { text: string } | undefined)?.text).toBe("alive-text");
    expect(tool?.input).toEqual({ b: 2 });
  });

  it("stream-restart discards reasoning blocks and their signatures", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "block_0", signature: "dead_sig" },
      { type: "reasoning-delta", id: "block_0", delta: "no" },
      { type: "stream-restart", attempt: 1 },
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "block_0", signature: "live_sig" },
      { type: "reasoning-delta", id: "block_0", delta: "yes" },
      { type: "reasoning-end", id: "block_0" },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
    ]));
    expect(result.content).toHaveLength(1);
    const block = result.content[0] as { type: "thinking"; thinking: string; signature: string };
    expect(block.thinking).toBe("yes");
    expect(block.signature).toBe("live_sig");
  });

  it("a dropped block warns exactly once, not once per reset", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await reassembleStream(await makeStream([
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "c1", toolName: "fn" },
        { type: "stream-restart", attempt: 1 },
        { type: "stream-start", warnings: [] },
        { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
      ]));
      // c1 was in the dead attempt and got discarded by resetBlocks() — no block
      // to warn about at the end. The surviving attempt has no incomplete block.
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warnings from stream-start are captured in result", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [{ type: "unsupported", feature: "topK" }] },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
    ]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatchObject({ feature: "topK" });
  });

  it("providerMetadata from finish is included in result", async () => {
    const result = await reassembleStream(await makeStream([
      { type: "stream-start", warnings: [] },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 }, providerMetadata: { anthropic: { cacheKey: "x" } } },
    ]));
    expect(result.providerMetadata).toEqual({ anthropic: { cacheKey: "x" } });
  });
});

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------
describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ input: { a: 1 } });
  });

  it("does not warn for valid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(safeJsonParse('{"a":1}')).toEqual({ input: { a: 1 } });
      expect(safeJsonParse("{}")).toEqual({ input: {} });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("issue is absent for valid JSON", () => {
    const result = safeJsonParse('{"a":1}');
    expect(result.issue).toBeUndefined();
  });

  it("returns { input: {}, issue: \"unparsable\" } for invalid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = safeJsonParse("{invalid", { toolName: "calc", toolCallId: "call_1" });
      expect(result).toEqual({ input: {}, issue: "unparsable" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("calc");
      expect(msg).toContain("call_1");
      expect(msg).toContain("{invalid");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns { input: {}, issue: \"empty\" } for empty string", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = safeJsonParse("", { toolName: "calc", toolCallId: "call_1" });
      expect(result).toEqual({ input: {}, issue: "empty" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("no argument JSON");
      expect(msg).toContain("calc");
      expect(msg).toContain("call_1");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns naming unknown when context is not provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = safeJsonParse("{invalid");
      expect(result).toEqual({ input: {}, issue: "unparsable" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain("unknown");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// StreamingToolCallTracker
// ---------------------------------------------------------------------------
describe("StreamingToolCallTracker", () => {
  function collect(fn: (tracker: StreamingToolCallTracker) => void): StreamPart[] {
    const parts: StreamPart[] = [];
    const tracker = new StreamingToolCallTracker(p => parts.push(p));
    fn(tracker);
    return parts;
  }

  it("single-chunk complete tool call emits start/delta/end/tool-call", () => {
    const parts = collect(t => {
      t.processDelta({ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } });
    });
    expect(parts).toMatchObject([
      { type: "tool-input-start", id: "call_1", toolName: "search" },
      { type: "tool-input-delta", id: "call_1", delta: '{"q":"test"}' },
      { type: "tool-input-end", id: "call_1" },
      { type: "tool-call", toolCallId: "call_1", toolName: "search", input: '{"q":"test"}' },
    ]);
  });

  it("multi-chunk tool call accumulates args across deltas", () => {
    const parts = collect(t => {
      t.processDelta({ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q"' } });
      t.processDelta({ index: 0, function: { arguments: ':"test"}' } });
    });
    expect(parts).toMatchObject([
      { type: "tool-input-start", id: "call_1", toolName: "search" },
      { type: "tool-input-delta", id: "call_1", delta: '{"q"' },
      { type: "tool-input-delta", id: "call_1", delta: ':"test"}' },
      { type: "tool-input-end", id: "call_1" },
      { type: "tool-call", toolCallId: "call_1", toolName: "search", input: '{"q":"test"}' },
    ]);
  });

  it("flush() finalizes unfinished (non-parseable) tool call", () => {
    const parts = collect(t => {
      t.processDelta({ index: 0, id: "call_1", type: "function", function: { name: "f", arguments: '{"a"' } });
      t.processDelta({ index: 0, function: { arguments: ':1' } });
      // args = '{"a":1' — not valid JSON yet
      t.flush();
    });
    // start + 2 deltas + end + tool-call
    expect(parts.filter(p => p.type === "tool-input-start")).toHaveLength(1);
    expect(parts.filter(p => p.type === "tool-input-delta")).toHaveLength(2);
    expect(parts.filter(p => p.type === "tool-input-end")).toHaveLength(1);
    expect(parts.filter(p => p.type === "tool-call")).toHaveLength(1);
    const toolCall = parts.find((p): p is Extract<StreamPart, { type: "tool-call" }> => p.type === "tool-call");
    expect(toolCall!.input).toBe('{"a":1');
  });

  it("flush() is idempotent — does not double-emit already-finished tool calls", () => {
    const parts = collect(t => {
      t.processDelta({ index: 0, id: "c1", type: "function", function: { name: "f", arguments: "{}" } });
      // "{}" is parseable → already finished
      t.flush();
    });
    expect(parts.filter(p => p.type === "tool-call")).toHaveLength(1);
  });

  it("two parallel tool calls sharing index: 0 do not merge arguments (LiteLLM #21331)", () => {
    const parts = collect(t => {
      // First call opens at index 0 with its own id.
      t.processDelta({ index: 0, id: "call_1", type: "function", function: { name: "calc", arguments: "" } });
      // A gateway reusing the index streams the second call also under
      // index: 0, but with its own id — the fix must route by id.
      t.processDelta({ index: 0, id: "call_2", type: "function", function: { name: "calc", arguments: "" } });
      t.processDelta({ index: 0, id: "call_1", function: { arguments: '{"expression":"52.5/124.96"}' } });
      t.processDelta({ index: 0, id: "call_2", function: { arguments: '{"expression":"11.36/17.48"}' } });
    });
    const toolCalls = parts.filter((p): p is Extract<StreamPart, { type: "tool-call" }> => p.type === "tool-call");
    expect(toolCalls).toHaveLength(2);
    const call1 = toolCalls.find(c => c.toolCallId === "call_1")!;
    const call2 = toolCalls.find(c => c.toolCallId === "call_2")!;
    expect(call1.input).toBe('{"expression":"52.5/124.96"}');
    expect(call2.input).toBe('{"expression":"11.36/17.48"}');
  });

  it("a delta that omits index and id but arrives right after a single open call is dropped, not merged", () => {
    // No `id`, no `index` on the continuation delta: nothing to route it to,
    // so it must be ignored rather than guessed onto whichever call happens
    // to be open — a wrong guess is exactly the concatenation bug.
    const parts = collect(t => {
      t.processDelta({ index: 0, id: "call_1", type: "function", function: { name: "calc", arguments: "" } });
      t.processDelta({ function: { arguments: '{"expression":"1"}' } });
    });
    expect(parts.filter(p => p.type === "tool-call")).toHaveLength(0);
  });

  it("a later delta identified only by index (no id) routes to the call that index was assigned to", () => {
    const parts = collect(t => {
      t.processDelta({ index: 0, id: "call_1", type: "function", function: { name: "calc", arguments: '{"a"' } });
      // OpenAI's own wire format omits `id` on continuation chunks.
      t.processDelta({ index: 0, function: { arguments: ':1}' } });
    });
    const toolCall = parts.find((p): p is Extract<StreamPart, { type: "tool-call" }> => p.type === "tool-call");
    expect(toolCall!.toolCallId).toBe("call_1");
    expect(toolCall!.input).toBe('{"a":1}');
  });
});
