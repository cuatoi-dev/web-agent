import { defaultRenderers } from "../renderers.js";
import { BUBBLE_SHADOW_HTML } from "./bubble-shadow-template.js";
// Element registrations this widget needs. Previously reached through the
// package barrel; imported directly so the barrel has no edge back here.
import "../chat-ui/chat-panel.js";
import "../chat-ui/message-view.js";
import "../chat-ui/context-gauge.js";
import "../chat-ui/schedule-clock.js";
import "../chat-ui/todo-indicator.js";
import "../ui-blocks/renderer/form-block.js";
import "../ui-blocks/renderer/buttons-block.js";
import type {
  CuesConfig, AgentHooks, CustomToolDef, SkillDef, SourceEntry,
  SessionConfig, SessionMessage,
} from "@cuatoi/web-agent-core";
import type { AgentChatPanel, HostStore, PanelAppContext } from "../chat-ui/chat-panel.js";
import type { BlockRenderer } from "../ui-blocks/renderer/types.js";
import type { SendOutcome } from "../chat-ui/types.js";

export class WebAgentBubble extends HTMLElement {
  private isOpen = false;
  private launcherBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private _running = false;
  private containerEl!: HTMLDivElement;
  private panelEl: AgentChatPanel | null = null;
  private _imageInput?: boolean;
  private _model?: string;
  private _models?: import("@cuatoi/web-agent-core").ModelOption[];
  private _selectedModel?: string;
  private _path?: string;
  private _type?: "openai" | "anthropic" | "gemini";
  private _fetch?: typeof fetch;
  private _tools?: CustomToolDef[];
  private _skills?: SkillDef[];
  private _skillRegistry?: import("@cuatoi/web-agent-core").SkillRegistry;
  private _renderers?: BlockRenderer[];
  private _cues?: CuesConfig;
  private _agentName?: string;
  private _agentShortName?: string;
  private _userAvatar?: string;
  private _agentAvatar?: string;
  private _launcherIcon?: string;
  private _closeIcon?: string;
  private _store?: HostStore;
  private _appContext?: PanelAppContext;
  private _sources?: SourceEntry[];
  private _toolProviders?: import("@cuatoi/web-agent-core").ToolProvider[];
  private _config?: Partial<SessionConfig>;
  private _notify?: (msg: string) => void;
  private _debug?: boolean;

  get imageInput() {
    return this._imageInput;
  }

  set imageInput(val: boolean | undefined) {
    this._imageInput = val;
    if (this.panelEl) {
      this.panelEl.imageInput = val;
    }
  }

  get model() {
    return this._model;
  }

  set model(val: string | undefined) {
    this._model = val;
    if (this.panelEl) { this.panelEl.model = val; }
  }

  get models() { return this._models; }
  set models(val: import("@cuatoi/web-agent-core").ModelOption[] | undefined) {
    this._models = val;
    if (this.panelEl) { this.panelEl.models = val; }
  }

  get selectedModel() { return this._selectedModel; }
  set selectedModel(val: string | undefined) {
    this._selectedModel = val;
    if (this.panelEl) this.panelEl.selectedModel = val;
  }

  get path() {
    return this._path;
  }

  set path(val: string | undefined) {
    this._path = val;
    if (this.panelEl) {
      this.panelEl.path = val;
    }
  }

  get type() {
    return this._type;
  }

  set type(val: "openai" | "anthropic" | "gemini" | undefined) {
    this._type = val;
    if (this.panelEl) {
      this.panelEl.type = val;
    }
  }

  get fetch() {
    return this._fetch;
  }

  set fetch(val: typeof fetch | undefined) {
    this._fetch = val;
    if (this.panelEl) {
      this.panelEl.fetch = val;
    }
  }

  get tools() {
    return this._tools;
  }

  set tools(val: CustomToolDef[] | undefined) {
    this._tools = val;
    if (this.panelEl) {
      this.panelEl.tools = val;
    }
  }

  get skills() {
    return this._skills;
  }

  set skills(val: SkillDef[] | undefined) {
    this._skills = val;
    if (this.panelEl) {
      this.panelEl.skills = val;
    }
  }

  get skillRegistry() {
    return this._skillRegistry;
  }

  set skillRegistry(val: import("@cuatoi/web-agent-core").SkillRegistry | undefined) {
    this._skillRegistry = val;
    if (this.panelEl) {
      this.panelEl.skillRegistry = val;
    }
  }

  get renderers() {
    return this._renderers;
  }

  set renderers(val: BlockRenderer[] | undefined) {
    this._renderers = val;
    if (this.panelEl) {
      // The panel's own `renderers` setter is non-optional (it defaults to
      // `[generativeUiRenderer]`); its `registry` getter already treats an
      // empty array the same as none (`this.renderers || []`), so this is the
      // same effect `undefined` always had, typed correctly.
      this.panelEl.renderers = val ?? [];
    }
  }

  get cues() {
    return this._cues;
  }

  set cues(val: typeof this._cues) {
    this._cues = val;
    if (this.panelEl) {
      this.panelEl.cues = val;
    }
  }

  private _onCuesChange?: (cues: { speed: "slow" | "fast"; enabled: boolean }) => void;
  get onCuesChange() { return this._onCuesChange; }
  set onCuesChange(val: typeof this._onCuesChange) {
    this._onCuesChange = val;
    if (this.panelEl) { this.panelEl.onCuesChange = val; }
  }

  get agentName() { return this._agentName; }
  set agentName(val: string | undefined) { this._agentName = val; if (this.panelEl) this.panelEl.agentName = val; }
  get agentShortName() { return this._agentShortName; }
  set agentShortName(val: string | undefined) { this._agentShortName = val; if (this.panelEl) this.panelEl.agentShortName = val; this._renderLauncher(); }
  get userAvatar() { return this._userAvatar; }
  set userAvatar(val: string | undefined) { this._userAvatar = val; if (this.panelEl) this.panelEl.userAvatar = val; }
  get agentAvatar() { return this._agentAvatar; }
  set agentAvatar(val: string | undefined) { this._agentAvatar = val; if (this.panelEl) this.panelEl.agentAvatar = val; this._renderLauncher(); }
  get launcherIcon() { return this._launcherIcon; }
  set launcherIcon(val: string | undefined) { this._launcherIcon = val; this._renderLauncher(); }

  // Overrides the open-state "close" glyph, which toggle() otherwise hard-codes
  // as <i>close</i> — a Material Symbols ligature. A host with no icon font
  // (cat-store) must supply a plain-text glyph (e.g. "✕") instead; a host that
  // vendors the font (docs-site) leaves this unset and keeps the ligature.
  get closeIcon() { return this._closeIcon; }
  set closeIcon(val: string | undefined) { this._closeIcon = val; }

  get store() { return this._store; }
  set store(val: HostStore | undefined) { this._store = val; if (this.panelEl) { this.panelEl.store = val; } }

  get appContext() { return this._appContext; }
  set appContext(val: PanelAppContext | undefined) { this._appContext = val; if (this.panelEl) { this.panelEl.appContext = val; } }

  get sources() { return this._sources; }
  set sources(val: SourceEntry[] | undefined) { this._sources = val; if (this.panelEl) { this.panelEl.sources = val; } }

  get toolProviders() { return this._toolProviders; }
  set toolProviders(val: import("@cuatoi/web-agent-core").ToolProvider[] | undefined) {
    this._toolProviders = val;
    if (this.panelEl) { this.panelEl.toolProviders = val; }
  }

  private _screens?: import("../chat-ui/types.js").PanelScreen[];
  get screens() { return this._screens; }
  set screens(val: import("../chat-ui/types.js").PanelScreen[] | undefined) {
    this._screens = val;
    if (this.panelEl) { this.panelEl.screens = val; }
  }

  get config() { return this._config; }
  set config(val: Partial<SessionConfig> | undefined) { this._config = val; if (this.panelEl) { this.panelEl.config = val; } }

  get notify() { return this._notify; }
  set notify(val: ((msg: string) => void) | undefined) { this._notify = val; if (this.panelEl) { this.panelEl.notify = val; } }

  private _hooks?: AgentHooks;
  get hooks() { return this._hooks; }
  set hooks(val: AgentHooks | undefined) { this._hooks = val; if (this.panelEl) { this.panelEl.hooks = val; } }

  get debug() { return this._debug; }
  set debug(val: boolean | undefined) {
    this._debug = val;
    if (this.panelEl) this.panelEl.debug = val;
  }

  /** Forwards to the inner panel's built-in "ask"-tier confirm dialog.
   *  Called lazily at confirm time (not wiring time), so it works even
   *  though `panelEl` may not exist yet when a host builds `domTools({
   *  confirmInteraction: bubble.confirmInteraction.bind(bubble) })`. */
  confirmInteraction(detail: { action: string; ref?: string; name?: string; reason?: string; summary?: string }): Promise<boolean> {
    return this.panelEl ? this.panelEl.confirmInteraction(detail) : Promise.resolve(true);
  }

  /** Forwards to the inner panel's `send()` (chat-panel-session.ts:221), so a
   *  host outside the shadow root can put a message into the conversation as
   *  if the user had typed it. The guard asks whether the bubble is OPEN, not
   *  whether a panel was ever built: `toggle()` assigns `panelEl` and never
   *  clears it, so testing `panelEl` alone left every send after the first
   *  close landing in a panel the user cannot see. A bubble that is not
   *  connected yet has no container to open, so it returns without throwing. */
  async send(
    input: string | { text: string; images?: { dataUrl: string; mediaType: string }[] },
    opts?: { userDisplayText?: string },
  ): Promise<SendOutcome> {
    if (!this.panelEl || !this.isOpen) {
      if (!this.containerEl) return { ran: "none" };
      this.toggle();
    }
    return (await this.panelEl?.send(input, opts)) ?? { ran: "none" };
  }

  /** Forwards to the inner panel's `messages` (chat-panel-state.ts:140).
   *  Empty before the bubble has ever been opened, never undefined. Getter
   *  only — nothing assigns the bubble's messages. */
  get messages(): SessionMessage[] {
    return this.panelEl ? this.panelEl.messages : [];
  }

  /** Forwards to the inner panel's `running` (chat-panel-state.ts:149) — true
   *  while a turn is in flight. This is NOT the private `_running` field
   *  above, which also counts compaction and drives the collapsed-state Stop
   *  button. */
  get running(): boolean {
    return this.panelEl ? !!this.panelEl.running : false;
  }

  connectedCallback() {
    // attachShadow() throws if called twice, so the re-connect path keys off
    // the root rather than off a query. Re-binding is enough: the shadow tree
    // survives a move in the DOM.
    const existing = this.shadowRoot;
    if (existing) {
      this.launcherBtn = existing.querySelector("#launcher") as HTMLButtonElement;
      this.stopBtn = existing.querySelector("#stop-run") as HTMLButtonElement;
      this.containerEl = existing.querySelector("#panel-container") as HTMLDivElement;
      this.panelEl = existing.querySelector("agent-chat-panel");
      this.isOpen = this.containerEl.style.display === "flex";
      this.setupListeners();
      this._renderLauncher();
      this._syncStopBtn();
      return;
    }

    // OPEN, never closed: both reference apps attach chrome to this root from
    // the outside (the resize grip), Playwright's CSS engine only pierces open
    // roots, and a host restyles the launcher through the exposed parts below.
    const root = this.attachShadow({ mode: "open" });

    root.innerHTML = BUBBLE_SHADOW_HTML;

    this.launcherBtn = root.querySelector("#launcher") as HTMLButtonElement;
    this.stopBtn = root.querySelector("#stop-run") as HTMLButtonElement;
    this.containerEl = root.querySelector("#panel-container") as HTMLDivElement;
    this.setupListeners();
    this._renderLauncher();
    this._syncStopBtn();
  }

  private setupListeners() {
    this.launcherBtn.onclick = () => this.toggle();
    this.stopBtn.onclick = () => {
      this.panelEl?.stop();
    };
  }

  private _renderLauncher() {
    if (!this.launcherBtn) return;
    const iconEl = this.launcherBtn.querySelector("#launcher-icon");
    if (this.isOpen) return; // toggle() owns the open-state icon
    if (iconEl) {
      if (this._launcherIcon) {
        iconEl.innerHTML = `<i>${this._launcherIcon}</i>`;
      } else if (this._agentAvatar) {
        iconEl.innerHTML = `<img class="wa-launcher-avatar" src="${this._agentAvatar}" alt="${this._agentShortName || "Open chat"}">`;
      } else {
        iconEl.innerHTML = "<i>chat</i>";
      }
    }
  }

  /** Visible only while a run is in flight AND the panel is closed. With the
   *  panel open its own composer Stop button is the control. */
  private _syncStopBtn(): void {
    if (!this.stopBtn) return;
    this.stopBtn.dataset.visible = String(this._running && !this.isOpen);
  }

  toggle() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.containerEl.style.display = "flex";
      this.launcherBtn.querySelector("#launcher-icon")!.innerHTML = this._closeIcon ?? "<i>close</i>";
      if (!this.panelEl) {
        this.panelEl = document.createElement("agent-chat-panel");

        // Host-supplied store wins; the mock only satisfies agent-chat-panel's
        // requirement when the host did not supply one (docs-site). The mock
        // shape is Redux-like (getState/subscribe/dispatch) — wider than
        // `HostStore`, which only names what the panel itself calls.
        const mockStore = {
          getState: () => ({
            ui: { route: window.location.pathname },
          }),
          subscribe: () => () => {},
          dispatch: () => {},
        };
        this.panelEl.store = this._store ?? mockStore;

        this.panelEl.appContext = this._appContext ?? {
          appName: "Web Agent Docs",
          appDescription: "Documentation for the web-agent project.",
        };

        // Configurable backend path/type. No model default — the host must set
        // `model`, otherwise the session throws at start.
        const BACKEND = {
          type: "openai",
          path: "/api/openai/v1",
        };

        this.panelEl.path = this._path ?? BACKEND.path;
        this.panelEl.model = this._model;
        if (this._models) this.panelEl.models = this._models;
        this.panelEl.selectedModel = this._selectedModel;
        this.panelEl.type = this._type ?? BACKEND.type;
        this.panelEl.imageInput = this._imageInput;
        this.panelEl.renderers = this._renderers ?? defaultRenderers;
        if (this._cues) this.panelEl.cues = this._cues;
        if (this._onCuesChange) this.panelEl.onCuesChange = this._onCuesChange;
        if (this._tools) this.panelEl.tools = this._tools;
        if (this._skills) this.panelEl.skills = this._skills;
        if (this._skillRegistry) this.panelEl.skillRegistry = this._skillRegistry;
        if (this._agentName) this.panelEl.agentName = this._agentName;
        if (this._agentShortName) this.panelEl.agentShortName = this._agentShortName;
        if (this._userAvatar) this.panelEl.userAvatar = this._userAvatar;
        if (this._agentAvatar) this.panelEl.agentAvatar = this._agentAvatar;
        if (this._debug !== undefined) this.panelEl.debug = this._debug;
        if (this._sources) this.panelEl.sources = this._sources;
        if (this._toolProviders) this.panelEl.toolProviders = this._toolProviders;
        if (this._screens) this.panelEl.screens = this._screens;
        if (this._fetch) this.panelEl.fetch = this._fetch;
        if (this._notify) this.panelEl.notify = this._notify;
        if (this._hooks) this.panelEl.hooks = this._hooks;

        this.panelEl.config = this._config ?? {
          persist: true,
          sessionNamespace: "web-agent-docs",
          appendSystemPrompt: "You are an assistant for the Web Agent documentation site. You can help users understand how to use, configure, and extend the Web Agent. You operate the current page only and cannot change pages; if the user needs a different page, ask them to switch to it. Keep replies precise, concise, and helpful."
        };

        this.panelEl.addEventListener("agent-running-change", (e: Event) => {
          this._running = !!(e as CustomEvent<{ running: boolean }>).detail?.running;
          this._syncStopBtn();
        });

        this.containerEl.appendChild(this.panelEl);
      }
    } else {
      this.containerEl.style.display = "none";
      this._renderLauncher();
    }
    // An icon-only button: the label is its accessible name.
    this.launcherBtn.setAttribute("aria-label", this.isOpen ? "Close chat" : "Open chat");
    this._syncStopBtn();
  }
}

if (!customElements.get("web-agent-bubble")) {
  customElements.define("web-agent-bubble", WebAgentBubble);
}
