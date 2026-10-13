// The host-facing agent configuration.
import type { ConfirmInteractionDetail } from "./types.js";
import type { SessionStore } from "./loop/types.js";
import type { CustomToolDef, ToolContext, ToolProvider } from "./tools/types.js";
import type { SkillDef } from "./tools/skill-def.types.js";
import type { SkillRegistry } from "./skills/types.js";
import type { AttachmentProvider } from "./attachments/types.js";
import type { AgentHooks } from "./hooks/types.js";
import type { ProviderFallbackNotice } from "./transport/fallback-provider.types.js";

export interface ContextConfig {
  kTurnsVerbatim: number;
  contextLength: number;
  autoCompactPercent: number;
  charsPerToken: number;
  jsonOverhead: number;
  compactionMaxTokens: number;
  mode?: "assert" | "warn";
}

export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  maxRetries?: number;
}

/** Kinds of adapter actions that can be cued visually by the agent cursor. */
export type CueKind = "click" | "fill" | "select" | "see";

/** Host-configurable agent-cursor behavior. */
export interface CuesConfig {
  /** Master on/off for the agent cursor (was mode: "off"). Default true. */
  enabled?: boolean;
  /** Cursor travel + typing pace (replaces speedMs/dwellMs/"demo"|"instant"). */
  speed?: "slow" | "fast";
}

export interface SpeedPreset { travelPxPerSec: number; msPerWord: number; }

export interface ImageConfig {
  /** Longest edge in px. Images wider/taller are scaled down. Default 1024. */
  maxDimension?: number;
  /** Max encoded byte size after downscaling (bytes). Default 524288 (512 KB). */
  maxBytes?: number;
  /** JPEG/WebP re-encode quality 0–1. Default 0.82. */
  quality?: number;
}

/** A user-selectable model entry for the runtime model switcher (067). */
export interface ModelOption {
  /** Backend model id sent on the wire (e.g. "m"). */
  id: string;
  /** Friendly display label (e.g. "Leo"). Falls back to `id` when omitted. */
  label?: string;
}

export interface AgentConfig {
  baseURL: string;
  model: string;
  /**
   * Custom `fetch` implementation for outgoing model provider requests.
   * Allows hosts to intercept requests (e.g. to inject auth headers).
   */
  fetch?: typeof fetch;
  maxIterations: number;
  turnTimeoutMs: number;
  queryResultMaxChars: number;
  /**
   * A source with MORE fields than this is "wide": a row query against it
   * must name the columns it wants in `select`, or query_data answers with
   * an error instead of rows. Aggregate queries are never affected.
   * Default DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD (40).
   */
  wideSourceFieldThreshold: number;
  context: ContextConfig;
  persist: boolean;
  /** Endpoint type: "anthropic" (default), "openai", "gemini", "mock", or a custom string registered via `providerRegistry`. */
  endpointType: "openai" | "anthropic" | "gemini" | "mock" | (string & {});
  /** Thinking config (anthropic endpoint only; openai ignores it). */
  thinking: { enabled: boolean; budgetTokens?: number };
  /** Model generation settings: sampling, output limit, stop sequences and retries. */
  generation: GenerationConfig;
  /** Extra instructions appended to the built system prompt. */
  appendSystemPrompt?: string;
  /** Guidelines for the generated UI blocks. */
  blockGuidelines?: string;
  /** Agent-cursor cues config. Optional; defaults to `{ enabled: true, speed: "slow" }`. */
  cues?: CuesConfig;
  /**
   * Host capability toggle. When false, hides image attach UI, disables
   * paste/drag ingest, and omits the `see` tool and its prompt snippet.
   * Default true.
   */
  imageInput?: boolean;
  /**
   * Host-supplied list of user-selectable models for the runtime model switcher
   * (067-ui). UI-only metadata — the transport ignores it; the active model is
   * `model`. When fewer than 2 entries, 067-ui hides the switcher.
   */
  models?: ModelOption[];
  /**
   * Host-supplied tool composition. Returns the FULL explicit tool-def list for
   * a turn (spread the exported builders, e.g. `[...defaultTools(ctx), myTool]`).
   * When unset, core uses `defaultTools` (the pre-refactor built-in toolset).
   */
  tools?: (ctx: ToolContext) => CustomToolDef[];
  /** Host-supplied skill composition. Default coreSkills(). */
  skills?: SkillDef[];
  /**
   * Async skill source, read **once** at session start. Its skills are merged
   * over `skills` (or over `coreSkills()` when `skills` is unset) and reach
   * `ctx.skills` and the `# Skills` prompt section before turn 1.
   *
   * **On a name clash the registry entry wins** and replaces the `skills` one,
   * so the merged list holds exactly one entry per name.
   *
   * A registry whose `list()` rejects is logged and contributes no skills — it
   * never fails the session. Reading happens **once**: assigning this after the
   * session exists does not load anything.
   */
  skillRegistry?: SkillRegistry;
  /**
   * Confirmation gate for a sensitive action — `create_skill` and
   * `delete_skill` (tools/skill-tools.ts), which call this before writing to
   * `skillRegistry`. Returns `true` to proceed, `false` to block. The same seam
   * `domTools()` uses for "ask"-tier DOM interactions (wire the same host
   * function to both). A host that omits this leaves both tools unconfirmed,
   * matching how an unwired `domTools()` leaves "ask"-tier elements
   * unconfirmed.
   */
  confirmInteraction?: (detail: ConfirmInteractionDetail) => Promise<boolean>;
  /**
   * Async tool providers, loaded **once** at session start. Each provider names
   * itself, declares whether it is `required`, and returns tool defs from
   * `load()`. Every provider is loaded **concurrently** and its tools are
   * appended after whatever `tools` produced.
   *
   * A provider with `required: true` that fails to load is a hard startup error
   * (the session's `initPromise` rejects and `state.error` is set). A provider
   * with `required: false` that fails is logged and contributes no tools.
   *
   * Loading happens at session start. Assigning a different array later (through
   * `updateConfig()`) disposes the loaded providers and loads the new ones; the
   * conversation is kept.
   */
  toolProviders?: ToolProvider[];
  /**
   * Attachment providers, in registration order. The framework binding renders
   * one composer icon per entry; core merges each provider's `onUserPrompt`
   * handler AHEAD of the host's own handlers so a provider can contribute
   * `MessagePart[]` and chips. Core never inspects what an attachment means.
   */
  attachmentProviders?: AttachmentProvider[];
  /**
   * Lifecycle hooks. Each event takes one handler or an array of handlers, run in
   * registration order and awaited inline with NO timeout. See {@link AgentHooks}.
   */
  hooks?: AgentHooks;
  /**
   * When true, requests `stream: true` and reassembles the SSE stream instead of one JSON response.
   * Required for gateways that only return valid Anthropic format over SSE.
   * Default false (non-streaming) so existing hosts are unaffected.
   */
  streaming?: boolean;
  /**
   * Per-attempt idle timeout (ms) applied by the withRetry transport
   * middleware. The window restarts every time the transport receives bytes,
   * including server-sent-events keep-alive comments, so a slow but live
   * stream is never aborted. An attempt that receives nothing for this long
   * is aborted and (if retries remain) retried. On the non-streaming path no
   * bytes arrive until the response is complete, so there the window is
   * effectively a total deadline. Default 300000 (5 minutes).
   */
  requestTimeoutMs?: number;
  /**
   * Per-chunk stream idle timeout (ms), applied by the withRetry transport
   * middleware (and the fallback-chain provider) once a stream's first
   * content part has arrived. The window restarts every time a further
   * content part arrives, so a slow but steady stream is never aborted; a
   * stream that goes silent mid-flight for this long is treated as a
   * retryable failure and goes through the same retry/backoff as any other
   * transport error. Default 120000 (2 minutes).
   */
  streamIdleTimeoutMs?: number;
  /**
   * Max transport-level retries (withRetry middleware) for empty/dead streams
   * and transient network/parse failures. Default 5. Deterministic client
   * errors (400/401/403) and user aborts are never retried.
   */
  maxRetries?: number;
  /**
   * Called just before the withRetry transport middleware sleeps ahead of a
   * retry attempt. `attempt` is 1-based (1..maxRetries); `error` is the
   * classified failure that triggered the retry.
   */
  onRetryAttempt?: (attempt: number, maxRetries: number, error: unknown) => void;
  /**
   * Called by the fallback-chain provider when one chain call had at least one
   * entry fail. Core sets this internally (see controller-config.ts) so the notice
   * reaches the session's event stream; a host value is overwritten, exactly
   * as `onRetryAttempt` already is.
   */
  onProviderFallback?: (
    notice: ProviderFallbackNotice,
  ) => void;
  /**
   * Host-swappable session persistence seam. When set and `persist` is true,
   * core calls createSession/appendRecords/saveMeta on this store instead of
   * the default `IdbSessionStore`. Ignored when `persist` is false.
   * Default: undefined, which means core uses `IdbSessionStore` when
   * `persist` is true.
   */
  sessionStore?: SessionStore;
  /**
   * Namespace for the default IdbSessionStore. When set, sessions are stored in
   * a separate IndexedDB DB ("web-agent-<namespace>") isolated from other hosts
   * sharing the same origin. Ignored when `sessionStore` is supplied by the host.
   */
  sessionNamespace?: string;
}
