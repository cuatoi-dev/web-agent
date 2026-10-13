// 009 — scroll-up window loading. Every case that drives a load runs under
// `vi.useFakeTimers()` and advances past `LOADER_MIN_MS`, so the file stays
// fast rather than waiting out a real 900 ms hold per case.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import type {
  AgentSession,
  SessionMessage,
  SessionMessagePart,
  SessionState,
} from "@cuatoi/web-agent-core";

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

// --- Harness copied verbatim from chat-panel.message-window.test.ts ---

/** One turn: a user bubble, then an assistant bubble carrying `tools` chips.
 *  Rows per turn = 1 + 1 + tools. */
function turn(n: number, tools: number): SessionMessage[] {
  const parts: SessionMessagePart[] = [
    { kind: "text", text: `Reply ${n}` },
    ...Array.from({ length: tools }, (_, k) => ({
      kind: "tool" as const,
      audit: { ts: 0, name: `tool_${k}`, input: {}, outcomeSummary: "ok" },
    })),
  ];
  return [
    { role: "user", text: `Question ${n}` },
    { role: "assistant", text: `Reply ${n}`, parts },
  ];
}

/** `turns` turns of `tools` tool chips each. */
function transcript(turns: number, tools = 4): SessionMessage[] {
  return Array.from({ length: turns }, (_, i) => turn(i, tools)).flat();
}

/** The `agent-message-view` elements actually mounted in the list, in order. */
function views(el: AgentChatPanel) {
  const list = el.querySelector(".messages-list")!;
  return Array.from(list.querySelectorAll("agent-message-view")) as
    (Element & { text?: string })[];
}

/** Rows actually in the DOM: one per message view, plus one per tool chip. */
function renderedRows(el: AgentChatPanel): number {
  const list = el.querySelector(".messages-list")!;
  return (
    list.querySelectorAll("agent-message-view").length +
    list.querySelectorAll(".tool-step").length
  );
}

/** A minimal `AgentSession` mock, same shape as
 *  `chat-panel.message-window.test.ts`'s `makeMockSession()`. */
function makeMockSession(): { session: AgentSession; push(next: Partial<SessionState>): void } {
  let state: SessionState = {
    activeSessionId: "session-1",
    sessions: [
      { id: "session-1", title: "Test Session", titleManual: false, createdAt: 0, updatedAt: 0, messageCount: 0 },
    ],
    messages: [],
    running: false,
    compacting: false,
    canCompact: false,
    error: undefined,
    contextWindow: { used: 0, total: 128000, percent: 0 },
    queuedMessages: [],
  } as unknown as SessionState;

  const subs: Array<(s: SessionState) => void> = [];
  const session = {
    getState: () => state,
    subscribe: (cb: (s: SessionState) => void) => {
      subs.push(cb);
      cb(state);
      return () => {
        const i = subs.indexOf(cb);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    subscribeEvents: () => () => {},
    updateConfig: () => {},
    availableTools: () => [],
  } as unknown as AgentSession;

  return {
    session,
    push(next: Partial<SessionState>) {
      state = { ...state, ...next };
      for (const cb of subs) cb(state);
    },
  };
}

// --- New for 009 ---

/** jsdom has no layout. Probed on jsdom 24.0.0 in this tree (2026-09-09):
 *  `scrollTop` IS a real writable property and reads back what you set, but
 *  `scrollHeight` and `clientHeight` are always 0 and never grow when rows are
 *  added. Model the list's height as a fixed row height times the rows
 *  actually rendered, so a prepend really does grow it and the panel's
 *  `scrollHeight - heightBefore` arithmetic is exercised for real rather than
 *  against two zeroes. */
const ROW_PX = 100;

function stubListMetrics(el: AgentChatPanel) {
  // The initial render (element connected, at its default `_atBottom = true`)
  // already queued a REAL `requestAnimationFrame` to pin the list to its
  // bottom — `_scrollToBottomQueue()` (chat-panel-window.ts:219). That frame is not
  // gated by `vi.useFakeTimers()` and can fire during this test's own
  // `advanceTimersByTimeAsync`, setting `scrollTop = scrollHeight` well after
  // this stub is installed and stomping any scrollTop this file asserts on.
  // Same leftover-frame problem `chat-panel.test.ts`'s
  // "scroll coalesced to one animation frame per redraw (009)" block cancels
  // in its own `beforeEach`; do the same here.
  const priv = el as unknown as Record<string, unknown>;
  const pendingRaf = priv["_scrollRafId"] as number | null;
  if (pendingRaf !== null) {
    cancelAnimationFrame(pendingRaf);
    priv["_scrollRafId"] = null;
  }
  priv["_forceScrollToBottom"] = false;

  const list = el.querySelector(".messages-list") as HTMLElement;
  Object.defineProperty(list, "scrollHeight", {
    get: () => renderedRows(el) * ROW_PX,
    configurable: true,
  });
  Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
  return list;
}

/** Put the list at the top and fire a real scroll event. */
function scrollToTop(list: HTMLElement) {
  list.scrollTop = 0;
  list.dispatchEvent(new Event("scroll"));
}

/** Put the list at the bottom (per the stub's current, pre-render
 *  `scrollHeight`) and fire a real scroll event — drives 008's own
 *  "at bottom" trim branch in `_handleListScroll`. */
function scrollToBottom(list: HTMLElement) {
  list.scrollTop = list.scrollHeight;
  list.dispatchEvent(new Event("scroll"));
}

function spyOnLoadWindow(el: AgentChatPanel) {
  const calls: Array<{ before: number; limit: number }> = [];
  const original = (el as unknown as Record<string, unknown>)["_loadWindow"] as
    (a: { before: number; limit: number }) => Promise<number>;
  (el as unknown as Record<string, unknown>)["_loadWindow"] = function (
    args: { before: number; limit: number },
  ) {
    calls.push(args);
    return original.call(el, args);
  };
  return calls;
}

/** Replaces `_loadWindow` with a version that pauses on an internal gate
 *  before delegating to the real implementation, so a test can shrink
 *  `messages` at the exact moment `_loadOlder()` has captured its `before`
 *  cursor but the load has not yet resolved — deterministically reaching the
 *  stale-cursor path (S11) instead of racing real microtask timing.
 *  `called` flips true the instant `_loadOlder()` invokes `_loadWindow`,
 *  which happens synchronously up to that method's own first `await`, so it
 *  is safe to check right after one `await element.updateComplete`. */
function gateLoadWindow(el: AgentChatPanel) {
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let called = false;
  const original = (el as unknown as Record<string, unknown>)["_loadWindow"] as
    (a: { before: number; limit: number }) => Promise<number>;
  (el as unknown as Record<string, unknown>)["_loadWindow"] = async function (
    args: { before: number; limit: number },
  ) {
    called = true;
    await gate;
    return original.call(el, args);
  };
  return {
    release: () => release(),
    get called() {
      return called;
    },
  };
}

/** Let a `_loadOlder()` in flight run to completion under fake timers: flush
 *  the microtasks up to the `setTimeout` hold, then advance past
 *  `LOADER_MIN_MS`, settling `updateComplete` around each step. */
async function settleLoad(el: AgentChatPanel) {
  await el.updateComplete;
  await vi.advanceTimersByTimeAsync(1000);
  await el.updateComplete;
}

describe("AgentChatPanel — scroll-up window loading", () => {
  let element: AgentChatPanel;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement("agent-chat-panel");
    element.session = makeMockSession().session;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    vi.useRealTimers();
  });

  it("shows the three-dot loader at the head of the list when the top is reached", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);

    scrollToTop(list);
    await element.updateComplete;

    const first = list.firstElementChild;
    expect(first).not.toBeNull();
    expect(first!.tagName).toBe("WA-WORKING-DOTS");
    expect(first!.querySelectorAll("span").length).toBe(3);

    await settleLoad(element);
  });

  it("the loader is the same <wa-working-dots> tag the in-turn indicator uses, not a new loader", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);

    scrollToTop(list);
    await element.updateComplete;

    // Both loaders render `<wa-working-dots></wa-working-dots>` (chat-panel.ts),
    // so both are built by the same element class — asserting the tag is
    // itself the "same kind of loader, not a new one" check.
    const topEl = list.firstElementChild as HTMLElement;
    expect(topEl.tagName).toBe("WA-WORKING-DOTS");
    expect(topEl.querySelectorAll("span").length).toBe(3);

    await settleLoad(element);
  });

  it("prepends older rows", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    const rowsBefore = renderedRows(element);
    const firstTextBefore = views(element)[0].text;

    scrollToTop(list);
    await settleLoad(element);

    expect(renderedRows(element)).toBeGreaterThan(rowsBefore);
    expect(views(element)[0].text).not.toBe(firstTextBefore);
  });

  it("holds the reader's row: scrollTop moves by exactly the prepended height", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    const heightBefore = renderedRows(element) * ROW_PX;
    const topBefore = list.scrollTop;

    scrollToTop(list);
    await settleLoad(element);

    const heightAfter = renderedRows(element) * ROW_PX;
    expect(list.scrollTop).toBe(topBefore + (heightAfter - heightBefore));
  });

  it("never removes rows from the bottom during a scroll-up load", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    const rowsBefore = renderedRows(element);
    const v = views(element);
    const lastTextBefore = v[v.length - 1].text;

    scrollToTop(list);
    await settleLoad(element);

    const after = views(element);
    expect(after[after.length - 1].text).toBe(lastTextBefore);
    expect(renderedRows(element)).toBeGreaterThan(rowsBefore);
  });

  it("repeated scroll-ups load until the start of the session is reached", async () => {
    // 70 turns, not 300: big enough to need several loads to reach the
    // start (proving "repeated"), small enough that the load/settle cycles
    // below don't turn into a multi-second real-wall-clock loop under load.
    element.messages = transcript(70, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);

    let iterations = 0;
    while ((element as unknown as Record<string, unknown>)["_windowStart"] !== 0 && iterations < 20) {
      scrollToTop(list);
      await settleLoad(element);
      iterations += 1;
    }

    expect(iterations).toBeGreaterThan(1);
    expect(iterations).toBeLessThan(20);
    expect((element as unknown as Record<string, unknown>)["_windowStart"]).toBe(0);
    expect(views(element).length).toBe(element.messages.length);
    expect(views(element)[0].text).toContain("Question 0");
  }, 30_000);

  it("at the start of the session no loader appears and the loader function is not called again", async () => {
    element.messages = transcript(2, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    const calls = spyOnLoadWindow(element);

    scrollToTop(list);
    await settleLoad(element);

    expect(calls.length).toBe(0);
    expect(list.firstElementChild!.tagName).toBe("AGENT-MESSAGE-VIEW");
  });

  it("a second load does not start while one is in flight", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    const calls = spyOnLoadWindow(element);

    scrollToTop(list);
    scrollToTop(list);
    scrollToTop(list);
    await settleLoad(element);

    expect(calls.length).toBe(1);
  });

  it("a turn arriving while an older window is loading appends at the bottom without inflating the reader's-row correction", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    const heightBefore = renderedRows(element) * ROW_PX;

    scrollToTop(list);
    // `_atBottom` is false (scrolled up) and `_windowStart` stays below
    // `msgs.length`, so re-assigning `.messages` below cannot trip
    // `_recomputeWindow()`'s early-return into re-cutting the window — it
    // just extends the tail the same way a streaming turn does in 008.
    await element.updateComplete;
    await vi.advanceTimersByTimeAsync(50);
    await element.updateComplete;
    expect((element as unknown as Record<string, unknown>)["_loadingOlder"]).toBe(true);
    // The prepend has landed (the window extended) but the correction is
    // deferred to the very end — `_loadOlder`'s doc comment — so scrollTop
    // is still untouched here, mid-hold.
    expect(list.scrollTop).toBe(0);
    const heightAfterPrepend = renderedRows(element) * ROW_PX;

    element.messages = [...element.messages, ...turn(9999, 0)];
    await element.updateComplete;

    const after = views(element);
    expect(after[after.length - 1].text).toBe("Reply 9999");
    // The bottom append must not be folded into the reader's-row correction.
    expect(list.scrollTop).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    await element.updateComplete;

    expect(list.scrollTop).toBe(heightAfterPrepend - heightBefore);
  });

  it("the loader stays visible when the load resolves in the same frame", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);

    scrollToTop(list);
    await Promise.resolve();
    await Promise.resolve();
    await element.updateComplete;
    expect(list.firstElementChild?.tagName).toBe("WA-WORKING-DOTS");

    await vi.advanceTimersByTimeAsync(400);
    await element.updateComplete;
    // Deliberately does not assert the 900 ms constant: only that the loader
    // has not cleared by 400 ms, which proves a minimum hold beyond an
    // instant resolve.
    expect(list.firstElementChild?.tagName).toBe("WA-WORKING-DOTS");

    await vi.advanceTimersByTimeAsync(2000);
    await element.updateComplete;
    expect(list.firstElementChild?.tagName).not.toBe("WA-WORKING-DOTS");
  });

  it("a cursor held past the end of a shrunken transcript does not index past it", async () => {
    element.messages = transcript(20, 0);
    await element.updateComplete;

    const loadWindow = (element as unknown as Record<string, unknown>)["_loadWindow"] as
      (a: { before: number; limit: number }) => Promise<number>;

    const target = await loadWindow.call(element, { before: 999, limit: 200 });
    expect(target).toBeGreaterThanOrEqual(0);
    expect(target).toBeLessThan(40);

    const atZero = await loadWindow.call(element, { before: 0, limit: 200 });
    expect(atZero).toBe(0);
  });

  it("S11 — a load whose cursor goes stale mid-flight (the list shrinks) is a no-op that still clears the loader", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    const gate = gateLoadWindow(element);

    scrollToTop(list);
    await element.updateComplete;
    // `_loadOlder()` ran synchronously up to its own `_loadWindow` call —
    // which captured `before = this._windowStart` — then suspended on the
    // gate, so the panel is now mid-flight with the loader showing.
    expect(gate.called).toBe(true);
    expect((element as unknown as Record<string, unknown>)["_loadingOlder"]).toBe(true);
    const beforeCursor = (element as unknown as Record<string, unknown>)["_windowStart"] as number;
    expect(beforeCursor).toBeGreaterThan(0);

    // Simulate a compaction landing while the load is in flight: `messages`
    // shrinks to fewer entries than the held `before` cursor — but still
    // enough rows to stay off the (stubbed) bottom, so `updated()`'s own
    // unrelated "wasAtBottom" auto-pin (chat-panel.ts:120-125) never fires
    // and this case exercises only `_loadOlder`'s stale-cursor guard. The
    // `messages` setter (chat-panel-state.ts:143-147) calls `_recomputeWindow()`
    // synchronously, which re-cuts `_windowStart` to 0 right here — before
    // `_loadWindow` ever resolves — because `_windowStart < msgs.length` no
    // longer holds.
    element.messages = transcript(10, 4);
    expect((element as unknown as Record<string, unknown>)["_windowStart"]).toBe(0);
    expect((element as unknown as Record<string, unknown>)["_windowStart"]).not.toBe(beforeCursor);
    // Let the shrink's own render land before releasing the gate, so
    // `rowsAfterShrink` is what the shrink itself produced — not the stale
    // pre-shrink DOM (rendering is async; nothing has flushed yet here).
    await element.updateComplete;
    const rowsAfterShrink = renderedRows(element);

    gate.release();
    await settleLoad(element);

    // The equality guard (`this._windowStart === before`) is now false, so
    // the prepend block never runs: nothing beyond the shrink itself is
    // rendered, `scrollTop` is untouched, and the loader still clears.
    expect(renderedRows(element)).toBe(rowsAfterShrink);
    expect(views(element)[0].text).toContain("Question 0");
    expect(list.scrollTop).toBe(0);
    expect((element as unknown as Record<string, unknown>)["_loadingOlder"]).toBe(false);
    expect(list.firstElementChild?.tagName).not.toBe("DIV");
  });

  it("a 008 bottom-trim advancing _windowStart forward while a load is in flight is not overwritten by the stale in-flight target", async () => {
    element.messages = transcript(300, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    const gate = gateLoadWindow(element);

    scrollToTop(list);
    await element.updateComplete;
    // `_loadOlder()` captured `before = this._windowStart` and is suspended
    // on the gate.
    expect(gate.called).toBe(true);
    expect((element as unknown as Record<string, unknown>)["_loadingOlder"]).toBe(true);
    const beforeCursor = (element as unknown as Record<string, unknown>)["_windowStart"] as number;
    expect(beforeCursor).toBeGreaterThan(0);

    // While the load is in flight, more turns arrive at the bottom. This
    // extends `this.messages` but does not touch `_windowStart` — the panel
    // is scrolled up, so the `messages` setter's own `_recomputeWindow()`
    // early-returns (chat-panel-window.ts:279), same as "a turn arriving while an
    // older window is loading" above.
    element.messages = [...element.messages, ...transcript(20, 4)];
    expect((element as unknown as Record<string, unknown>)["_windowStart"]).toBe(beforeCursor);

    // The user then scrolls all the way back down. That drives 008's own
    // "at bottom" trim (chat-panel-window.ts:323-331), which recomputes the
    // window from the now-GROWN array and advances `_windowStart` forward
    // past `beforeCursor` — to a value `_loadWindow`'s own clamp (anchored to
    // the stale `beforeCursor`, chat-panel-window.ts:365) could never produce. This
    // is the scenario the equality guard at chat-panel-window.ts:428 exists for,
    // named in its own doc comment: "008's own `_handleListScroll` 'at
    // bottom' branch re-cuts `_windowStart` forward independently of this
    // method." `_handleListScroll` has no `await`, so `_windowStart` is
    // already updated by the time `scrollToBottom` returns.
    scrollToBottom(list);
    const afterTrim = (element as unknown as Record<string, unknown>)["_windowStart"] as number;
    expect(afterTrim).toBeGreaterThan(beforeCursor);

    // Freeze the DOM position right here, deterministically, rather than
    // race the trim's own real (non-fake-timer-gated) bottom-pin
    // `requestAnimationFrame` (`_scrollToBottomQueue`, chat-panel-window.ts:219) —
    // the same leftover-frame hazard `stubListMetrics` guards against above.
    // Moving `scrollTop` off the bottom also makes `updated()`'s own
    // `wasAtBottom` check false on the next render, so no such frame is even
    // queued for this cycle; only `_loadOlder`'s own tail can move
    // `scrollTop` from here on.
    list.scrollTop = 0;
    const priv = element as unknown as Record<string, unknown>;
    priv["_forceScrollToBottom"] = false;
    if (priv["_scrollRafId"] !== null) {
      cancelAnimationFrame(priv["_scrollRafId"] as number);
      priv["_scrollRafId"] = null;
    }

    gate.release();
    await settleLoad(element);

    // The equality guard (`this._windowStart === before`) is false —
    // `_windowStart` is `afterTrim`, not `beforeCursor` — so the in-flight
    // load's stale `target` (computed from the stale `beforeCursor`) never
    // overwrites the newer, forward-advanced window, and no scroll
    // correction is applied on top of it. Without the guard, this block
    // would run unconditionally: `_windowStart` would revert to the stale,
    // smaller target, and the resulting `growth` (computed against a window
    // now extended further backward than `afterTrim`'s) would be positive,
    // moving `scrollTop` away from the frozen `0` asserted here — both
    // assertions below would fail.
    expect((element as unknown as Record<string, unknown>)["_windowStart"]).toBe(afterTrim);
    expect(list.scrollTop).toBe(0);
    expect((element as unknown as Record<string, unknown>)["_loadingOlder"]).toBe(false);
    expect(list.firstElementChild?.tagName).not.toBe("DIV");
  });
});
