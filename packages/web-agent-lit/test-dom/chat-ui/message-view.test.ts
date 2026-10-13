import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import DOMPurify from "dompurify";
import type { RenderableBlock, FormBlock } from "@cuatoi/web-agent-core";
import { AgentMessageView, sanitizeToolHtml } from "../../src/chat-ui/message-view.js";
import { BlockRendererRegistry } from "../../src/ui-blocks/renderer/types.js";
import { generativeUiRenderer } from "../../src/ui-blocks/renderer/generative-ui-renderer.js";

// ---------------------------------------------------------------------------
// WCAG 2.1 contrast helpers, mirroring src/themes/wa-tokens.test.ts. Every
// wa-tokens.css value used below is a plain hsl() token.
// ---------------------------------------------------------------------------

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let tt = t % 1;
    if (tt < 0) tt += 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

function parseHsl(value: string): [number, number, number] {
  const m = value.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i);
  if (!m) throw new Error(`not a plain hsl() token: ${value}`);
  const h = (parseFloat(m[1]) % 360) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  return hslToRgb(h, s, l);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// A text part renders through a Lit child expression (`${unsafeHTML(...)}`),
// so the container's innerHTML carries Lit's own bookkeeping comment marker
// ahead of the content — invisible in the browser, but present in the DOM.
// Strip it before comparing against the plain sanitized HTML string.
function stripLitMarker(html: string): string {
  return html.replace(/<!--\?lit\$\d+\$-->/g, "");
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseHsl(a));
  const lb = relativeLuminance(parseHsl(b));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

if (!customElements.get("agent-message-view")) {
  customElements.define("agent-message-view", AgentMessageView);
}

describe("AgentMessageView", () => {
  let element: AgentMessageView;

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("renders sanitized markdown HTML into the content container", async () => {
    element.html = "<p>Hello <strong>world</strong></p>";
    await element.updateComplete;

    const content = element.querySelector(".content");
    expect(content).not.toBeNull();
    expect(stripLitMarker(content!.innerHTML)).toBe("<p>Hello <strong>world</strong></p>");
  });

  it("renders sanitized markdown HTML when text property is set", async () => {
    element.text = "**bold** and _italic_ with <script>alert(1)</script> tags";
    await element.updateComplete;

    const content = element.querySelector(".content");
    expect(content).not.toBeNull();
    expect(content!.innerHTML).toContain("<strong>bold</strong>");
    expect(content!.innerHTML).toContain("<em>italic</em>");
    expect(content!.innerHTML).not.toContain("<script>");
  });

  it("renders blocks into the .blocks-container", async () => {
    element.blocks = [
      {
        type: "buttons",
        buttons: [{ label: "Click Me", onClick: { type: "user-message", message: "clicked" } }]
      }
    ];
    await element.updateComplete;

    const blocksContainer = element.querySelector(".blocks-container");
    expect(blocksContainer).not.toBeNull();
    expect(blocksContainer!.children.length).toBeGreaterThan(0);
  });

  it("renders parts in order: text part then block part", async () => {
    element.parts = [
      { kind: "text", html: "<p>Hello</p>" },
      {
        kind: "block",
        block: {
          type: "buttons",
          buttons: [{ label: "Go", onClick: { type: "user-message", message: "go" } }],
        },
      },
    ];
    await element.updateComplete;

    const textEl = element.querySelector('[data-part-idx="0"]');
    expect(textEl).not.toBeNull();
    expect(textEl!.classList.contains("content")).toBe(true);
    expect(stripLitMarker(textEl!.innerHTML)).toBe("<p>Hello</p>");

    const blockEl = element.querySelector('[data-part-idx="1"]');
    expect(blockEl).not.toBeNull();
    expect(blockEl!.classList.contains("blocks-container")).toBe(true);
    expect(blockEl!.children.length).toBeGreaterThan(0);
  });

  it("html getter returns combined text-part html after parts setter", () => {
    element.parts = [
      { kind: "text", html: "<p>First</p>" },
      { kind: "block", block: { type: "buttons", options: [] } },
      { kind: "text", html: "<p>Second</p>" },
    ];
    expect(element.html).toBe("<p>First</p><p>Second</p>");
  });

  it("blocks getter returns block-part blocks after parts setter", () => {
    element.parts = [
      { kind: "text", html: "<p>X</p>" },
      { kind: "block", block: { type: "buttons", options: [{ label: "A", prompt: "a" }] } },
    ];
    expect(element.blocks).toHaveLength(1);
    expect(element.blocks[0].type).toBe("buttons");
  });

  it("parts setter with undefined does not clobber html-derived parts", async () => {
    element.html = "<p>keep me</p>";
    await element.updateComplete;
    element.parts = undefined;
    expect(element.parts).toHaveLength(1);
    expect(element.parts![0].kind).toBe("text");
    expect(element.html).toBe("<p>keep me</p>");
  });

  it("renders a friendly default-fallback phrase for a tool with no defined phrase", async () => {
    element.parts = [
      { kind: "text", html: "<p>Doing it</p>" },
      {
        kind: "tool",
        audit: {
          name: "add_to_cart",
          input: {},
          outcomeSummary: "Added 2 cans.",
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    const toolStep = element.querySelector(".tool-step");
    expect(toolStep).not.toBeNull();
    expect(toolStep!.getAttribute("title")).toBe("add_to_cart");

    const phrase = toolStep!.querySelector(".tool-step-phrase");
    expect(phrase!.textContent).toBe("Agent used the tool add_to_cart");

    expect(element.querySelector(".tool-step-name")).toBeNull();
    expect(element.querySelector(".tool-step-outcome")).toBeNull();
    expect(element.querySelector("details")).toBeNull();
  });

  it("uses agentShortName in the friendly phrase when set, generic 'Agent' otherwise", async () => {
    element.agentShortName = "Whiskers";
    element.parts = [
      {
        kind: "tool",
        audit: {
          name: "click",
          input: { ref: "7" },
          outcomeSummary: 'Clicked [7] button "Add to Cart". Page may have changed; snapshot again if you need to verify.',
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    let phrase = element.querySelector(".tool-step-phrase");
    expect(phrase!.textContent).toBe('Whiskers clicked the button "Add to Cart"');

    element.agentShortName = undefined;
    await element.updateComplete;
    phrase = element.querySelector(".tool-step-phrase");
    expect(phrase!.textContent).toBe('Agent clicked the button "Add to Cart"');
  });

  it("renders parts in order: text → tool → text", async () => {
    element.parts = [
      { kind: "text", html: "<p>Before</p>" },
      {
        kind: "tool",
        audit: {
          name: "add_to_cart",
          input: {},
          outcomeSummary: "Added 2 cans.",
          ts: Date.now(),
        },
      },
      { kind: "text", html: "<p>After</p>" },
    ];
    await element.updateComplete;

    const container = element.querySelector(".message-container");
    expect(container).not.toBeNull();
    const children = Array.from(container!.children);
    const partClasses = children
      .map(child => {
        if (child.classList.contains("content")) return "content";
        if (child.classList.contains("tool-step")) return "tool-step";
        if (child.classList.contains("blocks-container")) return "blocks-container";
        return "";
      })
      .filter(cls => cls !== "");

    expect(partClasses).toEqual(["content", "tool-step", "content"]);
  });

  it("reflects role attribute and class changes", async () => {
    element.role = "assistant";
    await element.updateComplete;

    const container = element.querySelector(".message-container");
    expect(container!.classList.contains("assistant")).toBe(true);
    expect(container!.classList.contains("user")).toBe(false);

    element.role = "user";
    await element.updateComplete;
    expect(container!.classList.contains("user")).toBe(true);
    expect(container!.classList.contains("assistant")).toBe(false);
  });

  it("responds to observed attributes changes", async () => {
    element.setAttribute("role", "system");
    element.setAttribute("html", "<div>System Alert</div>");
    await element.updateComplete;

    const container = element.querySelector(".message-container");
    expect(container!.classList.contains("system")).toBe(true);

    const content = element.querySelector(".content");
    expect(stripLitMarker(content!.innerHTML)).toBe("<div>System Alert</div>");
  });

  it("renders NO avatar node for the user row (avatars removed)", async () => {
    element.role = "user";
    element.userAvatar = "data:image/svg+xml,user";
    await element.updateComplete;

    expect(element.querySelector(".wa-avatar")).toBeNull();
    const row = element.querySelector(".message-row");
    expect(row!.classList.contains("user")).toBe(true);
  });

  it("no avatar node renders for any role", async () => {
    for (const role of ["user", "assistant", "system"] as const) {
      element.role = role;
      await element.updateComplete;
      expect(element.querySelector(".wa-avatar")).toBeNull();
    }
  });

  it("drops the role-label caption", async () => {
    element.role = "assistant";
    element.html = "<p>Hello</p>";
    await element.updateComplete;
    expect(element.querySelector(".role-label")).toBeNull();
  });

  it("keeps avatar/name setters as no-render API seam", async () => {
    element.userAvatar = "data:image/svg+xml,user";
    element.agentAvatar = "data:image/svg+xml,agent";
    element.userName = "Alex";
    element.agentShortName = "Whiskers";
    await element.updateComplete;

    expect(element.userAvatar).toBe("data:image/svg+xml,user");
    expect(element.agentAvatar).toBe("data:image/svg+xml,agent");
    expect(element.userName).toBe("Alex");
    expect(element.agentShortName).toBe("Whiskers");
    expect(element.querySelector(".wa-avatar")).toBeNull();
  });

  it("formats and sanitizes text exactly once per write of parts", async () => {
    const sanitizeSpy = vi.spyOn(DOMPurify, "sanitize");
    sanitizeSpy.mockClear();

    element.parts = [
      { kind: "text", text: "## Heading\n\n- item 1\n- item 2\n\n```js\nconst x = 1;\n```" },
    ];
    await element.updateComplete;

    expect(sanitizeSpy).toHaveBeenCalledTimes(1);
    const content = element.querySelector('[data-part-idx="0"]');
    expect(content?.innerHTML).toContain("<h2");
    expect(content?.innerHTML).toContain("<ul>");
    expect(content?.innerHTML).toContain("<code");

    sanitizeSpy.mockRestore();
  });

  it("derives html getter lazily when parts contain text without html", () => {
    element.parts = [
      { kind: "text", text: "**Lazy**" },
      { kind: "text", text: "_Derivation_" },
    ];
    expect(element.html).toContain("<strong>Lazy</strong>");
    expect(element.html).toContain("<em>Derivation</em>");
  });

  it("sanitizes dangerous tags during single-pass render", async () => {
    element.parts = [
      { kind: "text", text: "Safe <script>bad()</script><img src=x onerror=alert(1)>" },
    ];
    await element.updateComplete;
    const content = element.querySelector('[data-part-idx="0"]');
    expect(content!.textContent).toContain("Safe");
    expect(content!.innerHTML).not.toContain("<script");
    expect(content!.innerHTML).not.toContain("onerror");
  });

  it("preserves <password> masking marker without being stripped by DOMPurify", async () => {
    element.parts = [
      { kind: "text", text: 'fill textbox "Password" <password>' },
    ];
    await element.updateComplete;
    const content = element.querySelector('[data-part-idx="0"]');
    expect(content!.textContent).toContain('fill textbox "Password" <password>');
  });
});

describe("compaction row (009)", () => {
  let element: AgentMessageView;

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  const CASES: Array<{ status: "running" | "done" | "cancelled" | "failed"; phrase: string }> = [
    { status: "running", phrase: "Agent compacts its context · running" },
    { status: "done", phrase: "Agent compacts its context" },
    { status: "cancelled", phrase: "Agent compacts its context · cancelled" },
    { status: "failed", phrase: "Agent compacts its context · failed" },
  ];

  for (const { status, phrase } of CASES) {
    it(`renders the ${status} compaction row with the right phrase and no colour of its own (no host agent name)`, async () => {
      element.parts = [{ kind: "compaction", compaction: { status } }];
      await element.updateComplete;

      const row = element.querySelector(".tool-step.compaction-step");
      expect(row).not.toBeNull();
      expect(row!.getAttribute("data-compaction-status")).toBe(status);
      expect(row!.querySelector(".tool-step-phrase")!.textContent).toBe(phrase);
      expect(row!.hasAttribute("style")).toBe(false);
      expect((row as HTMLElement).style.color).toBe("");
    });
  }

  it("uses the host's agentShortName in the compaction phrase, same as a tool row", async () => {
    element.agentShortName = "Whiskers";
    element.parts = [{ kind: "compaction", compaction: { status: "running" } }];
    await element.updateComplete;

    const row = element.querySelector(".tool-step.compaction-step");
    expect(row!.querySelector(".tool-step-phrase")!.textContent).toBe(
      "Whiskers compacts its context · running",
    );
  });

  it("a compaction part renders alongside a tool part in order", async () => {
    element.parts = [
      { kind: "text", html: "<p>Before</p>" },
      {
        kind: "tool",
        audit: { name: "add_to_cart", input: {}, outcomeSummary: "Added 2 cans.", ts: Date.now() },
      },
      { kind: "compaction", compaction: { status: "done" } },
    ];
    await element.updateComplete;

    const container = element.querySelector(".message-container");
    expect(container).not.toBeNull();
    const children = Array.from(container!.children);
    const partClasses = children
      .map((child) => {
        if (child.classList.contains("content")) return "content";
        if (child.classList.contains("compaction-step")) return "compaction-step";
        if (child.classList.contains("tool-step")) return "tool-step";
        return "";
      })
      .filter((cls) => cls !== "");

    expect(partClasses).toEqual(["content", "tool-step", "compaction-step"]);
  });
});

describe("compaction row detail (105/004)", () => {
  let element: AgentMessageView;

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("renders the compaction card with 2 lines, no prose and no heading, when status is done and stats are present", async () => {
    element.parts = [
      {
        kind: "compaction",
        compaction: {
          status: "done",
          stats: {
            tokensBefore: 96400,
            tokensAfter: 7180,
            messagesBefore: 82,
            messagesAfter: 36,
            toolCallsRedacted: 12,
            durationMs: 1834,
          },
        },
      },
    ];
    await element.updateComplete;

    const card = element.querySelector(".compaction-card");
    expect(card).not.toBeNull();
    expect(element.querySelector(".tool-step.compaction-step")).toBeNull();
    expect(card!.querySelector(".compaction-card-header")).toBeNull();
    expect(card!.querySelector(".compaction-card-heading")).toBeNull();
    expect(card!.querySelector(".compaction-card-body")).toBeNull();
    expect(card!.querySelector(".compaction-card-line1")!.textContent).toBe("Compaction done in 1,834 ms");
    expect(card!.querySelector(".compaction-card-line2")!.textContent).toContain(
      "82 messages → 36 messages, 96,400 tokens → 7,180 tokens, 12 tool calls redacted",
    );
    // No heading, no prose sentence — the whole point of the requirement change.
    expect(card!.textContent).not.toContain("Conversation compacted");
    expect(card!.textContent).not.toContain("summarised into");
    expect(card!.textContent).not.toContain("agent keeps the thread");
  });

  it("rounds fractional token counts and durations before display", async () => {
    element.parts = [
      {
        kind: "compaction",
        compaction: {
          status: "done",
          stats: {
            tokensBefore: 17287.05,
            tokensAfter: 3592.6,
            messagesBefore: 46,
            messagesAfter: 10,
            toolCallsRedacted: 3,
            durationMs: 1833.7,
          },
        },
      },
    ];
    await element.updateComplete;

    const card = element.querySelector(".compaction-card")!;
    expect(card.querySelector(".compaction-card-line1")!.textContent).toBe("Compaction done in 1,834 ms");
    const line2 = card.querySelector(".compaction-card-line2")!.textContent;
    expect(line2).toContain("17,287 tokens → 3,593 tokens");
    expect(line2).not.toContain(".");
  });

  it("pluralises singular counts correctly (1 message, 1 tool call)", async () => {
    element.parts = [
      {
        kind: "compaction",
        compaction: {
          status: "done",
          stats: {
            tokensBefore: 500,
            tokensAfter: 100,
            messagesBefore: 1,
            messagesAfter: 1,
            toolCallsRedacted: 1,
            durationMs: 200,
          },
        },
      },
    ];
    await element.updateComplete;

    const line2 = element.querySelector(".compaction-card-line2")!.textContent;
    expect(line2).toContain("1 message → 1 message");
    expect(line2).toContain("1 tool call redacted");
    expect(line2).not.toContain("1 messages");
    expect(line2).not.toContain("1 tool calls");
  });

  it("renders 0 tool calls redacted as plural", async () => {
    element.parts = [
      {
        kind: "compaction",
        compaction: {
          status: "done",
          stats: {
            tokensBefore: 500,
            tokensAfter: 100,
            messagesBefore: 4,
            messagesAfter: 2,
            toolCallsRedacted: 0,
            durationMs: 150,
          },
        },
      },
    ];
    await element.updateComplete;

    expect(element.querySelector(".compaction-card-line2")!.textContent).toContain("0 tool calls redacted");
  });

  it("renders the single-line row, not the card, when status is done but stats are missing", async () => {
    element.parts = [{ kind: "compaction", compaction: { status: "done" } }];
    await element.updateComplete;

    expect(element.querySelector(".compaction-card")).toBeNull();
    const row = element.querySelector(".tool-step.compaction-step");
    expect(row).not.toBeNull();
    expect(row!.getAttribute("data-compaction-status")).toBe("done");
  });

  it("applies theme tokens for the compaction card's borders, background, and text", async () => {
    element.parts = [
      {
        kind: "compaction",
        compaction: {
          status: "done",
          stats: {
            tokensBefore: 500,
            tokensAfter: 100,
            messagesBefore: 4,
            messagesAfter: 2,
            toolCallsRedacted: 1,
            durationMs: 150,
          },
        },
      },
    ];
    await element.updateComplete;

    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("var(--wa-border-color");
    expect(css).toContain("var(--wa-background-color-300");
    expect(css).toContain("var(--wa-text-color");
    expect(css).toContain("var(--wa-label-color");
  });
});

describe("custom tool renderer", () => {
  let element: AgentMessageView;

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("custom renderer HTML replaces the friendly phrase", async () => {
    element.toolRenderers = new Map([
      ["add_to_cart", (i: Record<string, unknown>) => `Added <b>${String(i.qty)}</b>`],
    ]);
    element.parts = [
      {
        kind: "tool",
        audit: {
          name: "add_to_cart",
          input: { qty: 2 },
          outcomeSummary: "Added 2 cans.",
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.innerHTML).toContain("<b>2</b>");
    expect(phrase.textContent).not.toContain("Agent used the tool");
  });

  it("falls back to 062a phrase when no renderer is registered", async () => {
    // toolRenderers unset
    element.parts = [
      {
        kind: "tool",
        audit: {
          name: "add_to_cart",
          input: {},
          outcomeSummary: "Added 2 cans.",
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.textContent).toBe("Agent used the tool add_to_cart");
  });

  it("does not invoke renderer for an in-progress step", async () => {
    element.toolRenderers = new Map([
      ["add_to_cart", () => "should <b>not</b> appear"],
    ]);
    element.agentShortName = "Agent";
    element.parts = [
      {
        kind: "tool",
        audit: {
          name: "add_to_cart",
          input: {},
          outcomeSummary: "",
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.textContent).toBe("Agent is using add_to_cart…");
    expect(phrase.innerHTML).not.toContain("<b>");
  });

  it("renderer output is sanitized (script/div/attr stripped)", async () => {
    element.toolRenderers = new Map([
      ["bad_tool", () => '<div>x</div><script>bad()</script><b onclick="y()">ok</b>'],
    ]);
    element.parts = [
      {
        kind: "tool",
        audit: {
          name: "bad_tool",
          input: {},
          outcomeSummary: "bad stuff",
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.innerHTML).toContain("<b>ok</b>");
    expect(phrase.textContent).toContain("x");
    expect(phrase.innerHTML).not.toContain("<div");
    expect(phrase.innerHTML).not.toContain("<script");
    expect(phrase.innerHTML).not.toContain("onclick");
  });

  it("empty sanitized renderer output falls back to the phrase", async () => {
    element.toolRenderers = new Map([
      ["empty_tool", () => "<div></div>"],
    ]);
    element.parts = [
      {
        kind: "tool",
        audit: {
          name: "empty_tool",
          input: {},
          outcomeSummary: "nothing",
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.textContent).toBe("Agent used the tool empty_tool");
  });

  // 002: a saved result shows its path, wraps fully, and never overrides custom HTML.
  const savedBlock = (id: string) =>
    `<saved-output path="/tmp/tool-results/${id}.txt" chars="48210">\nOutput too large (48,210 characters). Full output saved to /tmp/tool-results/${id}.txt.`;

  it("custom renderer wins over the saved suffix and wrapping", async () => {
    element.toolRenderers = new Map([
      ["add_to_cart", (i: Record<string, unknown>) => `Added <b>${String(i.qty)}</b>`],
    ]);
    element.parts = [
      {
        kind: "tool",
        audit: { name: "add_to_cart", input: { qty: 2 }, outcomeSummary: savedBlock("call_9"), ts: Date.now() },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.innerHTML).toContain("<b>2</b>");
    expect(phrase.textContent).not.toContain("full output saved");
    expect(phrase.classList.contains("saved-output-phrase")).toBe(false);
  });

  it("without a renderer the saved path is shown and the phrase wraps", async () => {
    element.parts = [
      {
        kind: "tool",
        audit: { name: "add_to_cart", input: {}, outcomeSummary: savedBlock("call_9"), ts: Date.now() },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.textContent).toContain("full output saved to /tmp/tool-results/call_9.txt");
    expect(phrase.classList.contains("saved-output-phrase")).toBe(true);
  });

  it("empty renderer output falls back to the saved phrase with wrapping", async () => {
    element.toolRenderers = new Map([["empty_tool", () => "<div></div>"]]);
    element.parts = [
      {
        kind: "tool",
        audit: { name: "empty_tool", input: {}, outcomeSummary: savedBlock("call_10"), ts: Date.now() },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.textContent).toContain("full output saved to /tmp/tool-results/call_10.txt");
    expect(phrase.classList.contains("saved-output-phrase")).toBe(true);
  });

  it("renderer that throws falls back to the phrase without crashing", async () => {
    element.toolRenderers = new Map([
      ["throw_tool", () => { throw new Error("boom"); }],
    ]);
    element.parts = [
      {
        kind: "tool",
        audit: {
          name: "throw_tool",
          input: {},
          outcomeSummary: "should fallback",
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    const phrase = element.querySelector(".tool-step-phrase")!;
    expect(phrase.textContent).toBe("Agent used the tool throw_tool");
  });

  it("renders one attachment chip per entry in promptMeta for user role", async () => {
    element.role = "user";
    element.promptMeta = {
      attachmentChips: [{ providerId: "image", label: "1 image" }],
    };
    await element.updateComplete;

    const chips = element.querySelectorAll(".attachment-chips .pointed-chip");
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toBe("1 image");
    expect(chips[0].getAttribute("data-attachment-provider")).toBe("image");
  });

  it("renders no chip container when promptMeta is absent or carries no chips", async () => {
    element.role = "user";
    element.promptMeta = undefined;
    await element.updateComplete;

    expect(element.querySelector(".attachment-chips")).toBeNull();
  });

  it("renders no attachment chips on an assistant message", async () => {
    element.role = "assistant";
    element.promptMeta = {
      attachmentChips: [{ providerId: "image", label: "1 image" }],
    };
    await element.updateComplete;

    expect(element.querySelector(".attachment-chips")).toBeNull();
  });
});

describe("sanitizeToolHtml", () => {
  it("strips block tags (<div>) keeping text", () => {
    expect(sanitizeToolHtml("<div>Hi</div>")).toBe("Hi");
  });

  it("strips <script> tags", () => {
    const out = sanitizeToolHtml("<script>alert(1)</script>x");
    expect(out).not.toContain("<script");
    expect(out).toBe("x");
  });

  it("strips <img> and onerror handlers", () => {
    const out = sanitizeToolHtml('<img src=x onerror=alert(1)>ok');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<img");
    expect(out).toBe("ok");
  });

  it("keeps the four allowed inline tags (<i>, <b>, <em>, <strong>)", () => {
    const out = sanitizeToolHtml("<i>a</i> <b>b</b> <em>c</em> <strong>d</strong>");
    expect(out).toBe("<i>a</i> <b>b</b> <em>c</em> <strong>d</strong>");
  });

  it("strips attributes from allowed tags (e.g. onclick from <b>)", () => {
    const out = sanitizeToolHtml('<b onclick="x()">hi</b>');
    expect(out).toBe("<b>hi</b>");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeToolHtml("")).toBe("");
  });
});

describe("image strip rendering", () => {
  let element: AgentMessageView;

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("renders .image-strip with lazy thumbnails when images are set", async () => {
    element.images = [
      { dataUrl: "data:image/png;base64,AAA=", mediaType: "image/png" },
    ];
    await element.updateComplete;
    const strip = element.querySelector(".image-strip");
    expect(strip).not.toBeNull();
    const img = strip!.querySelector("img.msg-thumbnail") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.src).toContain("data:image/png");
  });

  it("hides .image-strip when images array is empty", async () => {
    element.images = [];
    await element.updateComplete;
    const strip = element.querySelector(".image-strip");
    expect(strip).toBeNull();
  });

  it("clicking a user-attached thumbnail dispatches wa-image-open with the dataUrl", async () => {
    element.images = [
      { dataUrl: "data:image/jpeg;base64,BBB=", mediaType: "image/jpeg" },
    ];
    await element.updateComplete;
    const seen: { src: string; target: EventTarget | undefined }[] = [];
    element.addEventListener("wa-image-open", (e) =>
      seen.push({ src: (e as CustomEvent).detail.src, target: e.composedPath()[0] }),
    );
    const thumb = element.querySelector(".msg-thumbnail") as HTMLElement;
    thumb.click();
    expect(seen).toHaveLength(1);
    expect(seen[0].src).toContain("data:image/jpeg");
    expect(seen[0].target).toBe(thumb);
    expect(document.querySelector(".img-lightbox")).toBeNull();
  });
});

describe("tool image strip rendering", () => {
  let element: AgentMessageView;
  const IMG = { dataUrl: "data:image/png;base64,AAA=", mediaType: "image/png" };

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("renders a thumbnail strip under the tool step when the audit has images", async () => {
    element.parts = [
      { kind: "tool", audit: { name: "page_screenshot", input: {}, outcomeSummary: "Screenshot captured.", images: [IMG], ts: Date.now() } },
    ];
    await element.updateComplete;
    expect(element.querySelector(".tool-image-strip")).not.toBeNull();
    const btn = element.querySelector("button.tool-thumb") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect((btn.querySelector("img") as HTMLImageElement).src).toContain(IMG.dataUrl);
    expect(btn.getAttribute("aria-label")).toBe(
      `Open image 1 from ${element.querySelector(".tool-step-phrase")!.textContent}`,
    );
  });

  it("renders no strip when the tool part has no images", async () => {
    element.parts = [
      { kind: "tool", audit: { name: "page_screenshot", input: {}, outcomeSummary: "Screenshot captured.", ts: Date.now() } },
    ];
    await element.updateComplete;
    expect(element.querySelector(".tool-image-strip")).toBeNull();
  });

  it("a running step (empty outcomeSummary, no images) shows no strip", async () => {
    element.parts = [{ kind: "tool", audit: { name: "page_screenshot", input: {}, outcomeSummary: "", ts: Date.now() } }];
    await element.updateComplete;
    expect(element.querySelector(".tool-image-strip")).toBeNull();
    expect(element.querySelector(".tool-step-phrase")!.textContent).toContain("is using");
  });

  it("an image-only tool part shows the strip and the finished phrase", async () => {
    element.parts = [{ kind: "tool", audit: { name: "mcp_render", input: {}, outcomeSummary: "", images: [IMG], ts: Date.now() } }];
    await element.updateComplete;
    expect(element.querySelector(".tool-image-strip")).not.toBeNull();
    const text = element.querySelector(".tool-step-phrase")!.textContent;
    expect(text).not.toContain("is using");
    expect(text).toContain("mcp_render");
  });

  it("clicking a thumbnail dispatches wa-image-open with the dataUrl and the button as target", async () => {
    element.parts = [
      { kind: "tool", audit: { name: "page_screenshot", input: {}, outcomeSummary: "Screenshot captured.", images: [IMG], ts: Date.now() } },
    ];
    await element.updateComplete;
    const seen: { src: string; target: EventTarget | undefined }[] = [];
    document.body.addEventListener(
      "wa-image-open",
      (e) => seen.push({ src: (e as CustomEvent).detail.src, target: e.composedPath()[0] }),
      { once: true },
    );
    const btn = element.querySelector("button.tool-thumb") as HTMLButtonElement;
    btn.click();
    expect(seen).toHaveLength(1);
    expect(seen[0].src).toBe(IMG.dataUrl);
    expect(seen[0].target).toBe(btn);
  });

  it("a second image gets aria-label 'Open image 2 …'", async () => {
    element.parts = [
      { kind: "tool", audit: { name: "page_screenshot", input: {}, outcomeSummary: "Screenshot captured.", images: [IMG, IMG], ts: Date.now() } },
    ];
    await element.updateComplete;
    const btns = element.querySelectorAll("button.tool-thumb");
    expect(btns).toHaveLength(2);
    expect(btns[1].getAttribute("aria-label")!.startsWith("Open image 2")).toBe(true);
  });
});

describe("user bubble CSS guard", () => {
  let element: AgentMessageView;

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("user bubble CSS hugs content and right-aligns", async () => {
    element.role = "user";
    element.text = "Hi";
    await element.updateComplete;

    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("width: fit-content");
    expect(css).toContain("max-width: 90%");
    expect(css).toContain("margin-left: auto");
    expect(css).toContain("text-align: left");
    expect(css).not.toContain("margin-left: 0");
  });

  it("uses Public Sans as the message-container font-family", async () => {
    await element.updateComplete;
    const style = element.querySelector("style");
    expect(style?.textContent).toContain('font-family: var(--wa-font-family, "Public Sans"');
  });

  it("applies compact body typography tokens to the message container", async () => {
    element.role = "assistant";
    element.text = "Hi";
    await element.updateComplete;

    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("font-size: var(--wa-font-size-m");
    expect(css).toContain("line-height: var(--wa-line-height-m");
    expect(css).toContain("padding: var(--wa-padding-m");
  });

  it("renders compact tool-step rows via meta/space tokens", async () => {
    element.parts = [
      {
        kind: "tool",
        audit: {
          name: "add_to_cart",
          input: {},
          outcomeSummary: "Added 2 cans.",
          ts: Date.now(),
        },
      },
    ];
    await element.updateComplete;

    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("font-size: var(--wa-font-size-s");
    expect(css).toContain("gap: var(--wa-padding-s");
  });
});

describe("assistant surface + table CSS (005)", () => {
  let element: AgentMessageView;
  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });
  afterEach(() => element.remove());

  it("assistant block blends into the panel (no card bg/border/radius)", async () => {
    element.role = "assistant";
    element.text = "Hi";
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("background-color: transparent");
    expect(css).toContain("border: none");
    expect(css).toContain("border-radius: 0;");                 // trailing ; ≠ base 0.75rem
    expect(css).toContain("padding: var(--wa-padding-m, 0.5rem) 0");  // vertical only
    expect(css).not.toContain("border: 1px solid #ececec");     // card border gone
  });

  it("defines faint table cell/row borders for legibility", async () => {
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain(".content table");
    expect(css).toContain("border-collapse: collapse");
    expect(css).toContain("border: 1px solid var(--wa-border-color, #e0e0e0)");
    expect(css).toContain("background: var(--wa-background-color-700, #f1f3f4)");   // th header tint
    expect(css).toContain("tbody tr:nth-child(even) td");   // zebra rows
  });

  // Fix — review round 1 (131/003, Stage B item 6): the inherited
  // `.content { word-break: break-word }` behaved like `overflow-wrap: anywhere`,
  // letting the browser's auto table layout shrink a narrow column (e.g.
  // "Level") to a one-character min-content width and break words like "log"
  // mid-letter. `th`/`td` now reset to the standard wrap pair so a cell only
  // breaks at a space.
  it("keeps table cell words whole — word-break normal, overflow-wrap break-word (131/003 review fix)", async () => {
    element.text = "| Level | Message |\n| --- | --- |\n| log | checkout page ready |";
    await element.updateComplete;
    const th = element.querySelector(".content th")!;
    const td = element.querySelector(".content td")!;
    for (const cell of [th, td]) {
      const cs = getComputedStyle(cell);
      expect(cs.wordBreak).toBe("normal");
      expect(cs.overflowWrap).toBe("break-word");
    }
  });

  it("themes message surfaces from theme tokens (009)", async () => {
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("background-color: var(--wa-action-color-info, #e0dbff)");
    expect(css).toContain("color: var(--wa-action-text-color-info, #23005c)");
    expect(css).toContain("color: var(--wa-text-color, #202124)");
    expect(css).toContain("background: var(--wa-background-color-300, #f0f1f3)");
    // task 017: --wa-label-color alone measured 4.44:1 on wa2-light (below
    // the 4.5:1 AA floor) — blended toward --wa-text-color for a safe margin.
    expect(css).toContain("color-mix(in oklab, var(--wa-text-color, #202124) 60%, var(--wa-label-color, #80868b) 40%)");
    expect(css).toContain("background-color: transparent");
  });

  it("renders a real <table> with cells from markdown table text", async () => {
    element.text = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    await element.updateComplete;
    const content = element.querySelector(".content")!;
    expect(content.innerHTML).toContain("<table");
    expect(content.innerHTML).toContain("<th");
    expect(content.innerHTML).toContain("<td");
  });

  it("styles message anchors using theme link tokens", async () => {
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("var(--wa-link-color, hsl(216deg 86% 47%))");
    expect(css).toContain("var(--wa-link-color-visited, hsl(271deg 100% 46%))");
    expect(css).toContain("var(--wa-link-color-hover, hsl(216deg 86% 52%))");
    expect(css).toContain("var(--wa-link-color-active, hsl(271deg 100% 56%))");
  });
});

// Fix — review round 1 (131/002, Stage B item 6b): a link inside the user
// bubble measured 1.21:1 against rgb(131,82,255) using the generic
// --wa-link-color* tokens. Reused the bubble's own text token instead.
describe("user bubble link contrast (131/002 review fix)", () => {
  let element: AgentMessageView;
  let themeStyle: HTMLStyleElement;

  beforeEach(() => {
    themeStyle = document.createElement("style");
    themeStyle.textContent = readFileSync(
      path.resolve(__dirname, "../../src/themes/wa-tokens.css"),
      "utf-8",
    );
    document.head.appendChild(themeStyle);
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    themeStyle.remove();
  });

  it("renders a link in the user bubble underlined, coloured from the bubble's own text token", async () => {
    element.role = "user";
    element.text = "Contact [qa@example.com](mailto:qa@example.com)";
    await element.updateComplete;

    const anchor = element.querySelector(".content a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("mailto:qa@example.com");

    // jsdom does not resolve var() into a longhand colour, so the computed
    // value is the literal declaration — assert it names the bubble's own
    // text token (proven at >=4.5:1 below in every theme), not the generic
    // --wa-link-color* tokens the rejection measured at 1.21:1 here.
    const cs = getComputedStyle(anchor!);
    expect(cs.color).toBe("var(--wa-action-text-color-info, #23005c)");
    expect(cs.textDecoration).toContain("underline");
  });

  for (const theme of ["wa1-dark", "wa2-dark", "wa2-light"] as const) {
    it(`the user-bubble link colour meets WCAG AA 4.5:1 against the bubble background in ${theme}`, () => {
      const probe = document.createElement("div");
      probe.setAttribute("data-theme", theme);
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const text = cs.getPropertyValue("--wa-action-text-color-info").trim();
      const bg = cs.getPropertyValue("--wa-action-color-info").trim();
      probe.remove();

      const ratio = contrastRatio(text, bg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// Task 003410-002: the block cache keeps a block's rendered node stable across
// re-renders instead of rebuilding it (renderBlocksToElement / replaceChildren),
// which previously destroyed in-progress form input on every message update.
describe("block node identity and reuse (003410-002)", () => {
  let element: AgentMessageView;

  const formBlock = (): FormBlock => ({
    type: "form",
    id: "f1",
    fields: [{ kind: "text", name: "comment", label: "Comment" }],
  });

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("keeps the same agent-form-block node and its typed value when a new blocks array carries the same block object", async () => {
    const block = formBlock();
    element.blocks = [block];
    await element.updateComplete;

    const form = element.querySelector("agent-form-block")!;
    const textHost = form.querySelector('wa-text-input[data-name="comment"]')!;
    const input = textHost.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = "typed but not sent";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // A new array, same block object — the shape chat-panel produces on every
    // render (`.blocks=${msg.blocks || []}`).
    element.blocks = [block];
    await element.updateComplete;

    const formAfter = element.querySelector("agent-form-block");
    expect(formAfter).toBe(form);
    expect(formAfter!.isConnected).toBe(true);
    const inputAfter = formAfter!.querySelector('wa-text-input[data-name="comment"] input') as HTMLInputElement;
    expect(inputAfter.value).toBe("typed but not sent");
  });

  it("keeps the form node and its typed value when it becomes disabled (updates the property, not the node)", async () => {
    const block = formBlock();
    element.blocks = [block];
    await element.updateComplete;

    const form = element.querySelector("agent-form-block")! as HTMLElement & {
      disabled: boolean;
      updateComplete: Promise<boolean>;
    };
    const input = form.querySelector('wa-text-input[data-name="comment"] input') as HTMLInputElement;
    input.value = "typed but not sent";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    element.disabled = true;
    await element.updateComplete;
    await form.updateComplete;

    expect(element.querySelector("agent-form-block")).toBe(form);
    expect(form.disabled).toBe(true);
    const inputAfter = form.querySelector('wa-text-input[data-name="comment"] input') as HTMLInputElement;
    expect(inputAfter.value).toBe("typed but not sent");
  });

  it("rebuilds the node when the block object identity changes", async () => {
    const options = [{ label: "A", prompt: "a" }];
    element.blocks = [{ type: "buttons", options }];
    await element.updateComplete;
    const node1 = element.querySelector(".blocks-container")!.firstElementChild;

    element.blocks = [{ type: "buttons", options }];
    await element.updateComplete;
    const node2 = element.querySelector(".blocks-container")!.firstElementChild;

    expect(node2).not.toBeNull();
    expect(node2).not.toBe(node1);
  });

  it("rebuilds the node when the registry changes", async () => {
    const options = [{ label: "A", prompt: "a" }];
    const block: RenderableBlock = { type: "buttons", options };
    element.blocks = [block];
    await element.updateComplete;
    const node1 = element.querySelector(".blocks-container")!.firstElementChild;

    element.registry = new BlockRendererRegistry([generativeUiRenderer]);
    await element.updateComplete;
    const node2 = element.querySelector(".blocks-container")!.firstElementChild;

    expect(node2).not.toBeNull();
    expect(node2).not.toBe(node1);
  });

  it("rebuilds the node when the data source changes", async () => {
    const options = [{ label: "A", prompt: "a" }];
    const block: RenderableBlock = { type: "buttons", options };
    element.blocks = [block];
    await element.updateComplete;
    const node1 = element.querySelector(".blocks-container")!.firstElementChild;

    element.dataSource = { query: () => Promise.resolve([]) } as unknown as AgentMessageView["dataSource"];
    await element.updateComplete;
    const node2 = element.querySelector(".blocks-container")!.firstElementChild;

    expect(node2).not.toBeNull();
    expect(node2).not.toBe(node1);
  });

  it("rebuilds a node with no disabled property when disabled changes", async () => {
    const statelessRegistry = new BlockRendererRegistry([
      {
        types: ["stateless-block"],
        render() {
          const div = document.createElement("div");
          div.className = "stateless-block-node";
          return div;
        },
      },
    ]);
    element.registry = statelessRegistry;
    element.blocks = [{ type: "stateless-block" }];
    await element.updateComplete;
    const node1 = element.querySelector(".blocks-container")!.firstElementChild;
    expect(node1).not.toBeNull();
    expect("disabled" in node1!).toBe(false);

    element.disabled = true;
    await element.updateComplete;
    const node2 = element.querySelector(".blocks-container")!.firstElementChild;

    expect(node2).not.toBeNull();
    expect(node2).not.toBe(node1);
  });

  it("keeps the same .content element identity across a re-render with unchanged text", async () => {
    element.parts = [{ kind: "text", html: "<p>Hello</p>" }];
    await element.updateComplete;
    const contentBefore = element.querySelector(".content");

    // An unrelated property change forces a whole-template re-render; the
    // text part's html string is unchanged so its DOM should not be rebuilt.
    element.disabled = true;
    await element.updateComplete;

    const contentAfter = element.querySelector(".content");
    expect(contentAfter).toBe(contentBefore);
    expect(stripLitMarker(contentAfter!.innerHTML)).toBe("<p>Hello</p>");
  });
});
