// The composer's dynamic `AttachmentProviderView` seam:
// `_updateProviderButton` re-evaluates a provider's `view()` on mount and on
// every `subscribe` notification, updating the cached button's icon,
// aria-label, disabled state and tooltip in place. Split out of the giant
// chat-panel.test.ts because this behaviour is specific to
// `chat-panel-elements.ts`, not the whole panel.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import type { AgentSession, AttachmentProvider, AttachmentProviderView, SessionState } from "@cuatoi/web-agent-core";

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

/** A minimal `AgentSession` mock — same shape as `chat-panel.notice.test.ts`'s
 *  `makeMockSession()`. */
function makeMockSession(): AgentSession {
  const state: SessionState = {
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
  } as unknown as AgentSession;
}

/** A provider whose `view()` is a live closure over `current`, so a test can
 *  change what it returns and re-notify. */
function makeDynamicProvider(id: string, view: () => AttachmentProviderView): {
  provider: AttachmentProvider;
  fireChange: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    provider: {
      id,
      label: "Static label",
      icon: "attach_file",
      view,
      pick: () => {},
      hasPending: () => false,
      onUserPrompt: () => undefined,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    fireChange() {
      for (const l of listeners) l();
    },
  };
}

describe("AgentChatPanel — attachment provider view()", () => {
  let element: AgentChatPanel;

  beforeEach(() => {
    element = document.createElement("agent-chat-panel");
    element.session = makeMockSession();
    element.imageInput = false;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  /** The `<wa-icon-button>` host — carries `data-attachment-provider`,
   *  `title` and the `disabled` property. */
  function iconBtn(id: string): HTMLElement & { disabled: boolean } {
    const btn = element.querySelector(`wa-icon-button[data-attachment-provider="${id}"]`);
    expect(btn).not.toBeNull();
    return btn as HTMLElement & { disabled: boolean };
  }

  /** The real inner `<button>` — carries `aria-label` and the SVG icon. */
  function innerBtn(host: HTMLElement): HTMLButtonElement {
    const btn = host.querySelector("button");
    expect(btn).not.toBeNull();
    return btn as HTMLButtonElement;
  }

  it("a provider without view() renders and behaves exactly as before", async () => {
    let picked = false;
    const provider: AttachmentProvider = {
      id: "plain",
      label: "Attach image",
      icon: "attach_file",
      pick: () => {
        picked = true;
      },
      hasPending: () => false,
      onUserPrompt: () => undefined,
    };
    element.attachmentProviders = [provider];
    await element.updateComplete;

    const btn = iconBtn("plain");
    expect(innerBtn(btn).getAttribute("aria-label")).toBe("Attach image");
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute("title")).toBe(false);
    innerBtn(btn).dispatchEvent(new MouseEvent("click"));
    expect(picked).toBe(true);
  });

  it("view() overrides icon, aria-label and disabled on mount", async () => {
    const { provider } = makeDynamicProvider("watch-me", () => ({
      icon: "stop",
      label: "Stop recording",
      disabled: true,
    }));
    element.attachmentProviders = [provider];
    await element.updateComplete;

    const btn = iconBtn("watch-me");
    expect(innerBtn(btn).getAttribute("aria-label")).toBe("Stop recording");
    expect(btn.disabled).toBe(true);
    expect(innerBtn(btn).querySelector("svg")).not.toBeNull();
  });

  it("a subscribe notification updates icon, aria-label, disabled and tooltip in place, without losing the cached element", async () => {
    let state: AttachmentProviderView = { disabled: true, tooltip: "Turn on the agent in this tab to record" };
    const { provider, fireChange } = makeDynamicProvider("watch-me", () => state);
    element.attachmentProviders = [provider];
    await element.updateComplete;

    const btnBefore = iconBtn("watch-me");
    expect(btnBefore.getAttribute("title")).toBe("Turn on the agent in this tab to record");
    expect(btnBefore.disabled).toBe(true);

    state = { icon: "stop", label: "Stop recording" };
    fireChange();
    await element.updateComplete;

    const btnAfter = iconBtn("watch-me");
    expect(btnAfter).toBe(btnBefore); // same cached element — focus survives
    expect(innerBtn(btnAfter).getAttribute("aria-label")).toBe("Stop recording");
    expect(btnAfter.disabled).toBe(false);
    expect(btnAfter.hasAttribute("title")).toBe(false);
  });

  it("re-notifying with the same icon name does not rebuild the icon child", async () => {
    let state: AttachmentProviderView = {};
    const { provider, fireChange } = makeDynamicProvider("watch-me", () => state);
    element.attachmentProviders = [provider];
    await element.updateComplete;

    const svgBefore = innerBtn(iconBtn("watch-me")).querySelector("svg");
    state = { label: "Still idle" };
    fireChange();

    const svgAfter = innerBtn(iconBtn("watch-me")).querySelector("svg");
    expect(svgAfter).toBe(svgBefore);
  });
});

describe("AgentChatPanel — attachment provider choices menu", () => {
  let element: AgentChatPanel;

  beforeEach(() => {
    element = document.createElement("agent-chat-panel");
    element.session = makeMockSession();
    element.imageInput = false;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  function iconBtn(id: string): HTMLElement & { disabled: boolean } {
    const btn = element.querySelector(`wa-icon-button[data-attachment-provider="${id}"]`);
    expect(btn).not.toBeNull();
    return btn as HTMLElement & { disabled: boolean };
  }

  function innerBtn(host: HTMLElement): HTMLButtonElement {
    const btn = host.querySelector("button");
    expect(btn).not.toBeNull();
    return btn as HTMLButtonElement;
  }

  function menuProvider(choices: { id: string; label: string }[]) {
    const picks: (string | undefined)[] = [];
    const provider: AttachmentProvider = {
      id: "folder",
      label: "Attach folder",
      icon: "folder",
      choices: () => choices,
      pick: (id?: string) => { picks.push(id); },
      hasPending: () => false,
      onUserPrompt: () => undefined,
    };
    return { provider, picks };
  }

  const menu = () =>
    element.querySelector("wa-menu.wa-attach-menu") as HTMLElement & {
      open: boolean;
      items: { id: string; label: string }[];
    };
  const menuButtons = () => [...menu().querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')];

  it("a press opens the menu with the choices, anchored to the button", async () => {
    const { provider, picks } = menuProvider([
      { id: "ro", label: "Attach folder (read only)" },
      { id: "rw", label: "Attach folder (read and write)" },
    ]);
    element.attachmentProviders = [provider];
    await element.updateComplete;

    innerBtn(iconBtn("folder")).click();
    await element.updateComplete;

    expect(menu().open).toBe(true);
    expect(menu().items).toEqual([
      { id: "ro", label: "Attach folder (read only)" },
      { id: "rw", label: "Attach folder (read and write)" },
    ]);
    expect(menu().getAttribute("anchor-id")).toBe(iconBtn("folder").id);
    expect(iconBtn("folder").id).toMatch(/^wa-attach-\d+-folder$/);
    expect(picks).toEqual([]);
  });

  it("choosing an item calls pick(id) and closes", async () => {
    const { provider, picks } = menuProvider([
      { id: "ro", label: "Attach folder (read only)" },
      { id: "rw", label: "Attach folder (read and write)" },
    ]);
    element.attachmentProviders = [provider];
    await element.updateComplete;

    innerBtn(iconBtn("folder")).click();
    await element.updateComplete;

    menuButtons()[1].click();
    expect(picks).toEqual(["rw"]);
    await element.updateComplete;
    expect(menu().open).toBe(false);
    expect(menu().hasAttribute("anchor-id")).toBe(false);
  });

  it("request-close closes without picking", async () => {
    const { provider, picks } = menuProvider([
      { id: "ro", label: "Attach folder (read only)" },
      { id: "rw", label: "Attach folder (read and write)" },
    ]);
    element.attachmentProviders = [provider];
    await element.updateComplete;

    innerBtn(iconBtn("folder")).click();
    await element.updateComplete;

    menu().dispatchEvent(new CustomEvent("request-close"));
    await element.updateComplete;
    expect(menu().open).toBe(false);
    expect(picks).toEqual([]);
  });

  it("a second press closes the menu", async () => {
    const { provider, picks } = menuProvider([
      { id: "ro", label: "Attach folder (read only)" },
      { id: "rw", label: "Attach folder (read and write)" },
    ]);
    element.attachmentProviders = [provider];
    await element.updateComplete;

    innerBtn(iconBtn("folder")).click();
    await element.updateComplete;
    expect(menu().open).toBe(true);

    innerBtn(iconBtn("folder")).click();
    await element.updateComplete;
    expect(menu().open).toBe(false);
    expect(picks).toEqual([]);
  });

  it("an empty choices() picks at once", async () => {
    const { provider, picks } = menuProvider([]);
    element.attachmentProviders = [provider];
    await element.updateComplete;

    innerBtn(iconBtn("folder")).click();
    expect(picks).toEqual([undefined]);
    expect(menu().open).toBe(false);
  });

  it("a provider without choices() still picks at once", async () => {
    const picks: (string | undefined)[] = [];
    const provider: AttachmentProvider = {
      id: "folder",
      label: "Attach folder",
      icon: "folder",
      pick: (id?: string) => { picks.push(id); },
      hasPending: () => false,
      onUserPrompt: () => undefined,
    };
    element.attachmentProviders = [provider];
    await element.updateComplete;

    innerBtn(iconBtn("folder")).click();
    expect(picks).toEqual([undefined]);
    expect(menu().open).toBe(false);
  });

  it("two panels get different button ids", async () => {
    const { provider } = menuProvider([
      { id: "ro", label: "Attach folder (read only)" },
    ]);
    element.attachmentProviders = [provider];
    const second = document.createElement("agent-chat-panel");
    second.session = makeMockSession();
    second.imageInput = false;
    second.attachmentProviders = [provider];
    document.body.appendChild(second);
    try {
      await element.updateComplete;
      await second.updateComplete;
      const btn1 = element.querySelector(`wa-icon-button[data-attachment-provider="folder"]`)!;
      const btn2 = second.querySelector(`wa-icon-button[data-attachment-provider="folder"]`)!;
      expect(btn1.id).not.toBe(btn2.id);
    } finally {
      second.remove();
    }
  });
});
