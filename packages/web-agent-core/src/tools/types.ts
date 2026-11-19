// Shapes the tool layer declares: the context a tool runs in, what a tool
// definition looks like, and the async tool-provider seam.
import type { z } from "zod";
import type { JsonSchemaObject } from "../types.js";
import type { AttachmentProvider } from "../attachments/types.js";
import type { HookHandler, UserPromptPayload, UserPromptResult } from "../hooks/user-prompt.types.js";
import type { ToolContext, ToolOutcome, PostToolPayload, PostToolResult } from "../tool-hooks.types.js";

export type { SkillDef } from "./skill-def.types.js";
export type { JsonSchemaObject } from "../types.js";
// Declared in `../tool-hooks.types.ts`: they form a type-level recursion with
// `AgentHooks`, so they cannot live here without an import cycle.
export type {
  CompactionRequestOutcome,
  ToolOutcome,
  SchedulerControllerSeam,
  TodoControllerSeam,
  ToolContext,
  AppContext,
} from "../tool-hooks.types.js";

/**
 * Optional host-supplied friendly renderer for a custom tool-call row.
 * Returns SIMPLE inline HTML (`<i>`/`<b>`/`<em>`/`<strong>` only) — the host UI
 * sanitizes it (block-level/script/attributes stripped) before display.
 *  - `input`  : the model-provided tool arguments (same object passed to `execute`).
 *  - `result` : the tool's returned content string (i.e. `ToolOutcome.content`,
 *               surfaced as the audit `outcomeSummary`). Empty while in progress.
 * Sync only. NOTE: a tool that returns `outcome.block` renders as a UI block, not
 * a tool-step row, so its `renderer` never fires — use `renderer` for text-outcome
 * tools. The renderer is not persisted; it is re-applied on session rehydration.
 */
export type ToolRenderer = (input: Record<string, unknown>, result: string) => string;

/** A tool's argument schema: either a zod type or a raw JSON Schema object. */
export type ToolInputSchema = z.ZodType | JsonSchemaObject;

/** What a tool's own `phrase` is given for one finished step. */
export interface ToolStepPhraseInput {
  /** The audit entry's input, as an object. Never null. */
  input: Record<string, unknown>;
  /** The tool's result text. Never empty — an empty summary means the step is
   *  still running and routes to `inProgressPhrase` instead. */
  outcomeSummary: string;
  /** True when the call ended in an error of any kind: the tool returned isError: true,
   *  or the tool threw, or core rejected the call (unparsable arguments, invalid input, unknown tool).
   *  False otherwise. */
  failed: boolean;
}

export interface CustomToolDef {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  promptSnippet?: string;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;
  /** Optional friendly tool-call renderer — see {@link ToolRenderer}. */
  renderer?: ToolRenderer;
  /**
   * Optional readable wording for this call, used as `summary` in the `onPreTool`
   * payload (for example `Click "Add to cart" button`). Sync. A tool without it
   * yields `summary === undefined`.
   */
  summarize?: (input: Record<string, unknown>, ctx: ToolContext) => string;
  /**
   * Keep only the newest `ttl` results of this tool **per argument
   * set**. `snapshot_page({ref:"main"})` and `snapshot_page({ref:"side"})` hold
   * separate windows, so a snapshot of a different element never pushes out a
   * snapshot of this one. `null` or absent means never redacted.
   */
  ttl?: number | null;
  /**
   * A result of this tool lives `uttl` **user** turns. One user
   * message that drives twenty tool calls is one turn. `null` or absent means
   * never redacted.
   *
   * `ttl` and `uttl` are independent tests, not a fallback chain: whichever
   * expires first redacts the result.
   */
  uttl?: number | null;
  /**
   * This tool's own readable step line for the chat thread, in place
   * of the framework package's built-in phrase list. `agent` is the resolved
   * agent label ("tesagent", or "Agent" when the host sets no short name).
   *
   * Sync, and it must not throw. A throw is logged with `console.error` and the
   * built-in fallback chain is used instead, so a broken phrase degrades the
   * wording and never breaks the thread.
   */
  phrase?: (step: ToolStepPhraseInput, agent: string) => string;
  /** The line shown while this tool is still running. Same rules. */
  inProgressPhrase?: (agent: string) => string;
}

/**
 * An async source of tools, loaded **once** at session start.
 *
 * `config.tools` is a synchronous factory, so tools that must be discovered over
 * the network cannot go through it. A provider is the async seam next to it:
 * the host constructs it (e.g. `mcpToolProviders(...)` from
 * `@cuatoi/web-agent-mcp`) and passes it in `SessionConfig.toolProviders`.
 *
 * Providers load at session start. `updateConfig()` with a different
 * `toolProviders` array disposes the loaded providers and loads the new list;
 * the same array loads nothing again.
 */
export interface ToolProvider {
  /** Short id, used in log and error text. */
  name: string;
  /** true → a load failure is a hard startup error. false → logged and skipped. */
  required: boolean;
  /** Called at session start, and again for a new list passed to `updateConfig()`. */
  load(): Promise<CustomToolDef[]>;
  /**
   * Attachment providers this tool provider registers on the composer —
   * e.g. a DOM package's point-at-elements picker. Merged with
   * `SessionConfig.attachmentProviders` once this provider has loaded.
   */
  attachmentProviders?: AttachmentProvider[];
  /** Hook handlers this provider registers on core. */
  hooks?: {
    onUserPrompt?: HookHandler<UserPromptPayload, UserPromptResult | void>;
    onPostTool?: HookHandler<PostToolPayload, PostToolResult | void>;
  };
  /** Called from the session's dispose(). Optional — a stateless provider needs none. */
  dispose?(): Promise<void> | void;
}

export interface ToolProviderFailure {
  provider: ToolProvider;
  error: unknown;
}

export interface LoadToolProvidersResult {
  /** Tools from every provider that loaded, in configured order. */
  tools: CustomToolDef[];
  /** Providers whose load() resolved, so the caller can dispose them. */
  loaded: ToolProvider[];
  /** Every provider that failed (optional ones only — a required failure throws). */
  failures: ToolProviderFailure[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** Prose snippet that the system-prompt builder can insert. */
  promptSnippet: string;
}
