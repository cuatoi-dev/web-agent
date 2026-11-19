---
title: Compaction
---

# Compaction

Compaction summarizes conversation history to free context window space while
retaining essential context. As a conversation grows, older turns are compacted
into a concise summary and replaced with a journal tombstone, leaving the most
recent turns verbatim.

---

## When compaction triggers

Compaction runs in three situations:

1. **Automatic pre-turn compaction**: Before each turn, the controller first
   removes tool results whose `ttl` or `uttl` has expired, then checks context
   window usage (`src/controller-turn.ts:102-111`). If usage exceeds the
   configured threshold (`agentConfig.context?.autoCompactPercent`, defaulting
   to `0.75` in `src/config.ts:32-39`), compaction runs before calling the model.
2. **Model-requested compaction**: The model calls `compact_conversation`
   (`src/tools/builders.ts:94-160`) from `compactionTools()`. The tool accepts two
   optional parameters: `confirmation` (boolean, indicating explicit user or skill
   consent) and `followUp` (string, the task to perform in the next turn).
   The compaction executes at turn settle (`src/controller-turn.ts:170-202`).
3. **User slash command**: You can trigger compaction directly by entering
   `/compact [followUp]` in the chat input.

---

## Transcript representation

Hosts read conversation history through `SessionState.messages` (`SessionMessage[]`).
Each message contains an array of parts (`SessionMessagePart`, `src/controller.types.ts:29-37`).
Compaction events appear as parts with `kind: "compaction"`:

```ts
export type CompactionRowStatus = "running" | "done" | "cancelled" | "failed";

export interface SessionMessagePart {
  kind: "text" | "block" | "tool" | "compaction";
  text?: string;
  block?: RenderableBlock;
  audit?: AuditEntry;
  compaction?: { status: CompactionRowStatus; stats?: CompactionStats };
}
```

### The two compaction row shapes

The `compaction` object has two distinct shapes depending on how the session was loaded:

1. **Live compaction run**: When compaction finishes during an active session,
   the row carries terminal status and complete statistics:
   ```ts
   {
     kind: "compaction",
     compaction: {
       status: "done",
       stats: {
         tokensBefore: 45200,
         tokensAfter: 12100,
         messagesBefore: 14,
         messagesAfter: 4,
         toolCallsRedacted: 6,
         durationMs: 1450,
       },
     },
   }
   ```
2. **Reloaded or switched session**: When you reload the page or switch sessions,
   the controller reconstructs compaction rows from journal tombstones
   (`compactionRowsFromJournal`, `src/controller-sessions.ts:34-50`, called at
   `src/controller-sessions.ts:161` on init and `src/controller-sessions.ts:265` on session switch).
   Persisted journal entries store tombstones but do not retain live runtime stats.
   Rebuilt rows carry `status: "done"` with no `stats`:
   ```ts
   {
     kind: "compaction",
     compaction: {
       status: "done",
     },
   }
   ```

### Guarding against absent stats

> [!WARNING]
> Accessing `part.compaction.stats` without a presence check will throw a
> `TypeError` on page reload or session switch.

Always verify that `stats` is defined before reading its properties:

```ts
function renderCompactionPart(part: SessionMessagePart): string {
  if (part.kind !== "compaction" || !part.compaction) return "";

  const { status, stats } = part.compaction;
  if (stats) {
    return (
      `Compacted in ${Math.round(stats.durationMs)} ms: ` +
      `${stats.tokensBefore} -> ${stats.tokensAfter} tokens, ` +
      `${stats.messagesBefore} -> ${stats.messagesAfter} messages`
    );
  }

  // Fallback for rehydrated sessions:
  return `Compacted (${status})`;
}
```

---

## `CompactionStats` field reference

`CompactionStats` is exported from `@cuatoi/web-agent-core` (`src/index.ts:190`)
and defined in `src/loop/types.ts:166-178`:

```ts
export interface CompactionStats {
  tokensBefore: number;
  tokensAfter: number;
  messagesBefore: number;
  messagesAfter: number;
  toolCallsRedacted: number;
  durationMs: number;
}
```

| Field | Type | Unit | Description |
|---|---|---|---|
| `tokensBefore` | `number` | tokens | Estimated context token count before compaction |
| `tokensAfter` | `number` | tokens | Estimated context token count after compaction |
| `messagesBefore` | `number` | count | Non-tombstone journal entries prior to compaction |
| `messagesAfter` | `number` | count | Remaining non-tombstone journal entries kept after compaction |
| `toolCallsRedacted` | `number` | count | Count of tool-call content parts removed from compacted turns |
| `durationMs` | `number` | milliseconds | Total wall time of the compaction request and state update |

---

## Observing compaction with `CompactionObserver`

Hosts can monitor or cancel compaction by passing a `CompactionObserver`
(`src/loop/types.ts:181-191`) to `runCompaction()`:

```ts
export interface CompactionObserver {
  onStart?(): AbortSignal | undefined;
  onSettle?(
    outcome: "compacted" | "cancelled" | "failed",
    error?: unknown,
    stats?: CompactionStats,
  ): void;
}
```

- `onStart()`: Called once when compaction begins. Return an `AbortSignal` to
  allow cancellation, or `undefined` to run without cancellation. It is not
  called when there is nothing to compact, or when an
  [`onPreCompact` hook](./hooks.md#onprecompact) returns `{ veto: true }`. In both cases `runCompaction()` returns
  `{ outcome: "skipped" }` and neither observer method is called.
- `onSettle()`: Called once when compaction terminates. The `stats` argument is
  optional and provided only when `outcome` is `"compacted"`.

The session controller wires its own observer (`src/controller-sessions.ts:52`) to update
internal row state and emit session change events.

---

## How a compaction run works

`runCompaction()` (`src/loop/compaction.ts:122-219`) asks the model for a
summary with `summariseInCachedConversation()`. That function appends one user
message to the same request a live turn would send, with the same tools and
system prompt, so the provider can serve the history from its prompt cache. The
appended message is never stored in the journal
(`src/loop/compaction.ts:60-92`).

The summary request uses the transport's `requestTimeoutMs` deadline, 900000 ms
(15 minutes) by default. Pass `timeoutMs` in the options to change it. When the
timeout expires, the run fails with `Compaction timeout`
(`src/loop/compaction.ts:134`, `src/loop/compaction.ts:170`).

---

## Inspecting dropped context with `ContextManager`

`ContextManager` is exported from `@cuatoi/web-agent-core` (`src/index.ts:16`).
To inspect what was removed by the most recent compaction tombstone, use these two methods:

- `messagesSummarisedByLastTombstone(): number` (`src/loop/context-manager.ts:125-136`):
  Returns the count of journal entries preceding the kept turns that were summarized
  away. Returns `0` if no tombstone exists.
- `toolCallsRedactedByLastTombstone(): number` (`src/loop/context-manager.ts:145-156`):
  Returns the count of `tool_call` content parts in the summarized entries.
  Returns `0` if no tombstone exists.
