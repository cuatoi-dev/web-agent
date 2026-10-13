import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentMessageView } from "../../src/chat-ui/message-view.js";
import { html, render, live, repeat } from "../../src/ui/template.js";

if (!customElements.get("agent-message-view")) {
  customElements.define("agent-message-view", AgentMessageView);
}

describe("AgentMessageView Lit-1 render compatibility", () => {
  let element: AgentMessageView;

  beforeEach(() => {
    element = document.createElement("agent-message-view");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("renders a markdown text part and a block part under Lit-1 environment", async () => {
    element.parts = [
      { kind: "text", text: "**prose text** with _formatting_" },
      {
        kind: "block",
        block: {
          type: "buttons",
          options: [{ label: "Action Button", prompt: "action" }]
        }
      }
    ];

    await element.updateComplete;

    const textEl = element.querySelector('[data-part-idx="0"]');
    expect(textEl).not.toBeNull();
    expect(textEl!.classList.contains("content")).toBe(true);
    expect(textEl!.innerHTML).toContain("<strong>prose text</strong>");
    expect(textEl!.innerHTML).toContain("<em>formatting</em>");

    const blockEl = element.querySelector('[data-part-idx="1"]');
    expect(blockEl).not.toBeNull();
    expect(blockEl!.classList.contains("blocks-container")).toBe(true);
    expect(blockEl!.children.length).toBeGreaterThan(0);

    const buttonEl = blockEl!.querySelector("button");
    expect(buttonEl).not.toBeNull();
    expect(buttonEl!.textContent).toContain("Action Button");
  });
});

describe("template.ts live and repeat exports under Lit-1", () => {
  it("live re-syncs a property to the given value even when the DOM value has diverged since the last render", () => {
    const div = document.createElement("div");
    const template = (v: string) => html`<input .value=${live(v)} />`;
    render(template("hello"), div);
    const input = div.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("hello");

    input.value = "typed by user";
    render(template("hello"), div);
    expect(input.value).toBe("hello");
  });

  it("repeat keeps each keyed DOM node's identity across a reorder", () => {
    const div = document.createElement("div");
    const list = (items: string[]) =>
      html`<ul>${repeat(items, (item) => item, (item) => html`<li>${item}</li>`)}</ul>`;

    render(list(["a", "b", "c"]), div);
    const [liA, liB] = Array.from(div.querySelectorAll("li"));

    render(list(["c", "a", "b"]), div);
    const reordered = Array.from(div.querySelectorAll("li"));
    expect(reordered.map((li) => li.textContent)).toEqual(["c", "a", "b"]);
    expect(reordered[1]).toBe(liA);
    expect(reordered[2]).toBe(liB);
  });
});
