import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, SessionState } from "@cuatoi/web-agent-core";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";

if (!customElements.get("agent-chat-panel")) customElements.define("agent-chat-panel", AgentChatPanel);
const meta = (id: string) => ({ id, title: id, titleManual: false, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 });
function mockSession(sessions = [meta("s-1")]): AgentSession {
  const state: SessionState = {
    activeSessionId: "s-1", sessions, messages: [], running: false,
    compacting: false, canCompact: false, error: null,
    contextWindow: { used: 0, total: 128000, percent: 0 }, queuedMessages: [],
  };
  return {
    getState: () => state, subscribe: (cb) => { cb(state); return () => {}; },
    updateConfig: vi.fn(), createSession: vi.fn(), switchSession: vi.fn(), deleteSession: vi.fn(),
    clearAllSessions: vi.fn(), send: vi.fn(), stop: vi.fn(), undo: vi.fn(), retryLast: vi.fn(),
    compactHistory: vi.fn(), cancelQueued: vi.fn(), popLastQueued: vi.fn(), clearQueue: vi.fn(),
    renameSession: vi.fn(), autoTitleSession: vi.fn(), setModel: vi.fn(),
    commands: vi.fn(() => []), refreshSessions: vi.fn(() => Promise.resolve()),
    pendingCounts: vi.fn(() => ({ schedules: 0, reminders: 0, total: 0 })),
    todos: vi.fn(() => []), getAttachmentProviders: vi.fn(() => []),
    subscribeEvents: vi.fn(() => () => {}), dispose: vi.fn(), availableTools: vi.fn(() => []),
  } as unknown as AgentSession;
}

describe("panel widget Lit 1 compatibility", () => {
  let panel: AgentChatPanel;
  beforeEach(async () => {
    panel = document.createElement("agent-chat-panel");
    panel.session = mockSession(); document.body.append(panel); await panel.updateComplete;
  });
  afterEach(() => { panel.remove(); vi.restoreAllMocks(); });

  it("opens Configuration from the kebab menu", async () => {
    (panel.querySelector("#menu-anchor") as HTMLButtonElement).click(); await panel.updateComplete;
    const item = [...panel.querySelectorAll<HTMLElement>("wa-menu [role=menuitem]")]
      .find((el) => el.textContent?.trim() === "Configuration");
    expect(item).toBeDefined(); item!.click(); await panel.updateComplete;
    expect(panel.querySelector(".wa-config-view")).not.toBeNull();
  });
  it("changes cue speed from the config view", async () => {
    const onCuesChange = vi.fn(); panel.onCuesChange = onCuesChange;
    panel.cues = { enabled: true, speed: "slow" }; panel.configOpen = true; await panel.updateComplete;
    (panel.querySelectorAll(".wa-config-seg wa-button")[1].firstElementChild as HTMLElement).click();
    expect(onCuesChange).toHaveBeenCalledWith({ speed: "fast", enabled: true });
  });
  it("renders history rows with delete buttons and one current row", async () => {
    panel.session = mockSession([meta("s-1"), meta("s-2")]); await panel.updateComplete;
    (panel as AgentChatPanel & { _toggleHistoryPanel(): void })._toggleHistoryPanel(); await panel.updateComplete;
    const rows = panel.querySelectorAll(".wa-history-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelector("wa-icon-button button")?.getAttribute("aria-label")).toMatch(/^Delete session/);
    }
    expect(panel.querySelectorAll('.wa-history-row[aria-current="true"]')).toHaveLength(1);
  });
});
