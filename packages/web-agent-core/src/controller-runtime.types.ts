// The mutable state one `createAgentSession()` call owns, gathered into one
// object so the controller's parts can live in separate modules and still
// share exactly the same state. Every field here was a closure variable of
// `createAgentSession` before the split; the comments are the originals.
import type { ContextManager } from "./loop/context-manager.js";
import type { createPageAgent } from "./loop/agent.js";
import type { SessionStore, SessionMeta } from "./loop/session-store.js";
import type { RenderableBlock } from "./ui-blocks/types.js";
import type { AgentConfig } from "./config.js";
import type { ToolContext } from "./tools/build-tools.js";
import type { CustomToolDef } from "./tools/types.js";
import type { SkillDef } from "./tools/skill-def.types.js";
import type { ToolProvider } from "./tools/tool-provider.js";
import type { CommandList } from "./commands/types.js";
import type { CompactionObserver } from "./loop/types.js";
import type { ImageAttachment } from "./utils/types.js";
import type { SchedulerRegistry } from "./scheduler.types.js";
import type { TodoStore } from "./todo.types.js";
import type { TurnResult } from "./loop/run-turn.js";
import type {
  AvailableTool,
  CachedTurnMessages,
  CompactionRow,
  QueuedMessage,
  SessionConfig,
  SessionEvent,
  SessionMessage,
  SessionState,
} from "./controller.types.js";

/** What `driveTurn` calls to run the turn itself. `runUserTurn` passes a
 *  closure over `runTurn`, which appends the user message and opens a NEW turn;
 *  `resumeLastTurn` passes one over `resumeTurn`, which does neither. Every
 *  other concern — the abort controller, the pre-turn compaction, the failure
 *  marker, the flush, the hooks, the queue drain — is identical, so it lives
 *  here once. */
export type TurnInvoker = (
  signal: AbortSignal,
  onStep: () => void,
) => Promise<TurnResult>;

export interface SessionRuntime {
  currentConfig: SessionConfig;
  agentConfig: AgentConfig & { fetch?: typeof fetch };
  sessionStore: SessionStore | undefined;
  cm: ContextManager;
  ctx: ToolContext;
  agent: ReturnType<typeof createPageAgent>;
  providerTools: CustomToolDef[];
  /** The tool list the session was actually given, snapshotted from
   *  `agent.customToolDefs`. Seeded by `initAgent()` (controller-config.ts) at
   *  session construction and every rebuild — including the async re-run once
   *  `toolProviders`/the skill registry finish loading — so a restored session
   *  (a page reload) already reports it before any turn runs. `driveTurn()`
   *  (controller-turn.ts) re-snapshots it at turn start too, in case anything
   *  rebuilt `st.agent` since. This is what lets a saved step line
   *  resolve a tool's own `phrase` without waiting for a new turn. */
  resolvedTools: AvailableTool[];
  /** Providers whose load() resolved, disposed on dispose(). */
  loadedProviders: ToolProvider[];
  /** Skills read from `config.skillRegistry` at session start. Empty when no
   *  registry is configured or its list() failed. */
  registrySkills: SkillDef[];

  activeSessionId: string;
  /** A session change that sends must await before they choose a journal. */
  sessionTransition: Promise<void> | undefined;
  /** Changes when an old turn must stop mutating this session's state. */
  sessionEpoch: number;
  running: boolean;
  queuedMessages: QueuedMessage[];
  error: string | undefined;
  usage: { input: number; output: number };
  sessions: SessionMeta[];
  toolBlocks: Map<string, RenderableBlock>;
  toolBlocksVersion: number;

  turnCache: Map<string, CachedTurnMessages>;
  cachedStateMessages: SessionMessage[] | null;
  cachedStateKey: string;
  cachedContextWindow: { used: number; total: number; percent: number } | null;
  cachedContextWindowUsage: { tokens: number; max: number; percent: number } | null;

  controller: AbortController | undefined;
  flushedJournalLength: number;
  // Highest record sequence this controller has written for `activeSessionId`.
  // Seeded from the store's `lastSeq` when a session is opened or switched to,
  // and advanced by one on every flush. `retryLast()` needs it to name the last
  // good turn without reading the store back mid-flight.
  //
  // One flush writes one record, but one TURN can flush more than once — a turn
  // that also compacts flushes again at the end (controller-turn.ts:170) — so
  // "the last record" is not "the last turn". That is why the rewind reads
  // `lastRecordEntryCount` instead of assuming the turn wrote one record.
  flushedSeq: number;
  /** How many journal entries the LAST record `flushTurn` wrote holds.
   *  `resumeLastTurn` rewinds persistence by exactly this many entries, so the
   *  resumed flush rewrites that one record and nothing earlier. 0 until the
   *  first flush. */
  lastRecordEntryCount: number;
  listeners: Set<(s: SessionState) => void>;
  eventListeners: Set<(e: SessionEvent) => void>;

  compactionRows: CompactionRow[];
  compactionRowSeq: number;
  activeCompactionRowId: string | undefined;
  compactionAbort: AbortController | undefined;
  compacting: boolean;
  /** The resolved command list. Rebuilt by initAgent(), which runs on
   *  every updateConfig() and after the tool-provider and skill-registry loads,
   *  so it is fresh whenever the config changes. Building it here rather than
   *  on every commands() call also means the collision warnings fire once per
   *  rebuild instead of once per keystroke. */
  commandList: CommandList;
  /** Set by ctx._requestCompaction, consumed in driveTurn's
   *  finally. */
  compactionRequested: boolean;
  /** How many UNCONFIRMED compact_conversation calls this turn has
   *  seen. Per-turn: reset unconditionally in driveTurn's finally, so a turn
   *  that only ever asked still starts the next turn clean. */
  compactionUnconfirmedAttempts: number;
  /** The prompt to run in the turn AFTER a successful compaction.
   *  Recorded only on an accepted request, cleared on every path out of the
   *  end-of-turn compaction block, so it can never leak into a later turn. */
  compactionFollowUp: string | undefined;
  compactionObserver: CompactionObserver;

  scheduler: SchedulerRegistry;
  todoStore: TodoStore;

  /** Wired in `createAgentSession`. The turn module needs the queue module and
   *  the queue module needs the turn module, so these two cross the seam
   *  through the runtime rather than through an import cycle. */
  enqueueInput: (
    input: string | { text: string; images?: ImageAttachment[]; userDisplayText?: string; promptMeta?: Record<string, unknown> },
    images?: ImageAttachment[],
    source?: QueuedMessage["source"],
  ) => void;
  maybeDrainQueue: (opts?: { clearStaleError?: boolean }) => Promise<void>;
  /** Rebuild on the active context manager without an import cycle. */
  initAgent: (opts?: { preserveJournal?: boolean }) => void;
}
