import { LitElement, unsafeCSS, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
// Registers <agent-chat-panel> (packages/web-agent-lit/src/index.ts:3).
import "@cuatoi/web-agent-lit";
import type { SessionMeta, AgentHooks } from "@cuatoi/web-agent-core";
import { imageReachesModel, modelSupportsVision } from "@cuatoi/web-agent-core";
import { ACME_PANEL_MD_STYLES } from "../../acme-registry";
import { THEME_CHANGE_EVENT } from "../theme";
import { DEFAULT_GENUI_CONFIG, type GenuiConfig } from "../genui/genui-config";
import { mountIntoFrame } from "../genui/genui-frame";
import { syncFrameTheme } from "../genui/genui-frame-theme";
import { captureFrameScreenshot } from "../genui/genui-screenshot";
import type { GenuiScreenshotResult } from "../../shared/genui-screenshot";
import { validateGenuiSource, type ValidationResult } from "../genui/genui-validator";
import {
  createGenuiDiagnosticsCollector,
  type GenuiDiagnosticsCollector,
} from "../genui/genui-diagnostics-collector";
import type { GenuiDiagnostic } from "../../shared/genui-diagnostics";
import {
  panelProps,
  type PanelProps,
  applyProviderEntry,
  PROVIDER_ENTRIES,
  DEFAULT_PROVIDER_ENTRY_INDEX,
} from "../agent-panel-config";
import type { AgentChatPanel } from "@cuatoi/web-agent-lit";
import {
  CustomPromptConfig,
  loadCustomPromptConfig,
  saveCustomPromptConfig,
  clearCustomPromptConfig,
} from "../agent-prompt-config";
import {
  composeAppContext,
  installAgentPageGenuiGlobals,
  removeAgentPageGenuiGlobals,
} from "./agent-page-support";
import { agentPageStyles } from "./agent-page.styles";
import { renderAgentPage } from "./agent-page.view";
import {
  AGENT_RIGHT_PANEL_WIDTH_PX,
  clampSideWidth,
  sideWidthFromDrag,
} from "./agent-page-layout";

// The column widths and the two clamp helpers moved to agent-page-layout.ts.
// They stay importable from here: every one of them was public before.
export * from "./agent-page-layout";

@customElement("agent-page")
export class AgentPage extends LitElement {
  static styles = [agentPageStyles, unsafeCSS(ACME_PANEL_MD_STYLES)];

  /** Sessions as last read from the panel. A copy — chat-panel-session.ts:297-301
   *  documents that listSessions() returns core's own array. */
  @state() private _sessions: SessionMeta[] = [];
  /** The active session id, tracked host-side: there is no public accessor
   *  for it and SessionMeta carries no active flag. Sources: the
   *  onSessionStart hook, createSession()'s return value, and the id passed
   *  to switchSession(). */
  @state() private _activeId = "";
  /** Id of the row currently being renamed inline; "" when none. */
  @state() private _renamingId = "";
  /** true → the config view replaces the chat in the middle column. */
  @state() private _configOpen = false;
  /** Custom prompt field state. */
  @state() private _customConfig: CustomPromptConfig = {};
  /** Index into PROVIDER_ENTRIES of the combination the panel is configured
   *  with. The host holds it: the panel exposes the four values separately and
   *  has no notion of a combination. */
  @state() private _entryIndex = DEFAULT_PROVIDER_ENTRY_INDEX;
  /** true → the picker's option list is open. */
  @state() private _entryListOpen = false;
  /** Index awaiting confirmation; null when no dialog is showing. The
   *  selection is committed only on confirm, so cancelling needs no rollback —
   *  `_entryIndex` never moved. */
  @state() private _pendingIndex: number | null = null;
  /** Read by the e2e specs through `page.evaluate`, so a spec never duplicates
   *  the list. The list itself lives in agent-panel-config.ts. */
  readonly _entries = PROVIDER_ENTRIES;
  /** Current right-panel width in px. Not persisted — matching the bubble
   *  grip behaviour. A reload, or leaving and re-entering #/agent, restores
   *  the default. */
  @state() private _sideWidth = AGENT_RIGHT_PANEL_WIDTH_PX;
  /** true → the right panel is hidden and the chat takes its width. The width
   *  above is kept, so expanding restores what the user dragged. */
  @state() private _sideCollapsed = false;
  /** Host-owned generative UI configuration. */
  @state() private _genuiConfig: GenuiConfig = DEFAULT_GENUI_CONFIG;
  /** true while dragging the side-panel divider; toggles .dragging on the iframe to disable pointer-events */
  @state() private _dragging = false;

  /** Read by render_agent_ui to build its description from the enabled rules
   *  (GenuiToolHost). */
  public get genuiConfig(): GenuiConfig {
    return this._genuiConfig;
  }

  /** Buffers what the frame's bootstrap reports. Not @state — the buffer
   *  never renders, and a re-render on every log line would be wasteful. */
  private readonly _diagnostics: GenuiDiagnosticsCollector =
    createGenuiDiagnosticsCollector();

  private _props: PanelProps;
  private _hooks: AgentHooks;
  @state() private _appContext: NonNullable<AgentChatPanel["appContext"]>;
  private _globals: Record<string, unknown> = {};

  public get panel(): AgentChatPanel | null {
    return this.renderRoot?.querySelector<AgentChatPanel>("agent-chat-panel") ?? null;
  }

  public get _panel(): AgentChatPanel | null {
    return this.panel;
  }

  constructor() {
    super();
    this._props = panelProps({ domAccess: false, memory: true, genui: this });
    const baseHooks: AgentHooks = this._props.hooks ?? {};
    const prior = baseHooks.onSessionStart;
    this._hooks = {
      ...baseHooks,
      onSessionStart: [
        ...(Array.isArray(prior) ? prior : prior ? [prior] : []),
        (p: { sessionId: string }) => {
          this._refresh(p.sessionId);
        },
      ],
    };
    this._customConfig = loadCustomPromptConfig();
    this._appContext = composeAppContext(this._props.appContext, this._customConfig);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this._onWindowResize);
    window.addEventListener(THEME_CHANGE_EVENT, this._onThemeChange);
    // Start before the frame can load, so parse-time output is not missed.
    this._diagnostics.start();
    this._globals = installAgentPageGenuiGlobals(this);
  }

  override updated(changed: PropertyValues<this>): void {
    // Keep the frame's data-theme in sync on every render cycle.  This covers
    // both initial load and programmatic iframe navigation (e.g. switching to
    // ?profile=plain) where the @load handler may fire before the host's
    // data-theme is stable.
    this._syncThemeToFrame();
    this._syncScreenshotHook();
    if (changed.has("_renamingId" as keyof AgentPage) && this._renamingId) {
      const input = this.shadowRoot?.querySelector(
        ".rename-input",
      ) as HTMLInputElement | null;
      if (input && this.shadowRoot?.activeElement !== input) {
        input.focus();
        input.select();
      }
    }
    if (changed.has("_pendingIndex" as keyof AgentPage) && this._pendingIndex !== null) {
      const ok = this.shadowRoot?.querySelector(".confirm-ok") as HTMLElement | null;
      if (ok && this.shadowRoot?.activeElement !== ok) ok.focus();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._onWindowResize);
    window.removeEventListener(THEME_CHANGE_EVENT, this._onThemeChange);
    this._diagnostics.stop();
    // A drag in progress must not outlive the element.
    this._onDragEnd();
    removeAgentPageGenuiGlobals(this._globals);
    // Leaving the route destroys this element, so drop the session with it.
    // dispose() clears the panel's session reference, so a re-entry rebuilds it.
    this.panel?.dispose?.();
  }

  /** Re-read the session list from the panel. Pass an id to also set the
   *  active session. */
  private _refresh(activeId?: string): void {
    this._sessions = [...(this.panel?.listSessions() ?? [])] as SessionMeta[];
    if (activeId !== undefined) this._activeId = activeId;
  }

  private _label(s: SessionMeta): string {
    return (s.title ?? "").trim() || "New chat";
  }

  private async _onNewChat(): Promise<void> {
    this._renamingId = "";
    const id = await this.panel?.createSession();
    if (id) this._refresh(id);
  }

  private async _onSwitch(id: string): Promise<void> {
    if (id === this._activeId || this._renamingId) return;
    await this.panel?.switchSession(id);
    this._refresh(id);
  }

  private async _onDelete(id: string): Promise<void> {
    const before = new Set(this._sessions.map((s) => s.id));
    const wasActive = id === this._activeId;
    if (this._renamingId === id) this._renamingId = "";
    await this.panel?.deleteSession(id);
    const after = [...(this.panel?.listSessions() ?? [])] as SessionMeta[];
    this._sessions = after;
    if (wasActive) {
      // Core creates a brand-new empty session when the ACTIVE one is deleted
      // (controller-sessions.ts:274-275), so the one id that was not there before is
      // the new active session.
      const fresh = after.find((s) => !before.has(s.id));
      this._activeId = fresh?.id ?? after[0]?.id ?? "";
    }
  }

  private _onRenameStart(id: string): void {
    this._renamingId = id;
  }

  private async _onRenameCommit(id: string, value: string): Promise<void> {
    const title = value.trim();
    this._renamingId = "";
    if (!title) return;
    await this.panel?.renameSession(id, title);
    this._refresh();
  }

  private _onRenameKey(e: KeyboardEvent, id: string): void {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === "Enter") {
      e.preventDefault();
      void this._onRenameCommit(id, input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this._renamingId = "";
    }
  }

  private _onToggleConfig(): void {
    this._configOpen = !this._configOpen;
  }

  private _applyCustomConfig(): void {
    this._appContext = composeAppContext(this._props.appContext, this._customConfig);
    if (this.panel) {
      this.panel.appContext = this._appContext;
    }
  }

  private _onFieldInput(field: keyof CustomPromptConfig, value: string): void {
    this._customConfig = { ...this._customConfig, [field]: value };
    saveCustomPromptConfig(this._customConfig);
    this._applyCustomConfig();
  }

  private _onPresetClick(field: keyof CustomPromptConfig, sample: string): void {
    this._customConfig = { ...this._customConfig, [field]: sample };
    saveCustomPromptConfig(this._customConfig);
    this._applyCustomConfig();
  }

  private _onResetConfig(): void {
    this._customConfig = {};
    clearCustomPromptConfig();
    this._applyCustomConfig();
  }

  private _onToggleEntryList(): void {
    this._entryListOpen = !this._entryListOpen;
  }

  /** Picking the active entry does nothing at all — no dialog, no session. */
  private _onPickEntry(index: number): void {
    this._entryListOpen = false;
    if (index === this._entryIndex) return;
    this._pendingIndex = index;
  }

  private _onCancelSwitch(): void {
    this._pendingIndex = null;
  }

  /** Writes all four properties, THEN starts the session, so the new session is
   *  built on the new configuration. The four setters queue one updateConfig()
   *  between them, and createSession() pushes it before the new session starts. */
  private async _onConfirmSwitch(): Promise<void> {
    const index = this._pendingIndex;
    if (index === null) return;
    this._pendingIndex = null;
    this._renamingId = "";
    applyProviderEntry(this._props, PROVIDER_ENTRIES[index]);
    if (this.panel) {
      applyProviderEntry(this.panel, PROVIDER_ENTRIES[index]);
    }
    this._entryIndex = index;
    const id = await this.panel?.createSession();
    if (id) this._refresh(id);
  }

  /** Live drag state. null when no drag is in progress. */
  private _dragStartWidth: number | null = null;
  private _dragStartX = 0;

  /** The `.layout` box is the space the three columns share. */
  private _layoutWidth(): number {
    const layout = this.shadowRoot?.querySelector(".layout") as HTMLElement | null;
    return layout ? layout.getBoundingClientRect().width : 0;
  }

  private _onDragMove = (e: PointerEvent): void => {
    if (this._dragStartWidth === null) return;
    this._sideWidth = sideWidthFromDrag(
      this._dragStartWidth,
      e.clientX - this._dragStartX,
      this._layoutWidth(),
    );
  };

  private _onDragEnd = (): void => {
    this._dragging = false;
    this._dragStartWidth = null;
    document.removeEventListener("pointermove", this._onDragMove);
    document.removeEventListener("pointerup", this._onDragEnd);
    document.removeEventListener("pointercancel", this._onDragEnd);
  };

  private _onDividerPointerDown(e: PointerEvent): void {
    // Collapsed: nothing to resize. The toggle button handles its own clicks
    // and stops this event, so a press on it never starts a drag.
    if (this._sideCollapsed) return;
    e.preventDefault();
    this._dragging = true;
    this._dragStartWidth = this._sideWidth;
    this._dragStartX = e.clientX;
    document.addEventListener("pointermove", this._onDragMove);
    document.addEventListener("pointerup", this._onDragEnd);
    document.addEventListener("pointercancel", this._onDragEnd);
  }

  private _onToggleSide(): void {
    this._sideCollapsed = !this._sideCollapsed;
  }

  /** A narrower window can push a dragged width past its maximum, so re-clamp.
   *  Mirrors the shipped grip's resize handler (panel-resize.ts:182-188). */
  private _onWindowResize = (): void => {
    if (this._sideCollapsed) return;
    this._sideWidth = clampSideWidth(this._sideWidth, this._layoutWidth());
  };

  /** Gives the frame's own root the host theme, so CSS custom properties
   *  resolve the same inside the frame. A custom theme shows its base theme. */
  private _syncThemeToFrame = (): void => {
    const iframe = this.shadowRoot?.querySelector(".genui-frame") as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    syncFrameTheme(doc, document.documentElement.getAttribute("data-theme"));
  };

  /** Event handler for cat-store:theme-change — syncs frame theme and appInstructions. */
  private _onThemeChange = (): void => {
    this._syncThemeToFrame();
    this._applyCustomConfig();
  };

  /** Called when the iframe finishes loading its host page; sets the initial
   *  theme so the first paint is correct (not stuck on the server default). */
  private _onFrameLoad = (): void => {
    this._syncThemeToFrame();
  };

  /** Returns every diagnostic the frame reported since the previous drain, and
   *  empties the buffer so the tool can include them in its result. */
  public drainDiagnostics(): GenuiDiagnostic[] {
    return this._diagnostics.drain();
  }

  /** Injects markup and JavaScript source into the mounted generative UI frame. */
  public async mount(source: string): Promise<void> {
    const iframe = this.shadowRoot?.querySelector(".genui-frame") as HTMLIFrameElement | null;
    if (!iframe) {
      throw new Error("Generative UI frame element not found in DOM");
    }
    await mountIntoFrame(iframe, source);
    this._syncThemeToFrame();
  }

  /** Runs the syntax pre-check and every enabled rule against the source,
   *  using the FRAME's window as the rule context so registered-elements and
   *  approved-colours are answered by the frame's own registry and CSS oracle.
   *  Same behaviour the __WA_GENUI_VALIDATE__ hook had inline. */
  public validateSource(source: string, configOverride?: GenuiConfig): Promise<ValidationResult> {
    const iframe = this.shadowRoot?.querySelector(".genui-frame") as HTMLIFrameElement | null;
    return validateGenuiSource(source, configOverride ?? this._genuiConfig, {
      win: iframe?.contentWindow,
    });
  }

  /** Whether a screenshot could actually reach the model.
   *
   *  This is the same decision the three message converters make when they
   *  strip an image (message-converter.ts, openai-to-anthropic.ts,
   *  gemini-to-anthropic.ts all call imageReachesModel now), so the channel is
   *  offered exactly when the image would survive the trip. `imageInput` is the
   *  host's flag, set in agent-panel-config.ts:196; the model comes from the
   *  provider entry the switcher currently shows. */
  public get screenshotAvailable(): boolean {
    const entry = PROVIDER_ENTRIES[this._entryIndex];
    return imageReachesModel(
      this.panel?.imageInput === false ? false : this._props.imageInput,
      modelSupportsVision(entry.endpointType, entry.model),
    );
  }

  /** Offers or withdraws the screenshot channel. Called after the first render
   *  and after every update, so switching the provider or changing the host's
   *  imageInput flag takes effect without a reload. */
  private _syncScreenshotHook(): void {
    if (this.screenshotAvailable) {
      window.__WA_GENUI_SCREENSHOT__ = (opts?: { timeoutMs?: number }) =>
        this.screenshot(opts?.timeoutMs);
    } else {
      delete window.__WA_GENUI_SCREENSHOT__;
    }
  }

  /** Asks the frame to capture itself and returns the PNG data URL. */
  public async screenshot(timeoutMs?: number): Promise<GenuiScreenshotResult> {
    const iframe = this.shadowRoot?.querySelector(".genui-frame") as HTMLIFrameElement | null;
    if (!iframe) {
      return { ok: false, error: "frame-unavailable" };
    }
    return captureFrameScreenshot(iframe, timeoutMs === undefined ? {} : { timeoutMs });
  }

  /** The templates live in agent-page.view.ts. This is the only place the
   *  element's state and handlers are handed to them, as one plain object. */
  render() {
    return renderAgentPage({
      props: this._props,
      hooks: this._hooks,
      appContext: this._appContext,
      sessions: this._sessions,
      activeId: this._activeId,
      renamingId: this._renamingId,
      configOpen: this._configOpen,
      customConfig: this._customConfig,
      entryIndex: this._entryIndex,
      entryListOpen: this._entryListOpen,
      pendingIndex: this._pendingIndex,
      sideWidth: this._sideWidth,
      sideCollapsed: this._sideCollapsed,
      dragging: this._dragging,
      genuiConfig: this._genuiConfig,
      label: (s: SessionMeta) => this._label(s),
      onNewChat: () => void this._onNewChat(),
      onSwitch: (id: string) => void this._onSwitch(id),
      onDelete: (id: string) => void this._onDelete(id),
      onRenameStart: (id: string) => this._onRenameStart(id),
      onRenameKey: (e: KeyboardEvent, id: string) => this._onRenameKey(e, id),
      onRenameCancel: () => {
        this._renamingId = "";
      },
      onToggleConfig: () => this._onToggleConfig(),
      onFieldInput: (field: keyof CustomPromptConfig, value: string) =>
        this._onFieldInput(field, value),
      onPresetClick: (field: keyof CustomPromptConfig, sample: string) =>
        this._onPresetClick(field, sample),
      onResetConfig: () => this._onResetConfig(),
      onToggleEntryList: () => this._onToggleEntryList(),
      onCloseEntryList: () => {
        this._entryListOpen = false;
      },
      onPickEntry: (index: number) => this._onPickEntry(index),
      onCancelSwitch: () => this._onCancelSwitch(),
      onConfirmSwitch: () => void this._onConfirmSwitch(),
      onDividerPointerDown: (e: PointerEvent) => this._onDividerPointerDown(e),
      onToggleSide: () => this._onToggleSide(),
      onFrameLoad: () => this._onFrameLoad(),
    });
  }
}
