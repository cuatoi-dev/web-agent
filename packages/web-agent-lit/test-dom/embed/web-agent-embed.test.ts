import { describe, it, expect, vi, afterEach } from "vitest";
import { WebAgentBubble } from "../../src/embed/web-agent-embed.js";

if (!customElements.get("web-agent-bubble")) {
  customElements.define("web-agent-bubble", WebAgentBubble);
}

/** A minimal complete Anthropic message: one text block, normal end of turn. */
function mkJsonResponse(text: string) {
  return new Response(
    JSON.stringify({
      id: "msg_x",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      model: "test",
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("WebAgentBubble — the transport mode is not a host option", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("ignores a streaming property and sends one complete-result request", async () => {
    const bodies: Record<string, unknown>[] = [];
    const bubble = document.createElement("web-agent-bubble") as WebAgentBubble & {
      streaming?: boolean;
    };
    bubble.config = { persist: false };
    bubble.type = "anthropic";
    bubble.path = "/api/anthropic";
    bubble.model = "m";
    bubble.fetch = (_url, init) => {
      bodies.push(JSON.parse(init!.body as string) as Record<string, unknown>);
      return Promise.resolve(mkJsonResponse("Hello reply"));
    };
    // The property no longer exists. A host that still writes it must not
    // change the request: this assignment is the whole point of the test.
    bubble.streaming = true;
    document.body.appendChild(bubble);

    const sendPromise = bubble.send("hi");
    const panel = (
      bubble as unknown as {
        panelEl: { session: { initPromise: Promise<void> } } | null;
      }
    ).panelEl;
    await panel!.session.initPromise;
    await sendPromise;

    expect(bodies.length).toBe(1);
    expect(bodies[0].stream).toBe(false);
    expect(
      bubble.messages.filter((m) => m.role === "assistant").map((m) => m.text),
    ).toContain("Hello reply");
  });
});

const ICON_M = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>';
const ICON_S = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16"/></svg>';
const ICON_T = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l10 20H2z"/></svg>';
const MODEL_OPTIONS = [
  { id: "m", label: "Leo", icon: ICON_M },
  { id: "s", label: "Mochi", icon: ICON_S },
  { id: "t", label: "Third", icon: ICON_T },
];

type BubbleWithPanel = WebAgentBubble & { panelEl: import("../../src/chat-ui/chat-panel.js").AgentChatPanel | null };

async function mountBubble(before?: (b: BubbleWithPanel) => void): Promise<{
  bubble: BubbleWithPanel;
  panel: import("../../src/chat-ui/chat-panel.js").AgentChatPanel;
}> {
  const bubble = document.createElement("web-agent-bubble") as BubbleWithPanel;
  bubble.config = { persist: false };
  bubble.type = "anthropic";
  bubble.path = "/api/anthropic";
  bubble.model = "m";
  bubble.models = MODEL_OPTIONS;
  bubble.fetch = () => Promise.resolve(mkJsonResponse("Hello reply"));
  before?.(bubble);
  document.body.appendChild(bubble);
  await bubble.send("hi");
  const panel = bubble.shadowRoot!.querySelector("agent-chat-panel") as import("../../src/chat-ui/chat-panel.js").AgentChatPanel;
  await panel.session!.initPromise;
  await panel.updateComplete;
  return { bubble, panel };
}

async function openPanelMenu(panel: import("../../src/chat-ui/chat-panel.js").AgentChatPanel): Promise<string[]> {
  if (!panel.menuOpen) (panel.querySelector("#menu-anchor button") as HTMLButtonElement).click();
  await panel.updateComplete;
  return Array.from(panel.querySelectorAll('[role="menuitem"]'))
    .map((b) => b.textContent?.trim() ?? "")
    .filter((l) => l.startsWith("✓"));
}

describe("WebAgentBubble — the model switcher host hook", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("B1 forwards selectedModel before creation and follows later writes", async () => {
    const { bubble, panel } = await mountBubble((b) => {
      b.selectedModel = "s";
    });
    expect(panel.selectedModel).toBe("s");
    expect(await openPanelMenu(panel)).toEqual(["✓ Mochi"]);

    bubble.selectedModel = "t";
    await panel.updateComplete;
    expect(panel.selectedModel).toBe("t");
    expect(await openPanelMenu(panel)).toEqual(["✓ Third"]);

    bubble.selectedModel = undefined;
    await panel.updateComplete;
    expect(panel.selectedModel).toBeUndefined();
    expect(await openPanelMenu(panel)).toEqual(["✓ Leo"]);
  });

  it("B2 a listener on the bubble can cancel and own the check mark", async () => {
    const { bubble, panel } = await mountBubble();
    const seen: { id: string; bubbles: boolean; composed: boolean; cancelable: boolean }[] = [];
    bubble.addEventListener("agent-model-select", (e) => {
      const ev = e as CustomEvent<{ id: string }>;
      seen.push({
        id: ev.detail.id,
        bubbles: ev.bubbles,
        composed: ev.composed,
        cancelable: ev.cancelable,
      });
      ev.preventDefault();
      bubble.selectedModel = "s";
    });

    expect(await openPanelMenu(panel)).toEqual(["✓ Leo"]);
    const mochi = Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((b) => b.textContent?.trim().endsWith("Mochi"));
    mochi!.click();
    await panel.updateComplete;

    expect(seen).toEqual([{ id: "s", bubbles: true, composed: true, cancelable: true }]);
    expect(panel.session!.getState().model).toBe("m");
    expect(await openPanelMenu(panel)).toEqual(["✓ Mochi"]);
  });
});