import { html } from "../ui/template.js";
import { defineUiElements } from "../ui/registry.js";
import type { WaSelectDetail, WaValueInputDetail } from "../ui/types.js";
import { resolveModelLabel } from "@cuatoi/web-agent-core";
import "./message-view.js";
import "./context-gauge.js";
import "./schedule-clock.js";
import "./todo-indicator.js";
import { getAgentCursor } from "./agent-cursor.js";
import { messageViewStyles } from "./message-view-styles.js";
import { ChatPanelWindow } from "./chat-panel-window.js";
import { PANEL_SHELL_CSS } from "./chat-panel-shell-css.js";
import { PANEL_COMPOSER_CSS } from "./chat-panel-composer-css.js";
import { PANEL_SCREENS_CSS } from "./chat-panel-screens-css.js";
import type { HostStore, PanelAppContext, PanelMenuItemDef } from "./types.js";

export type { HostStore, PanelAppContext };
export { formatSessionLabel, formatTimestamp } from "./session-label.js";

defineUiElements();

export class AgentChatPanel extends ChatPanelWindow {
  private readonly _onPaste = (e: Event) => this._handlePaste(e as ClipboardEvent);
  private readonly _onDragOver = (e: Event) => this._handleDragOver(e as DragEvent);
  private readonly _onDrop = (e: Event) => this._handleDrop(e as DragEvent);

  static get observedAttributes() {
    return ["path", "model", "type", "thinking", "hide-header"];
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
    if (name === "path") {
      this.path = newVal || undefined;
    } else if (name === "model") {
      this.model = newVal || undefined;
    } else if (name === "type") {
      this.type = newVal || undefined;
    } else if (name === "thinking") {
      this.thinking = newVal !== null;
    } else if (name === "hide-header") {
      const boolVal = newVal !== null && newVal !== "false";
      if (this.hideHeader !== boolVal) {
        this.hideHeader = boolVal;
      }
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("data-agent-ui", "true");
    if (this._hideHeader) {
      this.setAttribute("hide-header", "");
    }
    this._ensureElements();
    this._ensureSession();
    this._ensureReadOnlyDataSource();

    // Drag-and-drop on the panel itself
    this.addEventListener("dragover", this._onDragOver);
    this.addEventListener("drop", this._onDrop);

    // Stop key events from bubbling outside the panel to the host
    this.addEventListener("keydown", this._stopKeyPropagation);
    this.addEventListener("keyup", this._stopKeyPropagation);
    this.addEventListener("keypress", this._stopKeyPropagation);
    this.addEventListener("wa-image-open", this._onImageOpen);
    this.addEventListener("keydown", this._onOverlayKeydown);
  }

  disconnectedCallback() {
    this._unsub?.();
    this._unsub = undefined;
    this._eventsUnsub?.();
    this._eventsUnsub = undefined;
    this._cancelLoadOlder();
    if (this._scrollRafId !== null) {
      cancelAnimationFrame(this._scrollRafId);
      this._scrollRafId = null;
    }
    for (const un of this._attachmentUnsubs) un();
    this._attachmentUnsubs = [];
    this.removeEventListener("keydown", this._stopKeyPropagation);
    this.removeEventListener("keyup", this._stopKeyPropagation);
    this.removeEventListener("keypress", this._stopKeyPropagation);
    this.removeEventListener("wa-image-open", this._onImageOpen);
    this.removeEventListener("keydown", this._onOverlayKeydown);
    this.removeEventListener("dragover", this._onDragOver);
    this.removeEventListener("drop", this._onDrop);
    this._detachHistoryListeners();
    this._historyPopupShown = false;
    // 105/003 — drops the document-level outside-click listener.
    this._closeSlashMenu();
    try {
      getAgentCursor().clear();
    } catch { /* the cursor layer may already be gone; nothing to clean up */ }
  }

  dispose() {
    this._unsub?.();
    this._unsub = undefined;
    this._eventsUnsub?.();
    this._eventsUnsub = undefined;
    if (this._scrollRafId !== null) {
      cancelAnimationFrame(this._scrollRafId);
      this._scrollRafId = null;
    }
    this._session?.dispose();
    this._session = undefined;
  }

  private _pinAfterRender = true;

  /** Captured before `render()` mutates `.messages-list`, while the previous
   *  frame's layout is still clean, so the read costs no synchronous layout.
   *  Measuring after the render also saw the already-grown `scrollHeight`, and
   *  failed the 30 px test whenever one render added more than that. */
  override willUpdate() {
    if (this._forceScrollToBottom || !this._didTranscriptChange()) {
      this._pinAfterRender = false;
      return;
    }
    const list = this.querySelector(".messages-list");
    this._pinAfterRender = list ? (list.scrollHeight - list.scrollTop - list.clientHeight < 30) : true;
  }

  updated() {
    this._ensureElements();
    this._updateSendButtonState();
    this._lastShowStop = this._showStopButton();
    this._syncHistoryPopup();
    if (this._forceScrollToBottom || this._pinAfterRender) this._scrollToBottomQueue();
  }


  private _menuItemDefs(): PanelMenuItemDef[] {
    const defs: PanelMenuItemDef[] = [];
    const models = this._models ?? [];
    if (models.length >= 2) {
      const activeId = this.selectedModel ?? this._state?.model;
      defs.push({ id: "model-header", label: "Choose model", disabled: true, run: () => {} });
      for (const m of models) {
        const label = resolveModelLabel(models, m.id);
        defs.push({
          id: `model:${m.id}`,
          label: m.id === activeId ? `✓ ${label}` : label,
          icon: m.icon,
          checked: m.id === activeId,
          run: () => this._onModelPick(m),
        });
      }
    }
    defs.push({
      id: "config",
      label: "Configuration",
      run: () => {
        this._menuOpen = false;
        this._openScreen = null;
        this._renderedScreenId = null;
        this._renderedScreenEl = null;
        this._toggleConfig();
      },
    });
    for (const s of this._screens ?? []) {
      defs.push({
        id: `screen:${s.id}`,
        label: s.label,
        run: () => {
          this._menuOpen = false;
          if (this._openScreen !== s.id) {
            this._renderedScreenId = null;
            this._renderedScreenEl = null;
          }
          this._openScreen = s.id;
          this._configOpen = false;
          this._debugOpen = false;
          this.requestUpdate();
        },
      });
    }
    if (this.debug) {
      defs.push({
        id: "debug",
        label: "Debug",
        run: () => {
          this._menuOpen = false;
          this._openScreen = null;
          this._renderedScreenId = null;
          this._renderedScreenEl = null;
          this._toggleDebug();
        },
      });
    }
    return defs;
  }

  private _onModelPick(m: import("@cuatoi/web-agent-core").ModelOption): void {
    this._menuOpen = false;
    const ev = new CustomEvent<{ id: string }>("agent-model-select", {
      detail: { id: m.id }, bubbles: true, composed: true, cancelable: true,
    });
    this.dispatchEvent(ev);
    if (!ev.defaultPrevented) {
      this._session?.setModel(m.id);
      this._model = m.id;
    }
    this.requestUpdate();
  }

  private _menuItems() {
    const defs = this._menuItemDefs();
    this._menuDefs = defs;
    const key = JSON.stringify(defs.map((d) => [d.id, d.label, !!d.disabled, d.icon, !!d.checked]));
    if (key !== this._menuItemsKey) {
      this._menuItemsKey = key;
      this._menuItemsCache = defs.map(({ id, label, disabled, icon, checked }) => ({ id, label, disabled, icon, checked }));
    }
    return this._menuItemsCache;
  }

  private _runMenuItem(id: string): void {
    this._menuDefs.find((d) => d.id === id)?.run();
  }

  private _closeMenu(): void {
    if (!this._menuOpen) return;
    this._menuOpen = false;
    this.requestUpdate();
  }

  private _onImageOpen = (e: Event) => {
    const detail = (e as CustomEvent<{ src: string }>).detail;
    this._overlaySrc = detail?.src ?? null;
    // The element that dispatched the event (the clicked <button> for a tool
    // thumbnail, the non-focusable <img> for a user attachment). Focus is
    // returned to it on close.
    this._overlayOpener = (e.composedPath()[0] as HTMLElement) ?? null;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.querySelector<HTMLElement>(".wa-image-overlay")?.focus();
    });
  };

  // On the panel root, not the overlay, so Escape closes it from anywhere in
  // the panel. The overlay is modal and has nothing to tab to, so Tab keeps
  // the focus on it instead of moving it behind the overlay or out of the panel.
  private _onOverlayKeydown = (e: KeyboardEvent) => {
    if (!this._overlaySrc) return;
    if (e.key === "Escape") this._closeImageOverlay();
    else if (e.key === "Tab") {
      e.preventDefault();
      this.querySelector<HTMLElement>(".wa-image-overlay")?.focus();
    }
  };

  private _closeImageOverlay() {
    this._overlaySrc = null;
    this._overlayOpener?.focus();
    this._overlayOpener = null;
    this.requestUpdate();
  }

  private _renderImageOverlay() {
    return html`
      <div
        class="wa-image-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Image"
        tabindex="-1"
        @click=${() => this._closeImageOverlay()}
      >
        <img
          src="${this._overlaySrc ?? ""}"
          alt="Full-size image"
          @click=${(e: Event) => e.stopPropagation()}
        />
      </div>
    `;
  }

  template() {
    const activeSession = this._state?.sessions.find(
      (s) => s.id === this._state?.activeSessionId
    );
    // 124/007 — built once per render, not once per message.
    const toolPhrases = this._toolPhrases();
    const headerTitle = activeSession?.title?.trim()
      ? activeSession.title
      : (this._agentName?.trim()
        ? this._agentName
        : (this.appContext?.appName
          ? `🤖 ${this.appContext.appName} Assistant`
          : "🤖 Assistant"));

    return html`
      <style>
${PANEL_SHELL_CSS}${PANEL_COMPOSER_CSS}${PANEL_SCREENS_CSS}
      </style>
      ${this._registryStyleEl}
      ${/* 011 — one message-row stylesheet for the whole thread. A row renders
            its own copy only with no <agent-chat-panel> ancestor. */ ""}
      ${messageViewStyles}
      ${this._hideHeader
        ? ""
        : html`<div class="header">
            <div class="wa-header-left ${this._titleEditActive ? "wa-title-edit-row" : ""}">
              ${this._titleEditActive
                ? html`
                    <wa-text-input
                      .value=${this._titleEditValue}
                      .placeholder=${"Session title…"}
                      @value-input=${(e: CustomEvent<WaValueInputDetail>) => { this._titleEditValue = e.detail.value; }}
                      @keydown=${(e: KeyboardEvent) => this._handleTitleEditKeydown(e)}
                      @keyup=${(e: KeyboardEvent) => this._handleTitleEditKeyup(e)}
                    ></wa-text-input>
                    <wa-icon-button icon="check" label="Save title"
                      @press=${() => this._handleTitleEditConfirm()}></wa-icon-button>
                    <wa-icon-button icon="close" label="Cancel title edit"
                      @press=${() => this._handleTitleEditCancel()}></wa-icon-button>`
                : html`<span
                      class="header-title"
                      @dblclick=${(e: MouseEvent) => this._handleTitleDblClick(e)}
                    >${headerTitle}</span>
                    ${(this.config?.persist !== false)
                      ? html`<wa-icon-button icon="edit" label="Edit session title"
                          class="wa-title-edit-btn"
                          .disabled=${this.running}
                          @press=${() => this._handleTitleEditOpen()}></wa-icon-button>`
                      : ""}`
              }
            </div>
            <div class="wa-header-actions">
              ${(this.config?.persist !== false)
                ? html`<wa-icon-button icon="add_comment" label="New session"
                    .disabled=${this.running}
                    @press=${() => { void this.createSession(); }}></wa-icon-button>`
                : ""}
              ${(this.config?.persist !== false)
                ? html`<wa-icon-button id="history-anchor" icon="history" label="Session history"
                    .disabled=${this.running}
                    @press=${() => this._toggleHistoryPanel()}></wa-icon-button>`
                : ""}
              <wa-icon-button id="menu-anchor" icon="more_vert" label="Menu options"
                @press=${() => this._toggleMenu()}></wa-icon-button>
              <wa-menu
                .open=${this._menuOpen}
                .items=${this._menuItems()}
                anchor-id="menu-anchor"
                @select=${(e: CustomEvent<WaSelectDetail>) => this._runMenuItem(e.detail.id)}
                @request-close=${() => this._closeMenu()}
              ></wa-menu>
              ${this._renderHistoryPanel()}
            </div>
          </div>`}

      ${(!this._hideHeader && this._debugOpen)
        ? this._renderDebugView()
        : (!this._hideHeader && this._configOpen)
        ? this._renderConfigView()
        : (!this._hideHeader && this._openScreen)
        ? (() => {
            const s = this._screens?.find((sc) => sc.id === this._openScreen);
            return s ? this._renderScreenFrame(s) : "";
          })()
        : html`
            ${this.running && !this._state?.inProgressTurnId
              ? html`<wa-progress .indeterminate=${true}></wa-progress>`
              : ""}

            <div
              class="messages-list"
              @scroll=${(e: Event) => this._handleListScroll(e.currentTarget as HTMLElement)}
              @block-button=${(e: CustomEvent<{ prompt: string }>) => this._handleBlockButton(e)}
              @block-submit=${(e: CustomEvent<{ id: string; values: Record<string, unknown> }>) => this._handleBlockSubmit(e)}
            >
              ${/* 009 — the older-window loader, at the head of the list.
                    Rendered bare, exactly as the plan's pseudo code and the
                    mockup's `loading-strip` show it: `.wa-working-dots`
                    already carries its own flex layout and padding, and a
                    bare node cannot collide with the bottom loader's
                    `.message-row.assistant .message-container.assistant > div`
                    selector (`apps/cat-store/e2e/working-dots.mock.spec.ts:22`). */ ""}
              ${this._loadingOlder ? html`<wa-working-dots></wa-working-dots>` : ""}
              ${/* 011 — a message that carries `parts` already holds its text
                    there, so the row gets `.text` empty and the view does not
                    write a text->html cache the following `.parts` write would
                    throw away in the same property batch. */ ""}
              ${this._visibleMessages().map(
                (msg) => html`
                  <agent-message-view
                    .role=${msg.role}
                    .text=${msg.parts?.length ? "" : (msg.text || "")}
                    .images=${msg.images || []}
                    .trace=${msg.trace}
                    .blocks=${msg.blocks || []}
                    .parts=${msg.parts}
                    .promptMeta=${msg.promptMeta}
                    .disabled=${msg.disabled}
                    .dataSource=${this._readOnlyDataSourceForBlocks()}
                    .registry=${this.registry}
                    .userAvatar=${this._userAvatar}
                    .agentAvatar=${this._agentAvatar}
                    .userName=${this.appContext?.userName}
                    .agentShortName=${this.agentShortName}
                    .toolRenderers=${this._toolRenderers}
                    .toolPhrases=${toolPhrases}
                  ></agent-message-view>
                `,
              )}
              ${(() => {
                const showWorkingDots =
                  (this.running && !!this._state?.inProgressTurnId && !this._retryAttempt) || this.compacting;
                if (showWorkingDots) {
                  return html`
                    <div class="message-row assistant">
                      <div class="message-container assistant">
                        <wa-working-dots></wa-working-dots>
                      </div>
                    </div>
                  `;
                }
                return "";
              })()}
              ${this._renderFailedTurnAffordance()}
            </div>

            ${this._renderQueueList()}
            ${this._resolveProviders().map((p) => p.slot?.() ?? "")}
            ${/* 010 — the scroll-to-bottom button. The anchor always reserves space
                  between the list and the composer so the list never resizes when
                  the button appears or disappears. Only the button element inside
                  is toggled. */ ""}
            <div class="wa-jump-anchor">${this._atBottom
              ? ""
              : html`<wa-icon-button icon="arrow_downward" label="Scroll to newest messages"
                  class="wa-jump-btn"
                  @press=${() => { this._forceScrollToBottom = true; this._scrollToBottomQueue(); }}
                ></wa-icon-button>`}
            </div>
            <div class="input-area">
              ${this._slashAnchorEl}
              <div class="composer">
                <wa-text-area
                  id="input"
                  .value=${this._composerValue}
                  .placeholder=${"Ask the assistant..."}
                  @value-input=${(e: CustomEvent<WaValueInputDetail>) => this._onComposerInput(e.detail.value)}
                  @keydown=${(e: KeyboardEvent) => this._handleKeyDown(e)}
                  @paste=${this._onPaste}
                ></wa-text-area>
                <div class="composer-controls">
                  ${this._resolveProviders().map((p) => this._providerButton(p))}
                  <span class="composer-spacer"></span>
                  ${(() => {
                    // 068/003 — absent, not dimmed, when the list is empty.
                    const todos = this._todoItems();
                    if (todos.length === 0) return "";
                    return html`
                      <agent-todo-indicator .items=${todos}></agent-todo-indicator>
                    `;
                  })()}
                  ${(() => {
                    // 109/003 — absent, not dimmed, when nothing is pending.
                    const pending = this._pendingCounts();
                    if (pending.schedules + pending.reminders === 0) return "";
                    return html`
                      <agent-schedule-clock
                        .schedules=${pending.schedules}
                        .reminders=${pending.reminders}
                      ></agent-schedule-clock>
                    `;
                  })()}
                  <agent-context-gauge
                    .percent=${this.usage.percent}
                    .tokens=${this.usage.tokens}
                    .max=${this.usage.max}
                    .warnAt=${this.config?.context?.autoCompactPercent ?? 0.75}
                    .busy=${this.compacting}
                    .disabled=${this.running || this.compacting || !this.canCompact}
                    @compact-request=${() => this.compactSession()}
                  ></agent-context-gauge>
                  ${this._showStopButton()
                    ? html`<wa-icon-button icon="stop" label="Stop" @press=${() => this.stop()}></wa-icon-button>`
                    : html`<wa-icon-button icon="send" label="Send"
                        .disabled=${!this._hasContent()}
                        @press=${() => this._handleSend()}></wa-icon-button>`}
                </div>
              </div>
              ${this._renderAttachMenu()}
            </div>
          `}
      ${this._overlaySrc ? this._renderImageOverlay() : ""}
    `;
  }
}

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}
