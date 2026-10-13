import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import type { AgentSession, SessionState } from "@cuatoi/web-agent-core";

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

const SRC = "data:image/png;base64,AAA=";

/** A minimal `AgentSession` mock, same shape as `chat-panel.notice.test.ts`. */
function makeMockSession(): AgentSession {
  const state = {
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
  return {
    getState: () => state,
    subscribe: (cb: (s: SessionState) => void) => {
      cb(state);
      return () => {};
    },
    subscribeEvents: () => () => {},
    updateConfig: () => {},
    availableTools: () => [],
    retryLast: vi.fn(),
  } as unknown as AgentSession;
}

function openFrom(target: EventTarget): void {
  target.dispatchEvent(
    new CustomEvent("wa-image-open", { detail: { src: SRC }, bubbles: true, composed: true }),
  );
}

describe("AgentChatPanel — the image overlay", () => {
  let element: AgentChatPanel;
  let opener: HTMLButtonElement;

  beforeEach(async () => {
    element = document.createElement("agent-chat-panel");
    element.session = makeMockSession();
    document.body.appendChild(element);
    // The opener lives inside the panel, like a tool thumbnail does.
    opener = document.createElement("button");
    element.appendChild(opener);
    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
  });

  it("a wa-image-open event renders the overlay and focuses it", async () => {
    openFrom(opener);
    await element.updateComplete;
    const overlay = element.querySelector(".wa-image-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect((overlay.querySelector("img") as HTMLImageElement).src).toContain(SRC);
    await Promise.resolve();
    expect(document.activeElement).toBe(overlay);
  });

  it("Escape closes the overlay and returns focus to the opener", async () => {
    openFrom(opener);
    await element.updateComplete;
    const overlay = element.querySelector(".wa-image-overlay") as HTMLElement;
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await element.updateComplete;
    expect(element.querySelector(".wa-image-overlay")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("Tab keeps the focus on the overlay, and Escape still closes it afterwards", async () => {
    openFrom(opener);
    await element.updateComplete;
    const overlay = element.querySelector(".wa-image-overlay") as HTMLElement;
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    overlay.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(overlay);
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await element.updateComplete;
    expect(element.querySelector(".wa-image-overlay")).toBeNull();
  });

  it("a backdrop click closes; a click on the image does not", async () => {
    openFrom(opener);
    await element.updateComplete;
    (element.querySelector(".wa-image-overlay img") as HTMLElement).click();
    await element.updateComplete;
    expect(element.querySelector(".wa-image-overlay")).not.toBeNull();

    (element.querySelector(".wa-image-overlay") as HTMLElement).click();
    await element.updateComplete;
    expect(element.querySelector(".wa-image-overlay")).toBeNull();
  });

  it("the overlay is a child of the panel root", async () => {
    openFrom(opener);
    await element.updateComplete;
    const overlay = element.querySelector(".wa-image-overlay") as HTMLElement;
    expect(element.contains(overlay)).toBe(true);
    expect(overlay.closest("agent-chat-panel")).toBe(element);
  });
});
