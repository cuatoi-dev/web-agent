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