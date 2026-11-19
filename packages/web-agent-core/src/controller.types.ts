// The session controller's public surface: what a session holds, what it
// emits, and how a host configures it.
import type { MessagePart } from "./types.js";
import type { RenderableBlock } from "./ui-blocks/types.js";
import type { AuditEntry, CompactionStats, SessionMeta } from "./loop/types.js";
import type { ImageAttachment } from "./utils/types.js";
import type { AgentConfig } from "./config.types.js";
import type { SourceEntry } from "./datasource/types.js";
import type { CommandEntry } from "./commands/types.js";
import type { AttachmentProvider } from "./attachments/types.js";
import type { TodoItem } from "./todo.types.js";
import type { ToolStepPhraseInput } from "./tools/types.js";

/** The four states of the transcript's compaction row. */
export type CompactionRowStatus = "running" | "done" | "cancelled" | "failed";

/** One entry of the tool list the agent was actually given for a turn.
 *  The debug view displays `name` and `description`; it never calls the tool.
 *  The two optional phrase functions are how a tool loaded
 *  through `toolProviders` gets its own readable step line into the thread —
 *  provider tools never pass through the host's `tools` array. */
export interface AvailableTool {
  name: string;
  description: string;
  phrase?: (step: ToolStepPhraseInput, agent: string) => string;
  inProgressPhrase?: (agent: string) => string;
}

export interface SessionMessagePart {
  kind: "text" | "block" | "tool" | "compaction";
  text?: string;
  block?: RenderableBlock;
  /** Present for kind: "tool" — the compact record of the tool call this step ran. */
  audit?: AuditEntry;
  /** Present for kind: "compaction" — one compaction run and how it ended. */
  compaction?: { status: CompactionRowStatus; stats?: CompactionStats };
}

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  text?: string;
  images?: { dataUrl: string; mediaType: string }[];
  parts?: SessionMessagePart[];
  blocks?: RenderableBlock[];
  trace?: AuditEntry[];
  disabled?: boolean;
  failed?: { message: string; retryable: boolean };
  /** The turn completed and carried no content at all. NOT a failure —
   *  the model ended its turn with nothing. Rendered as a neutral notice,
   *  never as the red error state. Mutually exclusive with `failed`. */
  notice?: { message: string; retryable: boolean };
  /** True while this assistant message's turn is still running (awaiting
   * more steps). Used by the UI to show the mid-turn "working" placeholder. */
  pending?: boolean;
  /** Opaque object from an `onUserPrompt` handler. Core never inspects it. */
  promptMeta?: Record<string, unknown>;
}

export interface QueuedMessage {
  id: string;
  text: string;
  images?: ImageAttachment[];
  userDisplayText?: string;
  promptMeta?: Record<string, unknown>;
  /** Present when this item is a slash command typed while a turn
   *  was running. `text` still carries what the user typed, so the existing
   *  queued-message chip renders unchanged. */
  command?: { name: string; argument: string };
  /** Who put this item in the queue. Present only for a schedule
   *  tick; ABSENT for anything a user typed, which is what keeps a user's
   *  message out of the coalesce. A schedule that fires while its own
   *  previous message is still undelivered replaces that message, matched on
   *  `source.name`, so one schedule can never stack. */
  source?: { kind: "schedule"; name: string };
}

export interface SessionState {
  messages: SessionMessage[];
  sessions: SessionMeta[];
  activeSessionId: string;
  running: boolean;
  /** True while a compaction (automatic or manual) is in flight. Separate
   *  from `running`: an automatic compaction runs after the turn ends, when
   *  `running` is already false. */
  compacting: boolean;
  /** True when there is at least one eligible turn to compact. Drives the
   *  compaction button in the UI. */
  canCompact: boolean;
  error?: string;
  usage: { input: number; output: number };
  contextWindow: { used: number; total: number; percent: number };
  queuedMessages: QueuedMessage[];
  /** The active model id. Mirrors the agent's live model. */
  model: string;
  /** Id of the turn currently in flight (undefined when idle). Lets the
   * UI attach a mid-turn "working" indicator to the right turn. */
  inProgressTurnId?: string;
}

export interface SessionConfig extends Partial<AgentConfig> {
  appContext?: {
    appName?: string;
    appDescription?: string;
    /** Per-agent system prompt. Rendered as the `# App instructions` section
     *  by `buildSystemPromptParts` (prompt/system-prompt.ts:121). This field
     *  was missing from this declaration AND from the literal `initAgent()`
     *  builds, so a host could not type it and the value never reached the
     *  model. */
    appInstructions?: string;
    userName?: string;
    userInfo?: string;
  };
  // getState's return is genuinely unknown — a host's real store shape is
  // opaque to core (mirrors @cuatoi/web-agent-lit's HostStore.getState).
  // Wider than the plan's original `() => Record<string, unknown>` because
  // that shape broke web-agent-lit's `buildSessionConfig()`, which passes its
  // own `HostStore` straight through; the narrower Record type is enforced at
  // the one place core actually needs it (initAgent's createDataSourceProvider
  // call), not on the public config surface.
  store?: { getState?: () => unknown };
  sources?: SourceEntry[];
  fetch?: typeof fetch;
  /** Host opt-in for session-owned scheduler. When absent or enabled is false,
   *  scheduler tools report unavailable and no timers are armed. */
  scheduler?: { enabled: boolean };
  /** Host opt-in for session-owned todo tracking. When absent or enabled is
   *  false, todo tools report unavailable. */
  todo?: { enabled: boolean };
  /** How many rendered rows the chat panel keeps in the DOM. A user
   *  bubble is one row, an assistant text bubble is one row, and each tool
   *  chip is one row. The panel reads it; core never does. */
  messageWindow?: number;
}

export type SessionEvent =
  | { type: "retry:start" }
  | { type: "retry:success" }
  | { type: "retry:failure"; error: { message: string; retryable: boolean } }
  | { type: "auto-retry:attempt"; attempt: number; maxRetries: number; error: { message: string } }
  /** One chain call fell back. `answered` is absent when every entry failed. */
  | {
      type: "provider:fallback";
      failed: { provider: string; model: string; message: string }[];
      answered?: { provider: string; model: string };
    };

export interface AgentSession {
  getState(): SessionState;
  subscribe(listener: (s: SessionState) => void): () => void;
  subscribeEvents(listener: (e: SessionEvent) => void): () => void;
  send(parts: MessagePart[], opts?: { userDisplayText?: string }): Promise<void>;
  retryLast(): Promise<void>;
  abort(): void;
  compact(): Promise<void>;
  reset(): Promise<void>;
  createSession(): Promise<void>;
  switchSession(id: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  clearAllSessions(): Promise<void>;
  setTitle(id: string, t: string): Promise<void>;
  refreshSessions(): Promise<void>;
  updateConfig(patch: Partial<SessionConfig>): void;
  /**
   * Swap the active model at runtime for the NEXT turn, without resetting the
   * conversation (does NOT re-init the ContextManager/agent). Per-session only.
   */
  setModel(id: string): void;
  dispose(): void;
  initPromise: Promise<void>;
  autoTitle(): Promise<void>;
  cancelQueued(id: string): void;
  popLastQueued(): { text: string; images?: ImageAttachment[] } | undefined;
  clearQueue(): void;
  /** The resolved user-facing command list: host skills marked
   *  `command: true`, then core's own actions, whose names a skill cannot
   *  claim. Rebuilt whenever the config changes. */
  commands(): CommandEntry[];
  /** Resolve one typed name (case-insensitive, aliases included). */
  resolveCommand(typedName: string): CommandEntry | undefined;
  /** Queue a command typed while a turn is running. It drains in order, as a
   *  command and never as prompt text. `text` is what the user typed and is
   *  what the queued-message chip shows. `source` is set only by the
   *  scheduler; a caller that omits it queues an ordinary user
   *  message that is never coalesced. */
  enqueueCommand(
    name: string,
    argument: string,
    text: string,
    source?: QueuedMessage["source"],
  ): void;
  /** Run one resolved entry. `ran` is false when an action could not act (the
   *  caller shows `entry.unavailableMessage`); `startedTurn` says whether a
   *  model turn was started, so a queue drain knows whether to continue
   *  itself. */
  runCommand(
    entry: CommandEntry,
    argument: string,
  ): Promise<{ ran: boolean; startedTurn: boolean }>;
  /** Returns current count of active schedules and reminders (excluding spent entries). */
  pendingCounts(): { schedules: number; reminders: number; total: number };
  /** Returns the current list of todos for the active session. */
  todos(): TodoItem[];
  /** Registered attachment providers, in registration order. The binding renders these. */
  getAttachmentProviders(): AttachmentProvider[];
  /**
   * The tool list the agent was actually given for the most recent
   * turn, as name/description pairs, in the order the model sees them.
   *
   * Resolved by `createPageAgent()` from the real `ToolContext` (every seam
   * present: `_scheduler`, `skillRegistry`, `dataSource`, `_requestCompaction`),
   * so it includes tool-provider tools and `create_skill` / `delete_skill`
   * whenever the live session offers them. Only core can see all of that, which is why this
   * exists: a caller that rebuilds a context to guess the list gets a
   * different answer from the one the model got.
   *
   * `[]` before the first turn — there is no turn to describe yet.
   *
   * Read-only: a fresh array of fresh objects each call, so mutating the
   * result changes nothing the session holds.
   */
  availableTools(): AvailableTool[];
}

/** One turn's rendered messages, cached by turn id inside `createAgentSession`. */
export interface CachedTurnMessages {
  isCompleted: boolean;
  userMessage?: SessionMessage;
  completedAssistantMessage?: SessionMessage;
  journalLength: number;
  compactionKey: string;
  toolBlocksVersion: number;
  failed?: { message: string; retryable: boolean };
}

/** One compaction run's transcript row, held by `createAgentSession`. */
export interface CompactionRow {
  id: string;
  /** The last journal turn id when the run started; the row renders after it. */
  afterTurnId: string;
  status: CompactionRowStatus;
  stats?: CompactionStats;
}
