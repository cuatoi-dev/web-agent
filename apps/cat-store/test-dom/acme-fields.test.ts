import { describe, it, expect, afterEach, vi } from "vitest";

// jsdom has no form-associated ElementInternals, and Material's text field
// calls it on connect. Same shim the fast-tier spec uses
// (src/acme-elements.test.ts), needed here only so the field can render.
if (typeof HTMLElement !== "undefined") {
  const originalAttachInternals = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "attachInternals")
    ?.value as ((this: HTMLElement) => ElementInternals) | undefined;
  HTMLElement.prototype.attachInternals = function (this: HTMLElement) {
    const internals: Record<string, unknown> = originalAttachInternals
      ? (originalAttachInternals.call(this) as unknown as Record<string, unknown>)
      : {};
    for (const m of ["setFormValue", "setValidity", "checkValidity", "reportValidity"]) {
      if (!(m in internals)) {
        internals[m] = () => {};
      }
    }
    if (!internals.states) internals.states = new Set();
    if (!internals.validity) internals.validity = { valid: true };
    return internals as unknown as ElementInternals;
  };
}

import { defineUiElements } from "../src/acme-registry";
import type { AcmeTextArea } from "../src/acme-fields";
import type { MaterialField } from "../src/acme-fields.types";

defineUiElements();

const mountField = (): { host: AcmeTextArea; field: MaterialField } => {
  const panel = document.createElement("agent-chat-panel");
  const host = document.createElement("wa-text-area") as AcmeTextArea;
  panel.appendChild(host);
  document.body.appendChild(panel);
  const field = host.firstElementChild as unknown as MaterialField;
  return { host, field };
};

describe("AcmeTextArea direct value binding (cat-store)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  /** Typing used to run Material's `handleInput`, which set `dirty` and the
   *  reactive `value`, so every key cost two Lit renders, a form-value write
   *  and a validation pass. The field's `value` is bound to the shadow
   *  `<textarea>` instead, so a keystroke schedules no render. */
  it("typing updates the shadow <textarea> without a Material re-render", async () => {
    const { host, field } = mountField();
    // jsdom's Material field renders no `<textarea>` of its own, so a
    // connected stand-in supplies the node the real browser would have. It is
    // installed before the first render settles, because the field binds to
    // (and caches) the `<textarea>` it finds once that render completes.
    const holder = document.createElement("div");
    const inner = document.createElement("textarea");
    holder.appendChild(inner);
    document.body.appendChild(holder);
    Object.defineProperty(field, "shadowRoot", {
      configurable: true,
      get: () => ({ querySelector: (sel: string) => (sel === "textarea" ? inner : null) }),
    });
    await field.updateComplete;

    const requestUpdate = vi.spyOn(field as unknown as { requestUpdate(): void }, "requestUpdate");
    const onInput = vi.fn();
    host.addEventListener("value-input", onInput);

    for (const value of ["a", "ab", "abc"]) {
      inner.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }

    expect(requestUpdate).not.toHaveBeenCalled();
    expect(field.value).toBe("abc");
    expect(host.value).toBe("abc");
    expect(onInput.mock.calls.map((c) => (c[0] as CustomEvent).detail.value)).toEqual(["a", "ab", "abc"]);

    host.resetHeight();
    expect(host.value).toBe("");
    expect(field.value).toBe("");
    expect(inner.value).toBe("");
  });

  /** Iteration 3's deferred bind left a window: a keystroke that arrives after a
   *  synchronous `focus()` render, but before `field.updateComplete.then(...)`
   *  runs, was read from the silenced Material property (`""`), and the bind
   *  then seeded from that empty value and overwrote the typed text. */
  it("keeps text typed before the deferred bind has run", async () => {
    const { host, field } = mountField();
    // `focus()` performs the pending first update synchronously, which mounts
    // Material's shadow `<textarea>` before the deferred bind's microtask runs.
    // The first update must complete first: an own `value` accessor on a Lit
    // element before it makes Lit's dev build throw a class-field-shadowing
    // error and abort every later update.
    (field as unknown as { scheduleUpdate(): unknown }).scheduleUpdate();
    const inner = field.shadowRoot!.querySelector("textarea")!;
    const onInput = vi.fn();
    host.addEventListener("value-input", onInput);

    // Every keystroke lands before the deferred bind's microtask runs.
    for (const value of ["h", "he", "hel"]) {
      inner.value = value;
      inner.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }

    await field.updateComplete;
    host.placeholder = "Ask...";

    expect(inner.value).toBe("hel");
    expect(field.value).toBe("hel");
    expect(host.value).toBe("hel");
    expect(onInput.mock.calls.map((c) => (c[0] as CustomEvent).detail.value)).toEqual(["h", "he", "hel"]);
  });
});

/** `<md-ripple>` runs a 450 ms press animation plus a 375 ms opacity
 *  transition at 60 Hz. Buttons and checkboxes offer no `renderRipple` hook, so
 *  their wrappers detach the element once the first render settles. */
describe("ripple suppression (cat-store)", () => {
  it("a button and an icon button leave no <md-ripple> in their shadow root", async () => {
    const button = document.createElement("wa-button") as HTMLElement & { label: string };
    button.label = "Go";
    const iconButton = document.createElement("wa-icon-button") as HTMLElement & { icon: string; label: string };
    iconButton.icon = "close";
    iconButton.label = "Close";
    document.body.append(button, iconButton);

    for (const hostEl of [button, iconButton]) {
      const inner = hostEl.firstElementChild as HTMLElement & { updateComplete: Promise<boolean> };
      await inner.updateComplete;
      const root = inner.shadowRoot!;
      // The same template also renders the focus ring, so its presence proves
      // the render ran and the missing ripple is not just an empty shadow root.
      expect(root.querySelector("md-focus-ring")).not.toBeNull();
      expect(root.querySelector("md-ripple")).toBeNull();
    }
  });
});
