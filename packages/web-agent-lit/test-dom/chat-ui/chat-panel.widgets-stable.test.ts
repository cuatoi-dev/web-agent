import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, SessionState } from "@cuatoi/web-agent-core";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";

if (!customElements.get("agent-chat-panel")) customElements.define("agent-chat-panel", AgentChatPanel);

const meta = (id: string) => ({ id, title: id, titleManual: false, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 });
function mockSession() {
  let state: SessionState = {
    activeSessionId: "s-1", sessions: [meta("s-1")], messages: [], running: false,
    compacting: false, canCompact: false, error: null,
    contextWindow: { used: 0, total: 128000, percent: 0 }, queuedMessages: [],
  };
  let subscriber: ((s: SessionState) => void) | undefined;
  const session = {
    getState: () => state,
    subscribe: (cb: (s: SessionState) => void) => { subscriber = cb; cb(state); return () => { subscriber = undefined; }; },
    updateConfig: vi.fn(), createSession: vi.fn(), switchSession: vi.fn(), deleteSession: vi.fn(),
    clearAllSessions: vi.fn(), send: vi.fn(), stop: vi.fn(), undo: vi.fn(), retryLast: vi.fn(),
    compactHistory: vi.fn(), cancelQueued: vi.fn(), popLastQueued: vi.fn(), clearQueue: vi.fn(),
    renameSession: vi.fn(), autoTitleSession: vi.fn(), setModel: vi.fn(),
    commands: vi.fn(() => []), refreshSessions: vi.fn(() => Promise.resolve()),
    pendingCounts: vi.fn(() => ({ schedules: 0, reminders: 0, total: 0 })),
    todos: vi.fn(() => []), getAttachmentProviders: vi.fn(() => []),
    subscribeEvents: vi.fn(() => () => {}), dispose: vi.fn(), availableTools: vi.fn(() => []),
  } as unknown as AgentSession;
  return { session, notify: (next: Partial<SessionState>) => { state = { ...state, ...next }; subscriber?.(state); } };
}

type PanelPrivate = AgentChatPanel & {
  _toggleHistoryPanel(): void;
  _historyOutsideHandler?: (e: MouseEvent) => void;
};
const priv = (panel: AgentChatPanel) => panel as PanelPrivate;

describe("panel widget stability", () => {
  let panel: AgentChatPanel;
  let notify: (s: Partial<SessionState>) => void;
  beforeEach(async () => {
    const mock = mockSession(); notify = mock.notify;
    panel = document.createElement("agent-chat-panel");
    panel.session = mock.session;
    document.body.append(panel);
    await panel.updateComplete;
  });
  afterEach(() => { panel.remove(); vi.restoreAllMocks(); });

  it("the open menu survives a render during a turn", async () => {
    (panel.querySelector("#menu-anchor button") as HTMLButtonElement).click(); await panel.updateComplete;
    const menu = panel.querySelector("wa-menu")!;
    const first = menu.querySelector('[role="menuitem"]') as HTMLButtonElement;
    first.focus();
    notify({ running: true, messages: [{ role: "user", text: "hi" }] }); await panel.updateComplete;
    expect(panel.querySelector("wa-menu")).toBe(menu);
    expect(menu.isConnected).toBe(true);
    expect(panel.menuOpen).toBe(true);
    expect(document.activeElement).toBe(first);
  });
  it("the menu button stays enabled during a turn and opens the menu", async () => {
    notify({ running: true }); await panel.updateComplete;
    const button = panel.querySelector("#menu-anchor") as HTMLElement & { disabled: boolean };
    expect(button.disabled).toBe(false);
    (button.querySelector("button") as HTMLButtonElement).click(); await panel.updateComplete;
    expect(panel.menuOpen).toBe(true);
    expect((panel.querySelector("wa-menu")!.firstElementChild as HTMLElement).style.display).toBe("block");
    expect((panel.querySelector("#history-anchor") as HTMLButtonElement).disabled).toBe(true);
  });
  it("the history popup survives a render", async () => {
    notify({ sessions: [meta("s-1"), meta("s-2"), meta("s-3")] }); await panel.updateComplete;
    priv(panel)._toggleHistoryPanel(); await panel.updateComplete;
    const popup = panel.querySelector(".wa-history-popup")!;
    const list = panel.querySelector(".wa-history-list")!;
    list.setAttribute("data-probe", "1");
    const handler = priv(panel)._historyOutsideHandler;
    notify({ running: true }); await panel.updateComplete;
    expect(panel.querySelector(".wa-history-popup")).toBe(popup);
    expect(panel.querySelector(".wa-history-list")).toBe(list);
    expect(list.getAttribute("data-probe")).toBe("1");
    expect(priv(panel)._historyOutsideHandler).toBe(handler);
    expect(panel.querySelectorAll(".wa-history-row")).toHaveLength(3);
  });
  it("Space on Fast and on the checkbox keeps focus", async () => {
    panel.cues = { enabled: true, speed: "slow" }; panel.configOpen = true; await panel.updateComplete;
    const fastHost = panel.querySelectorAll(".wa-config-seg wa-button")[1];
    const fast = fastHost.firstElementChild as HTMLButtonElement;
    fast.focus(); fast.click(); await panel.updateComplete;
    expect(fastHost.firstElementChild).toBe(fast);
    expect(document.activeElement).toBe(fast);
    expect(fast.className).toContain("wa-btn-primary");
    expect(panel.cues?.speed).toBe("fast");
    const cb = panel.querySelector(".wa-config-view input[type=checkbox]") as HTMLInputElement;
    cb.focus(); cb.click(); await panel.updateComplete;
    expect(panel.querySelector(".wa-config-view input[type=checkbox]")).toBe(cb);
    expect(document.activeElement).toBe(cb);
    expect(panel.cues?.enabled).toBe(false);
  });
  it("Escape closes the default menu inside the panel", async () => {
    (panel.querySelector("#menu-anchor button") as HTMLButtonElement).click(); await panel.updateComplete;
    panel.querySelector("wa-menu [role=menuitem]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    await panel.updateComplete;
    expect(panel.menuOpen).toBe(false);
  });
  it("menu listeners balance across renders", async () => {
    const menu = panel.querySelector("wa-menu") as HTMLElement;
    const own = (fn: unknown) => [Reflect.get(menu, "_onOutside"), Reflect.get(menu, "_onKey"), Reflect.get(menu, "_position")].includes(fn);
    const da = vi.spyOn(document, "addEventListener"); const dr = vi.spyOn(document, "removeEventListener");
    const wa = vi.spyOn(window, "addEventListener"); const wr = vi.spyOn(window, "removeEventListener");
    (panel.querySelector("#menu-anchor button") as HTMLButtonElement).click(); await panel.updateComplete;
    for (let i = 0; i < 3; i++) { panel.requestUpdate(); await panel.updateComplete; }
    panel.menuOpen = false; await panel.updateComplete;
    expect([...da.mock.calls, ...wa.mock.calls].filter((c) => own(c[1]))).toHaveLength(4);
    expect([...dr.mock.calls, ...wr.mock.calls].filter((c) => own(c[1]))).toHaveLength(4);
  });
  it("a re-attached panel handles one paste once", async () => {
    const provider = {
      id: "p", label: "P", icon: "image", pick: vi.fn(), hasPending: () => false,
      onUserPrompt: vi.fn(), onPaste: vi.fn(() => true),
    };
    panel.imageInput = false; panel.attachmentProviders = [provider]; await panel.updateComplete;
    for (let i = 0; i < 2; i++) { panel.remove(); document.body.append(panel); await panel.updateComplete; }
    panel.querySelector("textarea")!.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
    expect(provider.onPaste).toHaveBeenCalledTimes(1);
  });
});
