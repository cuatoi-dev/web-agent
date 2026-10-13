import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  return Array.from(list.querySelectorAll("agent-message-view"));
}

/** Rows actually in the DOM: one per message view, plus one per tool chip. */
function renderedRows(el: AgentChatPanel): number {
  const list = el.querySelector(".messages-list")!;
  return (
    list.querySelectorAll("agent-message-view").length +
    list.querySelectorAll(".tool-step").length
  );
}

/** Rows the FIRST rendered turn contributes: its user bubble and everything up
 *  to, but not including, the next user bubble. */
function firstTurnRows(el: AgentChatPanel): number {
  let count = 0;
  for (const view of views(el)) {
    if (count > 0 && view.querySelector(".user")) break;
    count += 1 + view.querySelectorAll(".tool-step").length;
  }
  return count;
}

/** Put the list at a known scroll position and fire a real scroll event. */
function scrollTo(el: AgentChatPanel, opts: { atBottom: boolean }) {
  const list = el.querySelector(".messages-list") as HTMLElement;
  Object.defineProperty(list, "scrollHeight", { value: 10_000, configurable: true });
  Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(list, "scrollTop", {
    value: opts.atBottom ? 9_600 : 0,
    configurable: true,
    writable: true,
  });
  list.dispatchEvent(new Event("scroll"));
}

/** A minimal `AgentSession` mock, same shape as
 *  `chat-panel.datasource-ordering.test.ts`'s `makeMockSession()`. Assigning it
 *  via `.session` before the element connects stops `connectedCallback()` from
 *  falling through to `_ensureSession()`'s real `createAgentSession()`, which
 *  throws without a configured `model`. The cases below drive `.messages` /
 *  `.config` directly and need nothing from the session itself. */
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

describe("AgentChatPanel — the chat message window", () => {
  let element: AgentChatPanel;

  beforeEach(() => {
    element = document.createElement("agent-chat-panel");
    element.session = makeMockSession().session;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("stops growing the rendered row count at the window bound", async () => {
    element.messages = transcript(300);
    await element.updateComplete;
    const rows300 = renderedRows(element);
    const views300 = views(element).length;

    element.messages = transcript(600);
    await element.updateComplete;
    const rows600 = renderedRows(element);
    const views600 = views(element).length;

    expect(rows600).toBe(rows300);
    expect(views600).toBe(views300);
    // Unwindowed, 600 turns hold 3,600 rows / 1,200 views. The window keeps a
    // small, constant slice of that regardless of transcript size.
    expect(rows600).toBeLessThan(3600 / 10);
    expect(views600).toBeLessThan(1200 / 10);
  });

  it("begins every window on a user message", async () => {
    for (const t of [transcript(300), transcript(300, 0), transcript(300, 9)]) {
      element.messages = t;
      await element.updateComplete;
      expect(views(element)[0].querySelector(".user")).not.toBeNull();
    }
  });

  it("extends the window back to the user message when the cut lands inside a turn", async () => {
    element.messages = transcript(300);
    await element.updateComplete;

    const rows = renderedRows(element);
    expect(rows).toBeGreaterThanOrEqual(200);
    expect(rows - firstTurnRows(element)).toBeLessThan(200);
    expect(views(element)[0].querySelector(".user")).not.toBeNull();
  });

  it("renders a single turn larger than the window whole", async () => {
    const bigParts: SessionMessagePart[] = [
      { kind: "text", text: "Reply big" },
      ...Array.from({ length: 248 }, (_, k) => ({
        kind: "tool" as const,
        audit: { ts: 0, name: `tool_${k}`, input: {}, outcomeSummary: "ok" },
      })),
    ];
    const bigTurn: SessionMessage[] = [
      { role: "user", text: "Question big" },
      { role: "assistant", text: "Reply big", parts: bigParts },
    ];
    element.messages = [...transcript(40), ...bigTurn];
    await element.updateComplete;

    const rendered = views(element);
    expect(rendered.length).toBe(2);
    expect(renderedRows(element)).toBe(250);
    expect(rendered[0].querySelector(".user")).not.toBeNull();
  });

  it("renders fewer rows for a smaller host window, by the same rules", async () => {
    element.messages = transcript(300);
    await element.updateComplete;
    const rowsDefault = renderedRows(element);
    const viewsDefault = views(element).length;

    element.config = { messageWindow: 50 };
    element.messages = transcript(300);
    await element.updateComplete;

    const rows = renderedRows(element);
    expect(rows).toBeGreaterThanOrEqual(50);
    expect(rows - firstTurnRows(element)).toBeLessThan(50);
    expect(rows).toBeLessThan(rowsDefault);
    expect(views(element).length).toBeLessThan(viewsDefault);
    expect(views(element)[0].querySelector(".user")).not.toBeNull();
  });

  it("applies a window the host sets after the messages", async () => {
    element.messages = transcript(300);
    await element.updateComplete;
    const rowsBefore = renderedRows(element);

    element.config = { messageWindow: 50 };
    await element.updateComplete;

    const rows = renderedRows(element);
    expect(rows).toBeLessThan(rowsBefore);
    expect(rows).toBeGreaterThanOrEqual(50);
    expect(rows - firstTurnRows(element)).toBeLessThan(50);
  });

  it("never trims while the list is scrolled off the bottom", async () => {
    element.messages = transcript(300);
    await element.updateComplete;
    const viewsBefore = views(element).length;
    const firstTextBefore = views(element)[0].textContent;

    scrollTo(element, { atBottom: false });

    element.messages = [...transcript(300), ...transcript(20)];
    await element.updateComplete;

    expect(views(element).length - viewsBefore).toBe(40);
    expect(views(element)[0].textContent).toBe(firstTextBefore);
  });

  it("trims back to the newest window on returning to the bottom", async () => {
    element.messages = transcript(300);
    await element.updateComplete;
    const viewsAtBottom = views(element).length;

    scrollTo(element, { atBottom: false });
    element.messages = [...transcript(300), ...transcript(20)];
    await element.updateComplete;

    const rendered = views(element);
    const lastText = rendered[rendered.length - 1].textContent;

    scrollTo(element, { atBottom: true });
    await element.updateComplete;

    expect(views(element).length).toBe(viewsAtBottom);
    const after = views(element);
    expect(after[after.length - 1].textContent).toBe(lastText);
  });

  it("keeps appending a streaming turn with the window active", async () => {
    const base = transcript(300);
    const growingTexts = ["Wor", "Working o", "Working on it, done."];

    for (const text of growingTexts) {
      element.messages = [
        ...base,
        { role: "user", text: "Question new" },
        { role: "assistant", text, pending: true },
      ];
      await element.updateComplete;

      const rendered = views(element);
      expect(rendered[rendered.length - 1].text).toBe(text);
      const rows = renderedRows(element);
      expect(rows).toBeGreaterThanOrEqual(195);
      expect(rows).toBeLessThanOrEqual(215);
    }
  });

  it("re-cuts the window for a switched-to session", async () => {
    const mock = makeMockSession();

    const el = document.createElement("agent-chat-panel");
    el.session = mock.session;
    document.body.appendChild(el);

    mock.push({ messages: transcript(300) });
    await el.updateComplete;

    scrollTo(el, { atBottom: false });

    mock.push({
      activeSessionId: "session-2",
      sessions: [
        { id: "session-1", title: "Test Session", titleManual: false, createdAt: 0, updatedAt: 0, messageCount: 0 },
        { id: "session-2", title: "Two", titleManual: false, createdAt: 0, updatedAt: 0, messageCount: 0 },
      ],
      messages: transcript(3),
    });
    await el.updateComplete;

    const rendered = views(el);
    expect(rendered.length).toBe(6);
    expect(rendered[0].text).toBe("Question 0");

    el.remove();
  });

  it("re-cuts rather than rendering nothing when the list gets shorter", async () => {
    element.messages = transcript(300);
    await element.updateComplete;
    scrollTo(element, { atBottom: false });

    element.messages = transcript(3);
    await element.updateComplete;

    const rendered = views(element);
    expect(rendered.length).toBe(6);
    expect(rendered[0].querySelector(".user")).not.toBeNull();
  });
});
