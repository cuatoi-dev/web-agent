import { describe, it, expect, afterEach } from "vitest";

const TAGS = ["web-agent-bubble", "agent-chat-panel", "wa-button"] as const;

// jsdom does not implement matchMedia, which applyTheme reads when the bubble
// mounts. A real browser always has it, so this fills a jsdom gap only.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList,
});

/** jsdom's `window.postMessage` sets `event.source` to null, and
 *  `readBridgeMessage` rejects a null source (src/lib/bridge-protocol.ts:19).
 *  A constructed MessageEvent with `source: window` is what the browser's own
 *  `window.postMessage` produces, so this is the faithful jsdom form. */
function postFromWindow(type: string, extra?: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type, ...extra },
      source: window,
      origin: window.location.origin,
    }),
  );
}

/** Collects the messages the content script posts back to the page. */
function collectMessages(): { messages: Record<string, unknown>[]; stop: () => void } {
  const messages: Record<string, unknown>[] = [];
  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data === "object" && data !== null && typeof (data as { type?: unknown }).type === "string") {
      messages.push(data as Record<string, unknown>);
    }
  };
  window.addEventListener("message", onMessage);
  return { messages, stop: () => window.removeEventListener("message", onMessage) };
}

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Returns the module to a resting state between tests: no bubble, no in-flight
 *  mount, empty body. Removing the element first, then asking for state, makes
 *  livingBubble() drop the detached reference. */
async function resetModule(): Promise<void> {
  document.querySelector("web-agent-bubble")?.remove();
  postFromWindow("wa-bridge-state-request");
  // The state reply is posted back to the window asynchronously. Wait for it
  // here, so it cannot arrive during the next test and be read as its answer.
  await new Promise((resolve) => setTimeout(resolve, 50));
  document.body.innerHTML = "";
}

afterEach(resetModule);

describe("content script lazy registration", () => {
  // Must stay first: after any mount, customElements keeps the tags for the
  // rest of the file, so a later `undefined` assertion could never pass.
  it("registers nothing until the bubble mounts", async () => {
    for (const tag of TAGS) expect(customElements.get(tag)).toBeUndefined();

    await import("./content");

    for (const tag of TAGS) expect(customElements.get(tag)).toBeUndefined();
    expect(document.querySelector("web-agent-bubble")).toBeNull();

    postFromWindow("wa-bridge-enable");
    await until(() => document.querySelector("web-agent-bubble") !== null);

    for (const tag of TAGS) expect(customElements.get(tag)).toBeDefined();
    expect(document.querySelector("web-agent-bubble")).not.toBeNull();
  });

  it("two enable messages produce exactly one bubble", async () => {
    await import("./content");
    postFromWindow("wa-bridge-enable");
    postFromWindow("wa-bridge-enable");
    await until(() => document.querySelectorAll("web-agent-bubble").length === 1);
    // Give a second load a chance to append a second bubble, then re-check.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelectorAll("web-agent-bubble")).toHaveLength(1);
  });

  it("a toggle during an in-flight mount waits and reports the real outcome", async () => {
    await import("./content");
    const { messages, stop } = collectMessages();
    try {
      postFromWindow("wa-bridge-enable");
      postFromWindow("wa-bridge-toggle"); // arrives while the enable mount runs
      await until(() => messages.some((m) => m.type === "wa-bridge-toggle-result"));
      await until(() => document.querySelectorAll("web-agent-bubble").length === 1);

      const setEnabled = messages.find((m) => m.type === "wa-bridge-set-origin-enabled");
      expect(setEnabled?.enabled).toBe(true);
      const result = messages.find((m) => m.type === "wa-bridge-toggle-result");
      expect(result?.mounted).toBe(true);
      expect(result?.requested).toBe("on");
      expect(document.querySelectorAll("web-agent-bubble")).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("a state request during an in-flight mount is answered after the mount", async () => {
    await import("./content");
    const { messages, stop } = collectMessages();
    try {
      postFromWindow("wa-bridge-enable");
      postFromWindow("wa-bridge-state-request");
      await until(() => messages.some((m) => m.type === "wa-bridge-state"));
      const state = messages.find((m) => m.type === "wa-bridge-state");
      expect(state?.mounted).toBe(true);
      expect(document.querySelectorAll("web-agent-bubble")).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("a toggle after the mount finishes turns the bubble off", async () => {
    await import("./content");
    postFromWindow("wa-bridge-enable");
    await until(() => document.querySelectorAll("web-agent-bubble").length === 1);
    const { messages, stop } = collectMessages();
    try {
      postFromWindow("wa-bridge-toggle");
      await until(() => messages.some((m) => m.type === "wa-bridge-toggle-result"));
      const result = messages.find((m) => m.type === "wa-bridge-toggle-result");
      expect(result?.mounted).toBe(false);
      expect(result?.requested).toBe("off");
      expect(document.querySelectorAll("web-agent-bubble")).toHaveLength(0);
      const setEnabled = messages.find((m) => m.type === "wa-bridge-set-origin-enabled");
      expect(setEnabled?.enabled).toBe(false);
    } finally {
      stop();
    }
  });

  it("mounts the bubble configured with PublicModels and initialRef", async () => {
    await import("./content");
    const mAnthropic = {
      ref: "brand:a",
      label: "Model A",
      model: "claude-a",
      endpoint: "https://a.test/api/anthropic",
      wireFormat: "anthropic" as const,
      vision: true,
      icon: "<svg></svg>",
    };
    const mOpenai = {
      ref: "brand:b",
      label: "Model B",
      model: "gpt-b",
      endpoint: "https://b.test/api/openai/v1",
      wireFormat: "openai" as const,
      vision: false,
      icon: "<svg></svg>",
    };
    postFromWindow("wa-bridge-enable", {
      models: [mAnthropic, mOpenai],
      current: "brand:b",
    });
    await until(() => document.querySelector("web-agent-bubble") !== null);
    const bubble = document.querySelector("web-agent-bubble") as any;
    expect(bubble.path).toBe("https://b.test/api/openai/v1");
    expect(bubble.type).toBe("openai");
    expect(bubble.model).toBe("gpt-b");
    expect(bubble.selectedModel).toBe("brand:b");
    expect(bubble.imageInput).toBe(false);
    expect(bubble.models.map((m: any) => m.id)).toEqual(["brand:a", "brand:b"]);
  });
});
