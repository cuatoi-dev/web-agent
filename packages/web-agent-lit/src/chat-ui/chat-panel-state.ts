import type { AgentSession, SessionMessage } from "@cuatoi/web-agent-core";
import { ChatPanelProps } from "./chat-panel-props.js";
import type { DemoWindowState } from "./types.js";

/** The session-state facing surface of the panel: the retry marker, the
 *  demo/gallery-only setters and the read-through accessors over
 *  `SessionState`. Moved verbatim out of chat-panel.ts. */
export abstract class ChatPanelState extends ChatPanelProps {

  get retryAttempt() { return this._retryAttempt; }
  set retryAttempt(val: { attempt: number; maxRetries: number; reason: string } | undefined) {
    this._retryAttempt = val;
    this.requestUpdate();
  }

  /** Demo/gallery-only: pre-fills the composer to show the Send/Stop icon
   *  swap without a live session. Not used by the product UI itself. */
  get composerText() { return this._composerValue; }
  set composerText(val: string) {
    this._composerValue = val;
    this._syncComposerControls();
    this.requestUpdate();
  }

  /** Demo/gallery-only: opens the config screen without a user click. */
  get configOpen() { return this._configOpen; }
  set configOpen(val: boolean) {
    this._configOpen = !!val;
    if (this._configOpen) this._debugOpen = false; // mutual exclusion
    this.requestUpdate();
  }

  /** Demo/gallery-only: opens the debug screen without a user click. */
  get debugOpen() { return this._debugOpen; }
  set debugOpen(val: boolean) {
    this._debugOpen = !!val;
    if (this._debugOpen) this._configOpen = false; // mutual exclusion
    this.requestUpdate();
  }

  /** Demo/gallery-only: opens the header kebab menu without a user click. */
  get menuOpen() { return this._menuOpen; }
  set menuOpen(val: boolean) {
    this._menuOpen = !!val;
    this.requestUpdate();
  }

  /** Demo/gallery-only: puts the panel into one of the message-window
   *  states without a live session, so `gallery.html` can tile them.
   *
   *  The scroll is applied after the render, from a microtask, and that timing
   *  is load-bearing. The panel's first `updated()` already queued a real
   *  `requestAnimationFrame` to pin the list to its bottom (chat-panel.ts:123-125 ->
   *  `_scrollToBottomQueue()` at chat-panel-window.ts:219). A microtask always runs before the
   *  next frame callback, so cancelling that frame here is what stops the pin
   *  from stomping the position this setter just asked for — the same leftover
   *  frame `chat-panel.scroll-up-loading.test.ts:108-132` cancels for the same
   *  reason.
   *
   *  Setting `scrollTop` fires a real `scroll` event, so `_handleListScroll()`
   *  computes `_atBottom` from real geometry. Callers keep `scrollTop` above
   *  `TOP_THRESHOLD_PX` (chat-panel-window.ts:11) unless they also set
   *  `loadingOlder`, whose own guard at chat-panel-window.ts:314-318 is what stops a real load from starting under a static
   *  tile. */
  set demoWindow(val: DemoWindowState) {
    if (val.windowStart !== undefined) this._windowStart = val.windowStart;
    if (val.loadingOlder !== undefined) this._loadingOlder = val.loadingOlder;
    this.requestUpdate();
    // Demo/gallery-only: a frozen loader photographs the same
    // every time. The pulse keeps one dot at `scale(0.2)` and the others part
    // way up the scale for most of the cycle, so a static capture lands on
    // sub-pixel dots by luck of timing. Freezing parks all three dots at full
    // scale after the render, and only for a gallery tile — the live loader
    // keeps pulsing.
    const freezeDots = val.loadingOlder === true;
    void this.updateComplete.then(() => {
      this._freezeOlderDots(freezeDots);
    });
    if (val.scrollTop === undefined) return;
    const top = val.scrollTop;
    void this.updateComplete.then(() => {
      if (this._scrollRafId !== null) {
        cancelAnimationFrame(this._scrollRafId);
        this._scrollRafId = null;
      }
      this._forceScrollToBottom = false;
      const list = this.querySelector(".messages-list");
      if (list) list.scrollTop = top;
    });
  }

  /** Demo/gallery-only. Freezing parks the older-loader dots at
   *  full scale with their pulse paused, so a static gallery capture always
   *  shows three visible dots. The pause marker is the inline `animation: none`
   *  on each dot, which `WaWorkingDots._applyFrame()` honours by leaving the dot
   *  alone. Unfreezing (`false`) restores the stashed inline styles, so the live
   *  loader's pulse is untouched. jsdom has no layout, so the DOM tests assert
   *  the stash/apply behaviour instead of pixels (see J9). */
  protected _freezeOlderDots(freeze: boolean): void {
    if (freeze) {
      if (this._frozenDots !== null) return;
      const olderDotsEl = this.querySelector(".wa-working-dots");
      const dots = olderDotsEl
        ? Array.from(olderDotsEl.querySelectorAll("span"))
        : [];
      if (dots.length === 0) return;
      this._frozenDots = (dots as HTMLElement[]).map((el) => ({
        el,
        animation: el.style.animation,
        transform: el.style.transform,
      }));
      for (const dot of dots as HTMLElement[]) {
        dot.style.animation = "none";
        dot.style.transform = "scale(1)";
      }
      return;
    }
    if (this._frozenDots === null) return;
    for (const { el, animation, transform } of this._frozenDots) {
      el.style.animation = animation;
      el.style.transform = transform;
    }
    this._frozenDots = null;
  }

  protected _subscribeSession(s: AgentSession) {
    if (this._unsub) this._unsub();
    if (this._eventsUnsub) this._eventsUnsub();
    this._unsub = s.subscribe((state) => this._handleStateUpdate(state));
    this._eventsUnsub = s.subscribeEvents?.((e) => this._handleEvent(e));
  }

  get session() { return this._session; }
  set session(s: AgentSession | undefined) {
    if (this._unsub) this._unsub();
    if (this._eventsUnsub) this._eventsUnsub();
    this._session = s;
    if (s) {
      this._subscribeSession(s);
    }
  }

  get messages() {
    return this._messagesOverride ?? this._state?.messages ?? [];
  }
  set messages(val: SessionMessage[]) {
    this._messagesOverride = val;
    this._recomputeWindow();
    this.requestUpdate();
  }

  get running() {
    return this._state?.running ?? false;
  }
  set running(val: boolean) {}

  get compacting() {
    return this._state?.compacting ?? false;
  }

  get canCompact() {
    return this._state?.canCompact ?? false;
  }

  get error() {
    return this._state?.error ?? null;
  }
  set error(val: string | null) {
    if (this._state) {
      this._state.error = val ?? undefined;
    }
    this.requestUpdate();
  }

  get usage() {
    return {
      tokens: this._state?.contextWindow?.used ?? 0,
      max: this._state?.contextWindow?.total ?? 128_000,
      percent: this._state?.contextWindow?.percent ?? 0,
    };
  }
  set usage(_val: { tokens: number; max: number; percent: number }) {}

  /** The transcript inputs the last render saw. A render caused by something
   *  else — a session title arriving from `autoTitle()`, the kebab menu opening
   *  — must not pay for the forced layout read in `updated()`. */
  protected _lastTranscriptSnap: readonly unknown[] | null = null;

  protected _didTranscriptChange(): boolean {
    const next: readonly unknown[] = [
      this.messages,
      this.messages.length,
      this._windowStart,
      this._loadingOlder,
      this.running,
      this.compacting,
      this._state?.inProgressTurnId,
      this._retryAttempt,
      this.error,
      this._transientWarning,
      this._dismissalRevision,
      this._debugOpen,
      this._configOpen,
      this._openScreen,
    ];
    const prev = this._lastTranscriptSnap;
    this._lastTranscriptSnap = next;
    if (!prev) return true;
    for (let i = 0; i < next.length; i++) {
      if (prev[i] !== next[i]) return true;
    }
    return false;
  }
}
