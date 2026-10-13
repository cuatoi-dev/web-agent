import { html } from "../ui/template.js";
import { defineUiElements } from "../ui/registry.js";
import {
  parseSlashInput,
  type CommandEntry,
  type MessagePart as CoreMessagePart,
} from "@cuatoi/web-agent-core";
import { filterCommandEntries, renderSlashMenu } from "./slash-menu.js";
import { ChatPanelScreens } from "./chat-panel-screens.js";

defineUiElements();

/** The composer: the "/" command menu, the key handling that drives it, the
 *  send path and the queued-message list. Moved verbatim out of
 *  chat-panel.ts. */
export abstract class ChatPanelComposer extends ChatPanelScreens {
  // --- Slash-command menu (105/003) ---

  /** The element that carries `aria-activedescendant`, and the one whose caret
   *  `pick` moves. The default registry's `<wa-text-area>` keeps a light-DOM
   *  `<textarea>` child, reachable through the `#input` host. cat-store's
   *  `AcmeTextArea` keeps its `<textarea>` in `<md-outlined-text-field>`'s
   *  shadow DOM instead — that field element itself is the fallback, since
   *  Material's field implements `focus()`/`setSelectionRange()` directly
   *  (delegating internally), unlike the plain `<wa-text-area>` wrapper. */
  protected _slashComposerHost(): HTMLElement {
    const host = this.querySelector("#input");
    return (host?.querySelector("textarea, input") as HTMLElement | null)
      ?? (host?.firstElementChild as HTMLElement | null)
      ?? (host as HTMLElement | null)
      ?? this;
  }

  /** P10 `onComposerInput` — recompute the menu from what is in the composer
   *  right now. Opens only when `/` is the FIRST character and nothing after it
   *  is whitespace; a space means the user has moved on to the argument. */
  protected _updateSlashMenu(): void {
    const text = this._composerValue || "";
    if (!text.startsWith("/") || /\s/.test(text)) {
      this._closeSlashMenu();
      return;
    }
    const all = this._session?.commands() ?? [];
    const entries = filterCommandEntries(all, text.slice(1));
    // An empty result closes rather than showing an empty box, so Enter and Tab
    // keep their ordinary behaviour and the typed text can still be sent.
    if (entries.length === 0) {
      this._closeSlashMenu();
      return;
    }
    const opening = !this._slashOpen;
    this._slashEntries = entries;
    this._slashHighlight = 0;
    if (opening) {
      this._slashOpen = true;
      this._slashMenuEl.hidden = false;
      this._attachSlashOutsideListener();
      // Never take more than half the panel — the same rule the composer's own
      // auto-grow uses (`WaTextArea.adjustHeight()` in `ui/wa-text-fields.ts`)
      // — so the menu always fits inside the panel instead of being clipped
      // at its top edge.
      const panelHeight = this.getBoundingClientRect().height;
      this._slashMenuEl.style.maxHeight =
        `${Math.max(120, Math.round(panelHeight * 0.5))}px`;
    }
    this._paintSlashMenu();
  }

  /** Rebuild the listbox for the current entries and highlight. */
  protected _paintSlashMenu(): void {
    renderSlashMenu(this._slashMenuEl, {
      entries: this._slashEntries,
      highlight: this._slashHighlight,
      idPrefix: "wa-slash-opt-",
      onPick: (entry) => this._pickSlashEntry(entry),
    });
    this._slashComposerHost().setAttribute(
      "aria-activedescendant",
      `wa-slash-opt-${this._slashHighlight}`,
    );
    // jsdom 24 does not implement scrollIntoView (verified 2026-09-05), so the
    // call is guarded — in jsdom typeof is "undefined" and row.scrollIntoView throws.
    const row = this._slashMenuEl.querySelector(
      `#wa-slash-opt-${this._slashHighlight}`,
    );
    if (typeof row?.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }

  protected _setSlashHighlight(index: number): void {
    this._slashHighlight = index;
    this._paintSlashMenu();
  }

  protected _closeSlashMenu(): void {
    if (this._slashOutsideHandler) {
      document.removeEventListener("click", this._slashOutsideHandler);
      this._slashOutsideHandler = undefined;
    }
    this._slashOpen = false;
    this._slashEntries = [];
    this._slashHighlight = 0;
    // Reachable from disconnectedCallback before _ensureElements has run.
    if (!this._slashMenuEl) return;
    this._slashMenuEl.hidden = true;
    this._slashMenuEl.replaceChildren();
    this._slashComposerHost().removeAttribute("aria-activedescendant");
  }

  /** P10 `pick` — write `/name ` into the composer, put the caret after the
   *  trailing space, close. NOTHING RUNS: the user presses Enter again on a
   *  closed menu to send, which is what keeps an entry with an argumentHint
   *  reachable from the menu. */
  protected _pickSlashEntry(entry: CommandEntry): void {
    const value = `/${entry.displayName} `;
    this._composerValue = value;
    const composerEl: (HTMLElement & { value: string }) | null = this.querySelector("#input");
    if (composerEl) composerEl.value = value;
    this._closeSlashMenu();
    const host = this._slashComposerHost() as HTMLElement & {
      setSelectionRange?: (start: number, end: number) => void;
    };
    host.focus?.();
    host.setSelectionRange?.(value.length, value.length);
    this._syncComposerControls();
  }

  protected _attachSlashOutsideListener(): void {
    if (this._slashOutsideHandler) {
      document.removeEventListener("click", this._slashOutsideHandler);
    }
    this._slashOutsideHandler = (e: MouseEvent) => {
      // composedPath() crosses shadow boundaries, so this stays correct when
      // the panel renders inside <web-agent-bubble>'s shadow root, where a
      // document-level `e.target` is retargeted to the host element.
      const path = e.composedPath();
      const composerEl = this.querySelector("#input");
      if (path.includes(this._slashMenuEl) || (composerEl && path.includes(composerEl))) return;
      this._closeSlashMenu();
    };
    document.addEventListener("click", this._slashOutsideHandler);
  }

  protected _handleKeyDown(e: KeyboardEvent) {
    // 105/003 P10 — while the menu is open it owns the arrows, Tab, Enter and
    // Escape. Every other key types as usual. An empty list is impossible here
    // (_updateSlashMenu closes on no match), and the length guard keeps the
    // modulo arithmetic safe anyway.
    if (this._slashOpen && this._slashEntries.length > 0) {
      const count = this._slashEntries.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          this._setSlashHighlight((this._slashHighlight + 1) % count);
          return;
        case "ArrowUp":
          e.preventDefault();
          this._setSlashHighlight((this._slashHighlight - 1 + count) % count);
          return;
        case "Tab":
        case "Enter":
          // Tab and Enter are identical: both PICK and neither runs.
          e.preventDefault();
          this._pickSlashEntry(this._slashEntries[this._slashHighlight]);
          return;
        case "Escape":
          e.preventDefault();
          this._closeSlashMenu();
          return;
        default:
          break;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this._handleSend();
    }
  }

  protected _handleSend() {
    this._ensureElements();
    const val = this._composerValue || "";
    if (!val.trim() && !this._hasPendingAttachments()) return;
    this._composerValue = "";
    const composerEl: (HTMLElement & { resetHeight: () => void }) | null = this.querySelector("#input");
    composerEl?.resetHeight();
    this._syncComposerControls();
    // 105/001 P4 — a slash command is intercepted HERE, before session.send().
    // It cannot live in controller.send(): that queues rather than throws when
    // a turn is running, so a command reaching it would be swallowed into the
    // prompt queue as literal text.
    if (this._runSlashCommand(val)) return;
    void this.send({ text: val });
  }

  /** The command name when `text` was a command and has been handled, null when
   *  it must be sent on as ordinary text — an unresolved `/foo`, and a genuine
   *  sentence with a slash in it, are never hijacked. The name is returned
   *  rather than a bare `true` so `send()` can report WHICH command ran
   *  (001/113); `_handleSend` keeps reading it as a truthy value. */
  protected _runSlashCommand(text: string): string | null {
    const parsed = parseSlashInput(text);
    if (!parsed) return null;
    const entry = this._session?.resolveCommand(parsed.name);
    if (!entry) return null;
    // The composer is already cleared above.
    if (this.running) {
      this._session?.enqueueCommand(parsed.name, parsed.argument, text);
      return parsed.name;                 // drains in order when the turn ends
    }
    this.error = null;
    this._forceScrollToBottom = true;
    void (async () => {
      const result = await this._session?.runCommand(entry, parsed.argument);
      if (result && !result.ran && entry.unavailableMessage) {
        this.error = entry.unavailableMessage;
      }
    })();
    return parsed.name;
  }

  protected _handleEditQueued() {
    const item = this._session?.popLastQueued();
    if (!item) return;
    this._ensureElements();
    this._composerValue = item.text;
    const composerEl: (HTMLElement & { value: string }) | null = this.querySelector("#input");
    if (composerEl) composerEl.value = item.text;
    const parts: CoreMessagePart[] = (item.images ?? []).map(
      (img) => ({ type: "image", dataUrl: img.dataUrl, mediaType: img.mediaType }),
    );
    if (parts.length > 0) {
      for (const p of this._resolveProviders()) p.restorePending?.(parts);
    }
    this._updateSendButtonState();
    this.requestUpdate();
    const nativeInput = composerEl?.querySelector("textarea, input") ?? composerEl;
    (nativeInput as HTMLElement)?.focus();
  }

  protected _renderQueueList() {
    const queued = this._state?.queuedMessages ?? [];
    if (queued.length === 0) return "";
    return html`
      <div class="wa-queue-list">
        ${queued.map((q, idx) => html`
          <div class="wa-queue-item">
            <span class="wa-queue-text">${q.text}</span>
            <div class="wa-queue-actions">
              ${idx === queued.length - 1
                ? html`<wa-icon-button icon="edit" label="Edit queued message"
                    @press=${() => this._handleEditQueued()}></wa-icon-button>`
                : ""}
              <wa-icon-button icon="close" label="Cancel queued message"
                @press=${() => this._session?.cancelQueued(q.id)}></wa-icon-button>
            </div>
          </div>
        `)}
      </div>
    `;
  }



  protected _handlePaste(e: ClipboardEvent) {
    this._forwardToProviders((p) => p.onPaste?.bind(p), e);
  }

  protected _handleDragOver(e: DragEvent) {
    this._forwardToProviders((p) => p.onDragOver?.bind(p), e);
  }

  protected _handleDrop(e: DragEvent) {
    this._forwardToProviders((p) => p.onDrop?.bind(p), e);
  }

}
