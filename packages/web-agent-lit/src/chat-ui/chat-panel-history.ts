import { html, nothing, repeat } from "../ui/template.js";
import { defineUiElements } from "../ui/registry.js";
import { ChatPanelSession } from "./chat-panel-session.js";
import { formatSessionLabel, formatTimestamp } from "./session-label.js";

defineUiElements();

/** The session-history dropdown: its open/close lifecycle, the panel element
 *  it builds imperatively, and the row actions. Moved verbatim out of
 *  chat-panel.ts. */
export abstract class ChatPanelHistory extends ChatPanelSession {
  // --- History panel lifecycle ---

  protected _toggleHistoryPanel(): void {
    if (this._historyPanelOpen) {
      this._closeHistoryPanel();
      return;
    }
    this._historyPanelOpen = true;
    void this._refreshHistorySessions();
    this.requestUpdate();
  }

  protected _closeHistoryPanel(): void {
    this._detachHistoryListeners();
    this._historyPanelOpen = false;
    this.requestUpdate();
  }

  protected _detachHistoryListeners(): void {
    if (this._historyOutsideHandler) {
      document.removeEventListener("click", this._historyOutsideHandler);
      this._historyOutsideHandler = undefined;
    }
    if (this._historyKeyHandler) {
      this.removeEventListener("keydown", this._historyKeyHandler);
      this._historyKeyHandler = undefined;
    }
  }

  protected _attachHistoryListeners(container: HTMLElement): void {
    // Remove any prior pair first (idempotent — never double-attach)
    this._detachHistoryListeners();
    this._historyOutsideHandler = (e: MouseEvent) => {
      // Document.getElementById does not search into shadow trees, and
      // this panel can now render inside <web-agent-bubble>'s shadow root.
      // this.querySelector reaches #history-anchor regardless — it is a
      // normal light-DOM descendant of the panel itself either way.
      //
      // e2e-fix 001: test composedPath(), not Node.contains(). When the panel
      // renders inside a shadow root, a listener on `document` sees `e.target`
      // retargeted to the outermost host element, so both `contains()` checks
      // are false and the panel closed on the very click that opened it.
      // composedPath() lists every node the event travelled through, including
      // nodes inside open shadow roots, so the anchor and the dropdown are
      // found however deeply the panel is mounted. Same idiom as the slash
      // menu's listener in chat-panel-composer.ts:129.
      const anchor = this.querySelector("#history-anchor");
      const path = e.composedPath();
      if (path.includes(container)) return;
      if (anchor && path.includes(anchor)) return;
      this._closeHistoryPanel();
    };
    this._historyKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this._closeHistoryPanel();
      }
    };
    document.addEventListener("click", this._historyOutsideHandler);
    this.addEventListener("keydown", this._historyKeyHandler);
  }

  protected async _refreshHistorySessions(): Promise<void> {
    this._ensureSession();
    if (!this._session) return;
    try {
      await this._session.refreshSessions();
    } catch (e) {
      console.error("[history] refreshSessions failed:", e);
    }
  }

  protected _syncHistoryPopup(): void {
    const popup = this._historyPanelOpen
      ? this.querySelector<HTMLElement>(".wa-history-popup")
      : null;
    if (popup && !this._historyPopupShown) {
      this._historyPopupShown = true;
      this._attachHistoryListeners(popup);
      this._positionHistoryPopup(popup);
    } else if (!popup && this._historyPopupShown) {
      this._historyPopupShown = false;
      this._detachHistoryListeners();
    }
  }

  protected _positionHistoryPopup(container: HTMLElement): void {
    const anchor = this.querySelector("#history-anchor");
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const contRect = container.getBoundingClientRect();
    const contW = contRect.width;
    const contH = contRect.height;
    let top = rect.bottom;
    let left = rect.left;
    if (left + contW > vw) left = rect.right - contW;
    if (left < 4) left = 4;
    if (top + contH > vh) top = rect.top - contH;
    if (top < 4) top = 4;
    container.style.top = `${top}px`;
    container.style.left = `${left}px`;
  }

  protected _renderHistoryPanel() {
    if (!this._historyPanelOpen) return nothing;
    const sessions = this._state?.sessions || [];
    const activeId = this._state?.activeSessionId || "";
    return html`
      <div class="wa-history-popup" role="dialog" tabindex="-1">
        <div class="wa-history-list">
          ${repeat(sessions, (s) => s.id, (s) => html`
            <div
              class="wa-history-row"
              data-session-id=${s.id}
              aria-current=${s.id === activeId ? "true" : "false"}
              @click=${(e: MouseEvent) => this._handleHistoryRowClick(e, s.id)}
            >
              <div class="wa-history-info">
                <div class="wa-history-name">${formatSessionLabel(s)}</div>
                <div class="wa-history-time">${formatTimestamp(s.updatedAt)}</div>
              </div>
              <wa-icon-button
                icon="delete"
                .label=${`Delete session "${s.title || "untitled"}"`}
                .disabled=${this.running}
                @press=${() => this._handleHistoryDelete(s.id)}
              ></wa-icon-button>
            </div>
          `)}
        </div>
        <div class="wa-history-new">
          <wa-button
            label="+ New Session"
            variant="primary"
            .disabled=${this.running}
            @press=${() => this._handleHistoryNewSession()}
          ></wa-button>
        </div>
        <div class="wa-history-clear">
          <wa-button
            label="Clear all history"
            variant="danger"
            .disabled=${this.running || sessions.length === 0}
            @press=${() => this._handleClearAllHistory()}
          ></wa-button>
        </div>
      </div>
    `;
  }

  protected _handleHistoryRowClick(e: MouseEvent, id: string): void {
    if ((e.target as HTMLElement).closest("wa-icon-button, button")) return;
    this._handleHistorySwitch(id);
  }

  protected _handleHistoryDelete(id: string): void {
    if (!confirm("Delete this session?")) return;
    this._focusRowAfterDelete(id);
    void this.deleteSession(id);
  }

  /** A row's delete button is what has focus when this runs (it is what was
   *  just clicked). The moment that row's DOM node is removed — whether by
   *  this delete landing immediately, or later once the list refreshes —
   *  focus reverts to the page body, outside the panel entirely, and
   *  `_historyKeyHandler` (bound to `this`, the panel) never sees Escape
   *  again: `_historyPanelOpen` stays `true`, and the next click on
   *  `#history-anchor` *closes* the panel instead of reopening it.
   *
   *  Move focus into a row that survives the delete before it happens:
   *  the next row's delete button, falling back to the previous row's, and
   *  to the dialog container itself (`tabindex="-1"` on `.wa-history-popup`)
   *  when this was the only row. `<wa-icon-button>` is a light-DOM wrapper —
   *  a Material-backed registry keeps its real, focusable control one level
   *  inside it, in shadow DOM the wrapper does not have (see
   *  `_handleTitleEditOpen` in chat-panel-screens.ts for the same shape). */
  protected _focusRowAfterDelete(id: string): void {
    // A plain `[data-session-id="…"]` attribute selector would need the id
    // escaped before it could be embedded safely; matching by dataset value
    // avoids that entirely.
    const rows = Array.from(this.querySelectorAll<HTMLElement>(".wa-history-row"));
    const index = rows.findIndex((r) => r.dataset.sessionId === id);
    const targetRow = index === -1 ? null : (rows[index + 1] ?? rows[index - 1] ?? null);
    const wrapper = targetRow?.querySelector<HTMLElement>("wa-icon-button") ?? null;
    const focusable = (wrapper?.querySelector("button, md-icon-button") as HTMLElement | null) ?? wrapper;
    if (focusable) {
      focusable.focus();
      return;
    }
    this.querySelector<HTMLElement>(".wa-history-popup")?.focus();
  }

  protected _handleHistorySwitch(id: string): void {
    if (id === (this._state?.activeSessionId || "")) {
      this._closeHistoryPanel();
      return;
    }
    if (!confirm("Switch to this session?")) return;
    void this.switchSession(id);
    this._closeHistoryPanel();
  }

  protected _handleHistoryNewSession(): void {
    void this.createSession();
    this._closeHistoryPanel();
  }

  protected _handleClearAllHistory(): void {
    if (!confirm("Clear ALL history? This permanently deletes every saved session and cannot be undone.")) return;
    void this.clearAllSessions();
    this._closeHistoryPanel();
  }

}
