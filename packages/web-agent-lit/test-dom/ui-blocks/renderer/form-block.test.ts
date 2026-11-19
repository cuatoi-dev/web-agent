import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentFormBlock } from "../../../src/ui-blocks/renderer/form-block.js";

if (!customElements.get("agent-form-block")) {
  customElements.define("agent-form-block", AgentFormBlock);
}

describe("AgentFormBlock", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders form fields and collects values on submit", async () => {
    const el = document.createElement("agent-form-block");
    el.block = {
      type: "form",
      id: "form-1",
      title: "Test Form",
      submit_label: "Send It",
      fields: [
        { kind: "text", name: "username", label: "Username", required: true },
        { kind: "number", name: "age", label: "Age", min: 18 },
        { kind: "select", name: "color", label: "Favorite Color", options: ["Red", "Blue"], default: "Blue" },
        { kind: "checkbox", name: "agree", label: "Agree to terms", default: true },
        { kind: "date", name: "birthday", label: "Birthday" },
      ],
    };
    document.body.appendChild(el);
    await el.updateComplete;

    const form = el.renderRoot.querySelector("form");
    expect(form).toBeTruthy();

    const textInput = el.renderRoot.querySelector('wa-text-input[data-name="username"] input') as HTMLInputElement;
    const numberInput = el.renderRoot.querySelector('wa-text-input[data-name="age"] input') as HTMLInputElement;
    const selectInput = el.renderRoot.querySelector('select[data-name="color"]') as HTMLSelectElement;
    const checkboxInput = el.renderRoot.querySelector('wa-checkbox[data-name="agree"] input') as HTMLInputElement;
    const dateInput = el.renderRoot.querySelector('wa-text-input[data-name="birthday"] input') as HTMLInputElement;

    expect(textInput).toBeTruthy();
    expect(numberInput).toBeTruthy();
    expect(selectInput.value).toBe("Blue");
    expect(checkboxInput.checked).toBe(true);

    // Set values and dispatch events
    textInput.value = "alice";
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    numberInput.value = "25";
    numberInput.dispatchEvent(new Event("input", { bubbles: true }));

    selectInput.value = "Red";
    selectInput.dispatchEvent(new Event("change", { bubbles: true }));

    checkboxInput.checked = false;
    checkboxInput.dispatchEvent(new Event("change", { bubbles: true }));

    dateInput.value = "2026-06-24";
    dateInput.dispatchEvent(new Event("input", { bubbles: true }));

    const handler = vi.fn<[e: CustomEvent<{ id: string; values: Record<string, unknown> }>], void>();
    el.addEventListener("block-submit", handler as EventListener);

    // Submit form
    const submitBtn = el.renderRoot.querySelector("wa-button")!.querySelector("button") as HTMLButtonElement;
    expect(submitBtn.textContent?.trim()).toBe("Send It");

    // In jsdom we can dispatch submit on the form
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({
      id: "form-1",
      values: {
        username: "alice",
        age: 25,
        color: "Red",
        agree: false,
        birthday: "2026-06-24",
      },
    });
  });

  it("does not submit form when disabled", async () => {
    const el = document.createElement("agent-form-block");
    el.block = {
      type: "form",
      id: "form-1",
      fields: [{ kind: "text", name: "username", label: "Username" }],
    };
    el.disabled = true;
    document.body.appendChild(el);
    await el.updateComplete;

    const handler = vi.fn();
    el.addEventListener("block-submit", handler);

    const form = el.renderRoot.querySelector("form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("select field is not disabled by default (only the disabled attribute state, not the value, gates interaction)", async () => {
    const el = document.createElement("agent-form-block");
    el.block = {
      type: "form",
      id: "form-1",
      fields: [{ kind: "select", name: "color", label: "Favorite Color", options: ["Red", "Blue"] }],
    };
    document.body.appendChild(el);
    await el.updateComplete;

    const selectInput = el.renderRoot.querySelector('select[data-name="color"]') as HTMLSelectElement;
    expect(selectInput.hasAttribute("disabled")).toBe(false);
    expect(selectInput.disabled).toBe(false);

    // Only the option matching the current value (default: first option) carries
    // the selected attribute — not every option.
    const options = Array.from(selectInput.querySelectorAll("option"));
    expect(options.filter((o) => o.hasAttribute("selected"))).toHaveLength(1);
    expect(options.find((o) => o.hasAttribute("selected"))?.getAttribute("value")).toBe("Red");
  });

  it("select field becomes disabled when the form is disabled", async () => {
    const el = document.createElement("agent-form-block");
    el.block = {
      type: "form",
      id: "form-1",
      fields: [{ kind: "select", name: "color", label: "Favorite Color", options: ["Red", "Blue"] }],
    };
    el.disabled = true;
    document.body.appendChild(el);
    await el.updateComplete;

    const selectInput = el.renderRoot.querySelector('select[data-name="color"]') as HTMLSelectElement;
    expect(selectInput.hasAttribute("disabled")).toBe(true);
    expect(selectInput.disabled).toBe(true);
  });

  it("injected styles use --wa-* custom property tokens for colours", async () => {
    const el = document.createElement("agent-form-block");
    el.block = {
      type: "form",
      id: "form-tok",
      fields: [],
    };
    document.body.appendChild(el);
    await el.updateComplete;

    const styleEl = el.querySelector("style");
    expect(styleEl).not.toBeNull();
    expect(document.getElementById("agent-form-block-styles")).toBeNull();
    const css = styleEl!.textContent ?? "";
    expect(css).toContain("--wa-background-color-300");
    expect(css).toContain("--wa-border-color");
    expect(css).toContain("--wa-elevation-s");
    expect(css).toContain("--wa-action-color-info");
    expect(css).toContain("--wa-label-color");
    expect(css).toContain("--wa-input-border-color");
    expect(css).toContain("--wa-input-background-color");
    expect(css).toContain("--wa-input-text-color");
    // --wa-text-color-disabled was rejected on measurement: it is tuned
    // to sit near-invisible against a component's own
    // disabled fill, not against this form's neutral background.
    expect(css).not.toContain("--wa-text-color-disabled");
    expect(css).toContain("--wa-text-color");
    // cat-store aliases the registry to Material Web, so the submit control
    // there is <md-filled-button>, not a plain <button> — its own disabled
    // token names need an explicit override too.
    expect(css).toContain("md-filled-button[disabled]");
    expect(css).toContain("--md-filled-button-disabled-label-text-color");
    expect(css).toContain("--md-filled-button-disabled-container-opacity");
    // docs-site's vendored Beer CSS fades a disabled checkbox's label span to
    // opacity: 0.5 (1.53:1 measured) — out-specify it explicitly.
    expect(css).toContain("input:disabled + span");
  });

  it("disabled form styles do not apply a blanket opacity fade (form-block contrast fix)", async () => {
    const el = document.createElement("agent-form-block");
    el.block = { type: "form", id: "form-tok", fields: [] };
    document.body.appendChild(el);
    await el.updateComplete;

    const styleEl = el.querySelector("style");
    const css = styleEl!.textContent ?? "";
    expect(css).not.toContain("opacity: 0.6");
    // The disabled button/select colours are chosen explicitly instead —
    // same pattern as buttons-block.ts.
    expect(css).toContain("color-mix(in oklab");
  });

  it("renders its stylesheet as a child, with nothing in document.head", async () => {
    const el = document.createElement("agent-form-block");
    el.block = { type: "form", id: "form-style", fields: [] };
    document.body.appendChild(el);
    await el.updateComplete;

    const sheet = el.querySelector("style");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("agent-form-block .form-container");
    expect(document.getElementById("agent-form-block-styles")).toBeNull();
  });

  // Pins the ordering constraint the eslint fix pass came closest to
  // breaking — the `type`/`min`/`max` mutations must land on the input
  // BEFORE it is placed in the template, or a number field renders as plain
  // text.
  it("a number field's input carries type, min and max after render", async () => {
    const el = document.createElement("agent-form-block");
    el.block = {
      type: "form", id: "f1", fields: [
        { kind: "number", name: "qty", label: "Qty", min: 1, max: 9 },
      ],
    };
    document.body.appendChild(el);
    await el.updateComplete;

    const input = el.renderRoot.querySelector('wa-text-input[data-name="qty"]')?.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    expect(input!.type).toBe("number");
    expect(input!.min).toBe("1");
    expect(input!.max).toBe("9");
  });

  // Pins the `|| wrapper` → `?? wrapper` rewrite — data-name and type
  // must still land whether or not the registry's wrapper contains a real
  // <input> descendant.
  it("a date field's input carries data-name and type=date", async () => {
    const el = document.createElement("agent-form-block");
    el.block = {
      type: "form", id: "f2", fields: [
        { kind: "date", name: "when", label: "When" },
      ],
    };
    document.body.appendChild(el);
    await el.updateComplete;

    const host = el.renderRoot.querySelector('[data-name="when"]');
    expect(host).not.toBeNull();
    const input = host!.querySelector("input");
    expect(input).not.toBeNull();
    expect(input!.type).toBe("date");
  });

  // Regression for post-submit re-render. In the real app,
  // `generative-ui-renderer.ts:14` creates a BRAND-NEW `<agent-form-block>`
  // element on every re-render (which happens right after submit, when
  // `controller-messages.ts:404` disables every earlier block) — but the
  // `block` object it assigns is the SAME reference every time, because it
  // comes from core's `toolBlocks` map. Before the fix, `set block()`
  // unconditionally reset to field defaults, so the fresh disabled instance
  // showed defaults while the transcript recorded the real submission.
  it("a re-rendered disabled form shows the submitted values, not the field defaults", async () => {
    const block = {
      type: "form" as const,
      id: "form-submitted",
      fields: [
        { kind: "select" as const, name: "framework", label: "Framework", options: ["lit3", "lit1", "vanilla"] },
        { kind: "checkbox" as const, name: "helpful", label: "Was this helpful?" },
        { kind: "text" as const, name: "topic", label: "Topic" },
      ],
    };

    // First render: the interactive form, as shown before submission.
    const el1 = document.createElement("agent-form-block");
    el1.block = block;
    document.body.appendChild(el1);
    await el1.updateComplete;

    const select1 = el1.renderRoot.querySelector('select[data-name="framework"]') as HTMLSelectElement;
    select1.value = "vanilla";
    select1.dispatchEvent(new Event("change", { bubbles: true }));

    const checkbox1 = el1.renderRoot.querySelector('wa-checkbox[data-name="helpful"] input') as HTMLInputElement;
    checkbox1.checked = true;
    checkbox1.dispatchEvent(new Event("change", { bubbles: true }));

    const text1 = el1.renderRoot.querySelector('wa-text-input[data-name="topic"] input') as HTMLInputElement;
    text1.value = "demo topic";
    text1.dispatchEvent(new Event("input", { bubbles: true }));

    const form1 = el1.renderRoot.querySelector("form");
    form1?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    el1.remove();

    // Second render: a brand-new element for the same block, now disabled —
    // exactly what happens in the real app right after submit.
    const el2 = document.createElement("agent-form-block");
    el2.block = block;
    el2.disabled = true;
    document.body.appendChild(el2);
    await el2.updateComplete;

    const select2 = el2.renderRoot.querySelector('select[data-name="framework"]') as HTMLSelectElement;
    const checkbox2 = el2.renderRoot.querySelector('wa-checkbox[data-name="helpful"] input') as HTMLInputElement;
    const text2 = el2.renderRoot.querySelector('wa-text-input[data-name="topic"] input') as HTMLInputElement;

    expect(select2.value).toBe("vanilla");
    expect(checkbox2.checked).toBe(true);
    expect(text2.value).toBe("demo topic");
  });

  // 007, AC-2: a field the user never touched must still show its default,
  // not just whatever the submit snapshot happened to hold.
  it("a field left untouched keeps its default in a re-rendered disabled form", async () => {
    const block = {
      type: "form" as const,
      id: "form-untouched",
      fields: [
        { kind: "select" as const, name: "framework", label: "Framework", options: ["lit3", "lit1", "vanilla"], default: "lit1" },
        { kind: "checkbox" as const, name: "agree", label: "Agree", default: true },
      ],
    };

    const el1 = document.createElement("agent-form-block");
    el1.block = block;
    document.body.appendChild(el1);
    await el1.updateComplete;

    const form1 = el1.renderRoot.querySelector("form");
    form1?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    el1.remove();

    const el2 = document.createElement("agent-form-block");
    el2.block = block;
    el2.disabled = true;
    document.body.appendChild(el2);
    await el2.updateComplete;

    const select2 = el2.renderRoot.querySelector('select[data-name="framework"]') as HTMLSelectElement;
    const checkbox2 = el2.renderRoot.querySelector('wa-checkbox[data-name="agree"] input') as HTMLInputElement;

    expect(select2.value).toBe("lit1");
    expect(checkbox2.checked).toBe(true);
  });
});
