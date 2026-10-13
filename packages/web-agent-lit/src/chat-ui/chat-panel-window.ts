import { html, nothing } from "../ui/template.js";
import type { SessionMessage } from "@cuatoi/web-agent-core";
import { ChatPanelComposer } from "./chat-panel-composer.js";

/** 008 — how many rendered rows the panel keeps when the host sets no
 *  `config.messageWindow`. */
const DEFAULT_MESSAGE_WINDOW = 200;

/** 009 — a scroll position this close to the top (px) loads the next window of
 *  older messages. */
const TOP_THRESHOLD_PX = 80;

/** 009 — the older-window loader is held at least this long, so an in-memory
 *  load that resolves in the same frame is still visible.
 *
 *  900 ms, not the 300 ms of an earlier draft: the shared `.wa-working-dots`
 *  element carries `animation: wa-fade-in 0.2s 400ms both`
 *  (`ui/registry-styles.ts:140`). `both` holds the `from` keyframe
 *  (`opacity: 0`) through the whole 400 ms delay, so the dots are invisible
 *  until 400 ms and only fully opaque at 600 ms. 900 leaves 300 ms of visible
 *  loader. */
const LOADER_MIN_MS = 900;

/** The failure notices, the scroll pin and the 008/009 message window —
 *  everything that decides which slice of the transcript is on screen. Moved
 *  verbatim out of chat-panel.ts. */
export abstract class ChatPanelWindow extends ChatPanelComposer {

  /** The `failed` marker of the NEWEST turn, or `undefined` when the newest
   *  turn did not fail.
   *
   *  Reads only the LAST message, because every failed turn puts its marker on
   *  the last message it contributes: a completed turn sets it on the assistant
   *  message when there is one and on the user message otherwise, and an
   *  in-progress turn sets it on both (`controller-messages.ts`, `turnFailed` handling).
   *
   *  It must not reverse-scan the whole transcript. That returned a truthy
   *  value for the rest of the session once any turn had failed, so the
   *  notice stayed on screen under every later successful reply (task 006).
   *  `_renderFailedTurnAffordance()` no longer gates `this.error` on this —
   *  the two notices take explicit precedence instead (task 007). */
  protected _lastFailed() {
    const msgs = this.messages;
    if (msgs.length === 0) return undefined;
    return msgs[msgs.length - 1].failed;
  }

  /** 003: the `notice` marker of the NEWEST turn, or `undefined`. Reads only
   *  the LAST message, for the same reason `_lastFailed()` does: a reverse
   *  scan would keep the notice on screen under every later reply. */
  protected _lastNotice() {
    const msgs = this.messages;
    if (msgs.length === 0) return undefined;
    return msgs[msgs.length - 1].notice;
  }

  /** The one notice renderer — an assistant message that happens to be red,
   *  not a container: transparent background, no border, no radius, vertical
   *  padding only (same rule set as `.assistant`, message-view-styles.ts:46-55). Retry
   *  renders only when the failure is retryable — absent from the DOM on a
   *  terminal error, not present-and-disabled. Both actions are real
   *  `<button>`s: accessible name, keyboard reachable, visible focus ring.
   *
   *  008: `tone` also selects the ARIA contract, because the same element is
   *  reused as a turn progresses from retrying to failed. `status`/`polite`
   *  while it is still working — an `alert` on every retry attempt is too
   *  loud — and `alert` once the attempts are gone. The element is never
   *  swapped, so the transcript does not shift under the reader. */
  protected _renderNotice(spec: {
    tone: "error" | "progress" | "info";
    message: string;
    retryable: boolean;
    dots?: { attempt: number; maxRetries: number };
    onRetry?: () => void;
    onDismiss?: () => void;
  }) {
    const progress = spec.tone === "progress";
    // 003: `info` is a completed turn that carried no reply. It is not an
    // alert, and it carries no icon — every candidate glyph risks an
    // emoji-presentation or tofu render in a host font, and the sentence
    // already carries the whole meaning, so nothing depends on the icon or
    // on colour.
    const isError = spec.tone === "error";
    return html`
      <div
        class="wa-notice"
        data-tone=${spec.tone}
        role=${isError ? "alert" : "status"}
        aria-live=${isError ? nothing : "polite"}
      >
        ${spec.tone === "info"
          ? nothing
          : html`<span class="wa-notice-icon" aria-hidden="true">${progress ? "↻" : "⚠"}</span>`}
        <span class="wa-notice-msg">
          ${spec.message}
          ${spec.dots
            ? html`<span class="wa-notice-dots" aria-hidden="true"
                >${Array.from(
                  { length: spec.dots.maxRetries },
                  (_, i) =>
                    html`<span
                      class="wa-notice-dot"
                      ?data-filled=${i < spec.dots!.attempt}
                    ></span>`
                )}</span
              >`
            : ""}
          ${spec.retryable || spec.onDismiss
            ? html`
                <span class="wa-notice-actions">
                  ${spec.retryable && spec.onRetry
                    ? html`<button
                        class="wa-notice-action wa-notice-retry"
                        ?disabled=${this.running}
                        @click=${spec.onRetry}
                      >Retry</button>`
                    : ""}
                  ${spec.retryable && spec.onRetry && spec.onDismiss
                    ? html`<span class="wa-notice-sep" aria-hidden="true">·</span>`
                    : ""}
                  ${spec.onDismiss
                    ? html`<button
                        class="wa-notice-action wa-notice-dismiss"
                        aria-label="Dismiss"
                        @click=${spec.onDismiss}
                      >Dismiss</button>`
                    : ""}
                </span>
              `
            : ""}
        </span>
      </div>
    `;
  }

  /** Exclusive: at most one of retrying / failed turn / provider error, below
   *  the messages. A failed turn takes precedence over `this.error` so the two
   *  never suppress each other — dismissing or superseding the failure lets a
   *  real provider-unavailable message through, instead of the old gate hiding
   *  it (task 006 note).
   *
   *  008: retrying joins that exclusive slot at the top, so the retry line and
   *  the failure it becomes are the SAME element and the transcript does not
   *  shift when the attempts run out. A transient warning is deliberately NOT
   *  in the slot — it is about the action the user just took, so an unrelated
   *  failed turn must never swallow it. Returns an array; lit renders each. */
  protected _renderFailedTurnAffordance() {
    const out: unknown[] = [];

    if (this._retryAttempt && this.running) {
      const { attempt, maxRetries, reason } = this._retryAttempt;
      out.push(
        this._renderNotice({
          tone: "progress",
          message: `${reason}. Retrying attempt ${attempt} of ${maxRetries}.`,
          dots: { attempt, maxRetries },
          retryable: false,
        })
      );
    } else {
      const failed = this._lastFailed();
      const notice = this._lastNotice();
      if (failed && !this._dismissedFailures.has(failed)) {
        out.push(
          this._renderNotice({
            tone: "error",
            message: failed.message,
            retryable: failed.retryable,
            onRetry: () => this._handleRetry(),
            onDismiss: () => {
              this._dismissedFailures.add(failed);
              this.requestUpdate();
            },
          })
        );
      } else if (notice) {
        // 003: nothing failed — the model ended the turn with no reply.
        // Neutral tone, Retry offered, and deliberately NO Dismiss: the
        // next turn replaces it, exactly like the failure notice.
        out.push(
          this._renderNotice({
            tone: "info",
            message: notice.message,
            retryable: notice.retryable,
            onRetry: () => this._handleRetry(),
          })
        );
      } else if (this.error !== null) {
        out.push(
          this._renderNotice({
            tone: "error",
            message: this.error,
            retryable: false,
            onDismiss: () => {
              this.error = null;
            },
          })
        );
      }
    }

    if (this._transientWarning !== null) {
      out.push(
        this._renderNotice({
          tone: "progress",
          message: this._transientWarning.text,
          retryable: false,
          onDismiss: () => {
            this._transientWarning = null;
            this.requestUpdate();
          },
        })
      );
    }

    return out;
  }

  protected _scrollToBottomQueue() {
    if (this._scrollRafId !== null) return;
    this._scrollRafId = requestAnimationFrame(() => {
      this._scrollRafId = null;
      this._forceScrollToBottom = false;
      const list = this.querySelector(".messages-list");
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    });
  }

  /** 008 — rows this one message draws: its own bubble, plus one chip per tool
   *  part. Matches what `message-view.ts` renders (`message-view.ts:312`). */
  protected _rowsIn(msg: SessionMessage): number {
    let tools = 0;
    for (const p of msg.parts ?? []) {
      if (p.kind === "tool") tools++;
    }
    return 1 + tools;
  }

  /** 008 — the window size in rows: the host's setting, or the default. */
  protected _messageWindowSize(): number {
    return this._config?.messageWindow ?? DEFAULT_MESSAGE_WINDOW;
  }

  /** 008 — walk back from `endIndex` until the rows counted reach `size` AND
   *  the message reached is a user message, so a window never starts mid-turn.
   *  Two consequences, both intended: a window can exceed `size` when the cut
   *  lands inside a turn, and a single turn longer than `size` is shown whole.
   *  Returns 0 when the walk reaches the start without meeting a user message. */
  protected _computeWindowStart(
    messages: SessionMessage[],
    endIndex: number,
    size: number,
  ): number {
    let count = 0;
    for (let i = endIndex; i >= 0; i--) {
      count += this._rowsIn(messages[i]);
      if (count >= size && messages[i].role === "user") return i;
    }
    return 0;
  }

  /** 008 — what the template maps, instead of the whole transcript. */
  protected _visibleMessages(): SessionMessage[] {
    return this.messages.slice(this._windowStart);
  }

  /** 008 — re-cut the window for the current message list.
   *
   *  Scrolled off the bottom, the window is left alone: scrolling up must never
   *  take messages away. The one exception is an index that is no longer an
   *  index into the list — a compaction rewrites the journal, so
   *  `state.messages` can get shorter inside one session
   *  (`buildSessionMessages()` in `controller-messages.ts`), and a stale `_windowStart` past the end would
   *  make `slice()` render nothing at all. */
  protected _recomputeWindow() {
    const msgs = this.messages;
    if (!this._atBottom && this._windowStart < msgs.length) return;
    this._windowStart = this._computeWindowStart(
      msgs,
      msgs.length - 1,
      this._messageWindowSize(),
    );
  }

  /** 008 — the list scrolled. Records where it is, and trims back to the newest
   *  window when it reaches the bottom. Trimming happens here and nowhere else.
   *
   *  The pin uses the existing `_forceScrollToBottom` + `_scrollToBottomQueue()`
   *  path rather than its own `await updateComplete`, per the plan's Notes. The
   *  pseudo code's `heightBefore` is not kept: it is never read again, and the
   *  pin is absolute (`scrollTop = scrollHeight`), so the observable result —
   *  the bottom row stays where it was — is identical either way. An unread
   *  local would also fail `no-unused-vars`. */
  protected _handleListScroll() {
    const list = this.querySelector(".messages-list");
    if (!list) return;
    // 010 — the jump button's visibility is `!_atBottom`, so a change in this
    // flag is on its own a reason to redraw. Before 010 only the at-bottom
    // trim branch below asked for a render, so scrolling off the bottom
    // changed the flag and nothing on screen. `requestUpdate()` is idempotent
    // per pending frame (`ui/component.ts:19-21`), so the trim branch's own
    // call below stays harmless.
    const wasAtBottom = this._atBottom;
    this._atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
    if (this._atBottom !== wasAtBottom) this.requestUpdate();
    if (!this._atBottom) {
      // 009 — the plan's "after the bottom handling from task 008". Scrolled
      // off the bottom is the only state a scroll-up load can happen in, so
      // the check lives in 008's early-return branch. Putting it here rather
      // than above the `_atBottom` line also means a scroll-up load and 008's
      // bottom trim can never both fire from one scroll event.
      if (
        list.scrollTop < TOP_THRESHOLD_PX &&
        this._windowStart > 0 &&
        !this._loadingOlder
      ) {
        void this._loadOlder();
      }
      return;
    }
    const target = this._computeWindowStart(
      this.messages,
      this.messages.length - 1,
      this._messageWindowSize(),
    );
    if (target <= this._windowStart) return;
    this._windowStart = target;
    this._forceScrollToBottom = true;
    this.requestUpdate();
  }

  /** 009 — the next window of older messages.
   *
   *  Async from day one even though it resolves from memory today. The whole
   *  history is already in `this.messages`, so the next window is a slice —
   *  but the arguments are `readRange`'s from task 007, a before-cursor and a
   *  count, so moving sessions to a server changes this one method and nothing
   *  else in the panel. `before` is an index into `this.messages` today and a
   *  store cursor later; the caller treats it as opaque.
   *
   *  The cursor is held across time and `this.messages` can get SHORTER inside
   *  one session, because a compaction rewrites the journal
   *  (`buildSessionMessages()` in `controller-messages.ts`) — the same edge case 008's `_recomputeWindow()`
   *  guards. `_recomputeWindow()` re-cuts a `_windowStart` that has fallen past
   *  the end, but a load already in flight holds its own copy, so clamp here
   *  too: a stale cursor then walks back from the real end of the list instead
   *  of indexing past it (`_rowsIn(undefined)` would throw).
   *
   *  Returns the new `_windowStart`. */
  protected async _loadWindow({
    before,
    limit,
  }: {
    before: number;
    limit: number;
  }): Promise<number> {
    // `require-await`: this resolves synchronously today (a slice of
    // `this.messages`), but the method stays `async` on purpose — see the
    // doc comment above — so a caller awaiting it behaves the same once this
    // moves to a real `readRange`.
    await Promise.resolve();
    const msgs = this.messages;
    const end = Math.min(before, msgs.length) - 1;
    if (end < 0) return 0;
    return this._computeWindowStart(msgs, end, limit);
  }

  /** 009 — prepend the next window of older messages, holding the reader's row.
   *
   *  The scroll correction is applied at the very END — right as the loader
   *  clears, not right after the prepend — and that timing is load-bearing,
   *  not cosmetic. The loader renders as the unconditional FIRST child of
   *  `.messages-list`, ahead of `_visibleMessages()` (Code change 6): when
   *  the window extends backward, the newly-loaded older rows land BETWEEN
   *  the loader and the reader's row, not above the loader. Correcting
   *  `scrollTop` right after that prepend — the first draft of this method —
   *  scrolls the reader's row back into view but scrolls the loader itself
   *  OUT of view in the same instant, since the loader sits above all of the
   *  newly-prepended content too. Measured live: `scrollTop` jumped from 0 to
   *  ~8258px within 5ms of the load starting, well before the loader's own
   *  400ms-delay + 200ms-fade even finishes — so a real user never sees the
   *  three dots at all. Leaving `scrollTop` untouched until the loader is
   *  about to disappear keeps the viewport parked near the top (loader
   *  visible, fading in as designed) for the whole `LOADER_MIN_MS` hold, and
   *  applies the jump to the reader's preserved position in the same frame
   *  the loader vanishes — the standard "spinner at the top, then a settle"
   *  pattern.
   *
   *  `growth` — the reader's row must move down by exactly the height the
   *  OLDER content added, but that must never include a turn arriving at the
   *  BOTTOM during the hold (criterion 8): only the prepend changes anything
   *  above the reader's row, so the diff used to compute `growth` is taken
   *  right after the prepend lands, before the hold (and before any
   *  bottom-appended turn) has a chance to grow `scrollHeight` further.
   *  `loaderHeight` — measured directly off the loader element rather than
   *  folded into a before/after `scrollHeight` diff, because the loader is
   *  removed later, at a point where a concurrent bottom append could have
   *  polluted a second diff. Subtracting it out here is what makes `growth`
   *  reflect only the OLDER content, so applying it once the loader is gone
   *  (and its own footprint already left the DOM on its own) lands the reader
   *  exactly where the load's height alone would put it.
   *  `before` is captured once, up front, and the prepend is applied only if
   *  `_windowStart` still equals it when the load resolves. Scrolling here is
   *  what fires this load, but nothing stops the user reaching the bottom
   *  again before it settles — 008's own `_handleListScroll` "at bottom"
   *  branch re-cuts `_windowStart` forward independently of this method. Without
   *  this guard a load that was already in flight would overwrite that newer,
   *  correct window with a stale, older one the moment it resolved. */
  protected async _loadOlder(): Promise<void> {
    const list = this.querySelector(".messages-list");
    if (!list) return;

    const heightBefore = list.scrollHeight;
    this._loadingOlder = true;
    this.requestUpdate();
    await this.updateComplete;
    const startedAt = Date.now();

    const before = this._windowStart;
    const target = await this._loadWindow({
      before,
      limit: this._messageWindowSize(),
    });

    let growth = 0;
    if (this._windowStart === before && target < before) {
      this._windowStart = target;
      this.requestUpdate();
      await this.updateComplete;
      const loaderHeight = this.querySelector(".wa-working-dots")?.getBoundingClientRect().height ?? 0;
      growth = list.scrollHeight - heightBefore - loaderHeight;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < LOADER_MIN_MS && this.isConnected) {
      await new Promise<void>((resolve) => {
        this._loadOlderResolve = resolve;
        this._loadOlderTimer = setTimeout(() => {
          this._loadOlderTimer = null;
          this._loadOlderResolve = null;
          resolve();
        }, LOADER_MIN_MS - elapsed);
      });
    }
    if (!this.isConnected) {
      this._loadingOlder = false;
      return;
    }
    this._loadingOlder = false;
    this.requestUpdate();
    if (growth > 0) {
      await this.updateComplete;
      list.scrollTop += growth;
    }
  }

  /** Cancel any pending older-message loader timer and reset loading state. */
  protected _cancelLoadOlder(): void {
    if (this._loadOlderTimer !== null) {
      clearTimeout(this._loadOlderTimer);
      this._loadOlderTimer = null;
    }
    if (this._loadOlderResolve !== null) {
      this._loadOlderResolve();
      this._loadOlderResolve = null;
    }
    this._loadingOlder = false;
  }
}
