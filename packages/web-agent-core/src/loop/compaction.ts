import type { ContextManager } from "./context-manager.js";
import type { AgentConfig } from "../config.types.js";
import type { PageAgent, SummarizeFn } from "./agent.types.js";
export type { PageAgent, SummarizeFn } from "./agent.types.js";
import type {
  CompactionObserver,
  CompactionResult,
} from "./types.js";
export type {
  CompactionObserver,
  CompactionOutcome,
  CompactionResult,
  CompactionStats,
} from "./types.js";
import { runHooks } from "../hooks/run-hooks.js";
import type { ModelMessage, TextBlock } from "../types.js";

export class CompactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompactionError";
  }
}

// Explicitly forbids tool use: with the full live toolset present in the
// request (required for the cache prefix to match — see
// summariseInCachedConversation below) and no instruction otherwise, a real
// model sometimes calls a tool (e.g. a fresh query_data) instead of
// answering — observed directly in this task's live proof. Anthropic's
// tool_choice has no "none" value to force this at the request level
// (`transport/anthropic-mapping.ts`'s mapToolChoice), so the instruction is
// the only lever.
export const SUMMARY_INSTRUCTION =
  "Do not call any tools. Reply with plain text only: a clear, structured summary of the conversation so far. Include the user's goal, constraints, key decisions, progress made, next steps, and any crucial facts or context needed to continue the conversation effectively.";

/** True when an assistant `tool-call` in `messages` has no matching
 *  `tool-result` — appending a user turn after one is an invalid request. */
export function hasUnansweredToolUse(messages: ModelMessage[]): boolean {
  const calls = new Set<string>();
  const results = new Set<string>();

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-call") {
          calls.add(part.toolCallId);
        } else if (part.type === "tool-result") {
          results.add(part.toolCallId);
        }
      }
    }
  }

  for (const id of calls) {
    if (!results.has(id)) return true;
  }
  return false;
}

/**
 * Summarise the conversation by appending ONE user turn to the message array
 * already built for the last request, so the history is a prompt-cache read
 * instead of a full-price detached prompt (see
 * `applyRollingCacheBreakpoint`, `transport/anthropic-cache.ts`).
 *
 * The request MUST be byte-identical to what a live turn would send — same
 * `tools`, same `systemPrompt`/`providerOptions` — up to the appended message,
 * because Anthropic's cache match is an exact, positional prefix over
 * tools→system→messages. A rebuilt-by-hand copy of those fields silently
 * drifts the moment the turn path gains one; instead this calls
 * `agent.buildCallOptions()`, the SAME builder `loop/agent.ts`'s turn loop
 * uses, overriding only `maxOutputTokens` (outside the cached prefix). The
 * full live toolset stays in the request — dropping it would break the cache
 * match at byte zero — so `SUMMARY_INSTRUCTION` itself tells the model not to
 * call one.
 *
 * `streaming` is left at whatever the live turn uses (`cfg.streaming`), NOT
 * forced to non-streaming: `withRetry`'s per-attempt idle timeout
 * (`requestTimeoutMs`, default 5 min) only resets on transport progress, and a
 * non-streaming call gets none — no bytes arrive until the whole response is
 * ready — so it degrades to a hard 5-minute deadline. A large summary (up to
 * `compactionMaxTokens` output tokens, over a 19-tool/full-history prompt)
 * routinely takes longer than that; observed directly in this task's live
 * proof as a `net::ERR_ABORTED` retry storm ending in "Compaction timeout".
 * `agent.callModel()` (`_model.generate()`) still returns one awaited
 * `ProviderResult` when streaming — the provider reassembles the stream
 * internally (`transport/anthropic-provider.ts`) — so this changes nothing
 * about what the caller receives.
 *
 * The appended turn is never journalled and never appears in the transcript —
 * it exists only in this request.
 */
export async function summariseInCachedConversation(
  cm: ContextManager,
  agent: PageAgent,
  cfg: AgentConfig,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const messages = cm.compose();
  if (messages.length === 0) {
    throw new CompactionError("nothing to summarise");
  }

  if (hasUnansweredToolUse(messages)) {
    throw new CompactionError("compaction attempted mid-turn");
  }

  const request: ModelMessage[] = [
    ...messages,
    { role: "user", content: SUMMARY_INSTRUCTION },
  ];

  const callOpts = agent.buildCallOptions(request, {
    maxOutputTokens: cfg.context.compactionMaxTokens,
    abortSignal: opts?.signal,
  });

  const result = await agent.callModel(callOpts);

  const text = result.content
    .filter((p): p is TextBlock => p.type === "text")
    .map((p) => p.text)
    .join("");

  if (!text || text.trim().length === 0) {
    throw new CompactionError("summariser returned no text");
  }

  return text;
}

export async function runCompaction(
  cm: ContextManager,
  agent: PageAgent,
  cfg: AgentConfig,
  opts?: {
    summarize?: SummarizeFn;
    timeoutMs?: number;
    observer?: CompactionObserver;
  }
): Promise<CompactionResult> {
  // 2 minutes. The previous 10s default lost the race most of the time:
  // measured 2026-08-30 over 6 real summarize calls (same route and model the
  // browser uses, output capped at 700 tokens), 4 of 6 took longer than 10s —
  // 8.3s, 9.6s, 9.7s, 11.3s, 17.9s, 18.9s. Latency is dominated by output
  // generation, so the tail is long by construction. Compaction failing here
  // is what produced the "failed" rows in the transcript.
  const timeoutMs = opts?.timeoutMs ?? 120000;
  let signal: AbortSignal | undefined;
  try {
    const toCompact = cm.turnsToCompact();
    if (toCompact.turnIds.length === 0) {
      return { outcome: "skipped" };
    }

    // Fired only once there is really something to compact.
    const usageBefore = cm.getUsage();
    if (cfg?.hooks?.onPreCompact) {
      const pre = await runHooks(cfg.hooks, "onPreCompact", {
        tokens: usageBefore.tokens,
        percent: usageBefore.percent,
      });
      if (pre.veto) return { outcome: "skipped" };
    }

    // The run is now certain to happen: tell the caller, and take its signal.
    signal = opts?.observer?.onStart?.();
    if (signal?.aborted) {
      opts?.observer?.onSettle?.("cancelled");
      return { outcome: "cancelled" };
    }

    const startedAt = Date.now();
    const messagesBefore = cm.journal.filter((e) => !e.meta.tombstone).length;

    let timerId: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const summarizeRunner = opts?.summarize ?? summariseInCachedConversation;
    // The loser of the race must not surface as an unhandled rejection.
    const summarizePromise = summarizeRunner(cm, agent, cfg, { signal });
    summarizePromise.catch(() => {});

    const timeoutPromise = new Promise<string>((_, reject) => {
      timerId = setTimeout(() => reject(new Error("Compaction timeout")), timeoutMs);
    });
    const abortPromise = new Promise<string>((_, reject) => {
      if (!signal) return;
      onAbort = () => reject(new DOMException("Compaction aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    timeoutPromise.catch(() => {});
    abortPromise.catch(() => {});

    let summaryText: string;
    try {
      summaryText = await Promise.race([summarizePromise, timeoutPromise, abortPromise]);
    } finally {
      clearTimeout(timerId);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }

    cm.appendTombstone(summaryText);
    cm.clearNeedsCompaction();
    const tokensAfter = cm.getUsage().tokens;
    if (cfg?.hooks?.onPostCompact) {
      await runHooks(cfg.hooks, "onPostCompact", {
        tokensBefore: usageBefore.tokens,
        tokensAfter,
      });
    }
    const messagesSummarised = cm.messagesSummarisedByLastTombstone();
    opts?.observer?.onSettle?.("compacted", undefined, {
      tokensBefore: usageBefore.tokens,
      tokensAfter,
      messagesBefore,
      messagesAfter: messagesBefore - messagesSummarised,
      toolCallsRedacted: cm.toolCallsRedactedByLastTombstone(),
      durationMs: Date.now() - startedAt,
    });
    return { outcome: "compacted" };
  } catch (err) {
    if (signal?.aborted) {
      opts?.observer?.onSettle?.("cancelled");
      return { outcome: "cancelled" };
    }
    // Clear the flag on failure too: otherwise every later turn re-attempts
    // and re-fails forever (the caller that set needsCompaction never sees
    // a success to clear it for them).
    cm.clearNeedsCompaction();
    opts?.observer?.onSettle?.("failed", err);
    throw err;
  }
}
