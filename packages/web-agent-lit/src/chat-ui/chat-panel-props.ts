import type {
  SessionConfig,
  AttachmentProvider,
  AgentHooks,
  CuesConfig,
  SourceEntry,
  SkillDef,
  CustomToolDef,
  ToolRenderer,
} from "@cuatoi/web-agent-core";
import { BlockRenderer, BlockRendererRegistry } from "../ui-blocks/renderer/types.js";
import type { ConfirmScrimDetail } from "./confirm-scrim.js";
import { ChatPanelFields } from "./chat-panel-fields.js";
import type { HostStore, PanelAppContext } from "./types.js";
import { sameValue } from "./same-value.js";

/** The panel's host-facing configuration properties. A setter that receives
 *  the value it already holds (`sameValue`) does nothing. A setter that feeds
 *  `buildSessionConfig()` queues ONE session update per task
 *  (`_scheduleConfigSync`), so a Lit render that writes 20 properties rebuilds
 *  the agent once. Core keeps the conversation across that update. */
export abstract class ChatPanelProps extends ChatPanelFields {
  /** Queue one session update for every property written in the current task. */
  protected _scheduleConfigSync(): void {
    if (this._configSyncQueued) return;
    this._configSyncQueued = true;
    queueMicrotask(() => this._flushConfigSync());
  }

  /** Push the queued update now. Does nothing when no update is queued.
   *  `_ensureSession()` calls it too, so a property written just before
   *  `send()` or `createSession()` in the same task reaches core first. The
   *  session update runs BEFORE `_syncAttachmentProviders()`, because that
   *  re-reads `session.getAttachmentProviders()` (002). */
  protected _flushConfigSync(): void {
    if (!this._configSyncQueued) return;
    this._configSyncQueued = false;
    this._session?.updateConfig(this.buildSessionConfig());
    if (this._attachmentSyncPending && this._elementsCreated) {
      this._attachmentSyncPending = false;
      this._syncAttachmentProviders();
      this.requestUpdate();
    }
  }

  // --- Public properties with getters/setters to trigger updates ---
  get store() { return this._store; }
  set store(val: HostStore | undefined) {
    if (sameValue(val, this._store)) return;
    this._store = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get appContext() { return this._appContext; }
  set appContext(val: PanelAppContext | undefined) {
    const next = val || {};
    if (sameValue(next, this._appContext)) return;
    this._appContext = next;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get agentName() { return this._agentName; }
  set agentName(val: string | undefined) {
    if (sameValue(val, this._agentName)) return;
    this._agentName = val;
    this.requestUpdate();
  }

  get agentShortName() { return this._agentShortName; }
  set agentShortName(val: string | undefined) {
    if (sameValue(val, this._agentShortName)) return;
    this._agentShortName = val;
    this.requestUpdate();
  }

  get userAvatar() { return this._userAvatar; }
  set userAvatar(val: string | undefined) {
    if (sameValue(val, this._userAvatar)) return;
    this._userAvatar = val;
    this.requestUpdate();
  }

  get agentAvatar() { return this._agentAvatar; }
  set agentAvatar(val: string | undefined) {
    if (sameValue(val, this._agentAvatar)) return;
    this._agentAvatar = val;
    this.requestUpdate();
  }

  get debug() { return this._debug; }
  set debug(val: boolean | undefined) {
    if (sameValue(val, this._debug)) return;
    this._debug = val;
    this.requestUpdate();
  }

  get screens() { return this._screens; }
  set screens(val: import("./types.js").PanelScreen[] | undefined) {
    const next = val ?? [];
    if (sameValue(next, this._screens)) return;
    this._screens = next;
    this.requestUpdate();
  }

  confirmInteraction(detail: ConfirmScrimDetail): Promise<boolean> {
    return this._defaultConfirmScrim(detail);
  }

  get cues() { return this._cues; }
  set cues(val: CuesConfig | undefined) {
    if (sameValue(val, this._cues)) return;
    this._cues = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get onCuesChange() { return this._onCuesChange; }
  set onCuesChange(val: ((cues: { speed: "slow" | "fast"; enabled: boolean }) => void) | undefined) {
    this._onCuesChange = val;
  }

  get path() { return this._path; }
  set path(val: string | undefined) {
    if (sameValue(val, this._path)) return;
    this._path = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }
  get baseUrl() { return this.path; }
  set baseUrl(val: string | undefined) { this.path = val; }

  get model() { return this._model; }
  set model(val: string | undefined) {
    if (sameValue(val, this._model)) return;
    this._model = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get type() { return this._type; }
  set type(val: "openai" | "anthropic" | "gemini" | "mock" | (string & {}) | undefined) {
    if (sameValue(val, this._type)) return;
    this._type = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get fetch() { return this._fetch; }
  set fetch(val: typeof fetch | undefined) {
    if (sameValue(val, this._fetch)) return;
    this._fetch = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get thinking() { return this._thinking; }
  set thinking(val: boolean | undefined) {
    if (sameValue(val, this._thinking)) return;
    this._thinking = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get images() { return this._images; }
  set images(val: { maxDimension?: number; maxBytes?: number; quality?: number } | undefined) {
    if (sameValue(val, this._images)) return;
    this._images = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get imageInput() { return this._imageInput; }
  set imageInput(val: boolean | undefined) {
    if (sameValue(val, this._imageInput)) return;
    this._imageInput = val;
    this._resolvedProviders = undefined;
    // 002: the session must hold the new own-list BEFORE
    // `_syncAttachmentProviders()` re-resolves against
    // `session.getAttachmentProviders()`, or the removed provider comes back.
    // `_flushConfigSync()` runs the update, then the sync, in that order.
    this._attachmentSyncPending = true;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get hideHeader(): boolean { return this._hideHeader; }
  set hideHeader(val: boolean) {
    const boolVal = Boolean(val);
    if (this._hideHeader === boolVal) return;
    this._hideHeader = boolVal;
    if (this._hideHeader) {
      if (!this.hasAttribute("hide-header")) this.setAttribute("hide-header", "");
    } else {
      if (this.hasAttribute("hide-header")) this.removeAttribute("hide-header");
    }
    this.requestUpdate();
  }

  get models() { return this._models; }
  set models(val: import("@cuatoi/web-agent-core").ModelOption[] | undefined) {
    if (sameValue(val, this._models)) return;
    this._models = val;
    // No updateConfig(): model list is UI metadata, not a transport rebuild.
    this.requestUpdate();
  }

  get streaming() { return this._streaming; }
  set streaming(val: boolean | undefined) {
    if (sameValue(val, this._streaming)) return;
    this._streaming = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get config() { return this._config; }
  set config(val: Partial<SessionConfig> | undefined) {
    if (sameValue(val, this._config)) return;
    this._config = val;
    this._scheduleConfigSync();
    this._recomputeWindow();
    this.requestUpdate();
  }

  get renderers() { return this._renderers; }
  set renderers(val: BlockRenderer[]) {
    if (sameValue(val, this._renderers)) return;
    this._renderers = val;
    this._cachedRenderers = null;
    this._cachedRegistry = null;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get sources() { return this._sources; }
  set sources(val: SourceEntry[] | undefined) {
    if (sameValue(val, this._sources)) return;
    this._sources = val;
    // 003b: the read-only provider handed to rendered blocks is built from
    // `sources` (see _ensureReadOnlyDataSource). Drop it so the next render
    // rebuilds it; otherwise a host that assigns `sources` after connect keeps
    // a provider built from an empty list, and charts fail with
    // `Unknown source "..."` while the agent's own tools work.
    // Rebuilt lazily at render, NOT here: `store` may still be unassigned at
    // this point and the provider captures it in a closure.
    this._readOnlyDataSource = undefined;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get tools() { return this._tools; }
  set tools(val: CustomToolDef[] | undefined) {
    if (sameValue(val, this._tools)) return;
    this._tools = val;
    const map = new Map<string, ToolRenderer>();
    for (const t of (val ?? [])) {
      if (t && typeof t.name === "string" && typeof t.renderer === "function") {
        map.set(t.name, t.renderer);
      }
    }
    this._toolRenderers = map.size > 0 ? map : undefined;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get skills() { return this._skills; }
  set skills(val: SkillDef[] | undefined) {
    if (sameValue(val, this._skills)) return;
    this._skills = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get skillRegistry() { return this._skillRegistry; }
  set skillRegistry(val: import("@cuatoi/web-agent-core").SkillRegistry | undefined) {
    if (sameValue(val, this._skillRegistry)) return;
    this._skillRegistry = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get toolProviders() { return this._toolProviders; }
  set toolProviders(val: import("@cuatoi/web-agent-core").ToolProvider[] | undefined) {
    if (sameValue(val, this._toolProviders)) return;
    this._toolProviders = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get attachmentProviders() { return this._attachmentProviders; }
  set attachmentProviders(val: AttachmentProvider[] | undefined) {
    if (sameValue(val, this._attachmentProviders)) return;
    this._attachmentProviders = val;
    this._resolvedProviders = undefined;
    // 002: same ordering rule as the imageInput setter above.
    this._attachmentSyncPending = true;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get hooks() { return this._hooks; }
  set hooks(val: AgentHooks | undefined) {
    if (sameValue(val, this._hooks)) return;
    this._hooks = val;
    this._scheduleConfigSync();
    this.requestUpdate();
  }

  get notify() { return this._notify; }
  set notify(val: ((msg: string, type: "error" | "info") => void) | undefined) {
    if (sameValue(val, this._notify)) return;
    this._notify = val;
    this.requestUpdate();
  }


  get registry(): BlockRendererRegistry {
    const renderers = this.renderers || [];
    if (this._cachedRenderers !== renderers || !this._cachedRegistry) {
      this._cachedRenderers = renderers;
      this._cachedRegistry = new BlockRendererRegistry(renderers);
    }
    return this._cachedRegistry;
  }

}
