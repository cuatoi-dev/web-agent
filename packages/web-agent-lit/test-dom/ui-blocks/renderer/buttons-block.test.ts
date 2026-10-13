import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentButtonsBlock } from "../../../src/ui-blocks/renderer/buttons-block.js";

if (!customElements.get("agent-buttons-block")) {
  customElements.define("agent-buttons-block", AgentButtonsBlock);
}

describe("AgentButtonsBlock", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders options and emits block-button event on click", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = {
      type: "buttons",
      options: [
        { label: "Yes", prompt: "User selected Yes" },
        { label: "No", prompt: "User selected No" },
      ],
    };
    document.body.appendChild(el);
    await el.updateComplete;

    const buttons = el.renderRoot.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent?.trim()).toBe("Yes");
    expect(buttons[1].textContent?.trim()).toBe("No");

    const handler = vi.fn<[e: CustomEvent<{ prompt: string }>], void>();
    el.addEventListener("block-button", handler as EventListener);

    (buttons[0] as HTMLElement).click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({
      prompt: "User selected Yes",
    });
  });

  it("does not emit block-button event when disabled", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = {
      type: "buttons",
      options: [{ label: "Yes", prompt: "User selected Yes" }],
    };
    el.disabled = true;
    document.body.appendChild(el);
    await el.updateComplete;

    const button = el.renderRoot.querySelector("button") as HTMLButtonElement;
    expect(button?.disabled).toBe(true);

    const handler = vi.fn();
    el.addEventListener("block-button", handler);

    button.click();

    expect(handler).not.toHaveBeenCalled();
  });

  it("injected styles use --wa-* custom property tokens for colours", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = {
      type: "buttons",
      options: [],
    };
    document.body.appendChild(el);
    await el.updateComplete;

    const styleEl = el.querySelector("style");
    expect(styleEl).not.toBeNull();
    expect(document.getElementById("agent-buttons-block-styles")).toBeNull();
    const css = styleEl!.textContent ?? "";
    expect(css).toContain("--wa-border-color");
    expect(css).toContain("--wa-background-color-300");
  });

  it("renders its stylesheet as a child, with nothing in document.head", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = { type: "buttons", options: [] };
    document.body.appendChild(el);
    await el.updateComplete;

    const sheet = el.querySelector("style");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("agent-buttons-block .buttons-container");
    expect(document.getElementById("agent-buttons-block-styles")).toBeNull();
  });

  it("the disabled state wires Material's disabled label and outline properties", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = { type: "buttons", options: [] };
    document.body.appendChild(el);
    await el.updateComplete;

    const css = el.querySelector("style")!.textContent ?? "";
    expect(css).toContain("--md-outlined-button-disabled-label-text-color");
    expect(css).toContain("--md-outlined-button-disabled-label-text-opacity");
    expect(css).toContain("--md-outlined-button-disabled-outline-color");
    expect(css).toContain("--md-outlined-button-disabled-outline-opacity");
  });

  it("the disabled rule does not fade or desaturate the whole block", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = { type: "buttons", options: [] };
    document.body.appendChild(el);
    await el.updateComplete;

    const css = el.querySelector("style")!.textContent ?? "";
    const match = css.match(/\.buttons-container\.disabled\s*{[^}]*}/);
    expect(match).not.toBeNull();
    const block = match![0];
    expect(block).not.toContain("grayscale");
    expect(block).not.toMatch(/opacity\s*:/);
  });

  it("no colour in the stylesheet is a hard-coded literal", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = { type: "buttons", options: [] };
    document.body.appendChild(el);
    await el.updateComplete;

    const css = el.querySelector("style")!.textContent ?? "";
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it("the disabled label colour is derived from --wa-* tokens", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = { type: "buttons", options: [] };
    document.body.appendChild(el);
    await el.updateComplete;

    const css = el.querySelector("style")!.textContent ?? "";
    const match = css.match(/\.buttons-container\.disabled\s*{[^}]*}/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("--wa-text-color");
    expect(match![0]).toContain("--wa-label-color");
  });

  it("the disabled colours fall back to currentColor when the host defines no tokens", async () => {
    const el = document.createElement("agent-buttons-block");
    el.block = { type: "buttons", options: [] };
    document.body.appendChild(el);
    await el.updateComplete;

    const css = el.querySelector("style")!.textContent ?? "";
    expect(css).toContain("var(--wa-text-color, currentColor)");
    expect(css).toContain("var(--wa-label-color, currentColor)");
    expect(css).toContain("var(--wa-background-color-300, currentColor)");
  });
});
