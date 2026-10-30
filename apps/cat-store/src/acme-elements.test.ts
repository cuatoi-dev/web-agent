if (typeof HTMLElement !== "undefined") {
  // Read the original method off its property descriptor, not off
  // `HTMLElement.prototype.attachInternals` directly — a bare reference to a
  // DOM method (lib.dom.d.ts declares no `this` parameter on it) held across
  // statements to `.call()` later is exactly the unsafe pattern
  // `@typescript-eslint/unbound-method` exists to catch; the descriptor's
  // `.value` is untyped, so it never LOOKS like a bound method to begin with.
  const originalAttachInternals = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "attachInternals")
    ?.value as ((this: HTMLElement) => ElementInternals) | undefined;
  HTMLElement.prototype.attachInternals = function (this: HTMLElement) {
    const internals: Record<string, unknown> = originalAttachInternals
      ? (originalAttachInternals.call(this) as unknown as Record<string, unknown>)
      : {};
    const methods = [
      "setFormValue",
      "setValidity",
      "checkValidity",
      "reportValidity",
    ];
    for (const m of methods) {
      if (!(m in internals)) {
        internals[m] = () => {};
      }
    }
    if (!internals.states) {
      internals.states = new Set();
    }
    if (!internals.validity) {
      internals.validity = { valid: true };
    }
    return internals as unknown as ElementInternals;
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineUiElements } from "./acme-registry";
import { AcmeButton, AcmeCheckbox, AcmeWorkingDots } from "./acme-elements";
import { AcmeMenu, AcmeTextArea, AcmeTextInput } from "./acme-fields";
import type { MaterialField } from "./acme-fields.types";

defineUiElements();
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });
const mount = <T extends HTMLElement>(tag: string): T => {
  const el = document.createElement(tag) as T;
  document.body.append(el);
  return el;
};

describe("cat-store UI elements", () => {
  it("defines every tag in the contract", () => {
    for (const tag of ["wa-button", "wa-icon-button", "wa-icon", "wa-checkbox", "wa-menu", "wa-text-input", "wa-text-area", "wa-progress", "wa-working-dots"]) {
      expect(customElements.get(tag)).toBeDefined();
    }
  });
  it("wa-button uses md-outlined-button for secondary and md-filled-button otherwise", () => {
    const el = document.createElement("wa-button") as AcmeButton;
    el.variant = "secondary"; document.body.append(el);
    expect(el.firstElementChild?.localName).toBe("md-outlined-button");
    el.variant = "danger";
    expect(el.firstElementChild?.localName).toBe("md-filled-button");
    expect((el.firstElementChild as HTMLElement).style.getPropertyValue("--md-filled-button-container-color")).toContain("--wa-action-color-error");
  });
  it("wa-button moves focus to the new inner node when the variant flips", () => {
    const el = document.createElement("wa-button") as AcmeButton;
    el.variant = "secondary"; document.body.append(el);
    const old = el.firstElementChild!;
    vi.spyOn(document, "activeElement", "get").mockReturnValue(old);
    let focused: unknown;
    const focus = vi.spyOn(customElements.get("md-filled-button")!.prototype, "focus")
      .mockImplementation(function (this: HTMLElement) {
        // Vitest 1.6 does not expose call contexts. Capture the receiver here.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        focused = this;
      });
    el.variant = "primary";
    expect(el.firstElementChild?.localName).toBe("md-filled-button");
    expect(old.isConnected).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focused).toBe(el.firstElementChild);
    expect(focused).not.toBe(old);
  });
  it("wa-button keeps its inner node when the variant does not cross tags", () => {
    const el = mount<AcmeButton>("wa-button"); const inner = el.firstElementChild;
    el.variant = "danger"; expect(el.firstElementChild).toBe(inner);
  });
  it("wa-menu drives md-menu and maps its events", () => {
    const el = document.createElement("wa-menu") as AcmeMenu;
    const anc = document.createElement("button"); anc.id = "anc"; document.body.append(anc);
    el.items = [{ id: "x", label: "X" }]; el.setAttribute("anchor-id", "anc"); document.body.append(el); el.open = true;
    const md = el.querySelector("md-menu") as HTMLElement & { open: boolean; anchorElement: HTMLElement | null };
    expect(md.open).toBe(true); expect(md.anchorElement).toBe(anc);
    const item = md.querySelector("md-menu-item")!; expect(item.querySelector("[slot=headline]")?.textContent).toBe("X");
    const select = vi.fn(); const close = vi.fn();
    el.addEventListener("select", select); el.addEventListener("request-close", close);
    (item as HTMLElement).click(); expect((select.mock.calls[0][0] as CustomEvent).detail.id).toBe("x");
    md.open = false; md.dispatchEvent(new Event("closed")); expect(close).toHaveBeenCalledTimes(1);
    el.open = false; md.dispatchEvent(new Event("closed")); expect(close).toHaveBeenCalledTimes(1);
  });
  it("wa-menu adds two document listeners and removes them", () => {
    const el = mount<AcmeMenu>("wa-menu");
    const da = vi.spyOn(document, "addEventListener"); const dr = vi.spyOn(document, "removeEventListener");
    const wa = vi.spyOn(window, "addEventListener");
    el.open = true;
    expect(da.mock.calls.filter((c) => c[0] === "pointerdown" || c[0] === "keydown")).toHaveLength(2);
    expect(wa.mock.calls.filter((c) => c[0] === "scroll" || c[0] === "resize")).toHaveLength(0);
    el.open = false;
    expect(dr.mock.calls.filter((c) => c[0] === "pointerdown" || c[0] === "keydown")).toHaveLength(2);
  });
  it("wa-checkbox maps md-checkbox change", () => {
    const el = mount<AcmeCheckbox>("wa-checkbox");
    const input = el.querySelector("md-checkbox") as HTMLElement & { checked: boolean };
    const change = vi.fn(); el.addEventListener("checked-change", change);
    input.checked = true; input.dispatchEvent(new Event("change"));
    expect((change.mock.calls[0][0] as CustomEvent).detail.checked).toBe(true);
  });
  it("wa-text-input forwards type, min and max to the Material field", () => {
    const el = mount<AcmeTextInput>("wa-text-input");
    el.type = "number"; el.min = 1; el.max = 5;
    const field = el.firstElementChild as unknown as MaterialField;
    expect(field.type).toBe("number");
    expect(field.min).toBe("1");
    expect(field.max).toBe("5");
    el.min = undefined; el.max = undefined;
    expect(field.min).toBe("");
    expect(field.max).toBe("");
  });
});

/** Restores the `registry.textArea` / `registry.iconButton` factory coverage that
 *  003410-005 dropped along with `acme-registry.test.ts`, against the surviving
 *  `<wa-text-area>` custom element (`AcmeTextArea`). Panel height comes from the
 *  nearest `agent-chat-panel` ancestor, so each test mounts one — matching the
 *  real composer layout, not a bare `document.body` append. */
describe("AcmeTextArea (cat-store)", () => {
  const mountField = (): { host: AcmeTextArea; field: MaterialField; panel: HTMLElement } => {
    const panel = document.createElement("agent-chat-panel");
    const host = document.createElement("wa-text-area") as AcmeTextArea;
    panel.appendChild(host);
    document.body.appendChild(panel);
    const field = host.firstElementChild as unknown as MaterialField;
    return { host, field, panel };
  };

  it("caps growth at 50% of the containing panel height", () => {
    const { host, field, panel } = mountField();
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ height: 600 } as DOMRect);
    Object.defineProperty(field, "scrollHeight", { value: 1604, configurable: true });
    host.value = "line\n".repeat(50);
    field.value = host.value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(field.style.height).toBe("300px");
  });

  it("accepts a 10,000+ character paste without truncation", () => {
    const { host, field } = mountField();
    const longText = "Lorem ipsum dolor sit amet. ".repeat(400);
    expect(longText.length).toBeGreaterThan(10000);
    field.value = longText;
    const onInput = vi.fn();
    host.addEventListener("value-input", onInput);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(field.value).toBe(longText);
    expect((onInput.mock.calls[0][0] as CustomEvent).detail.value).toBe(longText);
  });

  it("resetHeight clears the value and leaves the control at one row", () => {
    const { host, field } = mountField();
    host.value = "existing";
    field.style.height = "300px";
    host.resetHeight();
    expect(host.value).toBe("");
    expect(field.value).toBe("");
    const inner = field.shadowRoot?.querySelector("textarea");
    if (inner) {
      expect(inner.rows).toBe(1);
      expect(inner.style.overflowY).toBe("hidden");
    }
  });

  /** The textarea grows to fit its text. A keystroke that cannot have made the
   *  text shorter and still fits the box must not measure or write anything: it
   *  used to write `height: auto` and then force a reflow with
   *  `getBoundingClientRect()`, three layouts and three style recalcs per key. */
  describe("auto-grow fast path", () => {
    /** jsdom reports every layout length as 0 and the Material field has no
     *  shadow tree in this environment, so the test supplies the inner
     *  `<textarea>` the real component would have. The stub is visible only
     *  while the `input` event runs: the field is a Lit element, and its own
     *  async render must keep seeing the real `shadowRoot`. */
    const stubInner = (field: MaterialField, box: { clientHeight: number; scrollHeight: number }) => {
      const real = field.shadowRoot;
      const inner = document.createElement("textarea");
      Object.defineProperty(inner, "clientHeight", { configurable: true, get: () => box.clientHeight });
      Object.defineProperty(inner, "scrollHeight", { configurable: true, get: () => box.scrollHeight });
      const fake = { querySelector: (sel: string) => (sel === "textarea" ? inner : null) };
      let stubbing = false;
      Object.defineProperty(field, "shadowRoot", {
        configurable: true,
        get: () => (stubbing ? (fake as unknown as ShadowRoot) : real),
      });
      return (on: boolean): void => { stubbing = on; };
    };
    const type = (field: MaterialField, value: string, stub: (on: boolean) => void): void => {
      field.value = value;
      stub(true);
      try {
        field.dispatchEvent(new Event("input", { bubbles: true }));
      } finally {
        stub(false);
      }
    };

    it("measures nothing while the text still fits the box", () => {
      const { field, panel } = mountField();
      const stub = stubInner(field, { clientHeight: 40, scrollHeight: 40 });
      const fieldRect = vi.spyOn(field, "getBoundingClientRect");
      const panelRect = vi.spyOn(panel, "getBoundingClientRect");
      type(field, "hello", stub);
      type(field, "hello there", stub);
      expect(fieldRect).not.toHaveBeenCalled();
      expect(panelRect).not.toHaveBeenCalled();
      expect(field.style.height).toBe("");
    });

    it("grows when the text overflows, and shrinks again when a line is deleted", () => {
      const { field, panel } = mountField();
      const box = { clientHeight: 40, scrollHeight: 40 };
      const stub = stubInner(field, box);
      // 60 px of field box around a 40 px textarea means 20 px of chrome.
      vi.spyOn(field, "getBoundingClientRect").mockReturnValue({ height: 60 } as DOMRect);
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ height: 600 } as DOMRect);
      box.scrollHeight = 80;
      type(field, "a\nb", stub);
      expect(field.style.height).toBe("100px");
      box.scrollHeight = 40;
      type(field, "a", stub);
      expect(field.style.height).toBe("60px");
    });
  });

  /** Each keystroke used to re-query the field's shadow root for its
   *  `<textarea>`. The reference is cached once the node is connected, so the
   *  query runs once across a whole typing burst. */
  it("queries the shadow <textarea> once across repeated keystrokes", () => {
    const { field } = mountField();
    // The cache is only trusted while the node is connected, so the stand-in
    // must be in the document — jsdom gives the Material field no shadow tree.
    const holder = document.createElement("div");
    const inner = document.createElement("textarea");
    holder.appendChild(inner);
    document.body.appendChild(holder);
    const queries: string[] = [];
    const shadow = {
      querySelector: (sel: string) => { queries.push(sel); return inner; },
    } as unknown as ShadowRoot;
    Object.defineProperty(field, "shadowRoot", { configurable: true, get: () => shadow });

    for (const value of ["a", "ab", "abc", "abcd"]) {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(queries).toEqual(["textarea"]);
  });

  it("a keydown dispatched on the field bubbles up to the <wa-text-area> host", () => {
    const { host, field } = mountField();
    const onKeydown = vi.fn();
    host.addEventListener("keydown", onKeydown);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onKeydown).toHaveBeenCalledTimes(1);
  });
});

describe("wa-working-dots (Acme)", () => {
  it("the dot colour comes from --wa-text-color, not the disabled token", () => {
    const el = mount<AcmeWorkingDots>("wa-working-dots");
    expect(el.innerHTML).toContain("var(--wa-text-color,");
    expect(el.innerHTML).not.toContain("--wa-text-color-disabled");
  });

  it("injects no <style> child", () => {
    const el = mount<AcmeWorkingDots>("wa-working-dots");
    expect(el.querySelector("style")).toBeNull();
  });

  /** Layout, style and paint containment keep each pulse frame from making
   *  Blink re-run layer overlap analysis for the whole message list. */
  it("contains its own layout, style and paint", () => {
    const el = mount<AcmeWorkingDots>("wa-working-dots");
    const wrap = el.firstElementChild as HTMLElement;
    expect(wrap.style.contain).toBe("layout style paint");
  });

  /** Two of the twelve per-cycle writes repeat the value already on the dot
   *  (dot 0 from step 2 to 3, dot 2 from step 3 to 0). A repeated write still
   *  dirties the style attribute and costs a style recalculation, so the frame
   *  must skip it. */
  it("writes only the dots whose scale changes", () => {
    vi.useFakeTimers();
    const el = mount<AcmeWorkingDots>("wa-working-dots");
    const wrap = el.firstElementChild as HTMLElement;
    const dots = Array.from(wrap.querySelectorAll("span")) as HTMLElement[];
    const writes = dots.map(() => 0);
    dots.forEach((dot, i) => {
      const real = dot.style;
      const counted = new Proxy(real, {
        set(target, prop, value) {
          if (prop === "transform") writes[i] += 1;
          return Reflect.set(target, prop, value);
        },
      });
      Object.defineProperty(dot, "style", { configurable: true, get: () => counted });
    });
    vi.advanceTimersByTime(350 * 3);
    expect(writes).toEqual([2, 3, 3]);
    expect(dots[0].style.transform).toBe("scale(0.2)");
    vi.advanceTimersByTime(350);
    expect(writes).toEqual([3, 4, 3]);
    expect(dots[2].style.transform).toBe("scale(0.2)");
  });

  it("fades in at 400 ms, pulses every 350 ms, and stops on disconnect", () => {
    vi.useFakeTimers();
    const el = mount<AcmeWorkingDots>("wa-working-dots");
    const wrap = el.firstElementChild as HTMLElement;
    const dots = Array.from(wrap.querySelectorAll("span")) as HTMLElement[];
    expect(wrap.style.opacity).toBe("0");
    vi.advanceTimersByTime(400);
    expect(wrap.style.opacity).toBe("1");
    const first = dots.map((d) => d.style.transform).join("|");
    vi.advanceTimersByTime(350);
    expect(dots.map((d) => d.style.transform).join("|")).not.toBe(first);
    const before = dots.map((d) => d.style.transform).join("|");
    el.remove();
    vi.advanceTimersByTime(350 * 10);
    expect(dots.map((d) => d.style.transform).join("|")).toBe(before);
  });

  /** A hidden tab cannot show the pulse, so a tick there is pure cost: it
   *  still commits, re-lays out and re-layers the dots. */
  it("skips a pulse tick while the document is hidden", () => {
    vi.useFakeTimers();
    const el = mount<AcmeWorkingDots>("wa-working-dots");
    const dots = Array.from((el.firstElementChild as HTMLElement).querySelectorAll("span")) as HTMLElement[];
    const frame = (): string => dots.map((d) => d.style.transform).join("|");
    const first = frame();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    try {
      vi.advanceTimersByTime(350 * 2);
      expect(frame()).toBe(first);
    } finally {
      delete (document as unknown as { hidden?: unknown }).hidden;
    }
    vi.advanceTimersByTime(350);
    expect(frame()).not.toBe(first);
  });
});

/** `<md-ripple>` runs a 450 ms press animation plus a 375 ms opacity
 *  transition at 60 Hz, which accounted for ~80% of the compositor time in the
 *  clicks phase. The wrappers suppress it before the first render. */
describe("ripple suppression (cat-store)", () => {
  it("an icon button overrides renderRipple so no ripple element is created", () => {
    const el = mount<HTMLElement>("wa-icon-button") as HTMLElement & { icon: string; label: string };
    el.icon = "close";
    el.label = "Close";
    const btn = el.firstElementChild as HTMLElement & { renderRipple?: () => string };
    expect(typeof btn.renderRipple).toBe("function");
    expect(btn.renderRipple?.()).toBe("");
  });

  it("every menu item overrides renderRipple so no ripple element is created", () => {
    const el = document.createElement("wa-menu") as AcmeMenu;
    el.items = [{ id: "a", label: "A" }, { id: "b", label: "B", disabled: true }];
    document.body.append(el);
    const items = Array.from(el.querySelectorAll("md-menu-item")) as unknown as (HTMLElement & { renderRipple?: () => string })[];
    expect(items.length).toBe(2);
    for (const mi of items) {
      expect(typeof mi.renderRipple).toBe("function");
      expect(mi.renderRipple?.()).toBe("");
    }
  });
});

/** Restores the style-mapping coverage `acme-registry.test.ts` carried for
 *  `ACME_PANEL_MD_STYLES` (item I2 keeps that export; only the factory
 *  functions were removed). */
describe("acme-registry style mappings (ACME_PANEL_MD_STYLES)", () => {
  const headCss = (): string =>
    Array.from(document.head.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");

  it("injects header + input icon-button/text-field token overrides at module load", () => {
    const css = headCss();
    expect(css).toContain("agent-chat-panel md-icon-button {");
    expect(css).toContain("--md-icon-button-icon-color: var(--wa-text-color, #ffffff)");
    expect(css).toContain("--md-icon-button-hover-icon-color: var(--wa-text-color, #ffffff)");
    expect(css).toContain("--md-icon-button-focus-icon-color: var(--wa-text-color, #ffffff)");
    expect(css).toContain(
      "--md-outlined-text-field-focus-input-text-color: var(--wa-input-text-color, var(--wa-text-color, #ffffff))"
    );
    expect(css).toContain("--md-outlined-text-field-input-text-placeholder-color: var(--wa-label-color, #888888)");
    expect(css).toContain("--md-outlined-text-field-outline-color: var(--wa-border-color, #888888)");
    expect(css).toContain("agent-chat-panel .composer > md-outlined-text-field");
    expect(css).toContain("--md-outlined-text-field-outline-color: transparent");
  });

  it("the jump button's glyph does not take the body text colour every other panel icon button takes", () => {
    const css = headCss();
    const generic = /agent-chat-panel md-icon-button \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const jump = /agent-chat-panel \.wa-jump-btn md-icon-button \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(jump).toContain("--md-icon-button-icon-color");
    const genericColour = /--md-icon-button-icon-color:\s*([^;]+);/.exec(generic)?.[1]?.trim();
    const jumpColour = /--md-icon-button-icon-color:\s*([^;]+);/.exec(jump)?.[1]?.trim();
    expect(genericColour).toBeTruthy();
    expect(jumpColour).toBeTruthy();
    expect(jumpColour).not.toBe(genericColour);
  });

  it("maps md-menu / md-menu-item colours onto the --wa-dropdown-* tokens", () => {
    const css = headCss();
    expect(css).toContain("--md-menu-container-color: var(--wa-dropdown-background-color, #ffffff)");
    expect(css).toContain("--md-menu-item-label-text-color: var(--wa-dropdown-item-text-color, #000000)");
    expect(css).toContain("--md-menu-item-hover-state-layer-color: var(--wa-dropdown-item-text-color, #000000)");
    expect(css).toContain("--md-menu-item-pressed-state-layer-color: var(--wa-dropdown-item-text-color, #000000)");
    expect(css).toContain("--md-menu-item-container-color: var(--wa-dropdown-item-background-color, transparent)");
    expect(css).toContain(
      "--md-menu-item-selected-container-color: var(--wa-dropdown-item-background-color-selected, #1a73e8)"
    );
    expect(css).toContain(
      "--md-menu-item-selected-label-text-color: var(--wa-dropdown-item-text-color-selected, #ffffff)"
    );
  });

  it("undims the disabled menu item and gives it an AA-passing label colour", () => {
    const css = headCss();
    expect(css).toContain("--md-menu-item-disabled-opacity: 1");
    expect(css).toContain("--md-menu-item-label-text-color: var(--wa-label-color, #888888)");
    expect(css).not.toContain("--md-menu-item-label-text-color: var(--wa-dropdown-item-text-color-disabled");
    expect(css).not.toContain("--md-menu-item-label-text-color: var(--wa-text-color-disabled");
  });

  it("injects Material Web Public Sans typeface tokens at module load", () => {
    const css = headCss();
    expect(css).toContain('--md-ref-typeface-plain: "Public Sans"');
    expect(css).toContain('--md-ref-typeface-brand: "Public Sans"');
  });
});
