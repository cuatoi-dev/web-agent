// The mutually-recursive tool/hook type cluster, co-located in one leaf module.
// `AgentHooks` -> `PreToolPayload` -> `ToolContext` -> `AgentHooks` is a true
// type-level recursion, so these declarations cannot live in separate files
// without an import cycle. `tools/types.ts` and `hooks/types.ts` re-export
// every name below, so no other module needs to import from here.
import type { ConfirmInteractionDetail, ToolImage } from "./types.js";
import type { DataSourceProvider } from "./datasource/types.js";
import type { RenderableBlock } from "./ui-blocks/types.js";
import type { SkillRegistry } from "./skills/types.js";
import type { SkillDef } from "./tools/skill-def.types.js";
import type { TurnResult } from "./loop/types.js";
import type {
  HookEntry,
  UserPromptPayload,
  UserPromptResult,
} from "./hooks/user-prompt.types.js";

/** What the controller decided about one `compact_conversation` call. */
export type CompactionRequestOutcome =
  | "needs-confirmation"  // nobody has said the user or a skill asked
  | "unconfirmed-repeat"  // asked again in the same turn, still unconfirmed
  | "requested"           // accepted; runs when this turn ends
  | "already-requested"   // this turn has already asked
  | "nothing-to-compact"  // no eligible turns
  | "in-progress";        // a compaction is already running

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Images for the model, from any tool. `wrapExecutor`
   *  (tools/build-tools.ts) downscales each one with `downscaleToolImage`, and
   *  the loop sends all of them on the next step. */
  images?: ToolImage[];
  block?: RenderableBlock;
}

export interface SchedulerControllerSeam {
  setSchedule(input: Record<string, unknown>): { content: string; isError?: boolean };
  listSchedules(): { content: string; isError?: boolean };
  cancelSchedule(name?: unknown): { content: string; isError?: boolean };
}

export interface TodoControllerSeam {
  write(input: Record<string, unknown>): { content: string; isError?: boolean };
  read(): { content: string; isError?: boolean };
  items(): import("./todo.types.js").TodoItem[];
}

export interface ToolContext {
  dataSource?: DataSourceProvider;
  app: AppContext;
  signal: AbortSignal;
  imageInput?: boolean;
  skills?: SkillDef[];
  _onToolBlock?: (toolCallId: string, block: RenderableBlock) => void;
  /** Lifecycle hooks, assigned by `createPageAgent` from `AgentConfig.hooks`. */
  hooks?: AgentHooks;
  /** Maximum characters for a serialized query_data result. Propagated from
   *  `AgentConfig.queryResultMaxChars`; defaults to 6000 when unset. */
  queryResultMaxChars?: number;
  /** A source with MORE fields than this needs an explicit `select` on a row
   *  query. Propagated from `AgentConfig.wideSourceFieldThreshold`; defaults
   *  to DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD (40) when unset. */
  wideSourceFieldThreshold?: number;
  /** The host's configured skill registry, propagated from
   *  `AgentConfig.skillRegistry`. `create_skill` (tools/skill-tools.ts) is offered
   *  only when this exposes a `save` method, and `delete_skill` only when it
   *  exposes a `remove` method. */
  skillRegistry?: SkillRegistry;
  /** Confirmation gate for a sensitive action, propagated from
   *  `AgentConfig.confirmInteraction`. `create_skill` and `delete_skill` call
   *  this before writing to `skillRegistry`, the same seam `domTools()` uses for
   *  "ask"-tier DOM interactions. */
  confirmInteraction?: (detail: ConfirmInteractionDetail) => Promise<boolean>;
  /** Ask the controller to compact once the current turn ends. Assigned in
   *  `initAgent()` (controller-config.ts), in the same style as `_onToolBlock`.
   *  Absent when no controller owns this context (a bare `createPageAgent`
   *  caller, or a unit test), and `compact_conversation` then reports that
   *  compaction is unavailable.
   *
   *  `confirmed` is true only when the model said the user or a skill asked
   *  for this. `followUp` is the prompt to run in the next turn, once the
   *  context has been compacted; it is recorded ONLY on an accepted request.
   *  The controller returns the verdict because it is the only place that can
   *  see all four conditions — see `CompactionRequestOutcome`. */
  _requestCompaction?: (
    confirmed: boolean,
    followUp?: string,
  ) => CompactionRequestOutcome;
  /** Session-owned scheduler seam for set_schedule, list_schedules, and
   *  cancel_schedule. Absent when scheduling is not configured or disabled. */
  _scheduler?: SchedulerControllerSeam;
  /** Session-owned todo tracking seam. Absent when todo is not configured or disabled. */
  _todos?: TodoControllerSeam;
  /**
   * The id of the chat this tool call belongs to. A tool keys
   * per-chat state on it — the VFS read-before-write tracker is the first.
   *
   * Assigned in `initAgent()` (controller-config.ts) as a GETTER over
   * `st.activeSessionId`, because `switchSession()` changes the active chat
   * without rebuilding `st.ctx`. Creating a chat rebuilds the agent and context
   * on its new context manager. `wrapExecutor` copies the context
   * per call with a spread (tools/build-tools.ts:76-79), which reads the
   * getter then, so a tool always sees the chat that is active now.
   *
   * Absent when no controller owns this context (a bare `createPageAgent`
   * caller, or a unit test).
   */
  readonly sessionId?: string;
};

export interface AppContext {
  appName?: string;
  appDescription?: string;
  appInstructions?: string;
  route?: string;
  /** Host-supplied display name for the current user, e.g. "Alex". */
  userName?: string;
  /**
   * Freestyle background info about the current user (e.g. preferences).
   * Treated as data, not instructions, in the prompt. Keep it short —
   * under ~200 characters — it's re-sent on every turn.
   */
  userInfo?: string;
}

// --- onPreTool ---------------------------------------------------------
export interface PreToolPayload {
  name: string;
  /** The input as composed so far — a later handler sees an earlier one's `modifiedInput`. */
  input: Record<string, unknown>;
  /** Readable wording from the tool's own `summarize()`. Undefined when the tool has none. */
  summary?: string;
  ctx: ToolContext;
}
export interface PreToolResult {
  decision?: "allow" | "deny" | "ask";
  /** Sent to the model as the tool outcome when `decision` is "deny". */
  reason?: string;
  modifiedInput?: Record<string, unknown>;
}
// --- onPostTool --------------------------------------------------------
export interface PostToolPayload {
  name: string;
  toolCallId?: string;
  /** The input the tool actually ran with (after any `modifiedInput`). */
  input: Record<string, unknown>;
  outcome: ToolOutcome;
}
export interface PostToolResult { outcome?: ToolOutcome; }

// --- observe-only / veto ----------------------------------------------
export interface TurnEndPayload { result: TurnResult; stopReason: TurnResult["stopReason"]; }
/** `percent` is a 0–1 fraction, the same value as `SessionState.contextWindow.percent`. */
export interface PreCompactPayload { tokens: number; percent: number; }
export interface PreCompactResult { veto?: boolean; }
export interface PostCompactPayload { tokensBefore: number; tokensAfter: number; }
export interface SessionStartPayload { sessionId: string; }

/** The seven events. Exactly these — no more, no fewer. */
export interface AgentHooks {
  onPreTool?: HookEntry<PreToolPayload, PreToolResult | void>;
  onPostTool?: HookEntry<PostToolPayload, PostToolResult | void>;
  onUserPrompt?: HookEntry<UserPromptPayload, UserPromptResult | void>;
  onTurnEnd?: HookEntry<TurnEndPayload, void>;
  onPreCompact?: HookEntry<PreCompactPayload, PreCompactResult | void>;
  onPostCompact?: HookEntry<PostCompactPayload, void>;
  onSessionStart?: HookEntry<SessionStartPayload, void>;
}
