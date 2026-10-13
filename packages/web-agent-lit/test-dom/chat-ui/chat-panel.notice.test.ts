import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import type {
  AgentSession,
  SessionMessage,
  SessionState,
} from "@cuatoi/web-agent-core";

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

const NOTICE_TEXT = "The model ended its turn without a reply.";

/** A minimal `AgentSession` mock, same shape as
 *  `chat-panel.message-window.test.ts`'s `makeMockSession()`. */
function makeMockSession(): {
  session: AgentSession;
  retryLast: ReturnType<typeof vi.fn>;
  push(next: Partial<SessionState>): void;
} {
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
  const retryLast = vi.fn();
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
    retryLast,
  } as unknown as AgentSession;

  return {
    session,
    retryLast,
    push(next: Partial<SessionState>) {
      state = { ...state, ...next };
      for (const cb of subs) cb(state);
    },
  };
}

describe("AgentChatPanel — the empty-turn notice", () => {
  let element: AgentChatPanel;
  let retryLast: ReturnType<typeof vi.fn>;
  let push: (next: Partial<SessionState>) => void;
  beforeEach(() => {
    element = document.createElement("agent-chat-panel");
    const mock = makeMockSession();
    retryLast = mock.retryLast;
    push = (next) => mock.push(next);
    element.session = mock.session;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("an info notice renders neutral, with Retry and no Dismiss", async () => {
    const messages: SessionMessage[] = [
      { role: "user", text: "hi", notice: { message: NOTICE_TEXT, retryable: true } },
    ];
    element.messages = messages;
    await element.updateComplete;

    const notices = element.querySelectorAll(".wa-notice");
    expect(notices).toHaveLength(1);
    const notice = notices[0];
    expect(notice.getAttribute("data-tone")).toBe("info");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(notice.textContent).toContain(NOTICE_TEXT);
    expect(notice.querySelector(".wa-notice-retry")).not.toBeNull();
    expect(notice.querySelector(".wa-notice-dismiss")).toBeNull();
    expect(notice.querySelector(".wa-notice-icon")).toBeNull();
  });

  it("clicking Retry on the info notice calls the session's retryLast", async () => {
    const messages: SessionMessage[] = [
      { role: "user", text: "hi", notice: { message: NOTICE_TEXT, retryable: true } },
    ];
    element.messages = messages;
    await element.updateComplete;

    const retry = element.querySelector(".wa-notice-retry") as HTMLButtonElement;
    expect(retry).not.toBeNull();
    retry.click();
    expect(retryLast).toHaveBeenCalledTimes(1);
  });

  it("a failed turn still renders the error tone unchanged", async () => {
    const messages: SessionMessage[] = [
      { role: "user", text: "hi", failed: { message: "boom", retryable: true } },
    ];
    element.messages = messages;
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice")!;
    expect(notice.getAttribute("data-tone")).toBe("error");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.querySelector(".wa-notice-icon")?.textContent).toBe("⚠");
    expect(notice.querySelector(".wa-notice-retry")).not.toBeNull();
    expect(notice.querySelector(".wa-notice-dismiss")).not.toBeNull();
  });

  it("a retry in progress still renders the progress tone unchanged", async () => {
    element.messages = [{ role: "user", text: "hi" }];
    // `running` is a getter over the session state, so flip it through the
    // mock session; `_retryAttempt` is protected, set through a narrow view.
    push({ running: true });
    const internals = element as unknown as {
      _retryAttempt: { attempt: number; maxRetries: number; reason: string } | undefined;
    };
    internals._retryAttempt = { attempt: 1, maxRetries: 5, reason: "network blip" };
    element.requestUpdate();
    await element.updateComplete;

    const notice = element.querySelector(".wa-notice")!;
    expect(notice.getAttribute("data-tone")).toBe("progress");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.querySelector(".wa-notice-icon")?.textContent).toBe("↻");
    expect(notice.querySelector(".wa-notice-dots")).not.toBeNull();
  });
});
