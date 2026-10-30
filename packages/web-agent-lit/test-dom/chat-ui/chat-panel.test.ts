import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import { getAgentCursor } from "../../src/chat-ui/agent-cursor.js";
import type { AgentSession, AvailableTool, SessionState, SessionEvent, AttachmentProvider, CustomToolDef, MessagePart, SessionConfig, TodoItem } from "@cuatoi/web-agent-core";
import { createAgentSession, setMockScript } from "@cuatoi/web-agent-core";

/** The private surface these tests drive directly. `AgentChatPanel` declares
 *  these `protected`, so the tests reach them through one named type rather than
 *  `any` at every call site. Nothing here changes what the panel does. */
type PanelInternals = {
  _closeSlashMenu(): void;
  _composerValue: string;
  _forceScrollToBottom: boolean;
  _handleBlockButton(e: Event): void;
  _handleBlockSubmit(e: Event): void;
  _handleKeyDown(e: KeyboardEvent): void;
  _handleSend(): void;
  _handleTitleEditCancel(): void;
  _handleTitleEditConfirm(): void;
  _handleTitleEditOpen(): void;
  _historyPanelOpen: boolean;
  _onComposerInput(value: string): void;
  _resolveProviders(): AttachmentProvider[];
  _scrollRafId: number | null;
  _scrollToBottomQueue(): void;
  _slashEntries: import("@cuatoi/web-agent-core").CommandEntry[];
  _slashHighlight: number;
  _slashMenuEl: HTMLElement;
  _slashOpen: boolean;
  _titleEditActive: boolean;
  _titleEditValue: string;
  _toggleHistoryPanel(): void;
  _updateSendButtonState(): void;
  _updateSlashMenu(): void;
  /** Asserted `toBeUndefined()` — the panel must NOT expose it. */
  resetSession?: unknown;
};

// Intersecting with `AgentChatPanel` here (`AgentChatPanel & PanelInternals`)
// looked natural, but every `PanelInternals` member shares a name with a real
// `protected` field/method on the class, and TypeScript's checker resolves that
// intersection's colliding members to an unresolvable type in some contexts
// (surfaced by eslint's type-aware rules, not by `tsc` itself). Casting to
// `PanelInternals` alone avoids the collision; nothing here needs a public
// member on the same expression as a protected one.
const priv = (el: AgentChatPanel): PanelInternals =>
  el as unknown as PanelInternals;

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

/** The `AgentSession` mock. Every method is a `vi.fn`, so the tests can
 *  assert on calls; the type keeps `mockSession.send` etc. resolvable.
 *  `getAttachmentProviders` is attached dynamically by some tests (never at
 *  construction) and `initPromise` is never used on this mock at all — both
 *  are the ones the mapped type must not force onto the initial literal. */
type MockSession = Omit<{
  [K in keyof AgentSession]: AgentSession[K] extends (...a: infer A) => infer R
    ? Mock<A, R>
    : AgentSession[K];
}, "getAttachmentProviders" | "initPromise"> & {
  getAttachmentProviders?: AgentSession["getAttachmentProviders"];
};

describe("AgentChatPanel", () => {
  let element: AgentChatPanel;
  let mockSession: MockSession;
  let mockState: SessionState;
  let subscribers: ((state: SessionState) => void)[] = [];
  let eventSubscribers: ((e: SessionEvent) => void)[] = [];

  beforeEach(() => {
    subscribers = [];
    eventSubscribers = [];
    mockState = {
      activeSessionId: "session-1",
      sessions: [
        { id: "session-1", title: "Test Session", titleManual: false, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 }
      ],
      messages: [],
      running: false,
      compacting: false,
      canCompact: false,
      error: null,
      contextWindow: { used: 0, total: 128000, percent: 0 },
      queuedMessages: []
    };

    mockSession = {
      getState: vi.fn(() => mockState),
      subscribe: vi.fn((cb) => {
        subscribers.push(cb);
        cb(mockState);
        return () => {
          subscribers = subscribers.filter(s => s !== cb);
        };
      }),
      updateConfig: vi.fn(),
      createSession: vi.fn(() => {
        mockState.sessions.push({
          id: "session-new",
          title: "",
          titleManual: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0
        });
        mockState.activeSessionId = "session-new";
        triggerStateUpdate();
        return Promise.resolve();
      }),
      switchSession: vi.fn((id: string) => {
        mockState.activeSessionId = id;
        triggerStateUpdate();
        return Promise.resolve();
      }),
      deleteSession: vi.fn((id: string) => {
        mockState.sessions = mockState.sessions.filter(s => s.id !== id);
        if (mockState.activeSessionId === id) {
          mockState.activeSessionId = mockState.sessions[0]?.id || "";
        }
        triggerStateUpdate();
        return Promise.resolve();
      }),
      send: vi.fn((parts: MessagePart[]) => {
        // `html` was never a `SessionMessage` field (nothing reads it) — the
        // real field this mock needs is `text`, already set below.
        mockState.messages.push({
          role: "user",
          text: parts.map((p) => (p.type === "text" ? p.text : "")).join(" "),
        });
        triggerStateUpdate();
        return Promise.resolve();
      }),
      abort: vi.fn(),
      compact: vi.fn(),
      reset: vi.fn(),
      setTitle: vi.fn((id: string, title: string) => {
        const s = mockState.sessions.find(x => x.id === id);
        if (s) {
          s.title = title;
          s.titleManual = true;
        }
        triggerStateUpdate();
        return Promise.resolve();
      }),
      autoTitle: vi.fn(() => {
        const s = mockState.sessions.find(x => x.id === mockState.activeSessionId);
        if (s) {
          s.title = "Auto Title";
        }
        triggerStateUpdate();
        return Promise.resolve();
      }),
      dispose: vi.fn(),
      subscribeEvents: vi.fn((cb) => {
        eventSubscribers.push(cb);
        return () => {
          eventSubscribers = eventSubscribers.filter(s => s !== cb);
        };
      }),
      retryLast: vi.fn(() => Promise.resolve()),
      cancelQueued: vi.fn((id: string) => {
        mockState.queuedMessages = mockState.queuedMessages.filter(q => q.id !== id);
        triggerStateUpdate();
      }),
      popLastQueued: vi.fn(() => {
        const item = mockState.queuedMessages[mockState.queuedMessages.length - 1];
        if (!item) return undefined;
        mockState.queuedMessages = mockState.queuedMessages.slice(0, -1);
        triggerStateUpdate();
        return { text: item.text, images: item.images };
      }),
      clearQueue: vi.fn(() => {
        mockState.queuedMessages = [];
        triggerStateUpdate();
      }),
      clearAllSessions: vi.fn(() => Promise.resolve()),
      refreshSessions: vi.fn(() => Promise.resolve()),
      setModel: vi.fn(),
      commands: vi.fn(() => []),
      resolveCommand: vi.fn(() => undefined),
      enqueueCommand: vi.fn(),
      runCommand: vi.fn(() => Promise.resolve({ ran: true, startedTurn: false })),
      pendingCounts: vi.fn(() => ({ schedules: 0, reminders: 0, total: 0 })),
      todos: vi.fn((): TodoItem[] => []),
      availableTools: vi.fn((): AvailableTool[] => []),
    };

    element = document.createElement("agent-chat-panel");
    element.session = mockSession;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  function triggerStateUpdate() {
    for (const sub of subscribers) {
      sub({ ...mockState });
    }
  }

  function triggerEvent(e: SessionEvent) {
    for (const sub of eventSubscribers) {
      sub(e);
    }
  }

  async function openMenuItem(el: AgentChatPanel, label: string) {
    const kebab = el.querySelector("#menu-anchor") as HTMLButtonElement;
    kebab.click();
    await el.updateComplete;
    const item = Array.from(el.querySelectorAll('[role="menuitem"]'))
      .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    item.click();
    await el.updateComplete;
  }

  it("subscribes to AgentSession and reflects initial messages", async () => {
    mockState.messages = [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there", trace: [] }
    ];
    triggerStateUpdate();
    await element.updateComplete;

    const msgs = element.querySelectorAll("agent-message-view");
    expect(msgs.length).toBe(2);
    expect(msgs[0].text).toBe("hello");
    expect(msgs[1].text).toBe("hi there");
  });

  it("threads agentShortName through to each agent-message-view", async () => {
    element.agentShortName = "Whiskers";
    mockState.messages = [
      { role: "assistant", text: "hi", trace: [] },
    ];
    triggerStateUpdate();
    await element.updateComplete;

    const msgs = element.querySelectorAll("agent-message-view");
    expect(msgs[0].agentShortName).toBe("Whiskers");
  });

  it("calls session.send when a message is sent", async () => {
    await element.send("test input message");
    expect(mockSession.send).toHaveBeenCalledWith([
      { type: "text", text: "test input message" }
    ]);
  });

  it("calls session.abort when stop is pressed", () => {
    element.stop();
    expect(mockSession.abort).toHaveBeenCalled();
  });

  it("calls session.compact when compactSession is called", async () => {
    await element.compactSession();
    expect(mockSession.compact).toHaveBeenCalled();
  });

  it("calls session.clearAllSessions when clearAllSessions is called", async () => {
    await element.clearAllSessions();
    expect(mockSession.clearAllSessions).toHaveBeenCalled();
  });

  it("renders a kebab menu button in the header", async () => {
    await element.updateComplete;
    expect(element.querySelector("#menu-anchor")).not.toBeNull();
    expect(element.querySelector('button[aria-label="Menu options"]')).not.toBeNull();
    expect(priv(element).resetSession).toBeUndefined();
  });

  it("header has no standalone gear or bug icon", async () => {
    await element.updateComplete;
    expect(element.querySelector('button[aria-label="Settings"]')).toBeNull();
    expect(element.querySelector('button[aria-label="Debug"]')).toBeNull();
  });

  it("hideHeader defaults to false", async () => {
    await element.updateComplete;
    expect(element.hideHeader).toBe(false);
    expect(element.querySelector(".header")).not.toBeNull();
  });

  it("hideHeader=true suppresses the header and sets hide-header attribute with chromeless styles", async () => {
    element.hideHeader = true;
    await element.updateComplete;
    expect(element.querySelector(".header")).toBeNull();
    expect(element.hasAttribute("hide-header")).toBe(true);

    const cs = window.getComputedStyle(element);
    expect(cs.borderRadius === "0px" || cs.borderRadius === "0").toBe(true);
    expect(cs.boxShadow).toBe("none");
    expect(cs.borderStyle === "none" || cs.borderWidth === "0px" || cs.borderWidth === "0" || cs.borderTopStyle === "none" || cs.borderStyle === "").toBe(true);
    expect(cs.zIndex).toBe("auto");
    expect(cs.backgroundColor === "transparent" || cs.backgroundColor === "rgba(0, 0, 0, 0)").toBe(true);
  });

  it("hideHeader=false retains card container styles and z-index 9999", async () => {
    element.hideHeader = false;
    await element.updateComplete;
    expect(element.hasAttribute("hide-header")).toBe(false);

    const cs = window.getComputedStyle(element);
    // border-radius is a raw 12px literal (no theme border-radius step
    // matches it). Assert non-zero, matching the
    // "hideHeader=true" case's own 0px/0 check above, instead of pinning the
    // exact fallback literal.
    expect(cs.borderRadius === "0px" || cs.borderRadius === "0" || cs.borderRadius === "").toBe(false);
    expect(cs.boxShadow).not.toBe("none");
    expect(cs.zIndex).toBe("9999");
  });

  it("hideHeader=true still renders the message list and composer", async () => {
    element.hideHeader = true;
    await element.updateComplete;
    expect(element.querySelector(".messages-list")).not.toBeNull();
    expect(element.querySelector(".composer")).not.toBeNull();
  });

  it("hideHeader=true still completes a message turn", async () => {
    element.hideHeader = true;
    await element.updateComplete;
    await element.send("test input message");
    expect(mockSession.send).toHaveBeenCalledWith([
      { type: "text", text: "test input message" }
    ]);
    mockState.messages = [
      { role: "user", text: "test input message" },
      { role: "assistant", text: "reply" },
    ];
    triggerStateUpdate();
    await element.updateComplete;
    const msgs = element.querySelectorAll("agent-message-view");
    expect(msgs.length).toBe(2);
  });

  it("gauge compact-request event triggers compactSession", async () => {
    mockState.messages = [
      { role: "user", text: "hello" },
      { role: "assistant", text: "reply 1" },
      { role: "user", text: "hello 2" },
      { role: "assistant", text: "reply 2" },
    ];
    triggerStateUpdate();
    await element.updateComplete;

    const gauge = element.querySelector("agent-context-gauge");
    expect(gauge).toBeTruthy();
    gauge?.dispatchEvent(new CustomEvent("compact-request", { bubbles: true, composed: true }));
    expect(mockSession.compact).toHaveBeenCalled();
  });

  it("renders the context gauge in the composer controls row, immediately before send (002)", async () => {
    await element.updateComplete;

    const gauge = element.querySelector("agent-context-gauge");
    expect(gauge).toBeTruthy();

    // It left the header entirely.
    expect(element.querySelector(".header agent-context-gauge")).toBeNull();

    // It is a direct child of the composer controls row...
    const controls = element.querySelector(".composer-controls")!;
    expect(gauge!.parentElement).toBe(controls);

    // ...and the last child but one, i.e. immediately left of send/stop.
    const kids = [...controls.children];
    expect(kids.indexOf(gauge!)).toBe(kids.length - 2);

    // Disabled (fewer than two assistant messages) but still rendered.
    expect(gauge!.disabled).toBe(true);
  });

  it("falls back to core's 0.75 fraction for warnAt when config.context is unset (008)", async () => {
    expect(element.config?.context).toBeUndefined();
    mockState.contextWindow = { used: 102_400, total: 128_000, percent: 0.8 };
    triggerStateUpdate();
    await element.updateComplete;

    const gauge = element.querySelector("agent-context-gauge")!;
    expect(gauge).toBeTruthy();
    // The unit must match `percent`, which core clamps to 0…1.
    expect(gauge.warnAt).toBe(0.75);

    await gauge.updateComplete;
    const fg = gauge.querySelector(".fg-circle")!;
    // 0.8 >= 0.75 — the warn state must actually be reachable.
    expect(fg.classList.contains("color-red")).toBe(true);
    expect(fg.classList.contains("color-green")).toBe(false);
  });

  it("still prefers a host-supplied autoCompactPercent over the fallback (008)", async () => {
    element.config = { context: { autoCompactPercent: 0.5 } };
    mockState.contextWindow = { used: 51_200, total: 128_000, percent: 0.4 };
    triggerStateUpdate();
    await element.updateComplete;

    const gauge = element.querySelector("agent-context-gauge")!;
    expect(gauge.warnAt).toBe(0.5);

    await gauge.updateComplete;
    const fg = gauge.querySelector(".fg-circle")!;
    // 0.4 sits in the amber band (warnAt - 0.15 = 0.35 … 0.5).
    expect(fg.classList.contains("color-amber")).toBe(true);
  });

  it("calls session.setTitle when custom title confirms", async () => {
    priv(element)._titleEditActive = true;
    await element.updateComplete;

    const input = element.shadowRoot?.querySelector<HTMLInputElement>(".wa-title-edit-row input")
      || element.querySelector<HTMLInputElement>(".wa-title-edit-row input");
    if (input) {
      input.value = "New Custom Title";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      priv(element)._titleEditValue = "New Custom Title";
    }

    priv(element)._handleTitleEditConfirm();
    expect(mockSession.setTitle).toHaveBeenCalledWith("session-1", "New Custom Title");
  });

  it("renders the title-edit confirm and cancel as labelled icon buttons", async () => {
    priv(element)._handleTitleEditOpen();
    await element.updateComplete;

    const root = element.shadowRoot ?? element;
    const row = root.querySelector(".wa-title-edit-row")!;
    const confirm = row.querySelector('[aria-label="Save title"]')!;
    const cancel = row.querySelector('[aria-label="Cancel title edit"]')!;

    expect(confirm.querySelector("svg")).not.toBeNull();
    expect(cancel.querySelector("svg")).not.toBeNull();
    expect(confirm.textContent?.trim()).toBe("");
    expect(cancel.textContent?.trim()).toBe("");
    // The row still holds exactly the input plus the two controls.
    expect(row.children.length).toBe(3);
  });

  it("saves on the check click and closes without saving on the X click", async () => {
    priv(element)._handleTitleEditOpen();
    await element.updateComplete;
    const root = element.shadowRoot ?? element;
    priv(element)._titleEditValue = "Clicked Title";

    (root.querySelector('[aria-label="Save title"]') as HTMLElement).click();
    expect(mockSession.setTitle).toHaveBeenCalledWith("session-1", "Clicked Title");
    expect(priv(element)._titleEditActive).toBe(false);

    mockSession.setTitle.mockClear();
    priv(element)._handleTitleEditOpen();
    await element.updateComplete;
    (root.querySelector('[aria-label="Cancel title edit"]') as HTMLElement).click();
    expect(mockSession.setTitle).not.toHaveBeenCalled();
    expect(priv(element)._titleEditActive).toBe(false);
  });

  it("the header has exactly two element children in the default mode", async () => {
    await element.updateComplete;
    const h = element.querySelector(".header")!;
    expect(h.children.length).toBe(2);
    expect(h.children[0].classList.contains("wa-header-left")).toBe(true);
    expect(h.children[1].classList.contains("wa-header-actions")).toBe(true);
  });

  it("the pencil is inside the left group, immediately after the title", async () => {
    await element.updateComplete;
    const left = element.querySelector(".wa-header-left")!;
    expect(left.children.length).toBe(2);
    expect(left.children[0].classList.contains("header-title")).toBe(true);
    expect(left.children[1].classList.contains("wa-title-edit-btn")).toBe(true);
  });

  it("the header has exactly two element children while editing", async () => {
    priv(element)._titleEditActive = true;
    element.requestUpdate();
    await element.updateComplete;
    const h = element.querySelector(".header")!;
    expect(h.children.length).toBe(2);
    expect(h.children[0].classList.contains("wa-header-left")).toBe(true);
    expect(h.children[0].classList.contains("wa-title-edit-row")).toBe(true);
    expect(h.children[0].children.length).toBe(3);
  });

  it("the header stylesheet drops space-between and hides the pencil until hover", async () => {
    await element.updateComplete;
    const styleText = element.querySelector("style")!.textContent;
    expect(styleText).not.toMatch(/\.header\s*\{[^}]*justify-content/);
    expect(styleText).toContain(".wa-header-left .wa-title-edit-btn");
    expect(styleText).toContain("pointer-events: none");
    expect(styleText).toContain(".header:hover .wa-title-edit-btn");
    expect(styleText).toContain(".header:focus-within .wa-title-edit-btn");
    expect(styleText).toContain("@media (hover: none)");
    expect(styleText).toContain("text-overflow: ellipsis");
  });

  it("the pencil carries no inline opacity", async () => {
    await element.updateComplete;
    const btn = element.querySelector<HTMLElement>(".wa-title-edit-btn")!;
    expect(btn.style.opacity).toBe("");
  });

  it("double-clicking the title opens the inline editor", async () => {
    await element.updateComplete;
    const title = element.querySelector(".header-title")!;
    title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await element.updateComplete;
    expect(priv(element)._titleEditActive).toBe(true);
    expect(element.querySelector(".wa-title-edit-row")).not.toBeNull();
    expect(priv(element)._titleEditValue).toBe("Test Session");
  });

  it("double-clicking the title clears the word selection", async () => {
    await element.updateComplete;
    const titleSpan = element.querySelector(".header-title")!;
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(titleSpan);
      expect(sel.rangeCount).toBe(1);
    }
    titleSpan.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await element.updateComplete;
    if (sel) {
      expect(sel.rangeCount).toBe(0);
    }
  });

  it("double-clicking while already editing does nothing", async () => {
    priv(element)._handleTitleEditOpen();
    await element.updateComplete;
    mockSession.setTitle.mockClear();
    const header = element.querySelector(".header")!;
    header.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await element.updateComplete;
    expect(priv(element)._titleEditActive).toBe(true);
    expect(mockSession.setTitle).not.toHaveBeenCalled();
  });

  it("double-clicking the pencil or an action button does not open the editor", async () => {
    await element.updateComplete;
    const pencil = element.querySelector(".wa-title-edit-btn")!;
    pencil.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await element.updateComplete;
    expect(priv(element)._titleEditActive).toBe(false);

    const newBtn = element.querySelector('[aria-label="New session"]')!;
    newBtn.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await element.updateComplete;
    expect(priv(element)._titleEditActive).toBe(false);
  });

  it("with persist false there is no pencil and no double-click rename", async () => {
    element.config = { ...element.config, persist: false };
    await element.updateComplete;
    expect(element.querySelector(".wa-title-edit-btn")).toBeNull();
    const title = element.querySelector(".header-title")!;
    title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await element.updateComplete;
    expect(priv(element)._titleEditActive).toBe(false);
  });

  it("opening the title editor focuses the input", async () => {
    priv(element)._handleTitleEditOpen();
    await element.updateComplete;
    await Promise.resolve();
    const host = element.querySelector(".wa-title-edit-row wa-text-input");
    const expectedInput = host?.querySelector("input") ?? host;
    expect(document.activeElement).toBe(expectedInput);
  });

  // 003410-005 round 2: Stage A found this broken live in cat-store, whose
  // Acme <wa-text-input> keeps its real <input> in a Material field's shadow
  // DOM (no light-DOM input to find) — the old lookup then fell back to
  // focusing the non-focusable <wa-text-input> wrapper itself. This case
  // fails against that old lookup: it swaps in a field shape with no
  // light-DOM input, only a child whose OWN focus() delegates internally
  // (like Material's `md-outlined-text-field.focus()`) and which reports its
  // own async first render — exactly cat-store's shape, without depending on
  // the real Acme/Material code from this package.
  it("opening the title editor focuses a Material-shaped field via its own delegating focus()", async () => {
    priv(element)._handleTitleEditOpen();
    await element.updateComplete;
    await Promise.resolve();
    const host = element.querySelector(".wa-title-edit-row wa-text-input")!;

    const fakeField = document.createElement("div");
    const focusSpy = vi.fn();
    (fakeField as unknown as { focus: () => void }).focus = focusSpy;
    let resolveFieldUpdate!: () => void;
    (fakeField as unknown as { updateComplete: Promise<void> }).updateComplete =
      new Promise((resolve) => { resolveFieldUpdate = resolve; });
    host.replaceChildren(fakeField);

    priv(element)._handleTitleEditOpen();
    await element.updateComplete;
    await Promise.resolve();
    expect(focusSpy).not.toHaveBeenCalled();

    resolveFieldUpdate();
    await Promise.resolve();
    await Promise.resolve();
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("the actions group holds the three header buttons and carries no inline style", async () => {
    await element.updateComplete;
    const actions = element.querySelector<HTMLElement>(".wa-header-actions")!;
    expect(actions.getAttribute("style")).toBeNull();
    expect(actions.querySelector('[aria-label="New session"]')).not.toBeNull();
    expect(actions.querySelector('[aria-label="Session history"]')).not.toBeNull();
    expect(actions.querySelector('[aria-label="Menu options"]')).not.toBeNull();
  });

  it("auto-titles on turn 1 and turn 3 assistant messages", async () => {
    mockState.messages = [
      { role: "user", text: "hello" }
    ];
    triggerStateUpdate();
    await element.updateComplete;
    expect(mockSession.autoTitle).not.toHaveBeenCalled();

    // Turn 1 assistant message added
    mockState.messages.push({ role: "assistant", text: "response 1" });
    triggerStateUpdate();
    await element.updateComplete;
    expect(mockSession.autoTitle).toHaveBeenCalledTimes(1);

    // Turn 2 assistant message added (should not trigger new autoTitle call)
    mockState.messages.push({ role: "user", text: "hello 2" });
    mockState.messages.push({ role: "assistant", text: "response 2" });
    triggerStateUpdate();
    await element.updateComplete;
    expect(mockSession.autoTitle).toHaveBeenCalledTimes(1);

    // Turn 3 assistant message added
    mockState.messages.push({ role: "user", text: "hello 3" });
    mockState.messages.push({ role: "assistant", text: "response 3" });
    triggerStateUpdate();
    await element.updateComplete;
    expect(mockSession.autoTitle).toHaveBeenCalledTimes(2);
  });

  it("auto-titles: manual suppression triggers no autoTitle calls", async () => {
    priv(element)._titleEditActive = true;
    await element.updateComplete;

    priv(element)._titleEditValue = "User Title";
    priv(element)._handleTitleEditConfirm();

    mockSession.autoTitle.mockClear();

    mockState.messages = [
      { role: "user", text: "hello" },
      { role: "assistant", text: "response 1" }
    ];
    triggerStateUpdate();
    await element.updateComplete;
    expect(mockSession.autoTitle).not.toHaveBeenCalled();

    // Turn 2
    mockState.messages.push({ role: "user", text: "hello 2" });
    mockState.messages.push({ role: "assistant", text: "response 2" });
    triggerStateUpdate();
    await element.updateComplete;

    // Turn 3
    mockState.messages.push({ role: "user", text: "hello 3" });
    mockState.messages.push({ role: "assistant", text: "response 3" });
    triggerStateUpdate();
    await element.updateComplete;
    expect(mockSession.autoTitle).not.toHaveBeenCalled();
  });

  it("switching to a session whose first turn already completed still gets auto-titled once (120/002)", async () => {
    // A fast turn (a mock reply, or a quick real one) can finish before this
    // element ever observes the session's pre-turn state — this element's
    // FIRST render for that session already shows turnCount 1. Gating solely
    // on turnCount would read that as "already auto-titled" and skip it
    // forever. Because the session's title is still empty, it must still get
    // its one chance.
    mockState.sessions.push({
      id: "session-fast",
      title: "",
      titleManual: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 2,
    });
    // Reassign, not mutate: the mock's subscribe() hands the FIRST state
    // notification the live `mockState` object by reference (not a copy), so
    // this component's cached `oldState` already points at it. Mutating
    // `mockState` in place would silently rewrite that cached snapshot too,
    // masking the very activeSessionId change this test means to exercise —
    // the same reason other tests below reassign with a spread.
    mockState = {
      ...mockState,
      activeSessionId: "session-fast",
      messages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "hello" },
      ],
    };
    triggerStateUpdate();
    await element.updateComplete;
    expect(mockSession.autoTitle).toHaveBeenCalledTimes(1);
  });

  it("switching to an already-titled session is not re-auto-titled, even with turnCount 1 (120/002)", async () => {
    mockState.sessions.push({
      id: "session-titled",
      title: "Already titled",
      titleManual: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 2,
    });
    // Reassign, not mutate — see the note in the test above.
    mockState = {
      ...mockState,
      activeSessionId: "session-titled",
      messages: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "hello" },
      ],
    };
    triggerStateUpdate();
    await element.updateComplete;
    expect(mockSession.autoTitle).not.toHaveBeenCalled();
  });

  // 007: buildSessionConfig() no longer derives actionCue/typingPaceMs from
  // `cues` — the host wires them into `domTools({ actionCue, typingPaceMs })`
  // instead, using `createActionCue` (covered by cue-actions.test.ts) and
  // `this._cues` (still kept here for the agent-cursor.clear() calls).

  it("confirmInteraction() delegates to the built-in confirm scrim, rendered into the panel itself", async () => {
    const pending = element.confirmInteraction({ action: "click", ref: "1", name: "Remove item" });
    expect(element.querySelector(".wa-confirm-scrim")).not.toBeNull();
    const allowBtn = Array.from(element.querySelectorAll("button")).find((b) => b.textContent === "Allow");
    allowBtn!.click();
    await expect(pending).resolves.toBe(true);
    expect(element.querySelector(".wa-confirm-scrim")).toBeNull();
  });

  it("re-subscribes on reconnect across connect→disconnect→reconnect cycle", async () => {
    expect(element.running).toBe(false);

    // Disconnect from DOM
    document.body.removeChild(element);
    expect(subscribers.length).toBe(0);

    // Reconnect to DOM
    document.body.appendChild(element);
    expect(subscribers.length).toBe(1);

    // Emitting state should reach the panel
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.running).toBe(true);
  });

  it("renders inline notice and Retry button when last message has failed marker", async () => {
    mockState.messages = [{
      role: 'user',
      text: 'Place my order',
      failed: { message: 'Boom', retryable: true }
    }];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice[data-tone='error']");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Boom");
    const retryBtn = notice?.querySelector(".wa-notice-retry") as HTMLButtonElement | null;
    expect(retryBtn).not.toBeNull();
    expect(retryBtn?.disabled).toBe(false);
  });

  it("renders notice without container background, border or radius", async () => {
    mockState.messages = [{
      role: 'user',
      text: 'Place my order',
      failed: { message: 'Boom', retryable: true }
    }];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice") as HTMLElement;
    expect(notice).not.toBeNull();
    const style = window.getComputedStyle(notice);
    expect(style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent").toBe(true);
    // jsdom leaves borderWidth "" rather than "0px" when borderStyle is "none"
    // (same quirk worked around at line 299 above) — border-style: none is
    // itself proof there is no visible border.
    expect(style.borderStyle === "none" || style.borderWidth === "0px" || style.borderWidth === "0" || style.borderTopStyle === "none" || style.borderStyle === "").toBe(true);
    expect(style.borderRadius === "0px" || style.borderRadius === "0").toBe(true);
  });

  it("shows the one notice for the failed turn, but shows for non-turn error once dismissed", async () => {
    mockState.messages = [{
      role: 'user',
      text: 'Place my order',
      failed: { message: 'Boom', retryable: true }
    }];
    mockState.error = 'Boom';
    triggerStateUpdate();
    await element.updateComplete;

    expect(element.querySelector(".error-region")).toBeNull();
    expect(element.querySelector(".wa-notice[data-tone='error']")).not.toBeNull();

    mockState.messages = [{ role: 'user', text: 'Place my order' }];
    triggerStateUpdate();
    await element.updateComplete;

    expect(element.querySelector(".wa-notice[data-tone='error']")).not.toBeNull();
    expect(element.querySelector(".wa-notice-msg")?.textContent).toContain("Boom");
  });

  it("dismissing a failed turn hides the notice across re-renders", async () => {
    mockState.messages = [{
      role: 'user',
      text: 'Place my order',
      failed: { message: 'Boom', retryable: true }
    }];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    const dismissBtn = element.querySelector(".wa-notice-dismiss") as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();
    dismissBtn.click();
    await element.updateComplete;

    expect(element.querySelector(".wa-notice")).toBeNull();

    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelector(".wa-notice")).toBeNull();
  });

  it("notice action buttons are keyboard accessible and have accessible names", async () => {
    mockState.messages = [{
      role: 'user',
      text: 'Place my order',
      failed: { message: 'Boom', retryable: true }
    }];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    const retryBtn = element.querySelector(".wa-notice-retry") as HTMLButtonElement;
    const dismissBtn = element.querySelector(".wa-notice-dismiss") as HTMLButtonElement;
    expect(retryBtn.tagName).toBe("BUTTON");
    expect(dismissBtn.tagName).toBe("BUTTON");
    expect(dismissBtn.getAttribute("aria-label")).toBe("Dismiss");
    expect(retryBtn.textContent?.trim()).toBe("Retry");
  });

  it("shows the progress notice with the reason, count and dots during auto-retry", async () => {
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;

    triggerEvent({
      type: "auto-retry:attempt",
      attempt: 2,
      maxRetries: 5,
      error: { message: "Rate limited (HTTP 429)" },
    });
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice[data-tone='progress']");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Rate limited (HTTP 429)");
    expect(notice?.textContent).toContain("Retrying attempt 2 of 5");
    // Progress, not failure: polite, not an alert.
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    // Still working — no actions offered.
    expect(notice?.querySelector(".wa-notice-retry")).toBeNull();
    expect(notice?.querySelector(".wa-notice-dismiss")).toBeNull();
    // Dots: maxRetries total, `attempt` filled, hidden from assistive tech.
    expect(notice?.querySelectorAll(".wa-notice-dot").length).toBe(5);
    expect(notice?.querySelectorAll(".wa-notice-dot[data-filled]").length).toBe(2);
    expect(notice?.querySelector(".wa-notice-dots")?.getAttribute("aria-hidden")).toBe("true");
    // 008: the separate element is gone for good.
    expect(element.querySelector(".wa-retrying")).toBeNull();
  });

  it("clears the progress notice when running transitions true -> false", async () => {
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;

    triggerEvent({
      type: "auto-retry:attempt",
      attempt: 2,
      maxRetries: 5,
      error: { message: "Rate limited (HTTP 429)" },
    });
    await element.updateComplete;
    expect(element.querySelector(".wa-notice[data-tone='progress']")).not.toBeNull();

    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelector(".wa-notice[data-tone='progress']")).toBeNull();
  });

  // 008 criterion 2/3: one element, three states. The DOM tier proves the role
  // and the class swap on the SAME node; the e2e proves the geometry.
  it("reuses the same notice element when the retries run out", async () => {
    mockState.running = true;
    mockState.messages = [{ role: 'user', text: 'hi' }];
    triggerStateUpdate();
    await element.updateComplete;

    triggerEvent({
      type: "auto-retry:attempt",
      attempt: 2,
      maxRetries: 2,
      error: { message: "Rate limited (HTTP 429)" },
    });
    await element.updateComplete;
    const before = element.querySelector(".wa-notice") as HTMLElement;
    expect(before.getAttribute("data-tone")).toBe("progress");

    triggerEvent({ type: "retry:failure" });
    mockState.running = false;
    mockState.messages = [
      { role: 'user', text: 'hi', failed: { message: 'Rate limited (HTTP 429)', retryable: true } },
    ];
    triggerStateUpdate();
    await element.updateComplete;

    const after = element.querySelector(".wa-notice") as HTMLElement;
    // lit patches the existing node rather than replacing it — that is what
    // keeps the transcript from shifting.
    expect(after).toBe(before);
    expect(after.getAttribute("data-tone")).toBe("error");
    expect(after.getAttribute("role")).toBe("alert");
    expect(after.hasAttribute("aria-live")).toBe(false);
    expect(after.querySelector(".wa-notice-retry")).not.toBeNull();
    expect(after.querySelector(".wa-notice-dismiss")).not.toBeNull();
  });

  it("renders the panel's own warning when no host notify callback is set", async () => {
    element.notify = undefined;
    const seen: string[] = [];
    element.addEventListener("agent-toast", (e) => {
      seen.push((e as CustomEvent<{ message: string }>).detail.message);
    });

    priv(element)._showToast("Image resized to fit size limits", "info");
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice[data-tone='progress']");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Image resized to fit size limits");
    expect(notice?.querySelector(".wa-notice-retry")).toBeNull();
    expect(notice?.querySelector(".wa-notice-dismiss")).not.toBeNull();
    // The event path is unchanged on this branch.
    expect(seen).toEqual(["Image resized to fit size limits"]);

    (notice?.querySelector(".wa-notice-dismiss") as HTMLButtonElement).click();
    await element.updateComplete;
    expect(element.querySelector(".wa-notice[data-tone='progress']")).toBeNull();
  });

  it("defers to a host notify callback and dispatches no event", async () => {
    const hostSaw: [string, string][] = [];
    element.notify = (msg, type) => { hostSaw.push([msg, type]); };
    const seen: string[] = [];
    element.addEventListener("agent-toast", (e) => {
      seen.push((e as CustomEvent<{ message: string }>).detail.message);
    });

    priv(element)._showToast("Image resized to fit size limits", "info");
    await element.updateComplete;

    expect(hostSaw).toEqual([["Image resized to fit size limits", "info"]]);
    // Corrected contract (see "Plan contradiction and its resolution"): the
    // event fires ONLY on the no-notify branch.
    expect(seen).toEqual([]);
    expect(element.querySelector(".wa-notice")).toBeNull();
  });

  it("shows a warning alongside a failed turn, never instead of it", async () => {
    element.notify = undefined;
    mockState.messages = [
      { role: 'user', text: 'hi', failed: { message: 'Boom', retryable: true } },
    ];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelectorAll(".wa-notice").length).toBe(1);

    priv(element)._showToast("Image resized to fit size limits", "info");
    await element.updateComplete;

    const notices = element.querySelectorAll(".wa-notice");
    expect(notices.length).toBe(2);
    expect(element.querySelectorAll(".wa-notice[data-tone='error']").length).toBe(1);
    expect(element.querySelectorAll(".wa-notice[data-tone='progress']").length).toBe(1);
    expect(element.textContent).toContain("Boom");
    expect(element.textContent).toContain("Image resized to fit size limits");
  });

  it("retrying outranks a failed turn and a provider error", async () => {
    mockState.running = true;
    mockState.messages = [
      { role: 'user', text: 'hi', failed: { message: 'Boom', retryable: true } },
    ];
    mockState.error = 'Provider unavailable';
    triggerStateUpdate();
    await element.updateComplete;

    triggerEvent({
      type: "auto-retry:attempt",
      attempt: 1,
      maxRetries: 3,
      error: { message: "Rate limited (HTTP 429)" },
    });
    await element.updateComplete;

    expect(element.querySelectorAll(".wa-notice").length).toBe(1);
    expect(element.querySelector(".wa-notice")?.getAttribute("data-tone")).toBe("progress");
    expect(element.textContent).not.toContain("Boom");
    expect(element.textContent).not.toContain("Provider unavailable");
  });

  it("clicking Retry invokes retryLast() on session", async () => {
    mockState.messages = [{
      role: 'user',
      text: 'Place my order',
      failed: { message: 'Boom', retryable: true }
    }];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    const retryBtn = element.querySelector(".wa-notice-retry") as HTMLButtonElement;
    retryBtn.click();
    expect(mockSession.retryLast).toHaveBeenCalledTimes(1);
  });

  it("shows notice with Dismiss and no Retry on terminal failure (retryable: false)", async () => {
    mockState.messages = [{
      role: 'user',
      text: 'Place my order',
      failed: { message: 'Terminal Error', retryable: false }
    }];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice[data-tone='error']");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Terminal Error");
    expect(notice?.querySelector(".wa-notice-retry")).toBeNull();
    expect(notice?.querySelector(".wa-notice-dismiss")).not.toBeNull();
  });

  // 006: the notice must track the NEWEST turn, not "any turn that ever failed".
  it("hides the failed notice once a later turn succeeds", async () => {
    mockState.messages = [
      { role: 'user', text: 'first', failed: { message: 'Boom', retryable: true } },
      { role: 'assistant', text: 'partial', failed: { message: 'Boom', retryable: true } },
      { role: 'user', text: 'second' },
      { role: 'assistant', text: 'OK' },
    ];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    expect(element.querySelector(".wa-notice")).toBeNull();
  });

  it("hides the failed notice at send time, before the reply arrives", async () => {
    mockState.messages = [
      { role: 'user', text: 'first', failed: { message: 'Boom', retryable: true } },
    ];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelector(".wa-notice")).not.toBeNull();

    // The new user message is appended; no assistant message exists yet.
    mockState.messages = [
      { role: 'user', text: 'first', failed: { message: 'Boom', retryable: true } },
      { role: 'user', text: 'second' },
    ];
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;

    expect(element.querySelector(".wa-notice")).toBeNull();
  });

  it("shows the failed notice when the NEWEST turn failed after an earlier success", async () => {
    mockState.messages = [
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'OK' },
      { role: 'user', text: 'second', failed: { message: 'Boom', retryable: true } },
    ];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice[data-tone='error']");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Boom");
  });

  it("shows no failed notice for an empty transcript", async () => {
    mockState.messages = [];
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;

    expect(element.querySelector(".wa-notice")).toBeNull();
  });

  // 006/007 knock-on: a stale failed turn used to suppress a legitimate
  // provider error notice for the rest of the session; _renderFailedTurnAffordance()
  // now chooses one of the two explicitly instead of gating on `!this._lastFailed()`.
  it("shows the provider error notice when only an OLDER turn failed", async () => {
    mockState.messages = [
      { role: 'user', text: 'first', failed: { message: 'Boom', retryable: true } },
      { role: 'assistant', text: 'partial', failed: { message: 'Boom', retryable: true } },
      { role: 'user', text: 'second' },
      { role: 'assistant', text: 'OK' },
    ];
    mockState.error = 'Provider unavailable';
    triggerStateUpdate();
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice[data-tone='error']");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Provider unavailable");
    expect(element.querySelector(".error-region")).toBeNull();
  });


  it("allows submitting while running and enqueues the message", async () => {
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;

    const input = element.querySelector("#input") as HTMLElement & { disabled: boolean };
    expect(input.disabled).toBeFalsy();
    expect(element.querySelector('.composer-controls [data-attachment-provider="image"]')).not.toBeNull();

    priv(element)._composerValue = "queue me up";
    priv(element)._handleKeyDown({ key: "Enter", shiftKey: false, preventDefault: () => {} });
    await element.updateComplete;

    expect(mockSession.send).toHaveBeenCalledWith([
      { type: "text", text: "queue me up" }
    ]);
  });

  it("renders queued messages with cancel buttons", async () => {
    mockState.running = true;
    mockState.queuedMessages = [
      { id: "q1", text: "first queued" },
      { id: "q2", text: "second queued" },
    ];
    triggerStateUpdate();
    await element.updateComplete;

    const items = element.querySelectorAll(".wa-queue-item");
    expect(items.length).toBe(2);

    const firstCancelBtn = items[0].querySelector(".wa-queue-actions button") as HTMLButtonElement;
    firstCancelBtn.click();
    expect(mockSession.cancelQueued).toHaveBeenCalledWith("q1");
  });

  it("shows edit button only on the last queued message and pops it back to composer on click", async () => {
    mockState.running = true;
    mockState.queuedMessages = [
      { id: "q1", text: "first queued" },
      { id: "q2", text: "second queued" },
    ];
    triggerStateUpdate();
    await element.updateComplete;

    const items = element.querySelectorAll(".wa-queue-item");
    const firstButtons = items[0].querySelectorAll(".wa-queue-actions button");
    const lastButtons = items[1].querySelectorAll(".wa-queue-actions button");
    expect(firstButtons.length).toBe(1);
    expect(lastButtons.length).toBe(2);

    const editBtn = lastButtons[0] as HTMLButtonElement;
    editBtn.click();
    await element.updateComplete;

    expect(mockSession.popLastQueued).toHaveBeenCalled();
    expect(priv(element)._composerValue).toBe("second queued");
  });

  // ── Send/Stop icon-button tests ──────────────────────────────────────

  it("send/stop icon button: shows Stop (enabled) when running with empty composer", async () => {
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelector('button[aria-label="Stop"]')).not.toBeNull();
    expect(element.querySelector('button[aria-label="Send"]')).toBeNull();
    const stopBtn = element.querySelector('button[aria-label="Stop"]') as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(false);
  });

  it("send/stop icon button: shows Send (enabled) when running with typed composer text", async () => {
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;
    priv(element)._composerValue = "hello";
    priv(element)._updateSendButtonState();
    element.requestUpdate();
    await element.updateComplete;
    expect(element.querySelector('button[aria-label="Stop"]')).toBeNull();
    const sendBtn = element.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(sendBtn).not.toBeNull();
    expect(sendBtn.disabled).toBe(false);
  });

  it("send/stop icon button: shows Send (disabled) when idle with empty composer", async () => {
    await element.updateComplete;
    expect(element.querySelector('button[aria-label="Stop"]')).toBeNull();
    const sendBtn = element.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(sendBtn).not.toBeNull();
    expect(sendBtn.disabled).toBe(true);
  });

  it("send/stop icon button: shows Send (enabled) when idle with typed composer text", async () => {
    priv(element)._composerValue = "hi";
    priv(element)._updateSendButtonState();
    element.requestUpdate();
    await element.updateComplete;
    const sendBtn = element.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    expect(sendBtn).not.toBeNull();
    expect(sendBtn.disabled).toBe(false);
  });

  it("clicking the collapsed button while it shows Stop calls session.abort", async () => {
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;
    const stopBtn = element.querySelector('button[aria-label="Stop"]') as HTMLButtonElement;
    stopBtn.click();
    expect(mockSession.abort).toHaveBeenCalled();
  });

  it("clicking the collapsed button while it shows Send (running, typed) queues the message", async () => {
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;
    priv(element)._composerValue = "queued via click";
    priv(element)._updateSendButtonState();
    element.requestUpdate();
    await element.updateComplete;
    const sendBtn = element.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    sendBtn.click();
    expect(mockSession.send).toHaveBeenCalledWith([{ type: "text", text: "queued via click" }]);
  });

  // ── Generative-UI block submission race (006) ───────────────────────
  //
  // Fail-first regression: `this.running` only reflects an in-flight turn
  // once `session.send()`'s `onUserPrompt` hook has resolved and the panel
  // has re-rendered from a `notifyListeners()` call — a real, measured
  // window (task 006 Phase A, live probe against the deployed app: two
  // `panel.send()` calls issued in the same tick both logged `running=
  // false`, and the duplicate queued as a second independent turn with a
  // second, different model answer). `_handleBlockButton`/`_handleBlockSubmit`
  // guarded only on `this.running`, with no synchronous "already submitting"
  // flag — unlike the composer (`_handleSend()`, protected incidentally by
  // synchronously clearing the input) and `retryLast()` (protected by a
  // synchronous `running` check with no `await` before it). A fast double
  // click/tap on a generative-UI button lands inside that window.
  it("two block-button activations in the same tick submit the prompt only once (006 fail-first)", () => {
    const event = new CustomEvent("block-button", { detail: { prompt: "Yes" } });
    priv(element)._handleBlockButton(event);
    priv(element)._handleBlockButton(event);
    expect(mockSession.send).toHaveBeenCalledTimes(1);
  });

  it("two block-submit activations in the same tick submit the form only once (006 fail-first)", () => {
    const event = new CustomEvent("block-submit", {
      detail: { id: "form-1", values: { answer: "42" } },
    });
    priv(element)._handleBlockSubmit(event);
    priv(element)._handleBlockSubmit(event);
    expect(mockSession.send).toHaveBeenCalledTimes(1);
  });

  it("a generative-UI button click sends the tagged prompt but displays only the clean prompt text (B-7)", () => {
    const event = new CustomEvent("block-button", { detail: { prompt: "View All Products" } });
    priv(element)._handleBlockButton(event);
    expect(mockSession.send).toHaveBeenCalledWith(
      [{ type: "text", text: "[ui_action:button] View All Products" }],
      { userDisplayText: "View All Products" },
    );
  });

  it("the block-button guard releases after send() settles, so a later click still submits", async () => {
    const event = new CustomEvent("block-button", { detail: { prompt: "Yes" } });
    priv(element)._handleBlockButton(event);
    expect(mockSession.send).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    priv(element)._handleBlockButton(event);
    expect(mockSession.send).toHaveBeenCalledTimes(2);
  });

  it("composerText setter pre-fills the composer and updates disabled state", async () => {
    element.composerText = "prefilled";
    await element.updateComplete;
    expect(priv(element)._composerValue).toBe("prefilled");
    expect(element.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(false);
  });

  it("does not infinite-loop when running toggles", async () => {
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;
    mockState.running = false;
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelector('button[aria-label="Send"]')).not.toBeNull();
  });

  // ── Compaction (009) ──────────────────────────────────────────────────

  it("the stop button replaces send while compacting, with an empty composer", async () => {
    mockState.compacting = true;
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelector('button[aria-label="Stop"]')).not.toBeNull();
    expect(element.querySelector('button[aria-label="Send"]')).toBeNull();
  });

  it("typed content still shows send while compacting", async () => {
    mockState.compacting = true;
    triggerStateUpdate();
    await element.updateComplete;
    priv(element)._composerValue = "hello";
    priv(element)._updateSendButtonState();
    element.requestUpdate();
    await element.updateComplete;
    expect(element.querySelector('button[aria-label="Stop"]')).toBeNull();
    expect(element.querySelector('button[aria-label="Send"]')).not.toBeNull();
  });

  it("the gauge is disabled and busy while compacting", async () => {
    mockState.messages = [
      { role: "assistant", text: "one", trace: [] },
      { role: "assistant", text: "two", trace: [] },
    ];
    mockState.canCompact = true;
    mockState.compacting = true;
    triggerStateUpdate();
    await element.updateComplete;

    const gauge = element.querySelector("agent-context-gauge")!;
    expect(gauge.busy).toBe(true);
    expect(gauge.disabled).toBe(true);
  });

  it("the gauge is disabled when canCompact is false, even with >= 2 assistant messages", async () => {
    mockState.messages = [
      { role: "assistant", text: "one", trace: [] },
      { role: "assistant", text: "two", trace: [] },
    ];
    mockState.canCompact = false;
    triggerStateUpdate();
    await element.updateComplete;

    const gauge = element.querySelector("agent-context-gauge")!;
    expect(gauge.disabled).toBe(true);
  });

  it("the gauge is enabled when canCompact is true and not busy", async () => {
    mockState.canCompact = true;
    mockState.running = false;
    mockState.compacting = false;
    triggerStateUpdate();
    await element.updateComplete;

    const gauge = element.querySelector("agent-context-gauge")!;
    expect(gauge.disabled).toBe(false);
  });

  it("the gauge is disabled when running is true even if canCompact is true", async () => {
    mockState.canCompact = true;
    mockState.running = true;
    triggerStateUpdate();
    await element.updateComplete;

    const gauge = element.querySelector("agent-context-gauge")!;
    expect(gauge.disabled).toBe(true);
  });

  it("compacting shows the same working-dots row a normal in-progress turn shows", async () => {
    mockState.compacting = true;
    triggerStateUpdate();
    await element.updateComplete;

    expect(element.querySelector(".message-row.assistant .wa-working-dots")).not.toBeNull();
  });

  it("stop() during a compaction calls session.abort()", async () => {
    mockState.compacting = true;
    triggerStateUpdate();
    await element.updateComplete;
    element.stop();
    expect(mockSession.abort).toHaveBeenCalled();
  });

  // ── Config screen tests ──────────────────────────────────────────────

  it("menu shows Configuration always and Debug only when debug on", async () => {
    await element.updateComplete;
    const kebab = element.querySelector("#menu-anchor") as HTMLButtonElement;
    kebab.click();
    await element.updateComplete;
    let labels = Array.from(element.querySelectorAll('[role="menuitem"]')).map(b => b.textContent?.trim());
    expect(labels).toEqual(["Configuration"]);

    element.debug = true;
    await element.updateComplete;
    labels = Array.from(element.querySelectorAll('[role="menuitem"]')).map(b => b.textContent?.trim());
    expect(labels).toEqual(["Configuration", "Debug"]);
  });

  it("selecting Configuration from the menu opens the config view", async () => {
    await element.updateComplete;
    await openMenuItem(element, "Configuration");
    expect(element.querySelector(".wa-config-view")).not.toBeNull();
    expect(element.querySelector(".messages-list")).toBeNull();
  });

  it("Back button closes the config view", async () => {
    await element.updateComplete;
    await openMenuItem(element, "Configuration");
    const back = element.querySelector('button[aria-label="Back to chat"]') as HTMLButtonElement;
    back.click();
    await element.updateComplete;
    expect(element.querySelector(".wa-config-view")).toBeNull();
    expect(element.querySelector(".messages-list")).not.toBeNull();
  });

  it("menu toggles config closed on second selection", async () => {
    await element.updateComplete;
    await openMenuItem(element, "Configuration");
    expect(element.querySelector(".wa-config-view")).not.toBeNull();
    await openMenuItem(element, "Configuration");
    expect(element.querySelector(".wa-config-view")).toBeNull();
  });

  it("selecting Fast fires onCuesChange and updates cues", async () => {
    element.cues = { enabled: true, speed: "slow" };
    const spy = vi.fn();
    element.onCuesChange = spy;
    await openMenuItem(element, "Configuration");

    const segButtons = Array.from(element.querySelectorAll<HTMLButtonElement>(".wa-config-seg button"));
    const fastBtn = segButtons.find(b => b.textContent === "Fast")!;
    fastBtn.click();
    await element.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ speed: "fast", enabled: true });
    expect(element.cues.speed).toBe("fast");
  });

  it("unchecking enable fires onCuesChange, disables speed buttons, clears cursor", async () => {
    element.cues = { enabled: true, speed: "slow" };
    const spy = vi.fn();
    element.onCuesChange = spy;
    await openMenuItem(element, "Configuration");

    const checkbox = element.querySelector('.wa-config-view input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await element.updateComplete;

    expect(spy).toHaveBeenCalledWith({ speed: "slow", enabled: false });
    expect(element.cues.enabled).toBe(false);
    const segButtons = Array.from(element.querySelectorAll(".wa-config-seg button"));
    expect(segButtons.every(b => b.disabled)).toBe(true);
  });

  it("configOpen setter opens the view", async () => {
    element.configOpen = true;
    await element.updateComplete;
    expect(element.querySelector(".wa-config-view")).not.toBeNull();
  });

  // ── Debug screen tests ─────────────────────────────────────────────────

  it("debug off: no Debug menu item, no debug view", async () => {
    await element.updateComplete;
    const menuItems = Array.from(element.querySelectorAll('[role="menuitem"]')).map(b => b.textContent?.trim());
    expect(menuItems).not.toContain("Debug");
    expect(element.querySelector(".wa-debug-view")).toBeNull();
  });

  it("debug on: Debug menu item present", async () => {
    element.debug = true;
    await element.updateComplete;
    const menuItems = Array.from(element.querySelectorAll('[role="menuitem"]')).map(b => b.textContent?.trim());
    expect(menuItems).toContain("Debug");
  });

  it("selecting Debug from the menu opens the debug screen", async () => {
    element.debug = true;
    await element.updateComplete;
    await openMenuItem(element, "Debug");
    expect(element.querySelector(".wa-debug-view")).not.toBeNull();
    expect(element.querySelector(".messages-list")).toBeNull();
  });

  it("Back button closes the debug screen", async () => {
    element.debug = true;
    await element.updateComplete;
    await openMenuItem(element, "Debug");
    const back = element.querySelector('button[aria-label="Back to chat"]') as HTMLButtonElement;
    back.click();
    await element.updateComplete;
    expect(element.querySelector(".wa-debug-view")).toBeNull();
    expect(element.querySelector(".messages-list")).not.toBeNull();
  });

  it("mutual exclusion: opening config closes debug and vice versa", async () => {
    element.debug = true;
    element.debugOpen = true;
    await element.updateComplete;
    expect(element.querySelector(".wa-debug-view")).not.toBeNull();

    element.configOpen = true;
    await element.updateComplete;
    expect(element.querySelector(".wa-debug-view")).toBeNull();
    expect(element.querySelector(".wa-config-view")).not.toBeNull();

    element.debugOpen = true;
    await element.updateComplete;
    expect(element.querySelector(".wa-config-view")).toBeNull();
    expect(element.querySelector(".wa-debug-view")).not.toBeNull();
  });

  it("debugOpen setter opens the view", async () => {
    element.debug = true;
    element.debugOpen = true;
    await element.updateComplete;
    expect(element.querySelector(".wa-debug-view")).not.toBeNull();
  });

  it("textarea #1 holds config + transcript + tool calls", async () => {
    element.debug = true;
    mockState.messages = [
      { role: "assistant", text: "hi", trace: [{ ts: 0, name: "add_to_cart", input: {}, outcomeSummary: "Added 2 x Salmon" }] },
    ];
    triggerStateUpdate();
    element.debugOpen = true;
    await element.updateComplete;
    const tas = element.querySelectorAll(".wa-debug-ta");
    expect(tas.length).toBe(2);
    const val = (tas[0] as HTMLTextAreaElement).value;
    expect(val).toContain("Added 2 x Salmon");
    expect(val).toContain("add_to_cart");
    expect(val).toContain("hi");
    expect(val).toContain('"debug": true');
  });

  it("textarea #2 lists exactly what the session reports, and ignores element.tools", async () => {
    element.debug = true;
    // The panel must NOT rebuild the list from its own config: `bar` is set
    // here and is absent from what the session reports, so it must not show.
    element.tools = [{ name: "bar", description: "does bar" }] as unknown as CustomToolDef[];
    mockSession.availableTools.mockReturnValue([
      { name: "wait", description: "Pause for a number of seconds." },
      { name: "set_schedule", description: "Schedule a reminder." },
    ]);
    element.debugOpen = true;
    await element.updateComplete;
    const tas = element.querySelectorAll(".wa-debug-ta");
    expect(tas.length).toBe(2);
    const val = (tas[1] as HTMLTextAreaElement).value;
    expect(mockSession.availableTools).toHaveBeenCalled();
    expect(val).toContain("wait");
    expect(val).toContain("set_schedule");
    expect(val).not.toContain("bar");
  });

  it("textarea #2 heading counts what the session reports", async () => {
    element.debug = true;
    mockSession.availableTools.mockReturnValue([
      { name: "wait", description: "Pause for a number of seconds." },
      { name: "set_schedule", description: "Schedule a reminder." },
      { name: "create_skill", description: "Save a skill definition." },
    ]);
    element.debugOpen = true;
    await element.updateComplete;
    const titles = Array.from(element.querySelectorAll(".wa-config-section-title"))
      .map((n) => n.textContent ?? "");
    expect(titles.some((t) => t.includes("Available tools (3)"))).toBe(true);
  });

  it("textarea #2 shows 'No tools.' before the first turn, when the session reports none", async () => {
    element.debug = true;
    mockSession.availableTools.mockReturnValue([]);
    element.debugOpen = true;
    await element.updateComplete;
    const tas = element.querySelectorAll(".wa-debug-ta");
    const val = (tas[1] as HTMLTextAreaElement).value;
    expect(val).toBe("No tools.");
  });

  it("config appears at the top of textarea #1 before the conversation section", async () => {
    element.debug = true;
    element.agentName = "Whiskers";
    element.appContext = { appName: "Cat Store" };
    element.debugOpen = true;
    await element.updateComplete;
    const tas = element.querySelectorAll(".wa-debug-ta");
    expect(tas.length).toBe(2);
    const val = (tas[0] as HTMLTextAreaElement).value;
    expect(val).toContain('"agentName": "Whiskers"');
    expect(val).toContain('"debug": true');
    expect(val.indexOf('"agentName"')).toBeLessThan(val.indexOf("=== Conversation ==="));
  });

  it("Copy button writes the full textarea value to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    element.debug = true;
    mockState.messages = [
      { role: "assistant", text: "hi", trace: [{ ts: 0, name: "add_to_cart", input: {}, outcomeSummary: "Added 2 x Salmon" }] },
    ];
    triggerStateUpdate();
    element.debugOpen = true;
    await element.updateComplete;
    const tas = element.querySelectorAll(".wa-debug-ta");
    const rows = element.querySelectorAll(".wa-debug-copy-row button");
    (rows[0] as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith((tas[0] as HTMLTextAreaElement).value);
    // Flush microtasks so the writeText resolved-promise .then(done) runs.
    await new Promise<void>((r) => setTimeout(r, 0));
    await element.updateComplete;
    // Re-query because uiRegistry.button rebuilds the element each render.
    const rowsAfter = element.querySelectorAll(".wa-debug-copy-row button");
    expect((rowsAfter[0] as HTMLButtonElement).textContent).toContain("Copied!");
  });

  it("empty conversation shows '(no conversation yet)' in textarea #1", async () => {
    element.debug = true;
    mockState.messages = [];
    triggerStateUpdate();
    element.debugOpen = true;
    await element.updateComplete;
    const tas = element.querySelectorAll(".wa-debug-ta");
    expect((tas[0] as HTMLTextAreaElement).value).toContain("(no conversation yet)");
  });


  it("regression: always-on audit log removed from normal chat flow", async () => {
    mockState.messages = [
      { role: "assistant", text: "hi", trace: [{ ts: 0, name: "add_to_cart", input: {}, outcomeSummary: "done" }] },
    ];
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelector("details.audit-log-toggle")).toBeNull();
    expect(element.querySelector(".audit-item")).toBeNull();
  });

  it("regression: inline .tool-step rows still render (062a intact)", async () => {
    mockState.messages = [
      {
        role: "assistant",
        text: "",
        parts: [{ kind: "tool", audit: { ts: 0, name: "add_to_cart", input: {}, outcomeSummary: "done" } }],
        trace: [{ ts: 0, name: "add_to_cart", input: {}, outcomeSummary: "done" }],
      },
    ];
    triggerStateUpdate();
    await element.updateComplete;
    expect(element.querySelector("agent-message-view .tool-step")).not.toBeNull();
  });

  it("header uses agentName when set and no session title", async () => {
    mockState.sessions[0].title = "";
    triggerStateUpdate();
    element.agentName = "Whiskers";
    await element.updateComplete;
    expect(element.querySelector(".header-title")!.textContent).toBe("Whiskers");
  });

  it("session title overrides agentName", async () => {
    element.agentName = "Whiskers";
    await element.updateComplete;
    expect(element.querySelector(".header-title")!.textContent).toBe("Test Session");
  });

  it("header falls back to appName Assistant when agentName unset", async () => {
    mockState.sessions[0].title = "";
    triggerStateUpdate();
    element.appContext = { appName: "Cat Store" };
    await element.updateComplete;
    expect(element.querySelector(".header-title")!.textContent).toContain("Assistant");
  });

  it("uses Public Sans as the base font-family", async () => {
    await element.updateComplete;
    const style = element.querySelector("style");
    expect(style?.textContent).toContain('font-family: var(--wa-font-family, "Public Sans"');
  });

  it("defines the density token scale and uses the list-gutter token", async () => {
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("padding: var(--wa-padding-l, 0.75rem)");
  });

  it("extends the compact scale to header / input / config+debug (066b)", async () => {
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("padding: var(--wa-padding-m, 0.5rem) var(--wa-padding-l, 0.75rem)");
    expect(css).toContain("font-size: var(--wa-font-size-l, 1rem)");
    expect(css).toContain("padding: var(--wa-padding-m, 0.5rem)");
  });

  it("themes the panel chrome from theme surface tokens (009)", async () => {
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("background: var(--wa-background-color-900, #6200ee)");
    expect(css).toContain("color: var(--wa-text-color, white)");
    expect(css).toContain("background: var(--wa-background-color, #fafafa)");
    expect(css).toContain("background: var(--wa-background-color-700, white)");
    expect(css).toContain("color: var(--wa-text-color, inherit)");
    expect(css).not.toContain("background: #6200ee");
    expect(css).not.toContain("background: #fafafa");
  });

  it("renders the registry stylesheet inside the panel, not in document.head", () => {
    const sheet = element.querySelector('style[data-wa-styles="registry"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain(".wa-btn");
    expect(sheet!.textContent).toContain("@keyframes wa-bounce");
    expect(sheet!.getAttribute("id")).toBeNull();
    expect(document.getElementById("wa-registry-styles")).toBeNull();
  });

  it("keeps the panel's own stylesheet as the first style child", () => {
    const first = element.querySelector("style")!;
    expect(first.hasAttribute("data-wa-styles")).toBe(false);
    expect(first.textContent).toContain("agent-chat-panel");
  });

  /** The gauge's rules live in the panel stylesheet, so the gauge must not
   *  render a second copy of them inside the panel's light DOM. */
  it("the context gauge inside the panel renders no stylesheet of its own", async () => {
    await element.updateComplete;
    const gauge = element.querySelector("agent-context-gauge")!;
    expect(gauge).toBeTruthy();
    expect(gauge.querySelector("style")).toBeNull();
    expect(element.querySelector("style")!.textContent).toContain("agent-context-gauge .fg-circle");
  });

  it("renders the message row stylesheet once for the whole thread (011)", async () => {
    mockState.messages = [
      { role: "user", text: "one" },
      { role: "assistant", text: "two" },
      { role: "user", text: "three" },
    ];
    triggerStateUpdate();
    await element.updateComplete;

    const rows = Array.from(element.querySelectorAll("agent-message-view"));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.querySelector("style")).toBeNull();

    // Exactly one sheet in the panel carries the row rules, however many rows
    // are on screen.
    const rowSheets = Array.from(element.querySelectorAll("style"))
      .filter((s) => s.textContent?.includes("agent-message-view .message-row"));
    expect(rowSheets).toHaveLength(1);
  });

  it("a menu toggle or a title change re-renders nothing and re-pins no scroll (011)", async () => {
    mockState.messages = [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ];
    triggerStateUpdate();
    await element.updateComplete;

    // Warm-up. The first render after the transcript arrives pins the scroll
    // through `_forceScrollToBottom`, and only the queued animation frame
    // clears that flag; the next render is the first one that reads the
    // transcript snapshot. Run both before the spies go in, so the assertions
    // below observe the steady state.
    const kebab = element.querySelector("#menu-anchor") as HTMLElement;
    const toggleMenu = async (): Promise<void> => {
      kebab.dispatchEvent(new CustomEvent("press", { bubbles: true, composed: true }));
      await element.updateComplete;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    await toggleMenu();
    await toggleMenu();

    const rowUpdates = Array.from(element.querySelectorAll("agent-message-view"))
      .map((row) => vi.spyOn(row, "requestUpdate"));
    const scroll = vi.spyOn(
      element as unknown as { _scrollToBottomQueue: () => void },
      "_scrollToBottomQueue",
    );

    await toggleMenu();
    expect(scroll).not.toHaveBeenCalled();

    mockState.sessions[0].title = "Renamed Session";
    triggerStateUpdate();
    await element.updateComplete;

    for (const spy of rowUpdates) expect(spy).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(element.querySelector(".header-title")?.textContent).toBe("Renamed Session");
  });

  // ── Choose model menu tests (067-ui) ─────────────────────────────────

  describe("choose model menu", () => {
    beforeEach(() => {
      mockState.model = "m";
    });

    async function openMenu() {
      const kebab = element.querySelector("#menu-anchor") as HTMLButtonElement;
      kebab.click();
      await element.updateComplete;
    }

    function menuLabels() {
      return Array.from(element.querySelectorAll('[role="menuitem"]')).map(b => b.textContent?.trim());
    }

    it("shows both models by friendly label with the active one checked", async () => {
      element.models = [{ id: "m", label: "Leo" }, { id: "s", label: "Mochi" }];
      triggerStateUpdate();
      await element.updateComplete;
      await openMenu();
      const labels = menuLabels();
      expect(labels).toContain("Choose model");
      expect(labels.some(l => l?.includes("✓") && l.includes("Leo"))).toBe(true);
      expect(labels).toContain("Mochi");
    });

    it("heading item is disabled", async () => {
      element.models = [{ id: "m", label: "Leo" }, { id: "s", label: "Mochi" }];
      triggerStateUpdate();
      await element.updateComplete;
      await openMenu();
      const heading = Array.from(element.querySelectorAll('[role="menuitem"]'))
        .find((b) => b.textContent?.trim() === "Choose model") as HTMLButtonElement;
      expect(heading.disabled).toBe(true);
    });

    it("selecting a model calls setModel with its id", async () => {
      element.models = [{ id: "m", label: "Leo" }, { id: "s", label: "Mochi" }];
      triggerStateUpdate();
      await element.updateComplete;
      await openMenuItem(element, "Mochi");
      expect(mockSession.setModel).toHaveBeenCalledWith("s");
    });

    it("active check follows session model", async () => {
      element.models = [{ id: "m", label: "Leo" }, { id: "s", label: "Mochi" }];
      triggerStateUpdate();
      await element.updateComplete;
      await openMenuItem(element, "Mochi");

      mockState.model = "s";
      triggerStateUpdate();
      await element.updateComplete;
      await openMenu();
      const labels = menuLabels();
      expect(labels.some(l => l?.includes("✓") && l.includes("Mochi"))).toBe(true);
      expect(labels.some(l => l?.includes("✓") && l.includes("Leo"))).toBe(false);
    });

    it("hides the whole group when fewer than 2 models", async () => {
      element.models = [{ id: "m", label: "Leo" }];
      triggerStateUpdate();
      await element.updateComplete;
      await openMenu();
      let labels = menuLabels();
      expect(labels).not.toContain("Choose model");
      expect(labels).not.toContain("Leo");
      expect(labels).toContain("Configuration");

      element.models = undefined;
      triggerStateUpdate();
      await element.updateComplete;
      labels = menuLabels();
      expect(labels).not.toContain("Choose model");
      expect(labels).toContain("Configuration");
    });
  });

  describe("attachment provider buttons", () => {
    it("renders no attachment icon buttons when providers list is empty and imageInput is false", async () => {
      element.imageInput = false;
      await element.updateComplete;
      const buttons = element.querySelectorAll("wa-icon-button[data-attachment-provider]");
      expect(buttons.length).toBe(0);
      expect(element.querySelector("#wa-pick-toggle")).toBeNull();
    });

    it("renders one icon button per registered attachment provider, set after connect", async () => {
      // 007: attachmentProviders/imageInput setters re-sync composer icons
      // even when set AFTER the panel is already connected — this is what a
      // toolProvider's (e.g. domTools()'s picker) asynchronously-loaded
      // attachmentProviders needs, surfaced via session.getAttachmentProviders().
      element.imageInput = false;
      element.attachmentProviders = [
        {
          id: "stub",
          label: "Stub Provider",
          icon: "attach_file",
          pick: () => {},
          hasPending: () => false,
          slot: () => document.createElement("div"),
        },
      ];
      await element.updateComplete;
      const buttons = element.querySelectorAll("wa-icon-button[data-attachment-provider]");
      expect(buttons.length).toBe(1);
      expect(buttons[0].getAttribute("data-attachment-provider")).toBe("stub");
    });

    it("picks up a session-registered attachment provider (e.g. a toolProvider's picker) without it being set on attachmentProviders directly", async () => {
      element.imageInput = false;
      (mockSession).getAttachmentProviders = () => [
        {
          id: "picker",
          label: "Point at elements",
          icon: "ads_click",
          pick: () => {},
          hasPending: () => false,
          slot: () => document.createElement("div"),
        },
      ];
      triggerStateUpdate();
      await element.updateComplete;
      const buttons = element.querySelectorAll("wa-icon-button[data-attachment-provider]");
      expect(buttons.length).toBe(1);
      expect(buttons[0].getAttribute("data-attachment-provider")).toBe("picker");
    });

    // 002: an echo mock that behaves like core — updateConfig() stores the
    // patch, getAttachmentProviders() returns the toolProvider-loaded providers
    // followed by config.attachmentProviders, mirroring
    // controller-state.ts effectiveAttachmentProviders() and controller.ts
    // doUpdateConfig().
    function mkProvider(id: string): AttachmentProvider {
      return {
        id,
        label: `${id} provider`,
        icon: "attach_file",
        pick: () => {},
        hasPending: () => false,
        onUserPrompt: () => undefined,
        slot: () => document.createElement("div"),
      };
    }

    function installEchoSession(loaded: AttachmentProvider[] = []) {
      let cfg: Partial<SessionConfig> = {};
      mockSession.updateConfig = vi.fn((patch: Partial<SessionConfig>) => { cfg = { ...cfg, ...patch }; });
      mockSession.getAttachmentProviders = () =>
        [...loaded, ...(cfg.attachmentProviders ?? [])];
      return () => mockSession.getAttachmentProviders!().map((p) => p.id);
    }

    const iconIds = () =>
      [...element.querySelectorAll(".composer-controls wa-icon-button[data-attachment-provider]")]
        .map((b) => b.getAttribute("data-attachment-provider"));

    it("removes the built-in image provider when imageInput is set to false after connect", async () => {
      const sessionIds = installEchoSession([mkProvider("picker")]);
      element.imageInput = true;
      await element.updateComplete;
      expect(iconIds()).toContain("image");

      element.imageInput = false;
      await element.updateComplete;

      expect(iconIds()).not.toContain("image");
      expect(priv(element)._resolveProviders().map((p) => p.id)).not.toContain("image");
      expect(sessionIds()).not.toContain("image");
      expect(sessionIds()).toContain("picker");
    });

    it("brings the image provider back when imageInput is set to true again", async () => {
      installEchoSession([mkProvider("picker")]);
      element.imageInput = true;
      element.imageInput = false;
      await element.updateComplete;
      expect(iconIds()).not.toContain("image");

      element.imageInput = true;
      await element.updateComplete;
      expect(iconIds()).toContain("image");
    });

    it("removes exactly the host provider dropped from attachmentProviders", async () => {
      installEchoSession();
      element.imageInput = false;
      element.attachmentProviders = [mkProvider("alpha"), mkProvider("beta")];
      await element.updateComplete;
      expect(iconIds()).toEqual(["alpha", "beta"]);

      element.attachmentProviders = [mkProvider("alpha")];
      await element.updateComplete;
      expect(iconIds()).toEqual(["alpha"]);
    });

    it("keeps a session-registered picker after an unrelated imageInput change", async () => {
      installEchoSession([mkProvider("picker")]);
      element.imageInput = true;
      await element.updateComplete;
      expect(iconIds()).toEqual(["image", "picker"]);

      element.imageInput = false;
      await element.updateComplete;
      expect(iconIds()).toEqual(["picker"]);
    });

    it("renders one icon when a host provider re-uses the session provider's id", async () => {
      installEchoSession([mkProvider("picker")]);
      element.imageInput = false;
      element.attachmentProviders = [mkProvider("picker")];
      await element.updateComplete;
      expect(iconIds()).toEqual(["picker"]);
    });
  });

  describe("textArea composer and panel sizing", () => {
    it("uses the textArea role for the chat input, not textInput", async () => {
      await element.updateComplete;
      const inputHost = element.querySelector("#input");
      expect(inputHost).not.toBeNull();
      expect(inputHost?.querySelector("textarea")).not.toBeNull();
      expect(inputHost?.querySelector("input")).toBeNull();
      expect(typeof (inputHost as HTMLElement & { resetHeight: () => void })?.resetHeight).toBe("function");
    });

    it("clears and collapses the composer on send via resetHeight", async () => {
      await element.updateComplete;
      element.session = mockSession;
      const inputHost = element.querySelector("#input") as HTMLElement & { resetHeight: () => void };
      const resetSpy = vi.spyOn(inputHost, "resetHeight");
      const ta = inputHost.querySelector("textarea")!;
      ta.value = "Hello world";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      priv(element)._handleSend();
      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(mockSession.send).toHaveBeenCalledWith([
        expect.objectContaining({ text: "Hello world" }),
      ]);
    });

    it("resolves the native control through a textarea-aware selector", async () => {
      await element.updateComplete;
      const nativeInput = element.querySelector("#input")?.querySelector("textarea, input");
      expect(nativeInput).toBeInstanceOf(HTMLTextAreaElement);
    });

    it("routes keydown through the composer's own keydown handler", async () => {
      await element.updateComplete;
      element.session = mockSession;
      const textarea = element.querySelector("#input")!.querySelector("textarea")!;
      textarea.value = "Test send";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      textarea.dispatchEvent(enterEvent);
      expect(mockSession.send).toHaveBeenCalledTimes(1);

      textarea.value = "Shift enter line";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      const shiftEnterEvent = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true });
      textarea.dispatchEvent(shiftEnterEvent);
      expect(mockSession.send).toHaveBeenCalledTimes(1);
    });

    it("renders the controls in a row beneath the input inside one composer", async () => {
      await element.updateComplete;
      const composer = element.querySelector(".composer");
      expect(composer).not.toBeNull();
      expect(composer?.querySelector("#input")).not.toBeNull();
      const controls = composer?.querySelector(".composer-controls");
      expect(controls).not.toBeNull();
      expect(controls?.querySelector("[aria-label='Send']")).not.toBeNull();
      expect(element.querySelector(".input-area > #input")).toBeNull();
    });

    it("fills its container and never places or sizes itself (002)", async () => {
      await element.updateComplete;
      const css = element.querySelector("style")!.textContent;
      const rule = css.match(/agent-chat-panel\s*\{([^}]*)\}/)![1];

      // The host owns placement and size. Nothing in the panel's own rule may
      // pin it to the viewport or fix its pixel size — tasks 003 / ideas 083
      // and 085 all depend on this staying true.
      expect(rule).not.toMatch(/position:\s*fixed/);
      expect(rule).not.toMatch(/\b(top|right|bottom|left|inset)\s*:/);
      expect(rule).not.toMatch(/(width|height)\s*:\s*\d+(px|rem|em|vh|vw)/);

      // It fills the container exactly — border included, so a 1px border does
      // not overflow a container sized to the same number.
      expect(rule).toMatch(/width:\s*100%/);
      expect(rule).toMatch(/height:\s*100%/);
      expect(rule).toMatch(/box-sizing:\s*border-box/);

      // 015: no mobile breakpoint anywhere in the panel's CSS.
      expect(css).not.toContain("max-width: 600px");
      expect(css).not.toMatch(/@media[^{]*(max-width|min-width)/);
    });
  });

  describe("composer keystrokes stay cheap (003410-005)", () => {
    const textarea = () =>
      element.querySelector("#input")?.querySelector("textarea") as HTMLTextAreaElement;

    const typeChars = (s: string) => {
      const ta = textarea();
      for (const ch of s) {
        ta.value += ch;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("a keystroke that does not flip hasContent (a leading space) triggers no panel render", async () => {
      await element.updateComplete;
      const spy = vi.spyOn(element, "requestUpdate");
      typeChars(" ");
      expect(spy).toHaveBeenCalledTimes(0);
    });

    it("the first real character renders once; further characters render no more", async () => {
      await element.updateComplete;
      const spy = vi.spyOn(element, "requestUpdate");
      typeChars("x");
      expect(spy).toHaveBeenCalledTimes(1);
      typeChars("yz".repeat(19));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("typing 40 characters builds no new block element", async () => {
      let renderCount = 0;
      element.renderers = [{
        types: ["probe"],
        render: () => { renderCount++; return document.createElement("div"); },
      }];
      mockState.messages = [{
        role: "assistant", text: "", trace: [],
        parts: [{ kind: "block", block: { type: "probe" } }],
      }];
      triggerStateUpdate();
      await element.updateComplete;
      const before = renderCount;
      typeChars("x".repeat(40));
      await element.updateComplete;
      expect(renderCount).toBe(before);
    });

    it("the send button enables on the first character and disables when the box is emptied", async () => {
      await element.updateComplete;
      typeChars("a");
      await element.updateComplete;
      expect(element.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(false);
      textarea().value = "";
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
      await element.updateComplete;
      expect(element.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(true);
    });

    it("Enter sends immediately", async () => {
      await element.updateComplete;
      element.session = mockSession;
      typeChars("hello");
      const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      textarea().dispatchEvent(enterEvent);
      expect(mockSession.send).toHaveBeenCalledTimes(1);
      expect(mockSession.send).toHaveBeenCalledWith([
        expect.objectContaining({ text: "hello" }),
      ]);
    });

    it("a 40-character message sends complete", async () => {
      await element.updateComplete;
      element.session = mockSession;
      const exact = "x".repeat(40);
      typeChars(exact);
      const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      textarea().dispatchEvent(enterEvent);
      expect(mockSession.send).toHaveBeenCalledWith([
        expect.objectContaining({ text: exact }),
      ]);
    });

    it("sending clears the composer value synchronously", async () => {
      await element.updateComplete;
      element.session = mockSession;
      typeChars("hello");
      priv(element)._handleSend();
      expect(priv(element)._composerValue).toBe("");
    });

    it("typing while running still swaps Stop for Send", async () => {
      mockState.running = true;
      triggerStateUpdate();
      await element.updateComplete;
      expect(element.querySelector('button[aria-label="Stop"]')).not.toBeNull();
      typeChars("hi");
      await element.updateComplete;
      expect(element.querySelector('button[aria-label="Stop"]')).toBeNull();
      const sendBtn = element.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
      expect(sendBtn).not.toBeNull();
      expect(sendBtn!.disabled).toBe(false);
    });

    it("the Stop/Send flip renders once, not once per character", async () => {
      mockState.running = true;
      triggerStateUpdate();
      await element.updateComplete;
      const spy = vi.spyOn(element, "requestUpdate");
      typeChars("hello world");
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("a block whose content really changes is re-rendered", async () => {
      let renderCount = 0;
      element.renderers = [{
        types: ["probe"],
        render: () => { renderCount++; return document.createElement("div"); },
      }];
      mockState.messages = [{
        role: "assistant", text: "", trace: [],
        parts: [{ kind: "block", block: { type: "probe", id: "a" } }],
      }];
      triggerStateUpdate();
      await element.updateComplete;
      const before = renderCount;
      mockState.messages = [{
        role: "assistant", text: "", trace: [],
        parts: [{ kind: "block", block: { type: "probe", id: "b" } }],
      }];
      triggerStateUpdate();
      await element.updateComplete;
      expect(renderCount).toBe(before + 1);
    });
  });

  // ── Host-driven header API (083 task 001) ─────────────────────────────────

  describe("host-driven header API (083)", () => {
    it("renameSession writes the title through core", async () => {
      await element.renameSession("session-1", "Renamed");
      expect(mockSession.setTitle).toHaveBeenCalledWith("session-1", "Renamed");
      await element.updateComplete;
      expect(element.querySelector(".header-title")!.textContent).toBe("Renamed");
    });

    it("renameSession on the active session suppresses auto-titling", async () => {
      await element.renameSession("session-1", "Mine");
      mockState.messages = [
        { role: "assistant", text: "hello", trace: [] }
      ];
      mockState.running = false;
      triggerStateUpdate();
      await element.updateComplete;
      expect(mockSession.autoTitle).not.toHaveBeenCalled();
    });

    it("renameSession on another session leaves auto-titling on", async () => {
      // Add a second session
      mockState.sessions.push({
        id: "session-2",
        title: "Second",
        titleManual: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0
      });
      await element.renameSession("session-2", "Other");
      // Push state with one assistant message and running: false
      mockState.messages = [
        { role: "assistant", text: "hello", trace: [] }
      ];
      mockState.running = false;
      triggerStateUpdate();
      await element.updateComplete;
      // autoTitle should be called once (manual flag not set for active session)
      expect(mockSession.autoTitle).toHaveBeenCalledTimes(1);
    });

    it("listSessions returns the live session list", () => {
      const result = element.listSessions();
      expect(result).toBe(mockSession.getState().sessions);
      expect(result.map((s) => s.id)).toEqual(["session-1"]);
    });

    it("listSessions returns an empty array with no session", () => {
      const panel = document.createElement("agent-chat-panel");
      expect(panel.listSessions()).toEqual([]);
      panel.remove();
    });

    it("setModel forwards to core's in-place setModel", () => {
      element.setModel("model-b");
      expect(mockSession.setModel).toHaveBeenCalledWith("model-b");
      expect(mockSession.updateConfig).not.toHaveBeenCalled();
    });

    it("setModel without a session does not throw", () => {
      const panel = document.createElement("agent-chat-panel");
      expect(() => panel.setModel("x")).not.toThrow();
      panel.remove();
    });

    it("retryLast re-runs the last turn", async () => {
      await element.retryLast();
      expect(mockSession.retryLast).toHaveBeenCalledTimes(1);
    });

    it("retryLast does nothing while running", async () => {
      mockState.running = true;
      triggerStateUpdate();
      await element.updateComplete;
      await element.retryLast();
      expect(mockSession.retryLast).not.toHaveBeenCalled();
    });

    it("getDebugLog returns exactly what the debug view renders", async () => {
      element.debug = true;
      mockState.messages = [
        { role: "assistant", text: "hi", trace: [{ ts: 0, name: "add_to_cart", input: {}, outcomeSummary: "Added 2 x Salmon" }] },
      ];
      for (const sub of subscribers) sub({ ...mockState });
      element.debugOpen = true;
      await element.updateComplete;
      const ta = element.querySelectorAll(".wa-debug-ta")[0] as HTMLTextAreaElement;
      expect(element.getDebugLog()).toBe(ta.value);
      expect(element.getDebugLog()).toContain("=== Host / agent config ===");
      expect(element.getDebugLog()).toContain("=== Conversation ===");
      expect(element.getDebugLog()).toContain("add_to_cart");
    });

    it("a provider:fallback event is written to the debug log", async () => {
      element.debug = true;
      triggerEvent({
        type: "provider:fallback",
        failed: [{ provider: "anthropic", model: "sonnet", message: "Rate limited (HTTP 429)" }],
        answered: { provider: "openai", model: "sonnet" },
      });
      await element.updateComplete;
      expect(element.getDebugLog()).toContain("=== Provider fallback ===");
      expect(element.getDebugLog()).toContain("anthropic/sonnet failed: Rate limited (HTTP 429)");
      expect(element.getDebugLog()).toContain("openai/sonnet answered");
    });

    it("a provider:fallback event adds nothing to the conversation", async () => {
      const messageCountBefore = element.messages.length;
      triggerEvent({
        type: "provider:fallback",
        failed: [{ provider: "anthropic", model: "sonnet", message: "Rate limited (HTTP 429)" }],
        answered: { provider: "openai", model: "sonnet" },
      });
      await element.updateComplete;
      expect(element.messages.length).toBe(messageCountBefore);
      expect(element.textContent).not.toContain("failed:");
      expect(element.textContent).not.toContain("answered");
    });

    it("createSession and switchSession delegate to the session", async () => {
      await element.createSession();
      expect(mockSession.createSession).toHaveBeenCalledTimes(1);
      await element.switchSession("session-1");
      expect(mockSession.switchSession).toHaveBeenCalledWith("session-1");
    });

    it("deleteSession delegates to the session", async () => {
      await element.deleteSession("session-1");
      expect(mockSession.deleteSession).toHaveBeenCalledWith("session-1");
      expect(element.listSessions()).toEqual([]);
    });
  });

  // ── setModel takes the in-place path (083) ─────────────────────────────────

  describe("setModel takes the in-place path (083)", () => {
    async function mountWithRealSession() {
      setMockScript([{ text: "A1" }, { text: "A2" }]);
      const panel = document.createElement("agent-chat-panel");
      panel.config = { persist: false };
      panel.type = "mock";
      panel.model = "m1";
      document.body.appendChild(panel);
      const session = createAgentSession({ persist: false, model: "m1", endpointType: "mock" });
      await session.initPromise;
      panel.session = session;
      return panel;
    }

    function assistantTexts(panel: AgentChatPanel): string[] {
      return (panel.session!.getState().messages)
        .filter((m) => m.role === "assistant")
        .map((m) => m.text ?? (m.parts ?? [])
          .filter((p) => p.kind === "text").map((p) => p.text).join(""));
    }

    it("panel.setModel keeps the same transport instance and the conversation", async () => {
      const panel = await mountWithRealSession();
      await panel.send("hi");
      expect(assistantTexts(panel)).toEqual(["A1"]);
      panel.setModel("m2");
      expect(panel.session.getState().model).toBe("m2");
      expect(panel.session.getState().messages.length).toBe(2); // conversation survives
      await panel.send("again");
      expect(assistantTexts(panel)).toEqual(["A1", "A2"]); // same provider instance
      panel.remove();
    });

    it("the model property rebuilds the transport and keeps the conversation", async () => {
      const panel = await mountWithRealSession();
      await panel.send("hi");
      expect(assistantTexts(panel)).toEqual(["A1"]);
      panel.model = "m2";
      await Promise.resolve();
      expect(panel.session.getState().messages.length).toBe(2); // conversation kept
      await panel.send("again");
      expect(assistantTexts(panel)).toEqual(["A1", "A1"]); // fresh instance, callIndex reset
      panel.remove();
    });
  });

  // ── gemini union widening (002) ─────────────────────────────────────────

  describe("gemini union widening (002)", () => {
    it("accepts 'gemini' as type and forwards it through updateConfig", async () => {
      element.type = "gemini";
      expect(element.type).toBe("gemini");
      await Promise.resolve();
      expect(mockSession.updateConfig).toHaveBeenCalled();
      const lastCall = mockSession.updateConfig.mock.calls[mockSession.updateConfig.mock.calls.length - 1];
      expect(lastCall[0].endpointType).toBe("gemini");
    });
  });

  // ── fetch injection (086-005) ─────────────────────────────────────────────

  describe("fetch injection (086-005)", () => {
    function mkTextResp(text: string) {
      return {
        id: "msg_x",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        model: "test",
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
    }

    function mkJsonResponse(text: string) {
      return new Response(JSON.stringify(mkTextResp(text)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Real panel + real anthropic session (no session store). The turn routes
    // through whatever fetch the panel's buildSessionConfig() supplied.
    function mountPanel(fetchFn?: typeof fetch) {
      const panel = document.createElement("agent-chat-panel");
      panel.config = { persist: false };
      panel.type = "anthropic";
      panel.model = "m";
      if (fetchFn) panel.fetch = fetchFn;
      document.body.appendChild(panel);
      return panel;
    }

    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("exposes a fetch property with a getter and setter", () => {
      const panel = document.createElement("agent-chat-panel");
      const customFetch = async (url: RequestInfo | URL, init?: RequestInit) => window.fetch(url, init);
      panel.fetch = customFetch;
      expect(panel.fetch).toBe(customFetch);
      panel.remove();
    });

    it("passes fetch into the session config it builds", () => {
      const panel = document.createElement("agent-chat-panel");
      const customFetch = async (url: RequestInfo | URL, init?: RequestInit) => window.fetch(url, init);
      panel.fetch = customFetch;
      expect(panel.buildSessionConfig().fetch).toBe(customFetch);
      panel.remove();
    });

    it("calls updateConfig with the new fetch when fetch is set on an active session", async () => {
      const panel = document.createElement("agent-chat-panel");
      const updateConfigSpy = vi.fn();
      const mockSession = {
        updateConfig: updateConfigSpy,
        subscribe: vi.fn(() => () => {}),
        subscribeEvents: vi.fn(() => () => {}),
        availableTools: () => [],
      } as unknown as AgentSession;
      panel.session = mockSession;
      const customFetch = async (url: RequestInfo | URL, init?: RequestInit) => window.fetch(url, init);
      panel.fetch = customFetch;
      await Promise.resolve();
      expect(updateConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({ fetch: customFetch })
      );
      panel.remove();
    });

    it("injects an Authorization header into the outgoing request (panel e2e)", async () => {
      const globalSpy = vi.fn(() => Promise.reject(new Error("Global fetch should not be called")));
      globalThis.fetch = globalSpy;

      let captured: { url: RequestInfo | URL; init: RequestInit | undefined } | undefined;
      const wireSpy = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        captured = { url, init };
        return Promise.resolve(mkJsonResponse("Hello reply"));
      });

      const panel = mountPanel(async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", "Bearer test-token");
        return wireSpy(url, { ...init, headers });
      });

      try {
        const sendPromise = panel.send("hi");
        await panel.session.initPromise;
        await sendPromise;

        expect(wireSpy).toHaveBeenCalled();
        expect(captured).toBeDefined();
        expect(new Headers(captured!.init.headers).get("Authorization")).toBe("Bearer test-token");
        expect(globalSpy).not.toHaveBeenCalled();
      } finally {
        panel.remove();
      }
    });

    it("routes the next turn through a fetch assigned after the session exists", async () => {
      const globalSpy = vi.fn(() => Promise.resolve(mkJsonResponse("First reply")));
      globalThis.fetch = globalSpy;

      let captured: { url: RequestInfo | URL; init: RequestInit | undefined } | undefined;
      const wireSpy = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        captured = { url, init };
        return Promise.resolve(mkJsonResponse("Second reply"));
      });

      const panel = mountPanel();
      try {
        await panel.send("first");
        expect(globalSpy).toHaveBeenCalledTimes(1);
        expect(wireSpy).not.toHaveBeenCalled();

        panel.fetch = async (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Authorization", "Bearer test-token");
          return wireSpy(url, { ...init, headers });
        };
        await panel.send("second");

        expect(wireSpy).toHaveBeenCalled();
        expect(captured).toBeDefined();
        expect(new Headers(captured!.init.headers).get("Authorization")).toBe("Bearer test-token");
        expect(globalSpy).toHaveBeenCalledTimes(1);
      } finally {
        panel.remove();
      }
    });

    it("createAgentSession direct: a custom fetch handles the outgoing call", async () => {
      let captured: { url: RequestInfo | URL; init: RequestInit | undefined } | undefined;
      const wireSpy = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        captured = { url, init };
        return Promise.resolve(mkJsonResponse("Direct reply"));
      });

      const session = createAgentSession({
        persist: false,
        model: "m",
        endpointType: "anthropic",
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Authorization", "Bearer direct-token");
          return wireSpy(url, { ...init, headers });
        },
      });
      await session.initPromise;
      await session.send([{ type: "text", text: "hi" }]);
      expect(wireSpy).toHaveBeenCalled();
      expect(captured).toBeDefined();
      expect(new Headers(captured!.init.headers).get("Authorization")).toBe("Bearer direct-token");
      session.dispose();
    });

    it("uses the global fetch when no custom fetch is set", async () => {
      const globalSpy = vi.fn(() => Promise.resolve(mkJsonResponse("Hi from global")));
      globalThis.fetch = globalSpy;

      const panel = mountPanel();
      try {
        await panel.send("hi");
        expect(globalSpy).toHaveBeenCalled();
      } finally {
        panel.remove();
      }
    });
  });

  // 007: running-change event and cursor destroy on run end
  describe("running-change event and cursor cleanup (007)", () => {
    it("emits agent-running-change when a turn starts and when it ends", async () => {
      const events: CustomEvent<{ running: boolean }>[] = [];
      element.addEventListener("agent-running-change", (e) => events.push(e as CustomEvent<{ running: boolean }>));

      // idle -> running
      mockState = { ...mockState, running: true };
      triggerStateUpdate();
      await element.updateComplete;
      expect(events.length).toBe(1);
      expect(events[0].detail.running).toBe(true);

      // running -> idle
      mockState = { ...mockState, running: false };
      triggerStateUpdate();
      await element.updateComplete;
      expect(events.length).toBe(2);
      expect(events[1].detail.running).toBe(false);
    });

    it("does not emit on a state update that leaves running unchanged", async () => {
      const events: CustomEvent[] = [];
      element.addEventListener("agent-running-change", (e) => events.push(e as CustomEvent));

      mockState = { ...mockState, running: true };
      triggerStateUpdate();
      await element.updateComplete;
      expect(events.length).toBe(1);

      // another running state — no change
      triggerStateUpdate();
      await element.updateComplete;
      expect(events.length).toBe(1);
    });

    it("a finished run destroys the cursor layer", async () => {
      element.cues = { enabled: true, speed: "slow" };
      mockState = { ...mockState, running: true };
      triggerStateUpdate();
      await element.updateComplete;
      getAgentCursor().show();
      expect(document.querySelector(".wa-agent-cursor-layer")).not.toBeNull();

      mockState = { ...mockState, running: false };
      triggerStateUpdate();
      await element.updateComplete;
      expect(document.querySelector(".wa-agent-cursor-layer")).toBeNull();
    });
  });

  // Task 002: Stop panel key events reaching the host app
  describe("Panel key event containment (task 002)", () => {
    it("stops keydown, keyup, and keypress from bubbling out of the panel", () => {
      const hostKeydown = vi.fn();
      const hostKeyup = vi.fn();
      const hostKeypress = vi.fn();
      document.addEventListener("keydown", hostKeydown);
      document.addEventListener("keyup", hostKeyup);
      document.addEventListener("keypress", hostKeypress);
      try {
        const textarea = element.querySelector("textarea") || element.querySelector("input")!;
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, composed: true }));
        textarea.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true, composed: true }));
        textarea.dispatchEvent(new KeyboardEvent("keypress", { key: "a", bubbles: true, composed: true }));
        expect(hostKeydown).toHaveBeenCalledTimes(0);
        expect(hostKeyup).toHaveBeenCalledTimes(0);
        expect(hostKeypress).toHaveBeenCalledTimes(0);
      } finally {
        document.removeEventListener("keydown", hostKeydown);
        document.removeEventListener("keyup", hostKeyup);
        document.removeEventListener("keypress", hostKeypress);
      }
    });

    it("stops Escape keydown from bubbling out of the panel", () => {
      const hostKeydown = vi.fn();
      document.addEventListener("keydown", hostKeydown);
      try {
        const textarea = element.querySelector("textarea")!;
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
        expect(hostKeydown).toHaveBeenCalledTimes(0);
      } finally {
        document.removeEventListener("keydown", hostKeydown);
      }
    });

    it("stops key events in title input from bubbling out of the panel", async () => {
      priv(element)._titleEditActive = true;
      element.requestUpdate();
      await element.updateComplete;
      const titleInput = element.querySelector(".wa-title-edit-row wa-text-input input") || element.querySelector(".wa-title-edit-row wa-text-input");
      const hostKeydown = vi.fn();
      const hostKeyup = vi.fn();
      const hostKeypress = vi.fn();
      document.addEventListener("keydown", hostKeydown);
      document.addEventListener("keyup", hostKeyup);
      document.addEventListener("keypress", hostKeypress);
      try {
        titleInput.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true, composed: true }));
        titleInput.dispatchEvent(new KeyboardEvent("keyup", { key: "x", bubbles: true, composed: true }));
        titleInput.dispatchEvent(new KeyboardEvent("keypress", { key: "x", bubbles: true, composed: true }));
        expect(hostKeydown).toHaveBeenCalledTimes(0);
        expect(hostKeyup).toHaveBeenCalledTimes(0);
        expect(hostKeypress).toHaveBeenCalledTimes(0);
      } finally {
        document.removeEventListener("keydown", hostKeydown);
        document.removeEventListener("keyup", hostKeyup);
        document.removeEventListener("keypress", hostKeypress);
      }
    });

    it("stops Escape keydown and keyup in title input from reaching host document", async () => {
      priv(element)._titleEditActive = true;
      element.requestUpdate();
      await element.updateComplete;
      const titleInput = element.querySelector(".wa-title-edit-row wa-text-input input") || element.querySelector(".wa-title-edit-row wa-text-input");
      const hostKeydown = vi.fn();
      const hostKeyup = vi.fn();
      const hostKeypress = vi.fn();
      document.addEventListener("keydown", hostKeydown);
      document.addEventListener("keyup", hostKeyup);
      document.addEventListener("keypress", hostKeypress);
      try {
        titleInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
        titleInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true, composed: true }));
        await element.updateComplete;
        expect(priv(element)._titleEditActive).toBe(false);
        expect(hostKeydown).toHaveBeenCalledTimes(0);
        expect(hostKeyup).toHaveBeenCalledTimes(0);
        expect(hostKeypress).toHaveBeenCalledTimes(0);
      } finally {
        document.removeEventListener("keydown", hostKeydown);
        document.removeEventListener("keyup", hostKeyup);
        document.removeEventListener("keypress", hostKeypress);
      }
    });

    it("stops Enter keydown and keyup in title input from reaching host document", async () => {
      priv(element)._titleEditActive = true;
      priv(element)._titleEditValue = "New Session Title";
      element.requestUpdate();
      await element.updateComplete;
      const titleInput = element.querySelector(".wa-title-edit-row wa-text-input input") || element.querySelector(".wa-title-edit-row wa-text-input");
      const hostKeydown = vi.fn();
      const hostKeyup = vi.fn();
      const hostKeypress = vi.fn();
      document.addEventListener("keydown", hostKeydown);
      document.addEventListener("keyup", hostKeyup);
      document.addEventListener("keypress", hostKeypress);
      try {
        titleInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
        titleInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, composed: true }));
        await element.updateComplete;
        expect(priv(element)._titleEditActive).toBe(false);
        expect(hostKeydown).toHaveBeenCalledTimes(0);
        expect(hostKeyup).toHaveBeenCalledTimes(0);
        expect(hostKeypress).toHaveBeenCalledTimes(0);
      } finally {
        document.removeEventListener("keydown", hostKeydown);
        document.removeEventListener("keyup", hostKeyup);
        document.removeEventListener("keypress", hostKeypress);
      }
    });

    it("stops key events on panel buttons from bubbling out of the panel", () => {
      const hostKeydown = vi.fn();
      document.addEventListener("keydown", hostKeydown);
      try {
        const btn = element.querySelector('[aria-label="New session"]') || element.querySelector("#history-anchor") || element.querySelector("button");
        btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
        expect(hostKeydown).toHaveBeenCalledTimes(0);
      } finally {
        document.removeEventListener("keydown", hostKeydown);
      }
    });

    it("closes the history panel when Escape is pressed inside the panel", async () => {
      priv(element)._toggleHistoryPanel();
      await element.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
      expect(priv(element)._historyPanelOpen).toBe(true);

      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await element.updateComplete;
      expect(priv(element)._historyPanelOpen).toBe(false);
    });

    it("allows key events on elements outside the panel to bubble normally", () => {
      const sibling = document.createElement("input");
      document.body.appendChild(sibling);
      const hostKeydown = vi.fn();
      document.addEventListener("keydown", hostKeydown);
      try {
        sibling.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true, composed: true }));
        expect(hostKeydown).toHaveBeenCalledTimes(1);
      } finally {
        sibling.remove();
        document.removeEventListener("keydown", hostKeydown);
      }
    });

    it("allows host Enter and Escape keyup immediately after mouse-clicking Save or Cancel title", async () => {
      const sibling = document.createElement("input");
      document.body.appendChild(sibling);
      const hostKeyup = vi.fn();
      document.addEventListener("keyup", hostKeyup);
      try {
        // 1. Mouse-confirm title edit
        priv(element)._titleEditActive = true;
        priv(element)._titleEditValue = "Mouse Confirmed Title";
        await element.updateComplete;
        priv(element)._handleTitleEditConfirm();
        await element.updateComplete;
        expect(priv(element)._titleEditActive).toBe(false);

        // Host Enter keyup must reach host listener
        sibling.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, composed: true }));
        expect(hostKeyup).toHaveBeenCalledTimes(1);

        // 2. Mouse-cancel title edit
        priv(element)._titleEditActive = true;
        await element.updateComplete;
        priv(element)._handleTitleEditCancel();
        await element.updateComplete;
        expect(priv(element)._titleEditActive).toBe(false);

        // Host Escape keyup must reach host listener
        sibling.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true, composed: true }));
        expect(hostKeyup).toHaveBeenCalledTimes(2);
      } finally {
        sibling.remove();
        document.removeEventListener("keyup", hostKeyup);
      }
    });

    it("allows host keydown and keyup immediately after title edit is closed via Enter key", async () => {
      const sibling = document.createElement("input");
      document.body.appendChild(sibling);
      const hostKeydown = vi.fn();
      const hostKeyup = vi.fn();
      document.addEventListener("keydown", hostKeydown);
      document.addEventListener("keyup", hostKeyup);
      try {
        priv(element)._titleEditActive = true;
        priv(element)._titleEditValue = "Key Confirmed Title";
        element.requestUpdate();
        await element.updateComplete;
        const titleInput = element.querySelector(".wa-title-edit-row wa-text-input input") || element.querySelector(".wa-title-edit-row wa-text-input");

        // Press and release Enter on title input
        titleInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
        titleInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, composed: true }));
        await element.updateComplete;
        expect(priv(element)._titleEditActive).toBe(false);
        expect(hostKeydown).toHaveBeenCalledTimes(0);
        expect(hostKeyup).toHaveBeenCalledTimes(0);

        // Subsequent Enter on host element must be fully received
        sibling.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
        sibling.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, composed: true }));
        expect(hostKeydown).toHaveBeenCalledTimes(1);
        expect(hostKeyup).toHaveBeenCalledTimes(1);
      } finally {
        sibling.remove();
        document.removeEventListener("keydown", hostKeydown);
        document.removeEventListener("keyup", hostKeyup);
      }
    });
  });

  describe("scroll coalesced to one animation frame per redraw (009)", () => {
    let rafCallbacks: FrameRequestCallback[];
    let rafSpy: ReturnType<typeof vi.spyOn>;
    let cafSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // connectedCallback already scheduled a real animation frame during the
      // outer beforeEach's initial render, before this spy exists. Drop it so
      // it can't fire mid-test and stomp on the fake frame this block drives.
      const pending = priv(element)._scrollRafId;
      if (pending !== null) {
        cancelAnimationFrame(pending);
        priv(element)._scrollRafId = null;
      }
      // The dropped frame above never got to run, so it never reset this —
      // the initial mount request sets it, same as any first render.
      priv(element)._forceScrollToBottom = false;

      rafCallbacks = [];
      rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      }));
      cafSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    });

    afterEach(() => {
      rafSpy.mockRestore();
      cafSpy.mockRestore();
    });

    it("coalesces rapid updates into a single animation frame scroll", () => {
      const list = element.querySelector(".messages-list") as HTMLElement;
      Object.defineProperty(list, "scrollHeight", { value: 800, configurable: true });

      for (let i = 0; i < 5; i++) {
        priv(element)._scrollToBottomQueue();
      }

      expect(rafSpy).toHaveBeenCalledTimes(1);
      expect(rafCallbacks.length).toBe(1);

      rafCallbacks[0](0);

      expect(list.scrollTop).toBe(800);
      expect(priv(element)._forceScrollToBottom).toBe(false);
    });

    it("does not scroll to bottom if user is scrolled up and _forceScrollToBottom is false", async () => {
      const list = element.querySelector(".messages-list") as HTMLElement;
      Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
      Object.defineProperty(list, "scrollTop", { value: 100, configurable: true, writable: true });

      mockState.messages = [{ role: "assistant", text: "hi", trace: [] }];
      triggerStateUpdate();
      await element.updateComplete;

      expect(rafSpy).not.toHaveBeenCalled();
      expect(list.scrollTop).toBe(100);
    });

    it("forces scroll to bottom on send() even when user was scrolled up", async () => {
      const list = element.querySelector(".messages-list") as HTMLElement;
      Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
      Object.defineProperty(list, "scrollTop", { value: 100, configurable: true, writable: true });

      void element.send("test message");
      await element.updateComplete;

      expect(rafSpy).toHaveBeenCalledTimes(1);
      rafCallbacks[0](0);

      expect(list.scrollTop).toBe(1000);
    });

    it("cancels pending animation frame on disconnectedCallback and dispose", () => {
      priv(element)._scrollToBottomQueue();
      const pendingId = priv(element)._scrollRafId;
      expect(pendingId).not.toBeNull();

      element.disconnectedCallback();
      expect(cafSpy).toHaveBeenCalledWith(pendingId);
      expect(priv(element)._scrollRafId).toBeNull();

      priv(element)._scrollToBottomQueue();
      const pendingId2 = priv(element)._scrollRafId;
      expect(pendingId2).not.toBeNull();

      element.dispose();
      expect(cafSpy).toHaveBeenCalledWith(pendingId2);
      expect(priv(element)._scrollRafId).toBeNull();
    });

    /** `scrollHeight - scrollTop - clientHeight` forces a synchronous layout,
     *  so it is read before `render()` dirties the list, not after. Measuring
     *  after the render also saw the grown height, which failed the 30 px test
     *  whenever one render added more than that. */
    it("measures the pin before render grows the list, and still queues a scroll", async () => {
      const list = element.querySelector(".messages-list") as HTMLElement;
      let reads = 0;
      let grown = false;
      Object.defineProperty(list, "scrollHeight", {
        configurable: true,
        get: () => {
          reads += 1;
          return grown ? 900 : 400;
        },
      });
      Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 400 });
      Object.defineProperty(list, "scrollTop", { configurable: true, get: () => 0 });

      // Stands in for a new message row: the transcript grows during the render.
      const originalTemplate = element.template.bind(element);
      element.template = () => {
        grown = true;
        return originalTemplate();
      };

      mockState.messages = [{ role: "assistant", text: "hi", trace: [] }];
      triggerStateUpdate();
      await element.updateComplete;

      // One read, in willUpdate, while the list still reported the previous
      // frame's height. updated() must not read it again after the render.
      expect(reads).toBe(1);
      expect(rafSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("slash commands (105/001)", () => {
    const compactEntry = {
      name: "compact",
      displayName: "compact",
      description: "Summarise to free up context",
      argumentHint: "[then…]",
      aliases: [] as string[],
      matchNames: ["compact"],
      kind: "action" as const,
      unavailableMessage: "There is nothing to compact yet.",
    };

    it("P4a — a resolvable command runs via runCommand, never send, and clears the composer", async () => {
      mockSession.resolveCommand = vi.fn(() => compactEntry);
      priv(element)._composerValue = "/compact";
      priv(element)._handleSend();
      await Promise.resolve();

      expect(mockSession.runCommand).toHaveBeenCalledWith(compactEntry, "");
      expect(mockSession.send).not.toHaveBeenCalled();
      expect(priv(element)._composerValue).toBe("");
    });

    it("P4b — /notacommand hello sends the literal text; runCommand is never called", () => {
      priv(element)._composerValue = "/notacommand hello";
      priv(element)._handleSend();

      expect(mockSession.send).toHaveBeenCalledWith([
        expect.objectContaining({ text: "/notacommand hello" }),
      ]);
      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(priv(element)._composerValue).toBe("");
    });

    it("P4c — /2 + 2 = ? sends the literal text (P1f: name \"2\" parses, but never resolves)", () => {
      priv(element)._composerValue = "/2 + 2 = ?";
      priv(element)._handleSend();

      expect(mockSession.send).toHaveBeenCalledWith([
        expect.objectContaining({ text: "/2 + 2 = ?" }),
      ]);
      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(priv(element)._composerValue).toBe("");
    });

    it("P4d — a sentence with a slash in it is never hijacked", () => {
      priv(element)._composerValue = "What about /compact ?";
      priv(element)._handleSend();

      expect(mockSession.send).toHaveBeenCalledWith([
        expect.objectContaining({ text: "What about /compact ?" }),
      ]);
      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(priv(element)._composerValue).toBe("");
    });

    it("P4e — a command typed while running is queued as a command, not sent or run", async () => {
      mockState.running = true;
      triggerStateUpdate();
      await element.updateComplete;
      mockSession.resolveCommand = vi.fn(() => compactEntry);

      priv(element)._composerValue = "/compact";
      priv(element)._handleSend();

      expect(mockSession.enqueueCommand).toHaveBeenCalledWith("compact", "", "/compact");
      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(mockSession.send).not.toHaveBeenCalled();
      expect(priv(element)._composerValue).toBe("");
    });

    it("P4f — an action that could not run shows its unavailableMessage in the one notice", async () => {
      mockSession.resolveCommand = vi.fn(() => compactEntry);
      mockSession.runCommand = vi.fn(() => Promise.resolve({ ran: false, startedTurn: false }));
      priv(element)._composerValue = "/compact";
      priv(element)._handleSend();

      // Flush the microtask/macrotask queue the async runCommand() await needs.
      await new Promise((r) => setTimeout(r, 0));
      await element.updateComplete;

      const notice = element.querySelector(".wa-notice[data-tone='error']");
      expect(notice).not.toBeNull();
      expect(notice!.textContent).toContain("There is nothing to compact yet.");
      expect(notice!.querySelector(".wa-notice-retry")).toBeNull();
      expect(notice!.querySelector(".wa-notice-dismiss")).not.toBeNull();
      expect(element.querySelector(".error-region")).toBeNull();
      expect(priv(element)._composerValue).toBe("");

      (notice!.querySelector(".wa-notice-dismiss") as HTMLButtonElement).click();
      await element.updateComplete;
      expect(element.querySelector(".wa-notice")).toBeNull();
      expect(element.error).toBeNull();
    });

    it("P4g — with no session, _handleSend falls through to send() and does not throw", async () => {
      // No session set: _runSlashCommand's `this._session?.resolveCommand`
      // resolves to undefined, so it falls through to this.send(), which
      // lazily creates a real session (_ensureSession()). Supply a fetch so
      // that fallback session's turn resolves instead of hitting the network.
      element.session = undefined;
      element.type = "anthropic";
      element.model = "m";
      element.config = { persist: false };
      element.fetch = () => Promise.resolve(new Response(JSON.stringify({
        id: "msg_x", type: "message", role: "assistant",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn", stop_sequence: null, model: "test",
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

      priv(element)._composerValue = "/compact";
      expect(() => priv(element)._handleSend()).not.toThrow();
      await Promise.resolve();
    });
  });

  describe("programmatic send routes through the parser (113/002)", () => {
    const compactEntry = {
      name: "compact",
      displayName: "compact",
      description: "Summarise to free up context",
      argumentHint: "[then…]",
      aliases: [] as string[],
      matchNames: ["compact"],
      kind: "action" as const,
      unavailableMessage: "There is nothing to compact yet.",
    };
    const newEntry = {
      name: "new",
      displayName: "new",
      description: "Start a fresh session",
      aliases: ["clear"],
      matchNames: ["new", "clear"],
      kind: "action" as const,
      unavailableMessage: "Could not start a new session.",
    };
    /** The command list core builds: `/new` and `/clear` resolve to one entry
     *  (controller-queue.ts:33-34), everything else is unknown. */
    const resolveCoreCommand = (typed: string) => {
      if (typed === "compact") return compactEntry;
      if (typed === "new" || typed === "clear") return newEntry;
      return undefined;
    };

    beforeEach(() => {
      mockSession.resolveCommand = vi.fn(resolveCoreCommand);
    });

    it("S1 — send(\"/compact\") runs the command and never reaches session.send", async () => {
      const out = await element.send("/compact");

      expect(mockSession.resolveCommand).toHaveBeenCalledWith("compact");
      expect(mockSession.runCommand).toHaveBeenCalledWith(compactEntry, "");
      expect(mockSession.send).not.toHaveBeenCalled();
      // 001/113 — send() reports which command it ran.
      expect(out).toEqual({ ran: "command", command: "compact" });
    });

    it("S2 — send({ text: \"/new\" }) runs the new-session command", async () => {
      const out = await element.send({ text: "/new" });

      expect(mockSession.runCommand).toHaveBeenCalledWith(newEntry, "");
      expect(mockSession.send).not.toHaveBeenCalled();
      expect(out).toEqual({ ran: "command", command: "new" });
    });

    it("S3 — send(\"/clear\") resolves through the alias and runs the same entry", async () => {
      const out = await element.send("/clear");

      expect(mockSession.resolveCommand).toHaveBeenCalledWith("clear");
      expect(mockSession.runCommand).toHaveBeenCalledWith(newEntry, "");
      expect(mockSession.send).not.toHaveBeenCalled();
      // The entry resolved is core's "new" entry, but the reported command name
      // is the alias the caller actually typed.
      expect(out).toEqual({ ran: "command", command: "clear" });
    });

    it("S4 — send(\"/notacommand hello\") sends the literal text to the model", async () => {
      const out = await element.send("/notacommand hello");

      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(mockSession.send).toHaveBeenCalledWith([
        { type: "text", text: "/notacommand hello" },
      ]);
      expect(out).toEqual({ ran: "message" });
    });

    it("S5 — an unavailable command shows its unavailableMessage and sends nothing", async () => {
      mockSession.runCommand = vi.fn(() => Promise.resolve({ ran: false, startedTurn: false }));

      await element.send("/compact");
      // The notice is set after runCommand's await inside _runSlashCommand.
      await new Promise((r) => setTimeout(r, 0));
      await element.updateComplete;

      const notice = element.querySelector(".wa-notice[data-tone='error']");
      expect(notice).not.toBeNull();
      expect(notice!.textContent).toContain("There is nothing to compact yet.");
      expect(mockSession.send).not.toHaveBeenCalled();
    });

    it("S6 — a command sent while a turn is running is queued as a command, not as text", async () => {
      mockState.running = true;
      triggerStateUpdate();
      await element.updateComplete;

      await element.send("/compact");

      expect(mockSession.enqueueCommand).toHaveBeenCalledWith("compact", "", "/compact");
      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(mockSession.send).not.toHaveBeenCalled();
    });

    it("S7 — the argument after the command name is passed through", async () => {
      await element.send("/new and then summarise the page");

      expect(mockSession.runCommand).toHaveBeenCalledWith(newEntry, "and then summarise the page");
      expect(mockSession.send).not.toHaveBeenCalled();
    });

    it("S8 — images are dropped when the text is a command, exactly as the composer drops them", async () => {
      await element.send({
        text: "/compact",
        images: [{ dataUrl: "data:image/png;base64,AAA", mediaType: "image/png" }],
      });

      expect(mockSession.runCommand).toHaveBeenCalledWith(compactEntry, "");
      expect(mockSession.send).not.toHaveBeenCalled();
    });

    it("S9 — a block-button message is never treated as a command", async () => {
      await element.send("[ui_action:button] /compact", { userDisplayText: "/compact" });

      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(mockSession.send).toHaveBeenCalledWith(
        [{ type: "text", text: "[ui_action:button] /compact" }],
        { userDisplayText: "/compact" },
      );
    });

    it("S10 — a sentence containing a slash is sent as ordinary text", async () => {
      await element.send("What does /compact do?");

      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(mockSession.send).toHaveBeenCalledWith([
        { type: "text", text: "What does /compact do?" },
      ]);
    });

    it("S11 — a plain sentence resolves { ran: \"message\" }", async () => {
      const out = await element.send("hello there");

      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(out).toEqual({ ran: "message" });
    });

    it("S12 — with no session at all, send() resolves { ran: \"none\" }", async () => {
      element.session = undefined;
      // Stub out lazy session creation so `_session` genuinely stays unset —
      // otherwise `_ensureSession()` would create a real fallback session.
      (element as unknown as { _ensureSession(): void })._ensureSession = () => {};

      const out = await element.send("/new");

      expect(mockSession.send).not.toHaveBeenCalled();
      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(out).toEqual({ ran: "none" });
    });
  });

  describe("slash-command menu (105/003)", () => {
    const demo = {
      name: "demo",
      displayName: "demo",
      description: "Run the full capability demo",
      aliases: [],
      matchNames: ["demo"],
      kind: "skill",
    } as CommandEntry;

    const finance = {
      name: "finance-demo",
      displayName: "finance-demo",
      description: "Finance chart demo",
      aliases: ["finance"],
      matchNames: ["finance-demo", "finance"],
      kind: "skill",
    } as CommandEntry;

    const shop = {
      name: "shop-manager-report",
      displayName: "shop-manager-report",
      description: "Monthly shop report",
      argumentHint: "[month]",
      aliases: ["report"],
      matchNames: ["shop-manager-report", "report"],
      kind: "skill",
    } as CommandEntry;

    const compact = {
      name: "compact",
      displayName: "compact",
      description: "Summarise to free up context",
      argumentHint: "[then…]",
      aliases: [],
      matchNames: ["compact"],
      kind: "action",
    } as CommandEntry;

    const fresh = {
      name: "new",
      displayName: "new",
      description: "Start a fresh session",
      argumentHint: "[then…]",
      aliases: ["clear"],
      matchNames: ["new", "clear"],
      kind: "action",
    } as CommandEntry;

    const ALL: CommandEntry[] = [demo, finance, shop, compact, fresh];

    function typeInComposer(el: AgentChatPanel, text: string) {
      const ta = el.querySelector("#input textarea") as HTMLTextAreaElement;
      ta.value = text;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }

    beforeEach(async () => {
      mockSession.commands = vi.fn(() => ALL);
      mockSession.resolveCommand = vi.fn((name: string) =>
        ALL.find((e) => e.matchNames.includes(name.toLowerCase())),
      );
      await element.updateComplete;
    });

    it("/ opens the menu with every entry in registration order", () => {
      typeInComposer(element, "/");
      expect(priv(element)._slashMenuEl.hidden).toBe(false);
      const names = Array.from(
        priv(element)._slashMenuEl.querySelectorAll(".wa-slash-name"),
      ).map((el) => el.textContent);
      expect(names).toEqual([
        "/demo",
        "/finance-demo",
        "/shop-manager-report",
        "/compact",
        "/new",
      ]);
    });

    it("use the and/or rule never opens it", () => {
      typeInComposer(element, "use the and/or rule");
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
      expect(
        priv(element)._slashMenuEl.querySelectorAll('[role="option"]').length,
      ).toBe(0);
    });

    it("/sh filters to one row with its argument hint", () => {
      typeInComposer(element, "/sh");
      expect(
        priv(element)._slashMenuEl.querySelectorAll('[role="option"]').length,
      ).toBe(1);
      const text = priv(element)._slashMenuEl.textContent || "";
      expect(text).toContain("/shop-manager-report");
      expect(text).toContain("[month]");
    });

    it("a filter matching nothing closes the menu", () => {
      typeInComposer(element, "/zzz");
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
    });

    it("…and Enter then sends the typed text as prose", () => {
      typeInComposer(element, "/zzz");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: false, cancelable: true }),
      );
      expect(mockSession.send).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ text: "/zzz" })]),
      );
      expect(mockSession.runCommand).not.toHaveBeenCalled();
    });

    it("ArrowDown moves the highlight", () => {
      typeInComposer(element, "/");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }),
      );
      expect(
        priv(element)
          ._slashMenuEl.querySelector("#wa-slash-opt-1")
          ?.getAttribute("aria-selected"),
      ).toBe("true");
    });

    it("ArrowUp wraps from the first to the last", () => {
      typeInComposer(element, "/");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true }),
      );
      expect(
        priv(element)
          ._slashMenuEl.querySelector("#wa-slash-opt-4")
          ?.getAttribute("aria-selected"),
      ).toBe("true");
    });

    it("ArrowDown wraps from the last to the first", () => {
      typeInComposer(element, "/");
      for (let i = 0; i < 5; i++) {
        priv(element)._handleKeyDown(
          new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }),
        );
      }
      expect(
        priv(element)
          ._slashMenuEl.querySelector("#wa-slash-opt-0")
          ?.getAttribute("aria-selected"),
      ).toBe("true");
    });

    it("aria-activedescendant follows the highlight", () => {
      typeInComposer(element, "/");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }),
      );
      const ta = element.querySelector("#input textarea") as HTMLTextAreaElement;
      expect(ta.getAttribute("aria-activedescendant")).toBe("wa-slash-opt-1");
    });

    it("Tab picks and runs nothing", () => {
      typeInComposer(element, "/");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
      );
      expect(priv(element)._composerValue).toBe("/demo ");
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(mockSession.send).not.toHaveBeenCalled();
    });

    it("Enter picks identically", () => {
      typeInComposer(element, "/");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
      );
      expect(priv(element)._composerValue).toBe("/demo ");
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
      expect(mockSession.runCommand).not.toHaveBeenCalled();
      expect(mockSession.send).not.toHaveBeenCalled();
    });

    it("the caret lands after the trailing space", () => {
      typeInComposer(element, "/");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
      );
      const ta = element.querySelector("#input textarea") as HTMLTextAreaElement;
      expect(ta.selectionStart).toBe("/demo ".length);
      expect(ta.selectionEnd).toBe("/demo ".length);
    });

    it("a second Enter on the closed menu runs the command", () => {
      typeInComposer(element, "/");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
      );
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
      );
      expect(mockSession.runCommand).toHaveBeenCalledTimes(1);
      expect(mockSession.runCommand).toHaveBeenCalledWith(demo, "");
    });

    it("Escape closes and leaves the text", () => {
      typeInComposer(element, "/de");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      );
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
      expect(priv(element)._composerValue).toBe("/de");
    });

    /** Every ordinary keystroke used to write the menu away even when it was
     *  already closed: a `hidden` attribute, a `replaceChildren`, an
     *  `aria-activedescendant` removal and a `#input` query. None of that may
     *  happen while the menu is closed; a real close must still remove the
     *  attribute. */
    it("ordinary typing does not clear aria-activedescendant, Escape still does", () => {
      const ta = element.querySelector("#input textarea") as HTMLTextAreaElement;
      const removeAttr = vi.spyOn(ta, "removeAttribute");
      typeInComposer(element, "hello");
      expect(removeAttr).not.toHaveBeenCalledWith("aria-activedescendant");

      typeInComposer(element, "/de");
      expect(priv(element)._slashMenuEl.hidden).toBe(false);
      expect(ta.getAttribute("aria-activedescendant")).toBe("wa-slash-opt-0");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      );
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
      expect(removeAttr).toHaveBeenCalledWith("aria-activedescendant");
      expect(ta.getAttribute("aria-activedescendant")).toBeNull();
    });

    it("an outside click closes the menu", () => {
      typeInComposer(element, "/");
      expect(priv(element)._slashMenuEl.hidden).toBe(false);
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
    });

    it("a click inside the menu does not close it by itself", () => {
      typeInComposer(element, "/");
      expect(priv(element)._slashMenuEl.hidden).toBe(false);
      priv(element)._slashMenuEl.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      expect(priv(element)._slashMenuEl.hidden).toBe(false);
    });

    it("a space after the name closes it", () => {
      typeInComposer(element, "/demo ");
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
    });

    it("/clear filters to the /new row and shows or /clear", () => {
      typeInComposer(element, "/clear");
      expect(
        priv(element)._slashMenuEl.querySelectorAll('[role="option"]').length,
      ).toBe(1);
      expect(
        priv(element)._slashMenuEl.querySelector(".wa-slash-name")?.textContent,
      ).toBe("/new");
      expect(
        priv(element)._slashMenuEl.querySelector(".wa-slash-alias")?.textContent,
      ).toBe("or /clear");
      const allNames = Array.from(
        priv(element)._slashMenuEl.querySelectorAll(".wa-slash-name"),
      ).map((el) => el.textContent);
      expect(allNames).not.toContain("/clear");
    });

    it("the two glyphs differ", () => {
      typeInComposer(element, "/");
      const compactIcon = priv(element)._slashMenuEl.querySelector(
        "#wa-slash-opt-3 .wa-slash-icon",
      )?.innerHTML;
      const demoIcon = priv(element)._slashMenuEl.querySelector(
        "#wa-slash-opt-0 .wa-slash-icon",
      )?.innerHTML;
      expect(compactIcon).not.toBe(demoIcon);
    });

    it("the footer legend is present", () => {
      typeInComposer(element, "/");
      const text = priv(element)._slashMenuEl.textContent || "";
      expect(text).toContain("runs an action");
      expect(text).toContain("briefs the agent");
      expect(text).toContain("↑↓ · Tab · Esc");
    });

    it("no provenance badge", () => {
      typeInComposer(element, "/");
      expect(priv(element)._slashMenuEl.textContent).not.toContain("HOST");
    });

    it("navigating the open slash menu triggers no extra render beyond the composer's own hasContent flip", () => {
      // Typing the first "/" flips the composer from empty to non-empty, which
      // renders once to enable the Send button (003410-005) — that render is
      // deliberately not spied on here. The slash menu itself repaints
      // imperatively (_paintSlashMenu()) and must add no further renders.
      typeInComposer(element, "/");
      const spy = vi.spyOn(element, "requestUpdate");
      priv(element)._handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }),
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it("no session is safe", () => {
      element.session = undefined;
      expect(() => typeInComposer(element, "/")).not.toThrow();
      expect(priv(element)._slashMenuEl.hidden).toBe(true);
    });

    it("disconnect drops the document listener", () => {
      typeInComposer(element, "/");
      expect(priv(element)._slashOpen).toBe(true);
      element.remove();
      expect(() =>
        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      ).not.toThrow();
      expect(priv(element)._slashOpen).toBe(false);
    });
  });

  describe("schedule clock (109/003)", () => {
    it("is absent when the flag is unset", async () => {
      const before = element.querySelector(".composer-controls")!.children.length;
      mockSession.pendingCounts.mockReturnValue({ schedules: 3, reminders: 1, total: 4 });
      triggerStateUpdate();
      await element.updateComplete;

      expect(element.querySelector("agent-schedule-clock")).toBeNull();
      expect(element.querySelector(".composer-controls")!.children.length).toBe(before);
    });

    it("is absent when the flag is on but counts are zero", async () => {
      element.config = { scheduler: { enabled: true } };
      mockSession.pendingCounts.mockReturnValue({ schedules: 0, reminders: 0, total: 0 });
      triggerStateUpdate();
      await element.updateComplete;

      expect(element.querySelector("agent-schedule-clock")).toBeNull();
    });

    it("is present, and immediately left of the gauge", async () => {
      element.config = { scheduler: { enabled: true } };
      mockSession.pendingCounts.mockReturnValue({ schedules: 1, reminders: 0, total: 1 });
      triggerStateUpdate();
      await element.updateComplete;

      const controls = element.querySelector(".composer-controls")!;
      const clock = element.querySelector("agent-schedule-clock")!;
      const gauge = element.querySelector("agent-context-gauge")!;
      expect(clock.parentElement).toBe(controls);
      const kids = [...controls.children];
      expect(kids.indexOf(clock)).toBe(kids.indexOf(gauge) - 1);

      await clock.updateComplete;
      expect(clock.querySelector(".clock-badge")!.textContent.trim()).toBe("1");
    });

    it("shows the badge and summary at 3 schedules + 1 reminder", async () => {
      element.config = { scheduler: { enabled: true } };
      mockSession.pendingCounts.mockReturnValue({ schedules: 3, reminders: 1, total: 4 });
      triggerStateUpdate();
      await element.updateComplete;

      const clock = element.querySelector("agent-schedule-clock")!;
      await clock.updateComplete;

      expect(clock.querySelector(".clock-badge")!.textContent.trim()).toBe("4");
      const wrapper = clock.querySelector(".clock-wrapper")!;
      const expected = "3 schedules, 1 reminder. Use /schedule-list to see or cancel them.";
      expect(wrapper.getAttribute("title")).toBe(expected);
      expect(wrapper.getAttribute("aria-label")).toBe(expected);
    });

    it("disappears on the next state update, with no reload or re-mount", async () => {
      element.config = { scheduler: { enabled: true } };
      mockSession.pendingCounts.mockReturnValue({ schedules: 1, reminders: 0, total: 1 });
      triggerStateUpdate();
      await element.updateComplete;
      expect(element.querySelector("agent-schedule-clock")).not.toBeNull();

      mockSession.pendingCounts.mockReturnValue({ schedules: 0, reminders: 0, total: 0 });
      triggerStateUpdate();
      await element.updateComplete;

      expect(element.querySelector("agent-schedule-clock")).toBeNull();
      expect(element.isConnected).toBe(true);
    });

    it("the host flag off beats a non-empty registry", async () => {
      element.config = { scheduler: { enabled: false } };
      mockSession.pendingCounts.mockReturnValue({ schedules: 3, reminders: 1, total: 4 });
      triggerStateUpdate();
      await element.updateComplete;

      expect(element.querySelector("agent-schedule-clock")).toBeNull();
    });

    it("does not move the gauge or the send button", async () => {
      const controls = element.querySelector(".composer-controls")!;
      const sendBefore = controls.children[controls.children.length - 1];

      element.config = { scheduler: { enabled: true } };
      mockSession.pendingCounts.mockReturnValue({ schedules: 1, reminders: 0, total: 1 });
      triggerStateUpdate();
      await element.updateComplete;

      const gauge = element.querySelector("agent-context-gauge")!;
      const kids = [...controls.children];
      expect(kids.indexOf(gauge)).toBe(kids.length - 2);
      expect(kids[kids.length - 1].tagName).toBe(sendBefore.tagName);
    });
  });

  describe("todo indicator (068/003)", () => {
    const sampleTodos: TodoItem[] = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "pending" },
      { id: "3", text: "Task 3", status: "in_progress" },
    ];

    it("is absent when the flag is unset", async () => {
      const before = element.querySelector(".composer-controls")!.children.length;
      mockSession.todos.mockReturnValue(sampleTodos);
      triggerStateUpdate();
      await element.updateComplete;

      expect(element.querySelector("agent-todo-indicator")).toBeNull();
      expect(element.querySelector(".composer-controls")!.children.length).toBe(before);
    });

    it("is absent when the flag is off", async () => {
      element.config = { todo: { enabled: false } };
      mockSession.todos.mockReturnValue(sampleTodos);
      triggerStateUpdate();
      await element.updateComplete;

      expect(element.querySelector("agent-todo-indicator")).toBeNull();
    });

    it("is absent when the flag is on but the list is empty", async () => {
      element.config = { todo: { enabled: true } };
      mockSession.todos.mockReturnValue([]);
      triggerStateUpdate();
      await element.updateComplete;

      expect(element.querySelector("agent-todo-indicator")).toBeNull();
    });

    it("renders exactly once, inside the controls row", async () => {
      element.config = { todo: { enabled: true } };
      mockSession.todos.mockReturnValue(sampleTodos);
      triggerStateUpdate();
      await element.updateComplete;

      expect(element.querySelectorAll("agent-todo-indicator").length).toBe(1);
      const indicator = element.querySelector("agent-todo-indicator")!;
      expect(indicator.parentElement).toBe(element.querySelector(".composer-controls")!);
    });

    it("sits immediately left of the schedule clock", async () => {
      element.config = { todo: { enabled: true }, scheduler: { enabled: true } };
      mockSession.todos.mockReturnValue(sampleTodos);
      mockSession.pendingCounts.mockReturnValue({ schedules: 1, reminders: 0, total: 1 });
      triggerStateUpdate();
      await element.updateComplete;

      const controls = element.querySelector(".composer-controls")!;
      const todo = element.querySelector("agent-todo-indicator")!;
      const clock = element.querySelector("agent-schedule-clock")!;
      const gauge = element.querySelector("agent-context-gauge")!;
      const kids = [...controls.children];
      expect(kids.indexOf(todo)).toBe(kids.indexOf(clock) - 1);
      expect(kids.indexOf(clock)).toBe(kids.indexOf(gauge) - 1);
    });

    it("sits immediately left of the gauge when the clock is absent", async () => {
      element.config = { todo: { enabled: true } };
      mockSession.todos.mockReturnValue(sampleTodos);
      mockSession.pendingCounts.mockReturnValue({ schedules: 0, reminders: 0, total: 0 });
      triggerStateUpdate();
      await element.updateComplete;

      const controls = element.querySelector(".composer-controls")!;
      const todo = element.querySelector("agent-todo-indicator")!;
      const gauge = element.querySelector("agent-context-gauge")!;
      const kids = [...controls.children];
      expect(kids.indexOf(todo)).toBe(kids.indexOf(gauge) - 1);
    });

    /** Both indicators' rules live in the panel's single <style> block, so the
     *  shadow root gains no extra stylesheet when they mount. */
    it("the indicators bring no <style> of their own", async () => {
      element.config = { todo: { enabled: false }, scheduler: { enabled: false } };
      triggerStateUpdate();
      await element.updateComplete;
      const stylesBefore = element.querySelectorAll("style").length;

      element.config = { todo: { enabled: true }, scheduler: { enabled: true } };
      mockSession.todos.mockReturnValue(sampleTodos);
      mockSession.pendingCounts.mockReturnValue({ schedules: 1, reminders: 0, total: 1 });
      triggerStateUpdate();
      await element.updateComplete;

      const todo = element.querySelector("agent-todo-indicator")!;
      const clock = element.querySelector("agent-schedule-clock")!;
      expect(todo).not.toBeNull();
      expect(clock).not.toBeNull();
      expect(todo.querySelectorAll("style").length).toBe(0);
      expect(clock.querySelectorAll("style").length).toBe(0);
      expect(element.querySelectorAll("style").length).toBe(stylesBefore);
    });

    it("the badge reflects the list", async () => {
      element.config = { todo: { enabled: true } };
      mockSession.todos.mockReturnValue([
        { id: "1", text: "a", status: "done" },
        { id: "2", text: "b", status: "pending" },
        { id: "3", text: "c", status: "pending" },
      ]);
      triggerStateUpdate();
      await element.updateComplete;

      const indicator = element.querySelector("agent-todo-indicator")!;
      await indicator.updateComplete;
      expect(indicator.querySelector(".todo-badge")!.textContent?.trim()).toBe("2");

      mockSession.todos.mockReturnValue([
        { id: "1", text: "a", status: "done" },
        { id: "2", text: "b", status: "done" },
        { id: "3", text: "c", status: "pending" },
      ]);
      triggerStateUpdate();
      await element.updateComplete;
      await indicator.updateComplete;
      expect(indicator.querySelector(".todo-badge")!.textContent?.trim()).toBe("1");
    });

    it("disappears on the next state update", async () => {
      element.config = { todo: { enabled: true } };
      mockSession.todos.mockReturnValue(sampleTodos);
      triggerStateUpdate();
      await element.updateComplete;
      expect(element.querySelector("agent-todo-indicator")).not.toBeNull();

      mockSession.todos.mockReturnValue([]);
      triggerStateUpdate();
      await element.updateComplete;
      expect(element.querySelector("agent-todo-indicator")).toBeNull();
      expect(element.isConnected).toBe(true);
    });

    it("a session without todos is safe", async () => {
      element.config = { todo: { enabled: true } };
      const originalTodos = (mockSession as unknown as { todos?: unknown }).todos;
      try {
        delete (mockSession as unknown as { todos?: unknown }).todos;
        expect(() => triggerStateUpdate()).not.toThrow();
        await element.updateComplete;
        expect(element.querySelector("agent-todo-indicator")).toBeNull();
      } finally {
        (mockSession as unknown as { todos?: unknown }).todos = originalTodos;
      }
    });
  });
});

