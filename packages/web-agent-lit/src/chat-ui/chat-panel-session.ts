import {
  createAgentSession,
  createDataSourceProvider,
  defaultTools,
  buttonToMessage,
  formSubmitToMessage,
  type SessionConfig,
  type SessionState,
  type SessionMeta,
  type SessionEvent,
  type ToolContext,
  type TodoItem,
  type MessagePart as CoreMessagePart,
} from "@cuatoi/web-agent-core";
import { getAgentCursor } from "./agent-cursor.js";
import { ChatPanelElements } from "./chat-panel-elements.js";
import type { HostStore, SendOutcome } from "./types.js";

/** Everything that owns the live `AgentSession`: building its config,
 *  reacting to its state and events, the session CRUD calls and the
 *  host-driven header API. Moved verbatim out of chat-panel.ts. */
export abstract class ChatPanelSession extends ChatPanelElements {
  /** 109/003 — the counts behind the composer clock.
   *  Returns zeros unless the host opted in AND the session exposes the
   *  method. The optional call matters: several test doubles and host fake
   *  sessions predate `pendingCounts()` (chat-panel.datasource-ordering.test.ts:59-108),
   *  and a hard call would throw on every render for them. */
  protected _pendingCounts(): { schedules: number; reminders: number } {
    if (!this._config?.scheduler?.enabled) return { schedules: 0, reminders: 0 };
    const counts = this._session?.pendingCounts?.();
    return { schedules: counts?.schedules ?? 0, reminders: counts?.reminders ?? 0 };
  }

  /** 068/003 — the todo items behind the composer indicator.
   *  Returns an empty list unless the host opted in AND the session exposes
   *  the method. The optional call matters for the same reason it does on
   *  `_pendingCounts()` above: several test doubles and host fake sessions
   *  predate `todos()`, and a hard call would throw on every render. */
  protected _todoItems(): TodoItem[] {
    if (!this._config?.todo?.enabled) return [];
    return this._session?.todos?.() ?? [];
  }

  buildSessionConfig(): SessionConfig {
    return {
      store: this._store,
      appContext: this._appContext,
      cues: this._cues,
      baseURL: this._path ? this._path : undefined,
      model: this._model,
      endpointType: this._type,
      // The panel's own `thinking` property is a plain boolean flag (driven by
      // the `thinking` HTML attribute's presence). Core's `SessionConfig.thinking`
      // is `{ enabled: boolean; budgetTokens?: number }` — typing `_config`
      // (chat-panel-fields.ts, no longer `any`) surfaced that this call was forwarding the raw
      // boolean, which core has never accepted. Wrap it into the shape core
      // expects; `undefined` still means "no override", same as before.
      thinking: this._thinking !== undefined ? { enabled: this._thinking } : undefined,
      imageInput: this._imageInput,
      streaming: this._streaming,
      models: this._models,
      sources: this._sources,
      fetch: this._fetch,
      tools: (ctx: ToolContext) => [
        ...defaultTools(ctx),
        ...(this._tools ?? []),
      ],
      skills: this._skills,
      skillRegistry: this._skillRegistry,
      confirmInteraction: this.confirmInteraction.bind(this),
      toolProviders: this._toolProviders,
      attachmentProviders: this._ownProviders(),
      hooks: this._hooks,
      ...(this._config || {}),
      blockGuidelines: this.registry.collectPromptSnippets(),
    };
  }

  protected _handleStateUpdate(s: SessionState) {
    const oldState = this._state;
    this._state = s;

    if (oldState?.running && !s.running) {
      this._retryAttempt = undefined;
      const cuesEnabled = this._cues?.enabled ?? false;
      if (cuesEnabled) {
        try {
          // 007: take the layer off the page, not just its transients, so a
          // stopped run leaves no .wa-agent-cursor-layer behind.
          getAgentCursor().destroy();
        } catch { /* the cursor layer may already be gone; nothing to clean up */ }
      }
    }

    // 007: the bubble hides the panel — and with it the only Stop button —
    // when the user collapses it mid-run. Tell it when a run starts and ends
    // so it can offer its own Stop control. Same event shape as `agent-toast`
    // (`_showToast()` below).
    const wasBusy = (oldState?.running ?? false) || (oldState?.compacting ?? false);
    const isBusy = (s.running ?? false) || (s.compacting ?? false);
    if (wasBusy !== isBusy) {
      this.dispatchEvent(
        new CustomEvent("agent-running-change", {
          detail: { running: isBusy },
          bubbles: true,
          composed: true,
        })
      );
    }
    
    if (!oldState || oldState.activeSessionId !== s.activeSessionId) {
      this._forceScrollToBottom = true;
      this._atBottom = true;                 // 008 — the new session opens at its bottom
      const newMeta = s.sessions.find(x => x.id === s.activeSessionId);
      this._manualTitle = newMeta?.titleManual ?? false;
      const turnCount = s.messages ? s.messages.filter(m => m.role === "assistant").length : 0;
      // 120/002 — a session can reach this component's FIRST render already
      // past its first (or third) turn: a fast turn (a mock response, or a
      // quick real one) can complete before this element's initial state
      // subscription fires, especially under load. Gating on turnCount alone
      // then reads as "already auto-titled" and permanently skips autoTitle()
      // for a session that was never actually titled. Gate on whether the
      // session already carries a title instead — that is the only true
      // signal that autoTitle() (or a manual rename) already ran.
      const hasTitle = !!newMeta?.title;
      this._autoTitledAt = hasTitle ? (turnCount >= 3 ? 3 : turnCount >= 1 ? 1 : 0) : 0;
    }

    if (s.messages && !s.running && !this._manualTitle) {
      const turnCount = s.messages.filter(m => m.role === "assistant").length;
      if (turnCount === 1 && this._autoTitledAt < 1) {
        this._autoTitledAt = 1;
        this._session?.autoTitle().catch(() => {});
      } else if (turnCount === 3 && this._autoTitledAt < 3) {
        this._autoTitledAt = 3;
        this._session?.autoTitle().catch(() => {});
      }
    }

    // 007: a toolProvider's attachmentProviders (e.g. domTools()'s picker)
    // load asynchronously and only become visible via
    // session.getAttachmentProviders() — re-resolve + re-sync composer icons
    // on every state notification so they appear once loaded, not just once
    // at connect time (_syncAttachmentProviders() is otherwise a one-shot
    // called from _ensureElements()).
    this._resolvedProviders = undefined;
    this._syncAttachmentProviders();

    this._recomputeWindow();                 // 008 — after `_state` is the new state
    this.requestUpdate();
  }

  protected _ensureSession() {
    if (!this._session) {
      this._session = createAgentSession(this.buildSessionConfig());
      // Built from the current values, so a queued update has nothing to add.
      this._configSyncQueued = false;
    }
    if (!this._unsub) {
      this._subscribeSession(this._session);
    }
    // A property written earlier in this task must reach core before the
    // caller (send, createSession, …) uses the session.
    this._flushConfigSync();
  }

  protected _ensureReadOnlyDataSource() {
    if (this._readOnlyDataSource) return;
    const store = this.store ||
      (typeof window !== "undefined"
        ? (window as unknown as { __APP_STORE__?: HostStore }).__APP_STORE__
        : undefined);
    this._readOnlyDataSource = createDataSourceProvider({
      // `HostStore.getState` is declared `() => unknown` (its real shape is a
      // dependency's, not ours); the data-source provider reads it as a plain
      // state object, same as it always has.
      getState: () => (store?.getState?.() as Record<string, unknown> | undefined) ?? {},
      sources: this.sources || [],
    });
  }

  /** The provider handed to rendered blocks. Rebuilt on demand after the
   *  `sources` setter drops it, so a host that assigns `sources` after the
   *  element connects still gets a provider that knows those sources (003b). */
  protected _readOnlyDataSourceForBlocks() {
    this._ensureReadOnlyDataSource();
    return this._readOnlyDataSource;
  }

  async createSession(): Promise<string> {
    this._ensureSession();
    if (!this._session) return "";
    await this._session.createSession();
    return this._state?.activeSessionId || "";
  }

  async switchSession(id: string): Promise<void> {
    this._ensureSession();
    if (!this._session) return;
    await this._session.switchSession(id);
  }

  async deleteSession(id: string): Promise<void> {
    this._ensureSession();
    if (!this._session) return;
    await this._session.deleteSession(id);
  }

  async clearAllSessions(): Promise<void> {
    this._ensureSession();
    if (!this._session) return;
    await this._session.clearAllSessions();
  }

  protected _showToast(msg: string, type: "error" | "info") {
    if (this.notify) {
      this.notify(msg, type);
    } else {
      this.dispatchEvent(
        new CustomEvent("agent-toast", {
          detail: { message: msg, type },
          bubbles: true,
          composed: true,
        })
      );
      // 008: with no host callback the message used to vanish — the event had
      // no listener in a bare panel. Render it in the panel's one notice
      // instead. A host that sets `notify` is unchanged: it renders its own
      // toast, gets no event, and sees no panel notice.
      this._transientWarning = { text: msg };
      this.requestUpdate();
    }
  }

  async send(input: string | {
    text: string;
    images?: { dataUrl: string; mediaType: string }[];
  }, opts?: { userDisplayText?: string }): Promise<SendOutcome> {
    this._forceScrollToBottom = true;
    this._ensureSession();
    if (!this._session) return { ran: "none" };
    const text = typeof input === "string" ? input : input.text;
    // 113/002 — a programmatic send is parsed exactly like a typed one, so the
    // side panel's `send_to_page_agent` can run `/compact` and `/new` in the
    // in-page agent with no new tool and no new bridge message. `_handleSend`
    // does the same check for the composer at chat-panel-composer.ts:185, and cannot run a command
    // twice: the text it forwards here has already been through the parser.
    // The check sits AFTER `_ensureSession()` because `_runSlashCommand`
    // resolves the command through `this._session`; before it, the first send
    // into a fresh panel would find no session and post "/new" as text.
    const command = text ? this._runSlashCommand(text) : null;
    if (command !== null) return { ran: "command", command };
    const images = typeof input !== "string" ? input.images : undefined;

    const parts: CoreMessagePart[] = [];
    if (text) {
      parts.push({ type: "text", text });
    }
    if (images) {
      for (const img of images) {
        parts.push({ type: "image", dataUrl: img.dataUrl, mediaType: img.mediaType });
      }
    }

    this.error = null;
    // Only forward a second argument when the caller actually passed opts —
    // an explicit `undefined` second arg is a different call shape than one
    // argument as far as a mock's toHaveBeenCalledWith is concerned, and
    // existing callers (composer send, retry) rely on the one-arg form.
    if (opts) {
      await this._session.send(parts, opts);
    } else {
      await this._session.send(parts);
    }
    return { ran: "message" };
  }

  stop() {
    this._session?.abort();
  }

  async compactSession() {
    this._ensureSession();
    try {
      await this._session?.compact();
    } catch {
      // Controller tracks error in state and marks journal entry failed; UI updates via listener
    }
  }

  // --- Host-driven header API (083 task 001) ---
  // Everything the built-in header offers, as plain method calls, so a host can
  // hide the header and build its own.

  /**
   * Rename a session. This is what the built-in header's title-edit control
   * does: it writes the title through core and, for the active session, marks
   * the title as manual so the automatic title generator does not overwrite it
   * on the next turn.
   */
  async renameSession(id: string, title: string): Promise<void> {
    this._ensureSession();
    if (!this._session) return;
    await this._session.setTitle(id, title);
    if (id === this._state?.activeSessionId) {
      this._manualTitle = true;
    }
    this.requestUpdate();
  }

  /**
   * The sessions the built-in history panel lists, read live from the session.
   * Returns an empty array before a session exists. The array is the one core
   * holds, so treat it as read-only; copy it before sorting or splicing.
   */
  listSessions(): SessionMeta[] {
    return this._session?.getState().sessions ?? [];
  }

  /**
   * Switch the model for the next turn, in place. This is what the built-in
   * kebab menu's "Choose model" group does.
   *
   * This is NOT the same as assigning the `model` property:
   *
   * - `panel.model = id` flows through `buildSessionConfig()` into core's
   *   `updateConfig()`, which runs `buildConfig()` and `initAgent()` again. That
   *   builds a NEW transport. The conversation is kept.
   * - `setModel(id)` calls core's `setModel()`, which swaps the id on the live
   *   agent and notifies listeners. The transport, the journal and the
   *   conversation all survive.
   *
   * No-op before a session exists; the session is then created with the `model`
   * property anyway.
   */
  setModel(id: string): void {
    if (!this._session) return;
    this._session.setModel(id);
    this.requestUpdate();
  }

  /**
   * Re-run the last turn, the same way the built-in retry control does. It does
   * nothing while a turn is running, and core ignores it unless the last turn
   * failed.
   */
  async retryLast(): Promise<void> {
    if (this.running) return;
    this._forceScrollToBottom = true;
    await this._session?.retryLast?.();
  }

  /**
   * The full debug log the built-in debug view shows in its first textarea: the
   * host and agent config as JSON, then every message, turn and tool call.
   * Build your own debug view from this string.
   */
  getDebugLog(): string {
    return this._serializeDebugLog(this._debugConfigSnapshot());
  }


  protected _handleBlockButton(e: CustomEvent<{ prompt: string }>) {
    if (this.running) return;
    if (this._submitting) return;
    this._submitting = true;
    // The agent still needs the `[ui_action:button]` marker (buttonToMessage),
    // but the visible bubble must show only the button's own prompt text (B-7).
    const promptText = e.detail.prompt;
    const msg = buttonToMessage(promptText);
    void this.send(msg, { userDisplayText: promptText }).finally(() => { this._submitting = false; });
  }

  protected _handleBlockSubmit(
    e: CustomEvent<{ id: string; values: Record<string, unknown> }>,
  ) {
    if (this.running) return;
    if (this._submitting) return;
    this._submitting = true;
    const msg = formSubmitToMessage(e.detail.id, e.detail.values);
    void this.send(msg).finally(() => { this._submitting = false; });
  }

  protected _handleEvent(e: SessionEvent) {
    if (e.type === "auto-retry:attempt") {
      this._retryAttempt = { attempt: e.attempt, maxRetries: e.maxRetries, reason: e.error.message };
      this.requestUpdate();
    } else if (e.type === "retry:success" || e.type === "retry:failure") {
      this._retryAttempt = undefined;
      this.requestUpdate();
    } else if (e.type === "provider:fallback") {
      for (const f of e.failed) {
        this._fallbackLog.push(`${f.provider}/${f.model} failed: ${f.message}`);
      }
      if (e.answered) {
        this._fallbackLog.push(`${e.answered.provider}/${e.answered.model} answered`);
      }
      this.requestUpdate();
    }
  }

  protected _handleRetry() {
    if (this.running) return;
    this._forceScrollToBottom = true;
    void this._session?.retryLast?.();
  }
}
