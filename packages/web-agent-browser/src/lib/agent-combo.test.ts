import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountAgentCombo } from "./agent-combo";
import type { BrandAgent } from "./types";

const agents: BrandAgent[] = [
  { id: "chromagent", displayName: "Chromagent", description: "Your Personal Assistant", instructions: "I", tools: "*", skills: "*" },
  { id: "tesagent", displayName: "tesagent", description: "Tests websites", instructions: "I", tools: "*", skills: "*" },
];

describe("mountAgentCombo", () => {
  let row: HTMLDivElement;
  let button: HTMLButtonElement;
  let list: HTMLUListElement;
  let onSelect: ReturnType<typeof vi.fn>;

  function key(k: string) {
    button.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  }
  function pointerClick(el: Element) {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  }

  beforeEach(() => {
    row = document.createElement("div");
    row.innerHTML = `
      <button id="agent-combo" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="agent-list">
        <span class="name"></span><span class="description"></span><span class="expand" aria-hidden="true"></span>
      </button>
      <ul id="agent-list" role="listbox" hidden></ul>
      <p id="outside">outside</p>`;
    document.body.appendChild(row);
    button = row.querySelector("#agent-combo")!;
    list = row.querySelector("#agent-list")!;
    onSelect = vi.fn();
    const combo = mountAgentCombo({ button, list, agents, currentId: () => "chromagent", onSelect });
    combo.paint(agents[0]);
  });

  afterEach(() => row.remove());

  it("paints the name and description and marks the current option selected", () => {
    expect(button.querySelector(".name")!.textContent).toBe("Chromagent");
    expect(button.querySelector(".description")!.textContent).toBe("Your Personal Assistant");
    const options = Array.from(list.querySelectorAll("[role='option']"));
    expect(options.map((o) => o.id)).toEqual(["agent-option-chromagent", "agent-option-tesagent"]);
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(options.map((o) => o.querySelector(".name")!.textContent)).toEqual(["Chromagent", "tesagent"]);
    expect(options.every((o) => o.querySelector("svg.check")?.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it.each(["Enter", " ", "ArrowDown"])("%j opens a closed list and highlights the current agent", (k) => {
    key(k);
    expect(list.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-activedescendant")).toBe("agent-option-chromagent");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ArrowDown and ArrowUp move the highlight and stop at the ends", () => {
    key("ArrowDown");
    key("ArrowDown");
    expect(button.getAttribute("aria-activedescendant")).toBe("agent-option-tesagent");
    expect(list.querySelector("#agent-option-tesagent")!.classList.contains("highlighted")).toBe(true);
    key("ArrowDown");
    expect(button.getAttribute("aria-activedescendant")).toBe("agent-option-tesagent");
    key("ArrowUp");
    key("ArrowUp");
    expect(button.getAttribute("aria-activedescendant")).toBe("agent-option-chromagent");
  });

  it("Enter selects the highlighted agent and closes the list", () => {
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(list.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-activedescendant")).toBe(false);
    expect(onSelect).toHaveBeenCalledWith("tesagent");
  });

  it("Escape closes with no change and puts focus on the button", () => {
    key("ArrowDown");
    key("ArrowDown");
    key("Escape");
    expect(list.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("a pointer click toggles the list; a keyboard-made click (detail 0) does not", () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(list.hidden).toBe(true);
    pointerClick(button);
    expect(list.hidden).toBe(false);
    pointerClick(button);
    expect(list.hidden).toBe(true);
  });

  it("a click on an option selects it and closes the list", () => {
    pointerClick(button);
    pointerClick(list.querySelector("#agent-option-tesagent")!);
    expect(list.hidden).toBe(true);
    expect(onSelect).toHaveBeenCalledWith("tesagent");
  });

  it("a click outside closes with no change", () => {
    pointerClick(button);
    pointerClick(row.querySelector("#outside")!);
    expect(list.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
