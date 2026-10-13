import { REGISTRY_STYLES } from "../ui/registry-styles.js";
import { html, nothing } from "../ui/template.js";
import type { WaSelectDetail } from "../ui/types.js";
import {
  type AttachmentProvider,
  imageAttachmentProvider,
} from "@cuatoi/web-agent-core";
import { ChatPanelState } from "./chat-panel-state.js";

/** The panel-level plumbing every render depends on: the registry stylesheet
 *  and the slash menu (both plain elements, kept across renders), plus the
 *  attachment-provider and composer state that keeps the template-bound
 *  `<wa-*>` widgets correct. Moved verbatim out of chat-panel.ts. */
export abstract class ChatPanelElements extends ChatPanelState {

  protected _ensureElements() {
    if (this._elementsCreated) return;
    this._elementsCreated = true;

    this._registryStyleEl = document.createElement("style");
    this._registryStyleEl.setAttribute("data-wa-styles", "registry");
    this._registryStyleEl.textContent = REGISTRY_STYLES;

    // 105/003 — the "/" menu, built once. The anchor is a zero-height block
    // rendered above `.composer` inside `.input-area`; the menu is absolutely
    // positioned against it with `bottom: 100%`, so it sits directly above the
    // composer and is clipped by `agent-chat-panel { overflow: hidden }`
    // (chat-panel-shell-css.ts:23) rather than escaping the panel the way a
    // `position: fixed` popup would.
    this._slashAnchorEl = document.createElement("div");
    this._slashAnchorEl.className = "wa-slash-anchor";
    this._slashMenuEl = document.createElement("div");
    this._slashMenuEl.className = "wa-slash-menu";
    this._slashMenuEl.id = "wa-slash-listbox";
    this._slashMenuEl.setAttribute("role", "listbox");
    this._slashMenuEl.setAttribute("aria-label", "Commands");
    this._slashMenuEl.hidden = true;
    // Keep focus in the composer when a row is clicked: mousedown would blur
    // the textarea first, firing `focusout`.
    this._slashMenuEl.addEventListener("mousedown", (e) => e.preventDefault());
    this._slashAnchorEl.appendChild(this._slashMenuEl);

    this._syncAttachmentProviders();
  }

  /** The providers this panel OWNS: the built-in image provider (when enabled)
   *  followed by the host's `attachmentProviders`. This — and only this — is
   *  what `buildSessionConfig()` sends to core. It must never include a
   *  provider read back from the session, or removing a provider becomes
   *  impossible: the panel would keep re-seeding the session with the list it
   *  previously resolved from that same session (002). Returns a fresh array on
   *  every call, and is never cached, so a removal takes effect at once. */
  protected _ownProviders(): AttachmentProvider[] {
    const list: AttachmentProvider[] = [];
    if (this._imageInput !== false) {
      this._imageProvider ??= imageAttachmentProvider({
        limits: () => this._images,
        onNotify: (msg, type) => this._showToast(msg, type),
      });
      list.push(this._imageProvider);
    }
    list.push(...(this._attachmentProviders ?? []));
    return list;
  }

  /** Registry contents for RENDERING: this panel's own providers, then the
   *  providers a `toolProviders` entry (e.g. domTools()'s picker) registered on
   *  the SESSION (007) — core only learns of those once they load
   *  asynchronously, so they reach this seam via
   *  `session.getAttachmentProviders()` rather than the `attachmentProviders`
   *  property. Deduped by id, so an own provider that shares an id with a
   *  session one still yields a single icon. */
  protected _resolveProviders(): AttachmentProvider[] {
    if (this._resolvedProviders) return this._resolvedProviders;
    const list = this._ownProviders();
    const seen = new Set(list.map((p) => p.id));
    for (const p of this._session?.getAttachmentProviders?.() ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      list.push(p);
    }
    this._resolvedProviders = list;
    return list;
  }

  /** Renders one provider's dynamic presentation (`view()`, defaulting every
   *  field to the provider's static `icon`/`label`, not disabled, no
   *  tooltip) as a `<wa-icon-button>` template — the element persists across
   *  renders on its own (lit-html reuses the host node at this template
   *  position), so no cached-element bookkeeping is needed here. */
  protected _providerButton(p: AttachmentProvider): unknown {
    const v = p.view?.() ?? {};
    const icon = v.icon ?? p.icon;
    const label = v.label ?? p.label;
    const disabled = v.disabled ?? false;
    const tooltip = v.tooltip;
    return html`<wa-icon-button
      id=${`${this._attachAnchorPrefix}-${p.id}`}
      data-attachment-provider=${p.id}
      .icon=${icon}
      .label=${label}
      .disabled=${disabled}
      title=${tooltip !== undefined ? tooltip : nothing}
      @press=${() => this._onProviderPress(p)}
    ></wa-icon-button>`;
  }

  /** 128/003 — a provider with `choices()` opens a menu; any other provider
   *  is picked at once, exactly as before. A second press closes the menu. */
  protected _onProviderPress(p: AttachmentProvider): void {
    const choices = p.choices?.() ?? [];
    if (choices.length === 0) {
      void p.pick();
      return;
    }
    if (this._attachMenuFor === p.id) {
      this._closeAttachMenu();
      return;
    }
    this._attachMenuFor = p.id;
    this._attachMenuItems = choices.map((c) => ({ id: c.id, label: c.label }));
    this.requestUpdate();
  }

  /** Runs inside the menu item's click, so the provider's picker sees the
   *  user's action. */
  protected _onAttachMenuSelect(choiceId: string): void {
    const p = this._resolveProviders().find((x) => x.id === this._attachMenuFor);
    this._closeAttachMenu();
    if (p) void p.pick(choiceId);
  }

  protected _closeAttachMenu(): void {
    if (this._attachMenuFor === null) return;
    this._attachMenuFor = null;
    this._attachMenuItems = [];
    this.requestUpdate();
  }

  /** The one choices menu, anchored to the pressed provider's button.
   *  `anchor-id` is bound FIRST: lit commits bindings in template order, and
   *  cat-store's AcmeMenu resolves its anchor in the `open` setter. */
  protected _renderAttachMenu(): unknown {
    const anchor = this._attachMenuFor === null
      ? nothing
      : `${this._attachAnchorPrefix}-${this._attachMenuFor}`;
    return html`<wa-menu
      anchor-id=${anchor}
      class="wa-attach-menu"
      .items=${this._attachMenuItems}
      .open=${this._attachMenuFor !== null}
      @select=${(e: CustomEvent<WaSelectDetail>) => { e.stopPropagation(); this._onAttachMenuSelect(e.detail.id); }}
      @request-close=${() => this._closeAttachMenu()}
    ></wa-menu>`;
  }

  /** Rebuild the change subscriptions when the provider list changes. */
  protected _syncAttachmentProviders(): void {
    const providers = this._resolveProviders();
    for (const un of this._attachmentUnsubs) un();
    this._attachmentUnsubs = providers.flatMap((p) => {
      const un = p.subscribe?.(() => {
        this._updateSendButtonState();
        this.requestUpdate();
      });
      return un ? [un] : [];
    });
  }

  protected _hasPendingAttachments(): boolean {
    return this._resolveProviders().some((p) => p.hasPending());
  }

  /** First provider that consumes the event wins. */
  protected _forwardToProviders<E extends Event>(
    pick: (p: AttachmentProvider) => ((e: E) => boolean) | undefined,
    e: E,
  ): void {
    for (const p of this._resolveProviders()) {
      if (pick(p)?.(e)) { e.preventDefault(); return; }
    }
  }


  /** Called on every `<wa-text-area>` keystroke — updates the reactive field
   *  so a later render (triggered by anything else) never clobbers what was
   *  typed, then re-renders only when the Stop/Send choice or the Send
   *  button's enabled state actually flips. A redraw on every keystroke would
   *  replace every rendered block element and rebuild each chart. */
  protected _onComposerInput(value: string): void {
    this._composerValue = value;
    this._syncComposerControls();
    // 105/003 P10 — the "/" menu tracks what is typed. It writes into its own
    // element and never calls requestUpdate(), so the rule above holds.
    this._updateSlashMenu();
  }

  protected _hasContent(): boolean {
    return this._composerValue.trim().length > 0 || this._hasPendingAttachments();
  }

  /** Re-renders only when the Stop/Send choice or the Send button's enabled
   *  state actually changed — which cannot happen while the panel is idle. */
  protected _syncComposerControls(): void {
    const showStop = this._showStopButton();
    const hasContent = this._hasContent();
    if (this._lastShowStop !== showStop || this._lastHasContent !== hasContent) {
      this._lastShowStop = showStop;
      this._lastHasContent = hasContent;
      this.requestUpdate();
    }
  }

  protected _updateSendButtonState() {
    this._lastHasContent = this._hasContent();
  }

  /** running or compacting + empty composer → Stop; every other case → Send
   *  (not running is always Send, disabled when empty; running + typed
   *  content is Send, enabled — sends/queues via the existing path). */
  protected _showStopButton(): boolean {
    return (this.running || this.compacting) && !this._hasContent();
  }
}
