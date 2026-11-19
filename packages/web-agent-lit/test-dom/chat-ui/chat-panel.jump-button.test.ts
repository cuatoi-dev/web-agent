// The scroll-to-bottom button. Visibility follows `_atBottom`, and the
// press reuses `_forceScrollToBottom` + `_scrollToBottomQueue()`.
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

// --- Harness copied verbatim from chat-panel.scroll-up-loading.test.ts:17-133 ---

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

// NOTE: `views()` from scroll-up-loading.test.ts is not copied: every case
// here counts rows through `renderedRows()`, and an unused helper fails lint.

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

// --- Scroll-up loading helpers ---

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
  // "scroll coalesced to one animation frame per redraw" block cancels
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

// NOTE: `scrollToTop` / `scrollToBottom` from scroll-up-loading.test.ts are
// not copied: no case here drives the loader from the top, and an unused
// helper would fail lint.

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

// --- Jump-button helpers ---

/** Park the list off the bottom and fire a real scroll event. jsdom does not
 *  fire `scroll` on a scrollTop assignment, so the event is explicit. */
function scrollTo(list: HTMLElement, top: number) {
  list.scrollTop = top;
  list.dispatchEvent(new Event("scroll"));
}

function jumpBtn(el: AgentChatPanel): HTMLElement | null {
  return el.querySelector(".wa-jump-btn");
}

function priv(el: AgentChatPanel): Record<string, unknown> {
  return el as unknown as Record<string, unknown>;
}

describe("AgentChatPanel — scroll-to-bottom button", () => {
  let element: AgentChatPanel;

  beforeEach(() => {
    element = document.createElement("agent-chat-panel");
    element.session = makeMockSession().session;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("J1 — absent while the list is at the bottom", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    stubListMetrics(element);
    expect(jumpBtn(element)).toBeNull();
  });

  it("J2 — appears when the list scrolls off the bottom", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);

    scrollTo(list, 400);
    await element.updateComplete;

    expect(jumpBtn(element)).not.toBeNull();
    expect(priv(element)["_atBottom"]).toBe(false);
  });

  it("J3 — pressing it returns the list to the bottom and removes the button", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);

    scrollTo(list, 400);
    await element.updateComplete;
    expect(jumpBtn(element)).not.toBeNull();

    // Drive the queued animation frame by hand: cancel the frame the mount
    // queued, then collect the frame the press queues.
    const pending = priv(element)["_scrollRafId"] as number | null;
    if (pending !== null) {
      cancelAnimationFrame(pending);
      priv(element)["_scrollRafId"] = null;
    }
    priv(element)["_forceScrollToBottom"] = false;
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    jumpBtn(element)!.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true }));
    for (const cb of callbacks) cb(0);
    scrollTo(list, list.scrollHeight);
    await element.updateComplete;

    expect(list.scrollTop).toBe(list.scrollHeight);
    expect(jumpBtn(element)).toBeNull();
  });

  it("J4 — carries no number", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    scrollTo(list, 400);
    await element.updateComplete;

    const btn = jumpBtn(element)!;
    expect(btn.textContent?.trim()).toBe("");
    expect(/\d/.test(btn.textContent ?? "")).toBe(false);
  });

  it("J5 — has an accessible name that is not the icon name", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    scrollTo(list, 400);
    await element.updateComplete;

    const btn = jumpBtn(element)!;
    const name = btn.querySelector("button")!.getAttribute("aria-label")?.trim();
    expect(name).toBeTruthy();
    expect(name).not.toBe("arrow_downward");
  });

  it("J6 — renders the glyph as an SVG, not the icon name as text", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    scrollTo(list, 400);
    await element.updateComplete;

    const btn = jumpBtn(element)!;
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.querySelector("i")).toBeNull();
    expect(btn.textContent).toBe("");
  });

  it("J7 — sits between the list and the composer, in neither", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    const list = stubListMetrics(element);
    scrollTo(list, 400);
    await element.updateComplete;

    expect(element.querySelector(".messages-list .wa-jump-btn")).toBeNull();
    expect(element.querySelector(".input-area .wa-jump-btn")).toBeNull();
    const anchor = element.querySelector(".wa-jump-anchor")!;
    expect(anchor.nextElementSibling?.classList.contains("input-area")).toBe(true);
  });

  it("J8 — demoWindow holds the loader without starting a real load", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    stubListMetrics(element);
    const calls = spyOnLoadWindow(element);

    element.demoWindow = { loadingOlder: true, scrollTop: 0 };
    await element.updateComplete;
    // The setter applies the scroll from a microtask.
    await Promise.resolve();
    await element.updateComplete;

    const list = element.querySelector(".messages-list")!;
    const first = list.firstElementChild;
    expect(first).not.toBeNull();
    expect(first!.tagName).toBe("WA-WORKING-DOTS");
    expect(first!.querySelectorAll("span").length).toBe(3);
    expect(calls.length).toBe(0);
  });

  it("J9 — demoWindow freezes the loader dots at full scale for a static capture", async () => {
    element.messages = transcript(80, 4);
    await element.updateComplete;
    stubListMetrics(element);

    element.demoWindow = { loadingOlder: true, scrollTop: 0 };
    await element.updateComplete;
    // The setter freezes the dots from a microtask.
    await Promise.resolve();
    await element.updateComplete;

    // The freeze parks every dot at full scale with its bounce paused, so a
    // static capture always shows three visible dots. Without the freeze the
    // dots sit wherever the 1.4 s wa-bounce cycle happens to be — usually
    // near scale(0) and sub-pixel — which is why the gallery captures showed
    // an empty loader box.
    const list = element.querySelector(".messages-list")!;
    const dots = Array.from(list.firstElementChild!.querySelectorAll("span"));
    expect(dots.length).toBe(3);
    for (const dot of dots) {
      expect(dot.style.animation).toBe("none");
      expect(dot.style.transform).toBe("scale(1)");
    }
  });
});
