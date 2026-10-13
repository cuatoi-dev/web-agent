import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import type { AgentSession, SessionState } from "@cuatoi/web-agent-core";

/** The private surface this spec drives directly. The panel declares these
 *  `protected`; one named type keeps the casts off every call site. */
type PanelInternals = {
  _historyPanelOpen: boolean;
  _toggleHistoryPanel(): void;
  _historyOutsideHandler?: (e: MouseEvent) => void;
  _handleHistoryDelete(id: string): void;
};

const priv = (el: AgentChatPanel): PanelInternals =>
  el as unknown as PanelInternals;

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

describe("AgentChatPanel history dropdown inside a shadow root", () => {
  let host: HTMLDivElement;
  let root: ShadowRoot;
  let element: AgentChatPanel;
  let state: SessionState;

  beforeEach(() => {
    state = {
      // Not "session-1": the active row's own click handler unconditionally
      // closes the panel (chat-panel-history.ts:246-249), which is correct
      // app behaviour but not what this spec (case 2) means to exercise. A
      // non-active id routes the click through _handleHistorySwitch's
      // confirm() branch instead, which jsdom stubs to a falsy return, so the
      // row's own handler does not close the panel here — matching the
      // "click landed inside the dropdown, still open" scenario under test.
      activeSessionId: "",
      sessions: [
        {
          id: "session-1",
          title: "Test Session",
          titleManual: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
        },
        {
          id: "session-2",
          title: "Second Session",
          titleManual: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
        },
      ],
      messages: [],
      running: false,
      compacting: false,
      canCompact: false,
      error: null,
      contextWindow: { used: 0, total: 128000, percent: 0 },
      queuedMessages: [],
    };

    const session = {
      getState: vi.fn(() => state),
      subscribe: vi.fn((cb: (s: SessionState) => void) => {
        cb(state);
        return () => {};
      }),
      subscribeEvents: vi.fn(() => () => {}),
      updateConfig: vi.fn(),
      refreshSessions: vi.fn(() => Promise.resolve()),
      createSession: vi.fn(() => Promise.resolve()),
      switchSession: vi.fn(() => Promise.resolve()),
      deleteSession: vi.fn(() => Promise.resolve()),
      clearAllSessions: vi.fn(() => Promise.resolve()),
      send: vi.fn(() => Promise.resolve()),
      abort: vi.fn(),
      compact: vi.fn(),
      reset: vi.fn(),
      setTitle: vi.fn(() => Promise.resolve()),
      autoTitle: vi.fn(() => Promise.resolve()),
      dispose: vi.fn(),
      retryLast: vi.fn(() => Promise.resolve()),
      cancelQueued: vi.fn(),
      popLastQueued: vi.fn(() => undefined),
      clearQueue: vi.fn(),
      setModel: vi.fn(),
      commands: vi.fn(() => []),
      resolveCommand: vi.fn(() => undefined),
      enqueueCommand: vi.fn(),
      runCommand: vi.fn(() => Promise.resolve({ ran: true, startedTurn: false })),
      pendingCounts: vi.fn(() => ({ schedules: 0, reminders: 0, total: 0 })),
      todos: vi.fn(() => []),
      availableTools: vi.fn(() => []),
    } as unknown as AgentSession;

    // The whole point of this spec: the panel is mounted INSIDE an open shadow
    // root, the way <web-agent-bubble> mounts it (web-agent-embed.ts:299).
    host = document.createElement("div");
    document.body.appendChild(host);
    root = host.attachShadow({ mode: "open" });

    element = document.createElement("agent-chat-panel");
    element.session = session;
    root.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    host.remove();
  });

  it("stays open when the opening click on #history-anchor reaches document", async () => {
    const anchor = element.querySelector("#history-anchor") as HTMLElement;
    expect(anchor).not.toBeNull();

    // Open it the way a user does — a real click on the anchor's real button.
    (anchor.querySelector("button") as HTMLButtonElement).click();
    await element.updateComplete;
    await Promise.resolve();
    expect(priv(element)._historyPanelOpen).toBe(true);

    // The outside-click listener now lives on `document`. A DOM-dispatched
    // click cannot reproduce "that same click reaches document" here: any
    // click whose composedPath() includes `anchor` also re-fires anchor's own
    // toggle listener (chat-panel-elements.ts:120, onPress: () =>
    // this._toggleHistoryPanel()) via normal bubble/at-target semantics,
    // closing the panel through the app's own already-open toggle — a
    // different mechanism than the composedPath defect under test here.
    // So the outside-click handler is invoked directly with a constructed
    // event whose composedPath() reports the anchor, isolating exactly the
    // behaviour this task changed: before the fix (Node.contains()) this
    // constructed event still closes the panel, because contains() cannot
    // see composedPath() at all — it inspects e.target, which a real
    // shadow-crossing click retargets to `host`.
    const outsideHandler = priv(element)._historyOutsideHandler;
    expect(outsideHandler).toBeDefined();
    const fakeEvent = {
      target: host,
      composedPath: () => [anchor],
    } as unknown as MouseEvent;
    outsideHandler!(fakeEvent);
    expect(priv(element)._historyPanelOpen).toBe(true);
    expect(element.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("stays open when a click lands inside the dropdown", async () => {
    priv(element)._toggleHistoryPanel();
    await element.updateComplete;
    await Promise.resolve();
    expect(priv(element)._historyPanelOpen).toBe(true);

    const row = element.querySelector(".wa-history-row") as HTMLElement;
    expect(row).not.toBeNull();
    // Dispatch on the row's own child so the target is deep inside the
    // dropdown, then let it bubble to document.
    const inner = row.firstElementChild as HTMLElement;
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await element.updateComplete;
    expect(priv(element)._historyPanelOpen).toBe(true);
  });

  it("still closes when the click is outside both the dropdown and the anchor", async () => {
    priv(element)._toggleHistoryPanel();
    await element.updateComplete;
    await Promise.resolve();
    expect(priv(element)._historyPanelOpen).toBe(true);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    try {
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      await element.updateComplete;
      expect(priv(element)._historyPanelOpen).toBe(false);
    } finally {
      outside.remove();
    }
  });

  it("still closes on Escape inside a shadow root", async () => {
    priv(element)._toggleHistoryPanel();
    await element.updateComplete;
    await Promise.resolve();
    expect(priv(element)._historyPanelOpen).toBe(true);

    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await element.updateComplete;
    expect(priv(element)._historyPanelOpen).toBe(false);
  });

  it("keeps focus inside the panel after deleting a row, so Escape still closes it", async () => {
    priv(element)._toggleHistoryPanel();
    await element.updateComplete;
    await Promise.resolve();
    expect(priv(element)._historyPanelOpen).toBe(true);

    const rows = element.querySelectorAll<HTMLElement>(".wa-history-row");
    expect(rows.length).toBe(2);
    const deleteBtn = rows[0].querySelector<HTMLElement>("wa-icon-button")!;
    (deleteBtn.querySelector("button") as HTMLButtonElement).focus();
    expect(root.activeElement).toBe(deleteBtn.querySelector("button"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      // Deleting removes session-1's row from the DOM (jsdom does not run
      // the real subscription round-trip this component drives from, so the
      // row's own removal is simulated the way it happens for real: the
      // element the browser was about to make focus-less).
      priv(element)._handleHistoryDelete("session-1");
      rows[0].remove();
    } finally {
      confirmSpy.mockRestore();
    }

    // Focus must have already moved to session-2's row BEFORE its own row
    // was removed above — not left on the (now-detached) button, and not
    // reverted to <body> the way a plain DOM removal would leave it.
    const secondRowDeleteBtn = rows[1].querySelector<HTMLElement>("wa-icon-button")!;
    expect(root.activeElement).toBe(secondRowDeleteBtn.querySelector("button"));

    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await element.updateComplete;
    expect(priv(element)._historyPanelOpen).toBe(false);
  });

  it("focuses the dialog itself when the only row is deleted", async () => {
    priv(element)._toggleHistoryPanel();
    await element.updateComplete;
    await Promise.resolve();

    const rows = element.querySelectorAll<HTMLElement>(".wa-history-row");
    // Remove the second row first so only session-1 remains, matching the
    // "no rows survive the delete" case.
    rows[1].remove();
    const deleteBtn = rows[0].querySelector<HTMLElement>("wa-icon-button")!;
    (deleteBtn.querySelector("button") as HTMLButtonElement).focus();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      priv(element)._handleHistoryDelete("session-1");
      rows[0].remove();
    } finally {
      confirmSpy.mockRestore();
    }

    expect(root.activeElement).toBe(element.querySelector(".wa-history-popup"));

    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await element.updateComplete;
    expect(priv(element)._historyPanelOpen).toBe(false);
  });
});
