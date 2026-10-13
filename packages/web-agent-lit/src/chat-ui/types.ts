import type {
  RenderableBlock,
  AuditEntry,
  AvailableTool,
  CommandEntry,
  CompactionRowStatus,
  CompactionStats,
  CueKind,
} from "@cuatoi/web-agent-core";

/**
 * An ordered, renderable piece of an assistant message.
 * - `text` carries raw markdown for prose.
 * - `block` carries a UI block (button grid, chart, form, ...).
 * - `tool` carries a compact record of one tool call (name + outcome), rendered
 *   inline between text segments as a lightweight step row.
 * - `compaction` records one context-compaction run and how it ended.
 */
export type MessagePart =
  | { kind: "text"; text: string; html?: string }
  | { kind: "block"; block: RenderableBlock }
  | { kind: "tool"; audit: AuditEntry }
  | { kind: "compaction"; compaction: { status: CompactionRowStatus; stats?: CompactionStats } };
/** The public shape of the agent cursor overlay owned by `agent-cursor.ts`. */
export interface AgentCursor {
  moveTo(point: { x: number; y: number }, speed?: "slow" | "fast"): Promise<void>;
  clickPulse(): void;
  flash(rect: { x: number; y: number; width: number; height: number }): void;
  show(): void;
  hide(): void;
  reset(): void;
  clear(): void;
  /** clear(), then take the layer itself off the page. The next cue rebuilds
   *  it — ensureElements() already handles a detached layer. */
  destroy(): void;
}

/** Await-able hook fired before a synthetic DOM action. Structurally
 *  identical to `@cuatoi/web-agent-dom`'s `ActionCueFn`; declared here so
 *  this framework package does not depend on the feature package (007). */
export type ActionCueFn = (
  el: Element | undefined,
  kind: CueKind,
  detail?: {
    value?: string;
    speedMs?: number;
    point?: { x: number; y: number };
    rect?: { x: number; y: number; width: number; height: number };
  },
  signal?: AbortSignal,
) => Promise<void>;

/** What `createActionCue` needs from the panel that owns the cursor. */
export interface CueActionDeps {
  getCursor: () => AgentCursor;
  speed: () => "slow" | "fast";
}

/** Detail shown by the confirm scrim. `summary` (from `CustomToolDef.summarize`)
 *  is preferred when present; falls back to the raw action/name/ref wording. */
export interface ConfirmScrimDetail {
  action?: string;
  name?: string;
  ref?: string;
  reason?: string;
  summary?: string;
  /** The dialog heading. Absent → `Confirm action`. */
  title?: string;
  /** The body, as plain text. Absent → the `Agent wants to …` sentence. */
  message?: string;
  /** The confirm button text. Absent → `Allow`. */
  confirmLabel?: string;
  /** The cancel button text. Absent → `Reject`. */
  cancelLabel?: string;
  /** Whether the action is destructive (renders danger button variant). */
  danger?: boolean;
}

/** Context passed to a panel screen's render function. */
export interface PanelScreenContext {
  close(): void;
  confirm(detail: ConfirmScrimDetail): Promise<boolean>;
}

/** A host or feature package screen plugged into `<agent-chat-panel>`. */
export interface PanelScreen {
  id: string;
  label: string;
  render(ctx: PanelScreenContext): HTMLElement;
}

/** The host's state container. `web-agent-lit` only ever calls `getState()`
 *  on it (see `_ensureReadOnlyDataSource`). Core declares
 *  `SessionConfig.store` inline as `{ getState?: () => unknown }`
 *  (`web-agent-core/src/controller.types.ts:113`) and exports no named type, so the shape the panel actually depends on is
 *  declared here. The index signature is deliberate: hosts pass real state
 *  containers (Redux stores, custom stores) with members this panel never
 *  reads (`subscribe`, `dispatch`, …) — accept them without an excess-property
 *  error at every call site across the workspace. */
export interface HostStore {
  getState?: () => unknown;
  [key: string]: unknown;
}

/** Host-supplied application context, forwarded to core's system prompt.
 *  Mirrors core's own `AppContext` (`web-agent-core/src/tool-hooks.types.ts:97`),
 *  which core does NOT export from its entry point — hence the local copy.
 *  `appInstructions` and `route` were missing from the panel's old inline
 *  declaration even though cat-store and docs-site both set `appInstructions`
 *  and core reads it at `prompt/system-prompt.ts:121`. */
export interface PanelAppContext {
  appName?: string;
  appDescription?: string;
  appInstructions?: string;
  route?: string;
  userName?: string;
  userInfo?: string;
}

/** A registry-produced control the panel enables and disables. The registry
 *  seam (`../ui/types.ts`) declares `button`/`iconButton` as returning
 *  a bare `HTMLElement`, and the panel has always set `.disabled` on the result
 *  through `(el as any).disabled = …`. `disabled?` states that assumption
 *  without changing the seam and without claiming every host registry has it. */
export type DisableableControl = HTMLElement & { disabled?: boolean };

/** One panel menu entry and the action it runs. */
export interface PanelMenuItemDef extends WaMenuItem { run: () => void; }

/** 010 — demo/gallery-only: the message-window state a scripted gallery tile
 *  needs, so `gallery.html` can render the 008/009/010 window states as static
 *  tiles with no live session. `scrollTop` is applied to the real
 *  `.messages-list`, so `_atBottom` — and therefore the jump button — follows
 *  from real geometry rather than from a forced flag. */
export interface DemoWindowState {
  /** Index into `messages` of the first rendered message. */
  windowStart?: number;
  /** Holds the top three-dot loader on screen. */
  loadingOlder?: boolean;
  /** Where to park the list once it has rendered. */
  scrollTop?: number;
}

/** What `renderSlashMenu` draws. */
export interface SlashMenuModel {
  entries: CommandEntry[];
  /** Index into `entries`. Callers keep it in range. */
  highlight: number;
  /** Row ids are `${idPrefix}${index}`, so `aria-activedescendant` can name one. */
  idPrefix: string;
  onPick: (entry: CommandEntry) => void;
}

/** Turns one audit entry into the human phrase shown on a tool step row. */
export type PhraseBuilder = (entry: AuditEntry, agent: string) => string;

/** 124/007: what the thread reads off `session.availableTools()` to render a
 *  tool's own step line. Structurally the two optional fields of
 *  `AvailableTool`, so a host can hand one straight in. */
export type ToolPhraseDef = Pick<AvailableTool, "phrase" | "inProgressPhrase">;

/** 001/113 — what `AgentChatPanel.send()` actually did with the input, so a
 *  host outside the panel can report the truth instead of assuming a message
 *  was posted. `"command"` means a slash command was resolved and handled;
 *  `"message"` means the text went to the model; `"none"` means there was no
 *  session or no bubble to send into. */
export type SendOutcome =
  | { ran: "command"; command: string }
  | { ran: "message" }
  | { ran: "none" };
import type { WaMenuItem } from "../ui/types.js";
