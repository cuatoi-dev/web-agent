import { Component } from "../ui/component.js";
import type {
  AgentSession,
  SessionState,
  SessionMessage,
  SessionEvent,
  SessionConfig,
  AttachmentProvider,
  AgentHooks,
  CuesConfig,
  SourceEntry,
  SkillDef,
  CommandEntry,
  CustomToolDef,
  ToolRenderer,
  DataSourceProvider,
} from "@cuatoi/web-agent-core";
import { BlockRenderer, BlockRendererRegistry } from "../ui-blocks/renderer/types.js";
import { generativeUiRenderer } from "../ui-blocks/renderer/generative-ui-renderer.js";
import { createConfirmScrim } from "./confirm-scrim.js";
import type { HostStore, PanelAppContext, PanelMenuItemDef, SendOutcome } from "./types.js";
import type { WaMenuItem } from "../ui/types.js";

/** 128/003 — numbers each panel, so its attachment buttons get ids that are
 *  unique in a document holding several panels (the side panel holds one
 *  per agent). */
let attachAnchorSeq = 0;

/** Every instance field of `AgentChatPanel`, moved verbatim out of
 *  chat-panel.ts and kept in its original declaration order, so field
 *  initialisers still run in exactly the order they used to.
 *
 *  The panel is assembled as a chain of abstract classes, each holding one
 *  cohesive group of its behaviour. A field is reachable from every class in
 *  that chain, so every field lives here, at the root of the chain, and is
 *  `protected` rather than `private` for the same reason.
 *
 *  The `abstract` declarations at the bottom are the members a class earlier
 *  in the chain calls but a later class implements. */
export abstract class ChatPanelFields extends Component {
  protected _store?: HostStore;
  protected _appContext: PanelAppContext = {};
  protected _agentName?: string;
  protected _agentShortName?: string;
  protected _userAvatar?: string;
  protected _agentAvatar?: string;
  protected _debug?: boolean;
  /** 007: the built-in "ask"-tier confirm dialog. Core no longer resolves
   *  DOM permissions itself (no `ctx.domAdapter`), so this is no longer
   *  auto-wired into `onPreTool` — instead a host passes `confirmInteraction`
   *  (the panel's own method) into `domTools({ confirmInteraction: ... })`, and the DOM
   *  package calls it before an "ask"-tier click/fill/select_option runs. */
  protected _defaultConfirmScrim = createConfirmScrim(this);
  protected _cues?: CuesConfig;
  protected _onCuesChange?: (cues: { speed: "slow" | "fast"; enabled: boolean }) => void;
  protected _path?: string;
  protected _model?: string;
  protected _type?: "openai" | "anthropic" | "gemini" | "mock" | (string & {});
  protected _fetch?: typeof fetch;
  protected _thinking?: boolean;
  protected _images?: { maxDimension?: number; maxBytes?: number; quality?: number };
  protected _imageInput?: boolean;
  protected _hideHeader: boolean = false;
  protected _models?: import("@cuatoi/web-agent-core").ModelOption[];
  protected _selectedModel?: string;
  protected _config?: Partial<SessionConfig>;
  protected _renderers: BlockRenderer[] = [generativeUiRenderer];
  protected _sources?: SourceEntry[];
  protected _tools?: CustomToolDef[];
  protected _toolRenderers?: Map<string, ToolRenderer>;
  protected _skills?: SkillDef[];
  protected _skillRegistry?: import("@cuatoi/web-agent-core").SkillRegistry;
  protected _toolProviders?: import("@cuatoi/web-agent-core").ToolProvider[];
  protected _attachmentProviders?: AttachmentProvider[];
  protected _hooks?: AgentHooks;
  protected _notify?: (msg: string, type: "error" | "info") => void;
  protected _cachedRenderers: BlockRenderer[] | null = null;
  protected _cachedRegistry: BlockRendererRegistry | null = null;
  /** True while one session update is queued for the batch of property writes
   *  made in the current task (chat-panel-props.ts `_scheduleConfigSync`). */
  protected _configSyncQueued = false;
  /** True when an `imageInput` / `attachmentProviders` write must re-sync the
   *  composer icons AFTER the queued session update has run (002 ordering). */
  protected _attachmentSyncPending = false;
  // --- Session integration fields ---
  protected _session?: AgentSession;
  protected _unsub?: () => void;
  protected _eventsUnsub?: () => void;
  protected _retryAttempt?: { attempt: number; maxRetries: number; reason: string };
  /** 008: a one-off warning (an attachment hint, a validation message) shown
   *  by the panel itself when the host wires no `notify` callback. Independent
   *  of the exclusive failure slot, so an error never swallows it. Cleared by
   *  its own Dismiss. */
  protected _transientWarning: { text: string } | null = null;
  /** One line per provider fallback, for the debug log only. Never rendered in
   *  the conversation, and never persisted — it lives for the page load. */
  protected _fallbackLog: string[] = [];
  protected _state?: SessionState;
  protected _manualTitle = false;
  protected _autoTitledAt = 0;
  protected _readOnlyDataSource?: DataSourceProvider;
  protected _messagesOverride?: SessionMessage[];
  protected _elementsCreated = false;
  // --- Composer value (reactive; the <wa-text-area> is template-bound) ---
  protected _composerValue = "";
  protected _titleEditValue = "";
  /** The registry as rendered: host providers plus the built-in image provider. */
  protected _resolvedProviders?: AttachmentProvider[];
  /** The default image provider, built once and reused across config rebuilds. */
  protected _imageProvider?: AttachmentProvider;
  /** Unsubscribe callbacks from every provider's `subscribe()`. */
  protected _attachmentUnsubs: Array<() => void> = [];
  /** 128/003 — id of the provider whose `choices()` menu is open, or null. */
  protected _attachMenuFor: string | null = null;
  /** The open menu's rows, built once per open so `<wa-menu>` keeps them. */
  protected _attachMenuItems: WaMenuItem[] = [];
  /** Prefix of this panel's attachment button ids: `wa-attach-<n>`. */
  protected readonly _attachAnchorPrefix = `wa-attach-${++attachAnchorSeq}`;

  // --- History panel ---
  protected _historyPanelOpen = false;
  protected _historySessionsList: import("@cuatoi/web-agent-core").SessionMeta[] | null = null;
  protected _historyOutsideHandler?: (e: MouseEvent) => void;
  protected _historyKeyHandler?: (e: KeyboardEvent) => void;
  protected _historyPopupShown = false;
  protected _stopKeyPropagation = (e: KeyboardEvent) => {
    e.stopPropagation();
  };

  // --- Slash-command menu (105/003) ---
  /** Zero-height positioning parent, rendered as the first child of
   *  `.input-area`; the menu is absolutely positioned against it. */
  protected _slashAnchorEl!: HTMLElement;
  /** The listbox itself. Built once and kept, so its imperative children
   *  survive a panel re-render. */
  protected _slashMenuEl!: HTMLElement;
  protected _slashOpen = false;
  /** The currently rendered, already-filtered rows. Empty when closed. */
  protected _slashEntries: CommandEntry[] = [];
  protected _slashHighlight = 0;
  protected _slashOutsideHandler?: (e: MouseEvent) => void;

  // --- Config screen ---
  protected _configOpen = false;

  // --- Debug screen ---
  protected _debugOpen = false;
  /** Which debug Copy button is showing "Copied!" feedback, or null. */
  protected _debugCopied: "log" | "tools" | null = null;

  // --- Screen seam (125/001) ---
  protected _screens: import("./types.js").PanelScreen[] = [];
  protected _openScreen: string | null = null;
  protected _renderedScreenId: string | null = null;
  protected _renderedScreenEl: HTMLElement | null = null;

  // --- Header kebab (config + debug) menu ---
  protected _menuOpen = false;
  protected _menuDefs: PanelMenuItemDef[] = [];
  protected _menuItemsKey = "";
  protected _menuItemsCache: WaMenuItem[] = [];

  // --- Inline title edit ---
  protected _titleEditActive = false;

  /** Failed-turn markers the user has dismissed, keyed on object identity —
   *  `SessionMessage.failed` carries no id (controller.types.ts:34-52), and
   *  `controller-messages.ts:183-185` hands back the SAME object on every render of an
   *  unchanged turn, so identity is a stable key. Panel-local, never
   *  persisted: a reload rebuilds the journal with a new object, so the
   *  notice reappears — the turn really did fail and was never retried. */
  protected _dismissedFailures = new WeakSet<object>();

  /** The default registry's stylesheet, rendered as a child of this panel so
   *  the rules live in the panel's own tree — the document, or a host's shadow
   *  root. It carries no `id`: an id in the light DOM would still answer
   *  `document.getElementById`, which is the global scope this task removes. */
  protected _registryStyleEl!: HTMLStyleElement;

  // --- Scroll behavior ---
  protected _forceScrollToBottom = false;
  protected _scrollRafId: number | null = null;

  // --- 008: the chat message window ---
  /** Index into `this.messages` of the first message the template renders. */
  protected _windowStart = 0;
  /** Where the list was the last time it scrolled. Owned by
   *  `_handleListScroll()`; a panel that has never scrolled is at the bottom. */
  protected _atBottom = true;

  // --- 009: scroll-up window loading ---
  /** True while an older window is being loaded. Renders the top loader. */
  protected _loadingOlder = false;
  /** 010 round 2 — demo/gallery-only: the inline styles stashed by
   *  `_freezeOlderDots()` so unfreezing restores the exact animation the
   *  registry factory set. Null when the dots run normally. */
  protected _frozenDots: Array<{ el: HTMLElement; animation: string; transform: string }> | null = null;
  /** Pending timer for the minimum loader display duration. */
  protected _loadOlderTimer: ReturnType<typeof setTimeout> | null = null;
  protected _loadOlderResolve: (() => void) | null = null;

  // --- Tool image overlay (004) ---
  /** The dataUrl shown full-size in the panel image overlay, or null when
   *  closed. */
  protected _overlaySrc: string | null = null;
  /** The element that opened the overlay; focused again on close. */
  protected _overlayOpener: HTMLElement | null = null;

  /** The Stop/Send choice the last render actually produced. */
  protected _lastShowStop: boolean | null = null;
  /** Whether the last render's Send button was enabled. */
  protected _lastHasContent: boolean | null = null;
  /** True from the moment a block submission is accepted until its `send()`
   *  call has fully settled. `this.running` alone cannot guard a fast repeat
   *  click/tap: it lags behind by the `onUserPrompt` hook's await window
   *  (task 006), so two activations in that window both see `running ===
   *  false`. This flag is scoped to the block handlers only — the composer's
   *  `_handleSend()` needs no such guard (it is protected incidentally by
   *  synchronously clearing the input before `send()` is called), and must
   *  NOT share this flag: a deliberate second message typed into the
   *  composer while a turn runs has to queue, and this flag stays `true` for
   *  the whole turn (plus any drained queue), which would silently drop
   *  that submission if the composer checked it too. */
  protected _submitting = false;

  // --- Implemented further down the chain; declared here so an earlier class
  //     in the chain can call them. ---
  abstract buildSessionConfig(): SessionConfig;
  abstract createSession(): Promise<string>;
  abstract send(input: string | {
    text: string;
    images?: { dataUrl: string; mediaType: string }[];
  }, opts?: { userDisplayText?: string }): Promise<SendOutcome>;
  abstract stop(): void;
  protected abstract _debugConfigSnapshot(): Record<string, unknown>;
  protected abstract _ensureElements(): void;
  protected abstract _ensureSession(): void;
  protected abstract _freezeOlderDots(freeze: boolean): void;
  protected abstract _handleEvent(e: SessionEvent): void;
  protected abstract _handleKeyDown(e: KeyboardEvent): void;
  protected abstract _handleSend(): void;
  protected abstract _handleStateUpdate(s: SessionState): void;
  protected abstract _handleTitleEditCancel(): void;
  protected abstract _handleTitleEditConfirm(): void;
  protected abstract _handleTitleEditOpen(): void;
  protected abstract _recomputeWindow(): void;
  protected abstract _resolveProviders(): AttachmentProvider[];
  /** The command name that was handled, or null when the text is not a command
   *  and must be sent on as an ordinary message. A non-empty string is truthy,
   *  so the composer's `if (this._runSlashCommand(val)) return;` still reads
   *  correctly with no edit. */
  protected abstract _runSlashCommand(text: string): string | null;
  protected abstract _scrollToBottomQueue(): void;
  protected abstract _serializeDebugLog(cfg: Record<string, unknown>): string;
  protected abstract _showToast(msg: string, type: "error" | "info"): void;
  protected abstract _syncAttachmentProviders(): void;
  protected abstract _syncComposerControls(): void;
  protected abstract _toggleHistoryPanel(): void;
  protected abstract _toggleMenu(): void;
  protected abstract _updateSlashMenu(): void;
}
