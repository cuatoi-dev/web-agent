import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import { WebAgentBubble } from "../../src/embed/web-agent-embed.js";
import type { PanelScreen, PanelScreenContext } from "../../src/chat-ui/types.js";
import type { AgentSession, SessionState } from "@cuatoi/web-agent-core";

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}
if (!customElements.get("web-agent-bubble")) {
  customElements.define("web-agent-bubble", WebAgentBubble);
}

function createMockSession(): AgentSession {
  const state: SessionState = {
    activeSessionId: "s-1",
    sessions: [
      { id: "s-1", title: "Test", titleManual: false, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 },
    ],
    messages: [],
    running: false,
    compacting: false,
    canCompact: false,
    error: null,
    contextWindow: { used: 0, total: 128000, percent: 0 },
    queuedMessages: [],
  };
  return {
    getState: () => state,
    subscribe: (cb) => {
      cb(state);
      return () => {};
    },
    updateConfig: vi.fn(),
    createSession: vi.fn(),
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
    clearAllSessions: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
    undo: vi.fn(),
    retryLast: vi.fn(),
    compactHistory: vi.fn(),
    cancelQueued: vi.fn(),
    popLastQueued: vi.fn(),
    clearQueue: vi.fn(),
    renameSession: vi.fn(),
    autoTitleSession: vi.fn(),
    subscribeEvents: vi.fn(() => () => {}),
    dispose: vi.fn(),
    availableTools: vi.fn(() => []),
  } as unknown as AgentSession;
}

describe("AgentChatPanel - screen seam", () => {
  let panel: AgentChatPanel;

  beforeEach(() => {
    panel = document.createElement("agent-chat-panel");
    panel.session = createMockSession();
    document.body.appendChild(panel);
  });

  afterEach(() => {
    panel.remove();
  });

  async function getMenuItems(): Promise<string[]> {
    const kebab = panel.querySelector("#menu-anchor") as HTMLButtonElement;
    expect(kebab).not.toBeNull();
    kebab.click();
    await panel.updateComplete;
    const items = Array.from(panel.querySelectorAll('[role="menuitem"]'));
    return items.map((el) => el.textContent?.trim() ?? "");
  }

  async function clickMenuItem(label: string): Promise<void> {
    const kebab = panel.querySelector("#menu-anchor") as HTMLButtonElement;
    expect(kebab).not.toBeNull();
    kebab.click();
    await panel.updateComplete;
    const item = Array.from(panel.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === label,
    ) as HTMLElement | undefined;
    expect(item, `Menu item "${label}" should exist`).toBeDefined();
    item!.click();
    await panel.updateComplete;
  }

  it("renders default menu items when screens is empty", async () => {
    panel.screens = [];
    panel.debug = true;
    await panel.updateComplete;

    const items = await getMenuItems();
    expect(items).toEqual(["Configuration", "Debug"]);
  });

  it("renders custom screens after Configuration and before Debug", async () => {
    panel.debug = true;
    panel.screens = [
      {
        id: "files",
        label: "Files",
        render: () => document.createElement("div"),
      },
    ];
    await panel.updateComplete;

    const items = await getMenuItems();
    expect(items).toEqual(["Configuration", "Files", "Debug"]);
  });

  it("swaps chat for screenFrame and back button restores chat", async () => {
    const screenEl = document.createElement("div");
    screenEl.className = "custom-screen-content";
    screenEl.textContent = "Hello from screen";

    const screen: PanelScreen = {
      id: "custom",
      label: "Custom Screen",
      render: () => screenEl,
    };
    panel.screens = [screen];
    await panel.updateComplete;

    // Initially messages-list is visible
    expect(panel.querySelector(".messages-list")).not.toBeNull();
    expect(panel.querySelector(".wa-screen-view")).toBeNull();

    // Open the custom screen
    await clickMenuItem("Custom Screen");

    // Screen frame is mounted
    const screenFrame = panel.querySelector(".wa-screen-view");
    expect(screenFrame).not.toBeNull();
    expect(panel.querySelector(".wa-screen-title")?.textContent).toBe("Custom Screen");
    expect(panel.querySelector(".custom-screen-content")?.textContent).toBe("Hello from screen");
    // Chat messages-list is hidden
    expect(panel.querySelector(".messages-list")).toBeNull();

    // Click back button
    const backBtn = panel.querySelector(".wa-screen-header button") as HTMLButtonElement;
    expect(backBtn).not.toBeNull();
    backBtn.click();
    await panel.updateComplete;

    // Chat is restored
    expect(panel.querySelector(".wa-screen-view")).toBeNull();
    expect(panel.querySelector(".messages-list")).not.toBeNull();
  });

  it("calling ctx.close() unmounts screen and restores chat", async () => {
    let capturedCtx: PanelScreenContext | null = null;
    const screen: PanelScreen = {
      id: "closable",
      label: "Closable Screen",
      render: (ctx) => {
        capturedCtx = ctx;
        const div = document.createElement("div");
        div.className = "closable-content";
        return div;
      },
    };
    panel.screens = [screen];
    await panel.updateComplete;

    await clickMenuItem("Closable Screen");
    expect(panel.querySelector(".wa-screen-view")).not.toBeNull();

    expect(capturedCtx).not.toBeNull();
    capturedCtx!.close();
    await panel.updateComplete;

    expect(panel.querySelector(".wa-screen-view")).toBeNull();
    expect(panel.querySelector(".messages-list")).not.toBeNull();
  });

  it("opening Configuration closes open screen and vice versa", async () => {
    const screen: PanelScreen = {
      id: "screen1",
      label: "Screen 1",
      render: () => document.createElement("div"),
    };
    panel.screens = [screen];
    await panel.updateComplete;

    // Open screen1
    await clickMenuItem("Screen 1");
    expect(panel.querySelector(".wa-screen-view")).not.toBeNull();
    expect(panel.querySelector(".wa-config-view")).toBeNull();

    // Open configuration from menu
    await clickMenuItem("Configuration");
    expect(panel.querySelector(".wa-screen-view")).toBeNull();
    expect(panel.querySelector(".wa-config-view")).not.toBeNull();

    // Open screen1 again from menu
    await clickMenuItem("Screen 1");
    expect(panel.querySelector(".wa-screen-view")).not.toBeNull();
    expect(panel.querySelector(".wa-config-view")).toBeNull();
  });

  it("opening Debug closes open screen", async () => {
    panel.debug = true;
    const screen: PanelScreen = {
      id: "screen1",
      label: "Screen 1",
      render: () => document.createElement("div"),
    };
    panel.screens = [screen];
    await panel.updateComplete;

    await clickMenuItem("Screen 1");
    expect(panel.querySelector(".wa-screen-view")).not.toBeNull();
    expect(panel.querySelector(".wa-debug-view")).toBeNull();

    await clickMenuItem("Debug");
    expect(panel.querySelector(".wa-screen-view")).toBeNull();
    expect(panel.querySelector(".wa-debug-view")).not.toBeNull();
  });

  it("calls screen.render() only once per open even across panel re-renders", async () => {
    let renderCount = 0;
    const innerContent = document.createElement("div");
    innerContent.className = "custom-screen-content";
    innerContent.textContent = "Initial state";

    const screen: PanelScreen = {
      id: "stateful-screen",
      label: "Stateful Screen",
      render: () => {
        renderCount++;
        return innerContent;
      },
    };
    panel.screens = [screen];
    await panel.updateComplete;

    await clickMenuItem("Stateful Screen");
    expect(panel.querySelector(".wa-screen-view")).not.toBeNull();
    expect(panel.querySelector(".custom-screen-content")).toBe(innerContent);
    expect(renderCount).toBe(1);

    // Modify inner DOM state directly (like expanding a folder tree)
    innerContent.textContent = "Expanded folder state";

    // Trigger panel re-renders via property updates
    panel.agentName = "New Agent Name";
    await panel.updateComplete;
    panel.debug = true;
    await panel.updateComplete;
    panel.requestUpdate();
    await panel.updateComplete;

    // renderCount must still be 1, and the same DOM element with modified state must still be in the view
    expect(renderCount).toBe(1);
    expect(panel.querySelector(".custom-screen-content")).toBe(innerContent);
    expect(panel.querySelector(".custom-screen-content")?.textContent).toBe("Expanded folder state");

    // Closing and reopening should call render() again
    const backBtn = panel.querySelector(".wa-screen-header [role='button'], .wa-screen-header button") as HTMLElement;
    backBtn.click();
    await panel.updateComplete;
    expect(panel.querySelector(".wa-screen-view")).toBeNull();

    await clickMenuItem("Stateful Screen");
  });
});

describe("WebAgentBubble - screens forwarding", () => {
  let bubble: WebAgentBubble;

  beforeEach(() => {
    bubble = document.createElement("web-agent-bubble") as WebAgentBubble;
    bubble.model = "test-model";
    document.body.appendChild(bubble);
  });

  afterEach(() => {
    bubble.remove();
  });

  it("forwards screens set before panelEl is mounted", () => {
    const testScreen: PanelScreen = {
      id: "files",
      label: "Files",
      render: () => document.createElement("div"),
    };
    bubble.screens = [testScreen];
    bubble.toggle();

    expect(bubble.panelEl).toBeDefined();
    expect(bubble.panelEl?.screens).toEqual([testScreen]);
  });

  it("forwards screens set after panelEl is already mounted", () => {
    bubble.toggle();

    expect(bubble.panelEl).toBeDefined();
    const testScreen: PanelScreen = {
      id: "files",
      label: "Files",
      render: () => document.createElement("div"),
    };
    bubble.screens = [testScreen];
    expect(bubble.panelEl?.screens).toEqual([testScreen]);
  });
});
