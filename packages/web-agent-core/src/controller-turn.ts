// Running one turn: the user-facing `send()`, the turn loop wrapper
// `runUserTurn()`, the manual `compact()` and `retryLast()`. Moved out of
// `controller.ts` unchanged — each former closure variable is now read from
// the `SessionRuntime` passed in.
import { runTurn, resumeTurn } from "./loop/run-turn.js";
import { currentUserTurn } from "./loop/context-assembly.js";
import { runCompaction } from "./loop/compaction.js";
import { DEFAULT_CONTEXT_CONFIG } from "./config.js";
import { buttonToMessage, formSubmitToMessage } from "./ui-blocks/bridge.js";
import { runHooks } from "./hooks/run-hooks.js";
import { isRetryableError } from "./transport/middleware.js";
import { isEmptyCompletedTurn } from "./controller-messages.js";
import { toAvailableTools } from "./controller-tools.js";
import type { StreamPart } from "./transport/provider.types.js";
import type { ImageAttachment, UserMessageInput } from "./utils/types.js";
import type { MessagePart } from "./types.js";
import type { SessionRuntime, TurnInvoker } from "./controller-runtime.types.js";
import { emitEvent, notifyListeners } from "./controller-state.js";
import { flushTurn } from "./controller-sessions.js";

function partsToInput(parts: MessagePart[]): { text: string; images: ImageAttachment[] } {
  const userTextParts: string[] = [];
  const images: ImageAttachment[] = [];
  for (const part of parts) {
    if (part.type === "text") userTextParts.push(part.text);
    else if (part.type === "image") images.push({ dataUrl: part.dataUrl, mediaType: part.mediaType });
    else if (part.type === "tool") {
      if (part.name === "button") userTextParts.push(buttonToMessage(part.data as string));
      else if (part.name === "form_submit") {
        const d = part.data as { id: string; values: Record<string, unknown> };
        userTextParts.push(formSubmitToMessage(d.id, d.values));
      } else userTextParts.push(`[ui_action:${part.name}] ${JSON.stringify(part.data)}`);
    }
  }
  return { text: userTextParts.join("\n"), images };
}

export async function compact(st: SessionRuntime): Promise<void> {
  if (st.running || st.compacting) return;
  if (!st.cm.hasCompactableTurns()) return;

  // Remember which session this compaction belongs to, so the drain below can
  // tell a finished compaction from a stale one. `sessionEpoch` catches
  // createSession (which bumps it); `activeSessionId` catches switchSession,
  // which does not.
  const epoch = st.sessionEpoch;
  const sessionId = st.activeSessionId;
  st.running = true;
  st.error = undefined;
  notifyListeners(st);
  try {
    await runCompaction(st.cm, st.agent, st.agentConfig, {
      observer: st.compactionObserver,
    });
    flushTurn(st);
  } catch (e: unknown) {
    const message = (e as { message?: string }).message || String(e);
    st.error = message;
    const lastEntry = st.cm.journal[st.cm.journal.length - 1];
    if (lastEntry) {
      lastEntry.meta.failed = { message, retryable: false };
    }
    flushTurn(st);
    console.error("Compaction failed:", e);
    throw e;
  } finally {
    st.running = false;
    notifyListeners(st);
    // A message queued while the compaction ran must fire as soon as the
    // compaction finishes. Drain here, exactly like driveTurn's finally
    // (controller-turn.ts:217), but only if the session did not change while
    // the compaction ran. On a failed compaction `st.error` is set, so
    // maybeDrainQueue (no opts) returns without draining and the queue is kept.
    if (st.sessionEpoch === epoch && st.activeSessionId === sessionId) {
      await st.maybeDrainQueue();
    }
  }
}

async function driveTurn(st: SessionRuntime, invoke: TurnInvoker): Promise<void> {
  const sessionEpoch = st.sessionEpoch;
  st.running = true;
  st.error = undefined;
  // 110/004 — freeze what this turn's agent was built with, BEFORE the
  // notify below, so the first state update already carries it. `defs` is
  // resolved in createPageAgent() from the full ToolContext
  // (loop/agent.ts:139) and handed out as customToolDefs (:219).
  // 069/001 — `initAgent()` already seeds this the same way at session
  // construction/restore, so a saved step line's phrase resolves before this
  // turn even starts; this call just re-snapshots it for the turn that is
  // about to run, in case anything rebuilt `st.agent` since.
  st.resolvedTools = toAvailableTools(st.agent.customToolDefs);
  notifyListeners(st);

  st.controller = new AbortController();
  let turnResult: import("./loop/run-turn.js").TurnResult | undefined;

  try {
    if (st.ctx.app) {
      st.ctx.app.route = (st.currentConfig.store?.getState?.() as { ui?: { route?: string } } | undefined)?.ui?.route || "/";
    }

    // 107/004: expire stale tool results BEFORE reading usage, so a session
    // the sweep brings back under the threshold does not compact at all.
    st.cm.redactExpiredResults(st.agent.customToolDefs);
    const currentUsage = st.cm.getUsage();
    const threshold = st.agentConfig.context?.autoCompactPercent ?? DEFAULT_CONTEXT_CONFIG.autoCompactPercent;
    if (currentUsage.percent > threshold) {
      await runCompaction(st.cm, st.agent, st.agentConfig, {
        observer: st.compactionObserver,
      });
    }

    const onStreamPart = (part: StreamPart) => {
      if (st.sessionEpoch !== sessionEpoch) return;
      if (part.type !== "text-delta") return;   // text only, by scope
      st.streamingText += part.delta;
      notifyListeners(st);
    };

    const onStep = () => {
      if (st.sessionEpoch !== sessionEpoch) return;
      // Runs right after cm.recordStep() journaled this step's assistant
      // message (loop/agent.ts:377-380). Clearing here and notifying once
      // swaps the partial text for the committed message in a single state
      // update — no empty frame, no duplicate.
      st.streamingText = "";
      notifyListeners(st);
    };

    const turnPromise = invoke(st.controller.signal, onStep, onStreamPart);

    notifyListeners(st);

    const result = await turnPromise;
    if (st.sessionEpoch !== sessionEpoch) return;
    turnResult = result;

    if (result.usage) {
      st.usage.input += result.usage.input;
      st.usage.output += result.usage.output;
    }

    if (result.stopReason === "max_iterations") {
      console.warn(`[web-agent] Turn ended: max_iterations exceeded (${st.agentConfig.maxIterations} steps)`);
    }

    if (result.stopReason === "aborted" || result.stopReason === "error") {
      st.error = result.error?.message || (result.stopReason === "error" ? "An error occurred during execution." : "Turn aborted.");
      const lastEntry = st.cm.journal[st.cm.journal.length - 1];
      if (lastEntry) {
        lastEntry.meta.failed = { message: st.error, retryable: isRetryableError(result.error) };
      }
    }
  } catch (err: unknown) {
    if (st.sessionEpoch !== sessionEpoch) return;
    const message: string = (err as { message?: string }).message || String(err);
    st.error = message;
    turnResult = { assistantText: "", blocks: [], stopReason: "error" };
    const lastEntry = st.cm.journal[st.cm.journal.length - 1];
    if (lastEntry) {
      lastEntry.meta.failed = { message, retryable: isRetryableError(err) };
    }
  } finally {
    if (st.sessionEpoch === sessionEpoch) {
      st.running = false;
      st.controller = undefined;
      // Abort or error: the step never journaled, so the partial text belongs to
      // nothing. Drop it before the final repaint.
      st.streamingText = "";
      flushTurn(st);
      notifyListeners(st);
      if (turnResult) {
        await runHooks(st.agentConfig.hooks, "onTurnEnd", {
          result: turnResult,
          stopReason: turnResult.stopReason,
        });
      }
      // 108/001 — per-turn state resets together, and this one resets
      // UNCONDITIONALLY (outside the `if (compactionRequested)` below), so a
      // turn that only ever made unconfirmed calls still starts the next turn
      // clean and gets the question again rather than the repeat error.
      st.compactionUnconfirmedAttempts = 0;
      // P7 — the model asked for a compaction with compact_conversation. It
      // runs HERE, at the end of the turn, and BEFORE the queue drains, so a
      // queued follow-up prompt sees the compacted context.
      if (st.compactionRequested) {
        st.compactionRequested = false;
        try {
          await runCompaction(st.cm, st.agent, st.agentConfig, {
            observer: st.compactionObserver,
          });
          flushTurn(st);
          // 108/001 — the follow-up runs as an ordinary queued text turn, so
          // maybeDrainQueue() below picks it up AFTER the compaction settled
          // and it sees the compacted context. No new machinery.
          if (st.compactionFollowUp) {
            st.enqueueInput(st.compactionFollowUp, []);
          }
        } catch (e: unknown) {
          const message = (e as { message?: string }).message || String(e);
          st.error = message;
          const lastEntry = st.cm.journal[st.cm.journal.length - 1];
          if (lastEntry) {
            lastEntry.meta.failed = { message, retryable: false };
          }
          flushTurn(st);
          console.error("Compaction failed:", e);
          // 108/001 — deliberately do NOT queue the follow-up here. The agent
          // asked for room before doing the work; if the room was not made,
          // running the work anyway is the outcome it was trying to avoid, and
          // the compaction error is already surfaced to the user.
        } finally {
          st.compactionFollowUp = undefined;
        }
        notifyListeners(st);
      }
      await st.maybeDrainQueue();
    }
  }
}

export async function runUserTurn(
  st: SessionRuntime,
  userInput: string | UserMessageInput,
): Promise<void> {
  const agent = st.agent;
  const cm = st.cm;
  const ctx = st.ctx;
  await driveTurn(st, (signal, onStep, onStreamPart) =>
    runTurn(
      agent,
      cm,
      ctx,
      userInput,
      signal,
      st.agentConfig,
      onStep,
      onStreamPart,
    ));
}

export async function send(
  st: SessionRuntime,
  parts: MessagePart[],
  opts?: { userDisplayText?: string },
): Promise<void> {
  if (st.sessionTransition) await st.sessionTransition;
  let effectiveParts = parts;
  // The caller's own display text (e.g. a generative-UI button's clean prompt
  // label) is the default; a host's onUserPrompt hook, when present, still
  // wins — it sees the raw parts and knows better than the caller.
  let userDisplayText: string | undefined = opts?.userDisplayText;
  let meta: Record<string, unknown> | undefined;

  if (st.agentConfig.hooks?.onUserPrompt) {
    const { text: rawText } = partsToInput(parts);
    const displayText = opts?.userDisplayText ?? rawText;
    const firstInChat = currentUserTurn(st.cm.journal) === 1;
    const prompt = await runHooks(st.agentConfig.hooks, "onUserPrompt", {
      parts,
      sessionId: st.activeSessionId,
      firstInChat,
      displayText,
    });
    effectiveParts = prompt.parts;
    // runHooks() returns userDisplayText: undefined when no registered
    // handler expressed an opinion (e.g. a logging-only hook, B-7/B-9's
    // cat-store `onUserPrompt` in agent-panel-config.ts) — that must NOT
    // clobber the caller's own opts.userDisplayText. Only an explicit
    // value from a handler overrides it.
    if (prompt.userDisplayText !== undefined) userDisplayText = prompt.userDisplayText;
    meta = prompt.meta;
  }

  // The hook can yield while a new-session write starts. Choose the journal
  // only after that transition has completed.
  if (st.sessionTransition) await st.sessionTransition;

  const { text, images } = partsToInput(effectiveParts);
  const finalText = text;
  if (st.running) {
    st.enqueueInput({ text: finalText, images, userDisplayText, promptMeta: meta });
    return;
  }
  const finalUserDisplayText = userDisplayText;
  const userInput: string | UserMessageInput =
    (images.length > 0 || finalUserDisplayText !== undefined || meta !== undefined)
      ? { text: finalText, images, userDisplayText: finalUserDisplayText, promptMeta: meta }
      : finalText;
  await runUserTurn(st, userInput);
}

function reconstructUserInput(entry: import("./loop/types.js").JournalEntry): string | UserMessageInput {
  const content = entry.msg?.content;
  let text = "";
  const images: { dataUrl: string; mediaType: string }[] = [];
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "text") text += (text ? "\n" : "") + (part.text || "");
      else if (part.type === "image" && typeof part.image === "string")
        images.push({ dataUrl: part.image, mediaType: part.mediaType || "image/jpeg" });
    }
  }
  const userDisplayText = entry.meta?.userDisplayText;
  const promptMeta = entry.meta?.promptMeta;
  if (images.length > 0 || userDisplayText !== undefined || promptMeta !== undefined) {
    return { text, images, userDisplayText, promptMeta };
  }
  return text;
}

/** The terminal `retry:success` / `retry:failure` pair, read off the journal the
 *  retried run left behind. Unchanged from the tail of the old `retryLast`;
 *  shared so both paths emit the same thing. */
function emitRetryOutcome(st: SessionRuntime): void {
  const failedNow = st.cm.journal.length > 0 &&
    st.cm.journal[st.cm.journal.length - 1].meta.failed;
  if (failedNow) emitEvent(st, { type: "retry:failure", error: failedNow });
  else emitEvent(st, { type: "retry:success" });
}

/**
 * 001 — continue the open turn from its last completed step.
 *
 * Nothing is removed from the journal, so a tool that already ran is never run
 * again: `cm.compose()` hands the model the completed steps as context and
 * `generate()` journals only what is new.
 *
 * The journal always ends on a clean step boundary, so the resumed request is
 * always a shape the provider accepts: one `recordStep` call writes a step's
 * assistant message together with all of its tool results
 * (loop/agent.ts:313-377), and a tool executor never throws — build-tools.ts
 * returns the error as tool content instead (tools/build-tools.ts:158-160).
 * There can be no `tool_use` left without its `tool_result`.
 *
 * With zero completed steps this reduces to today's behaviour on its own:
 * `compose()` returns just the user message.
 */
async function resumeLastTurn(st: SessionRuntime, turnId: string): Promise<void> {
  // (a) The turn is open again, so the failure is no longer true of any of its
  //     entries. The render cache keys on this (controller-messages.ts:181),
  //     and the resumed flush must not re-persist it.
  for (const entry of st.cm.journal) {
    if (entry.meta.turnId === turnId && entry.meta.failed) {
      delete entry.meta.failed;
    }
  }
  st.error = undefined;

  // (b) Rewind persistence by exactly the LAST record, so the resumed flush
  //     rewrites those entries — without the failed marker — together with the
  //     new ones, as one record at the same sequence. Every earlier record
  //     stays byte-identical. `lastRecordEntryCount` is the record's real size,
  //     so a turn that also compacted (and therefore flushed twice) rewinds its
  //     last record and not the whole turn.
  if (st.sessionStore && st.activeSessionId && st.flushedSeq > 0) {
    const lastGoodSeq = st.flushedSeq - 1;
    st.flushedSeq = lastGoodSeq;
    st.flushedJournalLength -= st.lastRecordEntryCount;
    // Queued inside the store, so the resumed turn's appendRecords always
    // runs after this delete.
    st.sessionStore.truncateAfter(st.activeSessionId, lastGoodSeq)
      .catch((err) => console.error("[session] truncateAfter failed:", err));
  }

  // (c) The cached render of this turn described the failed state.
  st.turnCache.delete(turnId);
  st.cachedStateMessages = null;
  st.cachedStateKey = "";

  emitEvent(st, { type: "retry:start" });
  await driveTurn(st, (signal, onStep, onStreamPart) =>
    resumeTurn(
      st.agent,
      st.cm,
      st.ctx,
      signal,
      st.agentConfig,
      onStep,
      onStreamPart,
    ));
  emitRetryOutcome(st);
}

/**
 * The pre-001 behaviour, unchanged: discard the turn and re-send it from the
 * user message. Now reached ONLY by an empty completed turn — a turn the model
 * ended with an empty assistant message. Resuming that one would re-send the
 * empty message to the model and most likely produce nothing again.
 */
async function restartLastTurn(st: SessionRuntime): Promise<void> {
  const removed = st.cm.truncateLastTurn();
  for (const entry of removed) {
    st.turnCache.delete(entry.meta.turnId);
  }
  st.cachedStateMessages = null;
  st.cachedStateKey = "";
  const userEntry = removed.find(e => e.msg.role === "user");
  if (!userEntry) return;
  const userInput = reconstructUserInput(userEntry);

  // The failed turn wrote exactly one record, at `flushedSeq`. Drop that one
  // record and nothing else, so every earlier record stays byte-identical
  // (criterion 8); the retried turn's ordinary flush then writes the
  // replacement at the same sequence. `flushedJournalLength` is re-based to
  // the journal that survived truncateLastTurn(), so that flush carries the
  // retried turn's entries and only those.
  if (st.sessionStore && st.activeSessionId && st.flushedSeq > 0) {
    const lastGoodSeq = st.flushedSeq - 1;
    st.flushedSeq = lastGoodSeq;
    st.flushedJournalLength = st.cm.journal.length;
    // Queued inside the store, so the retried turn's appendRecords always
    // runs after this delete.
    st.sessionStore.truncateAfter(st.activeSessionId, lastGoodSeq)
      .catch((err) => console.error("[session] truncateAfter failed:", err));
  }

  emitEvent(st, { type: "retry:start" });
  await runUserTurn(st, userInput);
  emitRetryOutcome(st);
}

export async function retryLast(st: SessionRuntime): Promise<void> {
  if (st.running) return;
  const journal = st.cm.journal;
  if (journal.length === 0) return;
  const lastTurnId = journal[journal.length - 1].meta.turnId;
  const lastTurnEntries = journal.filter(e => e.meta.turnId === lastTurnId);
  const isFailed = lastTurnEntries.some(e => e.meta.failed);
  // 003: an empty completed turn is not a failure, but the panel offers
  // Retry on it (the notice from controller-messages.ts), so this guard has
  // to let it through or that button does nothing.
  if (!isFailed && !isEmptyCompletedTurn(lastTurnEntries)) return;

  // 001: a failed turn — error OR abort, both set `meta.failed`
  // (driveTurn, :127-133 and :134-141) — RESUMES from its last completed step.
  // `isFailed` wins when a turn matches both tests, so the tool-preserving path
  // is the default.
  if (isFailed) await resumeLastTurn(st, lastTurnId);
  else await restartLastTurn(st);
}
