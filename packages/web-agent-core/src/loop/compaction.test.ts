import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ContextManager } from "./context-manager.js";
import { createPageAgent } from "./agent.js";
import {
  runCompaction,
  summariseInCachedConversation,
  hasUnansweredToolUse,
  CompactionError,
  SUMMARY_INSTRUCTION,
} from "./compaction.js";
import type { SummarizeFn, PageAgent, CompactionObserver } from "./compaction.js";
import type { ContextConfig, AgentConfig } from "../config.js";
import type { PostCompactPayload } from "../hooks/types.js";
import type { ModelMessage } from "../types.js";
import { setMockScript } from "../transport/registry.js";

const TEST_CFG: ContextConfig = {
  kTurnsVerbatim: 1, // small verbatim window to allow folding
  contextLength: 600,
  autoCompactPercent: 200 / 600,
  charsPerToken: 4,
  jsonOverhead: 1.15,
  compactionMaxTokens: 100,
};

const lastTombstone = (cm: ContextManager) => [...cm.journal].reverse().find((e) => e.meta.tombstone);

const TEST_AGENT_CFG: AgentConfig = {
  baseURL: "http://localhost:8080/api/anthropic",
  model: "test-model",
  maxIterations: 12,
  turnTimeoutMs: 120_000,
  queryResultMaxChars: 6_000,
  wideSourceFieldThreshold: 40,
  persist: false,
  context: TEST_CFG,
  endpointType: "mock",
  thinking: { enabled: false },
  generation: {},
};

/**
 * Build a real `PageAgent` for a given config — the same seam
 * `summariseInCachedConversation` reads `buildCallOptions`/`callModel` from.
 * Tests that inject their own `summarize` mock never touch it; tests that
 * exercise the real `summariseInCachedConversation` need one whose `cfg`
 * matches (model, endpointType) so the mock provider it resolves is the one
 * `setMockScript` configures.
 */
function makeAgent(cfg: AgentConfig): PageAgent {
  return createPageAgent(cfg, { app: {}, signal: new AbortController().signal }, new ContextManager(cfg.context));
}

// Shared agent for tests that always inject their own `summarize` — its
// identity is never read in those cases.
const AGENT = makeAgent(TEST_AGENT_CFG);

describe("Compaction Orchestrator", () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager(TEST_CFG);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false and makes no changes if there are no turns to compact", async () => {
    const mockSummarize = vi.fn<Parameters<SummarizeFn>, ReturnType<SummarizeFn>>().mockResolvedValue("SUMMARY");

    // Turns verbatim window is 1, so if we have only 1 turn, it's inside verbatim window, so nothing to compact.
    cm.appendUser({ role: "user", content: "Only turn" });
    cm.recordStep([{ role: "assistant", content: "Reply" }]);
    cm.commitTurn();

    const compactResult = await runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: mockSummarize });
    expect(compactResult.outcome).toBe("skipped");
    expect(mockSummarize).not.toHaveBeenCalled();
    expect(cm.journal.some((e) => e.meta.tombstone)).toBe(false);
  });

  it("appends one tombstone per successful run", async () => {
    // Turn 1
    cm.appendUser({ role: "user", content: "Turn 1" });
    cm.recordStep([{ role: "assistant", content: "Reply 1" }]);
    cm.commitTurn();

    // Turn 2
    cm.appendUser({ role: "user", content: "Turn 2" });
    cm.recordStep([{ role: "assistant", content: "Reply 2" }]);
    cm.commitTurn();

    const mockSummarize = vi.fn<Parameters<SummarizeFn>, ReturnType<SummarizeFn>>().mockResolvedValue("SUMMARY 1");
    const result1 = await runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: mockSummarize });

    expect(result1.outcome).toBe("compacted");
    expect(cm.journal.filter((e) => e.meta.tombstone).length).toBe(1);
    expect(lastTombstone(cm)?.meta.tombstone?.summary).toBe("SUMMARY 1");

    // Add Turn 3 and Turn 4 (so Turn 3 is outside verbatim window)
    cm.appendUser({ role: "user", content: "Turn 3" });
    cm.recordStep([{ role: "assistant", content: "Reply 3" }]);
    cm.commitTurn();
    cm.appendUser({ role: "user", content: "Turn 4" });
    cm.recordStep([{ role: "assistant", content: "Reply 4" }]);
    cm.commitTurn();

    mockSummarize.mockResolvedValue("SUMMARY 2");
    const result2 = await runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: mockSummarize });

    expect(result2.outcome).toBe("compacted");
    expect(cm.journal.filter((e) => e.meta.tombstone).map((e) => e.meta.tombstone?.summary)).toEqual(["SUMMARY 1", "SUMMARY 2"]);
    expect(mockSummarize).toHaveBeenCalledTimes(2);
    // Each call is handed the live ContextManager (cm.compose() is read inside
    // the summarizer, not serialized into a prompt string — task 001).
    expect(mockSummarize.mock.calls[1][0]).toBe(cm);
    // ...and the same page agent, so it can build the identical tools/system
    // prefix a live turn would send (the fix — task 001 round 2).
    expect(mockSummarize.mock.calls[1][1]).toBe(AGENT);
  });

  it("a failing summarizer rejects runCompaction and leaves the existing tombstone untouched", async () => {
    cm.appendUser({ role: "user", content: "Turn 1" });
    cm.recordStep([{ role: "assistant", content: "Reply 1" }]);
    cm.commitTurn();
    cm.appendUser({ role: "user", content: "Turn 2" });
    cm.recordStep([{ role: "assistant", content: "Reply 2" }]);
    cm.commitTurn();

    // Setup initial tombstone
    cm.appendTombstone("INITIAL");

    // Add Turn 3 and Turn 4 so there are eligible turns to compact
    cm.appendUser({ role: "user", content: "Turn 3" });
    cm.recordStep([{ role: "assistant", content: "Reply 3" }]);
    cm.commitTurn();
    cm.appendUser({ role: "user", content: "Turn 4" });
    cm.recordStep([{ role: "assistant", content: "Reply 4" }]);
    cm.commitTurn();

    // Reject summarize call
    const failingSummarize = vi.fn().mockRejectedValue(new Error("LLM failure"));
    await expect(
      runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: failingSummarize }),
    ).rejects.toThrow("LLM failure");
    expect(cm.journal.filter((e) => e.meta.tombstone).length).toBe(1);
    expect(lastTombstone(cm)?.meta.tombstone?.summary).toBe("INITIAL");

    // Timeout summarize call
    const slowSummarize = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("SLOOOW"), 20000)));
    const promise = runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: slowSummarize, timeoutMs: 5000 });
    promise.catch(() => {});

    // Fast forward past timeout
    vi.advanceTimersByTime(6000);
    await expect(promise).rejects.toThrow("Compaction timeout");
    expect(cm.journal.filter((e) => e.meta.tombstone).length).toBe(1);
    expect(lastTombstone(cm)?.meta.tombstone?.summary).toBe("INITIAL");
  });

  it("preserves valid working context even if the summary is cleared and recomposed (C6)", async () => {
    // 3 turns
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const mockSummarize = vi.fn<Parameters<SummarizeFn>, ReturnType<SummarizeFn>>().mockResolvedValue("SUMMARY");
    await runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: mockSummarize });

    expect(cm.journal.some((e) => e.meta.tombstone)).toBe(true);

    const msgs = cm.compose();
    expect(() => cm.validateWorkingContext(msgs)).not.toThrow();
  });

  it("onPreCompact veto stops the compaction", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const summarizeSpy = vi.fn().mockResolvedValue("SUMMARY");
    const preCompactSpy = vi.fn().mockReturnValue({ veto: true });
    const cfg: AgentConfig = { ...TEST_AGENT_CFG, hooks: { onPreCompact: preCompactSpy } };

    const result = await runCompaction(cm, AGENT, cfg, { summarize: summarizeSpy });

    expect(result.outcome).toBe("skipped");
    expect(preCompactSpy).toHaveBeenCalledTimes(1);
    expect(summarizeSpy).toHaveBeenCalledTimes(0);
    expect(cm.journal.some((e) => e.meta.tombstone)).toBe(false);
  });

  it("onPostCompact fires once with numeric before/after counts", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const postCompactSpy = vi.fn<[PostCompactPayload], void>();
    const cfg: AgentConfig = { ...TEST_AGENT_CFG, hooks: { onPostCompact: postCompactSpy } };
    const result = await runCompaction(cm, AGENT, cfg, {
      summarize: () => Promise.resolve("SUMMARY"),
    });

    expect(result.outcome).toBe("compacted");
    expect(postCompactSpy).toHaveBeenCalledTimes(1);
    const payload = postCompactSpy.mock.calls[0][0];
    expect(typeof payload.tokensBefore).toBe("number");
    expect(typeof payload.tokensAfter).toBe("number");
  });

  it("neither compaction hook fires when there is nothing to compact", async () => {
    const preSpy = vi.fn();
    const postSpy = vi.fn();
    const cfg: AgentConfig = { ...TEST_AGENT_CFG, hooks: { onPreCompact: preSpy, onPostCompact: postSpy } };

    const result = await runCompaction(cm, AGENT, cfg, {
      summarize: () => Promise.resolve("SUMMARY"),
    });

    expect(result.outcome).toBe("skipped");
    expect(preSpy).toHaveBeenCalledTimes(0);
    expect(postSpy).toHaveBeenCalledTimes(0);
  });

  it("onStart is not called when there is nothing to compact", async () => {
    const onStart = vi.fn();
    const onSettle = vi.fn();

    cm.appendUser({ role: "user", content: "Only turn" });
    cm.recordStep([{ role: "assistant", content: "Reply" }]);
    cm.commitTurn();

    const result = await runCompaction(cm, AGENT, TEST_AGENT_CFG, {
      summarize: () => Promise.resolve("SUMMARY"),
      observer: { onStart, onSettle },
    });

    expect(onStart).not.toHaveBeenCalled();
    expect(onSettle).not.toHaveBeenCalled();
    expect(result.outcome).toBe("skipped");
  });

  it("onStart is not called when a hook vetoes", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const onStart = vi.fn();
    const onSettle = vi.fn();
    const cfg: AgentConfig = { ...TEST_AGENT_CFG, hooks: { onPreCompact: () => ({ veto: true }) } };
    const result = await runCompaction(cm, AGENT, cfg, {
      summarize: () => Promise.resolve("SUMMARY"),
      observer: { onStart, onSettle },
    });

    expect(onStart).not.toHaveBeenCalled();
    expect(onSettle).not.toHaveBeenCalled();
    expect(result.outcome).toBe("skipped");
  });

  it("aborting the observer's signal mid-run yields cancelled and leaves the journal untouched", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const journalLengthBefore = cm.journal.length;
    const abortController = new AbortController();
    const onSettle = vi.fn();
    let releaseSummarize: (() => void) | undefined;
    const summarize = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseSummarize = () => resolve("SUMMARY");
        }),
    );

    const promise = runCompaction(cm, AGENT, TEST_AGENT_CFG, {
      summarize,
      observer: { onStart: () => abortController.signal, onSettle },
    });

    // Give runCompaction a tick to call summarize and register the abort listener.
    await Promise.resolve();
    await Promise.resolve();
    abortController.abort();

    const result = await promise;
    expect(result.outcome).toBe("cancelled");
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith("cancelled");
    expect(cm.journal.length).toBe(journalLengthBefore);
    void releaseSummarize;
  });

  it("an already-aborted signal cancels before the summarizer runs", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const abortController = new AbortController();
    abortController.abort();
    const summarize = vi.fn().mockResolvedValue("SUMMARY");

    const result = await runCompaction(cm, AGENT, TEST_AGENT_CFG, {
      summarize,
      observer: { onStart: () => abortController.signal },
    });

    expect(result.outcome).toBe("cancelled");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("the summarize call receives the observer's signal", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const abortController = new AbortController();
    let receivedOpts: { signal?: AbortSignal } | undefined;
    const summarize = vi.fn((_cm: ContextManager, _agent: PageAgent, _cfg: AgentConfig, opts?: { signal?: AbortSignal }) => {
      receivedOpts = opts;
      return Promise.resolve("SUMMARY");
    });

    await runCompaction(cm, AGENT, TEST_AGENT_CFG, {
      summarize,
      observer: { onStart: () => abortController.signal },
    });

    expect(receivedOpts?.signal).toBe(abortController.signal);
  });

  it("a timeout rejects with the timeout error, not a cancellation", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const abortController = new AbortController();
    const onSettle = vi.fn();
    const slowSummarize = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("SLOW"), 20000)));

    const promise = runCompaction(cm, AGENT, TEST_AGENT_CFG, {
      summarize: slowSummarize,
      timeoutMs: 5000,
      observer: { onStart: () => abortController.signal, onSettle },
    });
    promise.catch(() => {});

    vi.advanceTimersByTime(6000);
    await expect(promise).rejects.toThrow("Compaction timeout");
    expect(onSettle).toHaveBeenCalledWith("failed", expect.any(Error));
  });

  it("runCompaction works with no observer", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const result = await runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: () => Promise.resolve("SUMMARY") });
    expect(result.outcome).toBe("compacted");
  });

  it("runCompaction appends a tombstone and clears needsCompaction", async () => {
    cm.appendUser({ role: "user", content: "A".repeat(1500) });
    cm.recordStep([{ role: "assistant", content: "Reply 1" }]);
    cm.commitTurn();
    cm.appendUser({ role: "user", content: "Turn 2" });
    cm.recordStep([{ role: "assistant", content: "Reply 2" }]);
    cm.commitTurn();

    cm.compose();
    expect(cm.needsCompaction).toBe(true);

    const result = await runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: () => Promise.resolve("SUMMARY") });

    expect(result.outcome).toBe("compacted");
    expect(lastTombstone(cm)?.meta.tombstone?.summary).toBe("SUMMARY");
    expect(cm.needsCompaction).toBe(false);
  });

  it("runCompaction propagates failure: rethrows error, clears needsCompaction, and notifies observer with failed", async () => {
    cm.appendUser({ role: "user", content: "A".repeat(1500) });
    cm.recordStep([{ role: "assistant", content: "Reply 1" }]);
    cm.commitTurn();
    cm.appendUser({ role: "user", content: "Turn 2" });
    cm.recordStep([{ role: "assistant", content: "Reply 2" }]);
    cm.commitTurn();

    cm.compose();
    expect(cm.needsCompaction).toBe(true);

    const onSettle = vi.fn();
    const err = new Error("no auth token");
    const failingSummarize = vi.fn().mockRejectedValue(err);

    await expect(
      runCompaction(cm, AGENT, TEST_AGENT_CFG, { summarize: failingSummarize, observer: { onSettle } }),
    ).rejects.toThrow("no auth token");

    expect(cm.needsCompaction).toBe(false);
    expect(onSettle).toHaveBeenCalledWith("failed", err);
  });

  it("passes tokensBefore, tokensAfter, messagesBefore/After, toolCallsRedacted, and durationMs to observer on settle", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const onSettle = vi.fn();
    const result = await runCompaction(cm, AGENT, TEST_AGENT_CFG, {
      summarize: () => Promise.resolve("SUMMARY"),
      observer: { onSettle },
    });

    expect(result.outcome).toBe("compacted");
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith("compacted", undefined, {
      tokensBefore: expect.any(Number),
      tokensAfter: expect.any(Number),
      messagesBefore: expect.any(Number),
      messagesAfter: expect.any(Number),
      toolCallsRedacted: expect.any(Number),
      durationMs: expect.any(Number),
    });
    const [, , stats] = onSettle.mock.calls[0];
    expect(stats.tokensAfter).toBeLessThan(stats.tokensBefore);
    expect(stats.messagesAfter).toBeLessThan(stats.messagesBefore);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("cancelled run passes no stats to onSettle", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const abortController = new AbortController();
    abortController.abort();
    const onSettle = vi.fn();

    const result = await runCompaction(cm, AGENT, TEST_AGENT_CFG, {
      summarize: () => Promise.resolve("SUMMARY"),
      observer: { onStart: () => abortController.signal, onSettle },
    });

    expect(result.outcome).toBe("cancelled");
    expect(onSettle).toHaveBeenCalledWith("cancelled");
  });

  it("failed run passes no stats to onSettle", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    const onSettle = vi.fn();
    const err = new Error("summarizer down");
    await expect(
      runCompaction(cm, AGENT, TEST_AGENT_CFG, {
        summarize: () => Promise.reject(err),
        observer: { onSettle },
      }),
    ).rejects.toThrow("summarizer down");

    expect(onSettle).toHaveBeenCalledWith("failed", err);
  });

  it("an observer with a 2-parameter onSettle(outcome, error) still compiles and works", async () => {
    for (let i = 1; i <= 3; i++) {
      cm.appendUser({ role: "user", content: `Turn ${i}` });
      cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
      cm.commitTurn();
    }

    let seenOutcome = "";
    let seenError: unknown;
    const observer: CompactionObserver = {
      onSettle(outcome, error) {
        seenOutcome = outcome;
        seenError = error;
      },
    };

    const result = await runCompaction(cm, AGENT, TEST_AGENT_CFG, {
      summarize: () => Promise.resolve("SUMMARY"),
      observer,
    });

    expect(result.outcome).toBe("compacted");
    expect(seenOutcome).toBe("compacted");
    expect(seenError).toBeUndefined();
  });

});

describe("hasUnansweredToolUse", () => {
  it("returns false when there are no tool calls", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(hasUnansweredToolUse(messages)).toBe(false);
  });

  it("returns false when every tool call has a matching tool result", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "run it" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "1", toolName: "t", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "1", toolName: "t", output: {} }] },
    ];
    expect(hasUnansweredToolUse(messages)).toBe(false);
  });

  it("returns true when a tool call has no matching tool result", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "run it" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "1", toolName: "t", input: {} }] },
    ];
    expect(hasUnansweredToolUse(messages)).toBe(true);
  });
});

describe("summariseInCachedConversation", () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager(TEST_CFG);
  });

  it("appends SUMMARY_INSTRUCTION to the composed messages", async () => {
    cm.appendUser({ role: "user", content: "hello" });
    cm.recordStep([{ role: "assistant", content: "hi there" }]);
    cm.commitTurn();

    let captured: ModelMessage[] | undefined;
    setMockScript((opts) => {
      captured = opts.messages;
      return { text: "SUMMARY" };
    });

    // A fresh agent, built AFTER setMockScript — the mock provider snapshots
    // the script at construction time (registry.ts), so the shared module
    // level AGENT (built once, before any test's setMockScript) would still
    // be running the default echo script.
    const agent = makeAgent(TEST_AGENT_CFG);
    const text = await summariseInCachedConversation(cm, agent, TEST_AGENT_CFG);
    expect(text).toBe("SUMMARY");
    expect(captured).toEqual([
      ...cm.compose(),
      { role: "user", content: SUMMARY_INSTRUCTION },
    ]);
  });

  it("sends the identical tools/system prefix a live turn would send", async () => {
    cm.appendUser({ role: "user", content: "hello" });
    cm.recordStep([{ role: "assistant", content: "hi there" }]);
    cm.commitTurn();

    const turnCallOpts = AGENT.buildCallOptions(cm.compose(), { abortSignal: undefined });

    let captured: { tools?: unknown; systemPrompt?: string; providerOptions?: unknown; model?: string } = {};
    setMockScript((opts) => {
      captured = {
        tools: opts.tools,
        systemPrompt: opts.systemPrompt,
        providerOptions: opts.providerOptions,
        model: opts.model,
      };
      return { text: "SUMMARY" };
    });

    // Fresh agent built AFTER setMockScript — see the note in the previous test.
    const agent = makeAgent(TEST_AGENT_CFG);
    await summariseInCachedConversation(cm, agent, TEST_AGENT_CFG);

    // Every field that participates in Anthropic's cache prefix (tools →
    // system → providerOptions → model) matches the live turn's request
    // exactly — only the appended message and maxOutputTokens may differ.
    expect(captured.tools).toEqual(turnCallOpts.tools);
    expect(captured.systemPrompt).toBe(turnCallOpts.systemPrompt);
    expect(captured.providerOptions).toEqual(turnCallOpts.providerOptions);
    expect(captured.model).toBe(turnCallOpts.model);
  });

  it("passes cfg.model and compactionMaxTokens (16000)", async () => {
    cm.appendUser({ role: "user", content: "hello" });
    cm.recordStep([{ role: "assistant", content: "hi there" }]);
    cm.commitTurn();

    let captured: { model?: string; maxOutputTokens?: number } = {};
    setMockScript((opts) => {
      captured = { model: opts.model, maxOutputTokens: opts.maxOutputTokens };
      return { text: "SUMMARY" };
    });

    const cfg: AgentConfig = {
      ...TEST_AGENT_CFG,
      model: "sonnet",
      context: { ...TEST_CFG, compactionMaxTokens: 16000 },
    };
    const agent = makeAgent(cfg);
    await summariseInCachedConversation(cm, agent, cfg);
    expect(captured.model).toBe("sonnet");
    expect(captured.maxOutputTokens).toBe(16000);
  });

  it("throws CompactionError when messages are empty", async () => {
    await expect(summariseInCachedConversation(cm, AGENT, TEST_AGENT_CFG)).rejects.toMatchObject({
      name: "CompactionError",
      message: "nothing to summarise",
    });
    await expect(summariseInCachedConversation(cm, AGENT, TEST_AGENT_CFG)).rejects.toBeInstanceOf(CompactionError);
  });

  it("throws CompactionError when tool calls are unanswered", async () => {
    cm.appendUser({ role: "user", content: "run a tool" });
    cm.recordStep([
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "query_state", input: {} }],
      },
    ]);
    // No matching tool-result recorded — mid-turn.

    await expect(summariseInCachedConversation(cm, AGENT, TEST_AGENT_CFG)).rejects.toMatchObject({
      name: "CompactionError",
      message: "compaction attempted mid-turn",
    });
  });

  it("throws CompactionError when the provider returns empty text", async () => {
    cm.appendUser({ role: "user", content: "hello" });
    cm.recordStep([{ role: "assistant", content: "hi there" }]);
    cm.commitTurn();

    // 003: a whitespace-only TEXT response is retried by the withRetry
    // transport middleware (middleware.ts's isEmptyResult) ONLY when the turn
    // did not finish normally. With finishReason "stop" it now reaches this
    // function and raises the same "summariser returned no text". The case
    // scripted below is the other one: content with no text block at all
    // (the model answers with only a tool call).
    setMockScript({ content: [{ type: "tool_use", id: "t1", name: "ignore", input: {} }] });

    // Fresh agent built AFTER setMockScript — see the note above.
    const agent = makeAgent(TEST_AGENT_CFG);
    await expect(summariseInCachedConversation(cm, agent, TEST_AGENT_CFG)).rejects.toMatchObject({
      name: "CompactionError",
      message: "summariser returned no text",
    });
  });

  it("forwards abortSignal to the provider", async () => {
    cm.appendUser({ role: "user", content: "hello" });
    cm.recordStep([{ role: "assistant", content: "hi there" }]);
    cm.commitTurn();

    const controller = new AbortController();
    controller.abort();

    // The withRetry transport middleware maps a user abort to AgentError
    // (errors.ts:mapToAgentError) rather than surfacing the raw DOMException.
    await expect(
      summariseInCachedConversation(cm, AGENT, TEST_AGENT_CFG, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AgentError", kind: "aborted" });
  });
});
