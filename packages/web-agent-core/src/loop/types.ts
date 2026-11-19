// Shapes the agent loop declares: the journal, the session store, and what a
// turn or a compaction run reports.
import type { ModelMessage, ToolImage } from "../types.js";
import type { AgentError } from "./errors.js";
import type { TodoItem } from "../todo.types.js";

export interface SessionMeta {
  id: string;
  title: string;
  titleManual: boolean; // true when user has explicitly named the session
  createdAt: number;    // Unix ms
  updatedAt: number;    // Unix ms
  messageCount: number;
  todos?: TodoItem[];
  /** Highest record sequence written for this session. Absent until the first
   *  record is appended, which is why every reader uses `?? 0`. */
  lastSeq?: number;
}

/** Which slice of a session's records to read. */
export interface SessionRecordRange {
  /** Highest sequence to read, inclusive. Omit to start at the session's last
   *  record. Pass a previous page's `cursor` to continue backwards. */
  before?: number;
  /** How many records to return. Must be 1 or more. */
  limit: number;
}

/** One page of session records. */
export interface SessionRecordPage {
  /** Oldest-first — the order `reconstructState` needs. */
  records: unknown[];
  /** Highest sequence still unread, or absent when the session start was
   *  reached. Pass it back as `before` to read the next older page. */
  cursor?: number;
}

export interface SessionStore {
  createSession(meta: SessionMeta): Promise<void>;
  appendRecords(sessionId: string, records: unknown[]): Promise<void>;
  readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage>;
  truncateAfter(sessionId: string, seq: number): Promise<void>;
  saveMeta(sessionId: string, meta: Partial<SessionMeta>): Promise<void>;
  loadAllMetadata(): Promise<SessionMeta[]>;
  deleteByIds(ids: string[]): Promise<void>;
}

export interface TurnFlushRecord {
  _kind: "turn_flush";
  journalDelta: JournalEntry[];
  audit: AuditEntry[];
}

// The generate() result's steps only ever carry inputTokens/outputTokens, but
// different providers have historically filled promptTokens/completionTokens
// instead; this shape lets the ?? fallbacks in `run-turn.ts` keep reading both
// without widening `result`'s real return type.
export interface UsageLike {
  inputTokens?: number;
  promptTokens?: number;
  outputTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface TurnResult {
  assistantText: string;
  blocks: unknown[];
  stopReason: "end_turn" | "max_iterations" | "aborted" | "error";
  error?: AgentError;
  usage?: { input: number; output: number };
}

export interface StepToolResult {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  failed?: boolean;
  /** True when the tool had no executor: the model called a tool that was
   *  never offered. Core answered `Unknown tool: <name>`; the call never ran.
   *  Lets the message builder omit the step line for a call that never
   *  happened. */
  unknownTool?: boolean;
}

export type PartKind =
  | "user_prose"
  | "ui_action"
  | "assistant_prose"
  | "assistant_ui_block"
  | "tool_call"
  | "tool_result_snapshot"
  | "tool_result_query"
  | "tool_result_action"
  | "tool_result_wait"
  | "summary_stub";

export interface JournalEntry {
  msg: ModelMessage;            // verbatim
  meta: {
    turnId: string;            // one user turn = one id
    stepNo: number;            // step index within the turn
    kinds: PartKind[];         // per content part (P0)
    chars: number;             // serialized length (token proxy)
    toolName?: string;         // for tool parts
    generation?: number;       // for snapshot/query results
    createdAt: number;
    /** The 1-based ordinal of the user turn this entry belongs to.
     *  `uttl` measures age in these. Absent on entries written by older versions,
     *  which the sweep therefore treats as "same turn as now" and never expires
     *  by age. */
    userTurn?: number;
    failed?: { message: string; retryable: boolean };
    /** User's typed prose before prompt-hook overrides or block formatting. */
    userDisplayText?: string;
    /** Opaque object returned by an `onUserPrompt` handler. Persisted and
     *  handed back to the UI verbatim — core never inspects its contents. */
    promptMeta?: Record<string, unknown>;
    /** Present ONLY on a compaction tombstone. Its `summary` replaces
     *  everything before this entry when the context is rebuilt. `createdAt`
     *  above is the tombstone's timestamp. An entry without this field is an
     *  ordinary journal entry. */
    tombstone?: { summary: string };
    /** On a role "tool" entry only — the images each tool call in this
     *  message returned, keyed by toolCallId. Written once, by
     *  `ContextManager.recordStep`. Never sent to the model. */
    toolImages?: Record<string, ToolImage[]>;
  };
}

/** The only part of a tool definition the context manager reads.
 *  `CustomToolDef` satisfies it structurally. */
export interface ToolTtlPolicy {
  name: string;
  ttl?: number | null;
  uttl?: number | null;
}

export interface AuditEntry {
  ts: number;
  name: string;
  input: unknown;
  outcomeSummary: string;
  failed?: boolean;
  /** Mirrors StepToolResult.unknownTool. The trace keeps the entry as an
   *  honest record; the rendered step line is omitted for it. */
  unknownTool?: boolean;
  /** The images this call returned. Filled IN MEMORY by
   *  `buildSessionMessages` (controller-messages.ts) from the tool entry's
   *  `meta.toolImages`; never persisted on the audit list. */
  images?: ToolImage[];
}

/** How a compaction run ended. `skipped` = there was nothing to compact, or a
 *  hook vetoed it; no row is created for it. */
export type CompactionOutcome = "compacted" | "skipped" | "cancelled" | "failed";

export interface CompactionResult {
  outcome: CompactionOutcome;
  /** Present only when `outcome` is "failed". */
  error?: unknown;
}

export interface CompactionStats {
  tokensBefore: number;
  tokensAfter: number;
  /** Non-tombstone journal entries before this run's tombstone is appended. */
  messagesBefore: number;
  /** `messagesBefore` minus what the rebuild dropped — what remains kept. */
  messagesAfter: number;
  /** Tool-call parts among the dropped entries — calls the rebuild stopped sending. */
  toolCallsRedacted: number;
  /** Wall time of the run, from the point it is certain to happen (after the
   *  veto check) to settle. */
  durationMs: number;
}

/** How a caller observes and cancels a compaction run. */
export interface CompactionObserver {
  /** Called once, when a run actually starts (after the veto check). Return an
   *  AbortSignal to make the run cancellable, or undefined for no cancel. */
  onStart?(): AbortSignal | undefined;
  /** Called once with the terminal outcome. Never called for "skipped". */
  onSettle?(
    outcome: "compacted" | "cancelled" | "failed",
    error?: unknown,
    stats?: CompactionStats,
  ): void;
}
