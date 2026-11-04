import { beforeEach, afterEach, describe, expect, it, vi, beforeAll } from "vitest";
import * as recorder from "./page-recorder";
import { EXTENSION_UI_ATTR, REC_HOVER_REST_MS, REC_SCROLL_QUIET_MS } from "./constants";
import type { RecordedStep } from "./recorder.types";

beforeAll(() => {
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => s.replace(/([^a-zA-Z0-9_-])/g, "\\$1"),
    };
  }
});

if (typeof PointerEvent === "undefined") {
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = MouseEvent;
}

/** Every step the binding received, in order. */
let calls: string[];

function steps(): RecordedStep[] {
  // Upsert by seq, the same rule the panel's driver applies.
  const out: RecordedStep[] = [];
  for (const raw of calls) {
    const step = JSON.parse(raw) as RecordedStep;
    const at = out.findIndex((s) => s.seq === step.seq);
    if (at >= 0) out[at] = step;
    else out.push(step);
  }
  return out;
}

/** A trusted event: jsdom's own events have `isTrusted` false, so it is
 *  set on the internal symbol (or defined) per event — the recorder's first filter is exactly this flag. */
function fire(target: EventTarget, event: Event): void {
  const syms = Object.getOwnPropertySymbols(event);
  for (const sym of syms) {
    const impl = (event as unknown as Record<symbol, unknown>)[sym];
    if (impl && typeof impl === "object") {
      try {
        Object.defineProperty(impl, "isTrusted", {
          get() {
            return true;
          },
          set() {},
          configurable: true,
        });
      } catch {
        // jsdom impl defines isTrusted on its own prototype
      }
    }
  }
  target.dispatchEvent(event);
}

describe("page-recorder", () => {
  beforeEach(() => {
    recorder.__resetRecorderForTest();
    calls = [];
    document.body.innerHTML = "";
    (globalThis as unknown as { __waRecStep?: (s: string) => void }).__waRecStep = (s: string) => {
      calls.push(s);
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (globalThis as unknown as { __waRecStep?: unknown }).__waRecStep;
  });

  it("U-R3: trusted click on <button>Apply</button> while recording", () => {
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.appendChild(btn);

    recorder.start("r1");
    fire(btn, new MouseEvent("click", { bubbles: true, cancelable: true }));

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("click");
    expect(s[0].line).toBe('click button "Apply"');
    expect(s[0].ref).toBeUndefined();
    expect(s[0].target).toMatchObject({ role: "button", name: "Apply" });
    expect(s[0].locators).toEqual({ role: "button", name: "Apply", roleMatches: 1, css: "button:nth-of-type(1)", xpath: "/html/body[1]/button[1]" });
  });

  it("a step carries no ref, for every step kind", () => {
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    const input = document.createElement("input");
    document.body.append(btn, input);

    recorder.start("r1");
    fire(btn, new MouseEvent("click", { bubbles: true, cancelable: true }));
    input.value = "x";
    fire(input, new Event("input", { bubbles: true }));

    for (const s of steps()) expect(s.ref).toBeUndefined();
  });

  it("target.label has no [n] prefix", () => {
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.appendChild(btn);

    recorder.start("r1");
    fire(btn, new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(steps()[0].target?.label).toBe('button "Apply"');
  });

  it("U-R4: the same click with isTrusted left false", () => {
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.appendChild(btn);

    recorder.start("r1");
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(steps()).toHaveLength(0);
  });

  it("U-R5: a trusted click inside the extension's own UI wrapper records nothing", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute(EXTENSION_UI_ATTR, "true");
    const btn = document.createElement("button");
    btn.textContent = "X";
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);

    recorder.start("r1");
    fire(btn, new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(steps()).toHaveLength(0);
  });

  it("U-R6: a trusted click on a checked/unchecked checkbox", () => {
    const label = document.createElement("label");
    label.htmlFor = "gift";
    label.textContent = "Gift";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "gift";
    document.body.appendChild(label);
    document.body.appendChild(input);

    recorder.start("r1");

    fire(input, new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(steps()[0]).toMatchObject({ kind: "check", line: 'check checkbox "Gift"' });

    fire(input, new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(steps()[1]).toMatchObject({ kind: "uncheck", line: 'uncheck checkbox "Gift"' });
  });

  it("U-R7: a trusted click on a text input, a textarea, a <select> and a contenteditable", () => {
    const text = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(text, textarea, select, editable);

    recorder.start("r1");
    fire(text, new MouseEvent("click", { bubbles: true }));
    fire(textarea, new MouseEvent("click", { bubbles: true }));
    fire(select, new MouseEvent("click", { bubbles: true }));
    fire(editable, new MouseEvent("click", { bubbles: true }));

    expect(steps()).toHaveLength(0);
  });

  it("U-R8: three input events on the same <input id=coupon>", () => {
    const label = document.createElement("label");
    label.htmlFor = "coupon";
    label.textContent = "Coupon";
    const input = document.createElement("input");
    input.id = "coupon";
    document.body.append(label, input);

    recorder.start("r1");

    input.value = "S";
    fire(input, new Event("input", { bubbles: true }));
    input.value = "SA";
    fire(input, new Event("input", { bubbles: true }));
    input.value = "SAVE10";
    fire(input, new Event("input", { bubbles: true }));

    expect(calls).toHaveLength(3);
    const seqs = calls.map((c) => (JSON.parse(c) as RecordedStep).seq);
    expect(seqs[0]).toBe(seqs[1]);
    expect(seqs[1]).toBe(seqs[2]);

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].line).toBe('fill textbox "Coupon" "SAVE10"');
    expect(s[0].value).toBe("SAVE10");
  });

  it("U-R9: an input on <input type=password> whose value is secret123", () => {
    const label = document.createElement("label");
    label.htmlFor = "pass";
    label.textContent = "Password";
    const input = document.createElement("input");
    input.type = "password";
    input.id = "pass";
    document.body.append(label, input);

    recorder.start("r1");

    input.value = "secret123";
    fire(input, new Event("input", { bubbles: true }));

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].masked).toBe(true);
    expect(s[0].value).toBeUndefined();
    expect(s[0].line).toBe('fill textbox "Password" <password>');
    expect(calls.join("")).not.toContain("secret123");
  });

  it("U-R10: an input on Coupon, then a click on Apply, then another input on Coupon", () => {
    const label = document.createElement("label");
    label.htmlFor = "coupon";
    label.textContent = "Coupon";
    const input = document.createElement("input");
    input.id = "coupon";
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.append(label, input, btn);

    recorder.start("r1");

    input.value = "S";
    fire(input, new Event("input", { bubbles: true }));

    fire(btn, new MouseEvent("click", { bubbles: true }));

    input.value = "NEW";
    fire(input, new Event("input", { bubbles: true }));

    const s = steps();
    expect(s).toHaveLength(3);
    expect(s[0].kind).toBe("fill");
    expect(s[1].kind).toBe("click");
    expect(s[2].kind).toBe("fill");
    expect(s[2].seq).not.toBe(s[0].seq);
  });

  it("U-R11: an input on <select id=shipping> with Express selected", () => {
    const label = document.createElement("label");
    label.htmlFor = "shipping";
    label.textContent = "Shipping";
    const select = document.createElement("select");
    select.id = "shipping";
    const opt1 = document.createElement("option");
    opt1.value = "standard";
    opt1.text = "Standard";
    const opt2 = document.createElement("option");
    opt2.value = "express";
    opt2.text = "Express";
    select.append(opt1, opt2);
    document.body.append(label, select);

    recorder.start("r1");

    opt2.selected = true;
    fire(select, new Event("input", { bubbles: true, composed: true }));

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("select");
    expect(s[0].values).toEqual(["Express"]);
    expect(s[0].line).toBe('select combobox "Shipping" "Express"');
  });

  it("U-R12: an input on a <select multiple> with two options selected", () => {
    const label = document.createElement("label");
    label.htmlFor = "extras";
    label.textContent = "Extras";
    const select = document.createElement("select");
    select.id = "extras";
    select.multiple = true;
    const opt1 = document.createElement("option");
    opt1.value = "giftwrap";
    opt1.text = "Gift wrap";
    const opt2 = document.createElement("option");
    opt2.value = "card";
    opt2.text = "Card";
    select.append(opt1, opt2);
    document.body.append(label, select);

    recorder.start("r1");

    opt1.selected = true;
    opt2.selected = true;
    fire(select, new Event("input", { bubbles: true, composed: true }));

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].values).toEqual(["Gift wrap", "Card"]);
    expect(s[0].line.endsWith('"Gift wrap", "Card"')).toBe(true);
  });

  it("a light-DOM <select> receiving input then change records one select step", () => {
    const label = document.createElement("label");
    label.htmlFor = "shipping";
    label.textContent = "Shipping";
    const select = document.createElement("select");
    select.id = "shipping";
    const opt1 = document.createElement("option");
    opt1.value = "standard";
    opt1.text = "Standard";
    const opt2 = document.createElement("option");
    opt2.value = "express";
    opt2.text = "Express";
    select.append(opt1, opt2);
    document.body.append(label, select);

    recorder.start("r1");

    opt2.selected = true;
    fire(select, new Event("input", { bubbles: true, composed: true }));
    fire(select, new Event("change", { bubbles: true }));

    expect(calls).toHaveLength(1);
    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("select");
    expect(s[0].values).toEqual(["Express"]);
    expect(s[0].line).toBe('select combobox "Shipping" "Express"');
  });

  it("U-R13: keydown Enter on <button> and Escape on <body> still record", () => {
    const btn = document.createElement("button");
    btn.textContent = "OK";
    document.body.appendChild(btn);

    recorder.start("r1");

    fire(btn, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    fire(document.body, new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // A single printable key is recorded now — see "navigation keys and
    // shortcuts (003)" below.

    const s = steps();
    expect(s).toHaveLength(2);
    expect(s[0].line).toBe("press Enter");
    expect(s[0].target).toBeDefined();
    expect(s[1].line).toBe("press Escape");
    expect(s[1].target).toBeUndefined();
  });

  it("U-R14: two wheel events with deltaY 100 and 300, then advance timers past REC_SCROLL_QUIET_MS", () => {
    vi.useFakeTimers();
    recorder.start("r1");

    fire(window, new WheelEvent("wheel", { deltaY: 100 }));
    fire(window, new WheelEvent("wheel", { deltaY: 300 }));

    vi.advanceTimersByTime(REC_SCROLL_QUIET_MS + 50);

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].deltaY).toBe(400);
    expect(s[0].line).toBe("scroll down 400 px");
  });

  it("U-R15: scroll with an <h2>Cart</h2> whose getBoundingClientRect().top is stubbed inside the viewport", () => {
    vi.useFakeTimers();
    const h2 = document.createElement("h2");
    h2.textContent = "Cart";
    vi.spyOn(h2, "getBoundingClientRect").mockReturnValue({
      top: 50,
      bottom: 80,
      left: 0,
      right: 100,
      width: 100,
      height: 30,
      x: 0,
      y: 50,
      toJSON: () => {},
    });
    document.body.appendChild(h2);

    recorder.start("r1");

    fire(window, new WheelEvent("wheel", { deltaY: 200 }));
    vi.advanceTimersByTime(REC_SCROLL_QUIET_MS + 50);

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].line).toBe('scroll to "Cart"');
  });

  it("U-R16: one wheel with deltaY -250", () => {
    vi.useFakeTimers();
    recorder.start("r1");

    fire(window, new WheelEvent("wheel", { deltaY: -250 }));
    vi.advanceTimersByTime(REC_SCROLL_QUIET_MS + 50);

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].line).toBe("scroll up 250 px");
  });

  it("U-R17: pointermove over an <a>, then advance timers by REC_HOVER_REST_MS", () => {
    vi.useFakeTimers();
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Cart (2)";
    document.body.appendChild(a);

    recorder.start("r1");

    fire(a, new PointerEvent("pointermove", { bubbles: true }));
    vi.advanceTimersByTime(REC_HOVER_REST_MS);

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("hover");
    expect(s[0].line).toBe('hover link "Cart (2)"');
  });

  it("U-R18: pointermove over the link, advance 200 ms, pointermove over a <p>, advance 600 ms", () => {
    vi.useFakeTimers();
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Cart";
    const p = document.createElement("p");
    p.textContent = "Paragraph";
    document.body.append(a, p);

    recorder.start("r1");

    fire(a, new PointerEvent("pointermove", { bubbles: true }));
    vi.advanceTimersByTime(200);

    fire(p, new PointerEvent("pointermove", { bubbles: true }));
    vi.advanceTimersByTime(600);

    expect(steps()).toHaveLength(0);
  });

  it("U-R19: pointermove over the link, rest, then two more pointermoves at the same link", () => {
    vi.useFakeTimers();
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Cart";
    document.body.appendChild(a);

    recorder.start("r1");

    fire(a, new PointerEvent("pointermove", { bubbles: true }));
    vi.advanceTimersByTime(REC_HOVER_REST_MS);
    expect(steps()).toHaveLength(1);

    fire(a, new PointerEvent("pointermove", { bubbles: true }));
    vi.advanceTimersByTime(REC_HOVER_REST_MS);
    fire(a, new PointerEvent("pointermove", { bubbles: true }));
    vi.advanceTimersByTime(REC_HOVER_REST_MS);

    expect(steps()).toHaveLength(1);
  });

  it("a hashchange and a popstate emit no step: route steps come only from Page.navigatedWithinDocument", () => {
    recorder.start("r1");

    fire(window, new HashChangeEvent("hashchange"));
    fire(window, new PopStateEvent("popstate"));

    expect(calls).toHaveLength(0);
  });

  it("pushState is NOT patched: the panel raises the route step from Page.navigatedWithinDocument instead", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = history.pushState;
    recorder.start("r1");

    history.pushState({}, "", "/cart");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(history.pushState).toBe(original);
    expect(steps()).toHaveLength(0);
  });

  it("U-R23: pause(), a trusted click, resume(), a trusted click", () => {
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.appendChild(btn);

    recorder.start("r1");
    recorder.pause();

    fire(btn, new MouseEvent("click", { bubbles: true }));
    expect(steps()).toHaveLength(0);

    recorder.resume();
    fire(btn, new MouseEvent("click", { bubbles: true }));

    const s = steps();
    expect(s).toHaveLength(1);
    expect(s[0].line).toBe('click button "Apply"');
  });

  it("resume() clears the pending hover timer: a pointer that rested during the pause records no hover", () => {
    vi.useFakeTimers();
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "Cart";
    document.body.appendChild(a);

    recorder.start("r1");
    fire(a, new PointerEvent("pointermove", { bubbles: true }));
    recorder.pause();
    vi.advanceTimersByTime(REC_HOVER_REST_MS);
    recorder.resume();
    vi.advanceTimersByTime(REC_HOVER_REST_MS);

    expect(steps()).toHaveLength(0);
  });

  it("__waRecStep missing: a click does not throw and nothing is emitted", () => {
    delete (globalThis as unknown as { __waRecStep?: unknown }).__waRecStep;
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.appendChild(btn);

    recorder.start("r1");
    expect(() => fire(btn, new MouseEvent("click", { bubbles: true }))).not.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("__waRecStep throwing: a click does not throw", () => {
    (globalThis as unknown as { __waRecStep?: (s: string) => void }).__waRecStep = () => {
      throw new Error("session detached");
    };
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.appendChild(btn);

    recorder.start("r1");
    expect(() => fire(btn, new MouseEvent("click", { bubbles: true }))).not.toThrow();
  });

  it("stop(): a later click emits nothing, and isRecording() is false", () => {
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.appendChild(btn);

    recorder.start("r1");
    recorder.stop();
    expect(recorder.isRecording()).toBe(false);

    fire(btn, new MouseEvent("click", { bubbles: true }));
    expect(calls).toHaveLength(0);
  });

  it("start() twice: the second resets seq to 0 and detaches the first set of listeners", () => {
    const btn = document.createElement("button");
    btn.textContent = "Apply";
    document.body.appendChild(btn);

    recorder.start("r1");
    recorder.start("r2");
    fire(btn, new MouseEvent("click", { bubbles: true }));

    // One emit per click, not two — the first attach() was torn down by the
    // second start(), not left running alongside it.
    expect(calls).toHaveLength(1);
    const step = JSON.parse(calls[0]) as RecordedStep;
    expect(step.recordingId).toBe("r2");
    expect(step.seq).toBe(0);
  });

  describe("open shadow roots", () => {
    const composed = { bubbles: true, composed: true };

    function host(tag: string, mode: "open" | "closed", html: string): { host: HTMLElement; root: ShadowRoot } {
      const h = document.createElement(tag);
      const root = h.attachShadow({ mode });
      root.innerHTML = html;
      document.body.appendChild(h);
      return { host: h, root };
    }

    it("trusted click on a <button> inside an open shadow root with slotted text", () => {
      const { host: h, root } = host("custom-button", "open", "<button><slot></slot></button>");
      h.textContent = "Add to cart";
      recorder.start("r1");
      fire(root.querySelector("button") as Element, new MouseEvent("click", composed));

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("click");
      expect(s[0].line).toBe('click button "Add to cart"');
      expect(s[0].target).toMatchObject({ role: "button", name: "Add to cart" });
      expect(s[0].locators?.shadow).toEqual(["custom-button:nth-of-type(1)", "button:nth-of-type(1)"]);
      expect(s[0].locators?.css).toBeUndefined();
    });

    it("click on a slotted <span> inside such a button records the same click on the inner <button>", () => {
      const { host: h } = host("custom-button", "open", "<button><slot></slot></button>");
      const span = document.createElement("span");
      span.textContent = "Add to cart";
      h.appendChild(span);
      recorder.start("r1");
      fire(span, new MouseEvent("click", composed));

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].line).toBe('click button "Add to cart"');
      expect(s[0].target).toMatchObject({ role: "button", name: "Add to cart" });
    });

    it("typing into an <input> inside an open shadow root records fill and updates in place", () => {
      const { root } = host("custom-field", "open", '<label for="qty">Quantity</label><input id="qty">');
      const input = root.querySelector("input") as HTMLInputElement;
      recorder.start("r1");
      input.value = "2";
      fire(input, new Event("input", composed));
      input.value = "3";
      fire(input, new Event("input", composed));

      expect(calls).toHaveLength(2);
      expect((JSON.parse(calls[0]) as RecordedStep).seq).toBe((JSON.parse(calls[1]) as RecordedStep).seq);
      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("fill");
      expect(s[0].value).toBe("3");
      expect(s[0].line).toBe('fill textbox "Quantity" "3"');
    });

    it("typing into a password input inside an open shadow root records fill with masked: true", () => {
      const { root } = host("custom-field", "open", '<label for="secret">Secret Code</label><input id="secret" type="password">');
      const input = root.querySelector("input") as HTMLInputElement;
      recorder.start("r1");
      input.value = "topsecret";
      fire(input, new Event("input", composed));

      const s = steps();
      expect(s[0].masked).toBe(true);
      expect(s[0].value).toBeUndefined();
      expect(s[0].line).toBe('fill textbox "Secret Code" <password>');
      expect(calls.join("")).not.toContain("topsecret");
    });

    it("changing a <select> inside an open shadow root records a select step with option labels", () => {
      const { root } = host(
        "custom-select",
        "open",
        '<label for="size">Size</label><select id="size"><option value="s">Small</option><option value="l">Large</option></select>',
      );
      const select = root.querySelector("select") as HTMLSelectElement;
      recorder.start("r1");
      select.selectedIndex = 1;
      fire(select, new Event("input", composed));
      fire(select, new Event("change", { bubbles: true }));

      expect(calls).toHaveLength(1);
      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("select");
      expect(s[0].values).toEqual(["Large"]);
      expect(s[0].line).toBe('select combobox "Size" "Large"');
    });

    it("trusted composed input on a <select> inside an open shadow root records one select step with its label", () => {
      const { root } = host(
        "store-view",
        "open",
        '<label for="cat-filter">Category:</label><select id="cat-filter"><option value="">All</option><option value="Food">Food</option><option value="Toys">Toys</option></select>',
      );
      const select = root.querySelector("select") as HTMLSelectElement;
      recorder.start("r1");
      select.selectedIndex = 2;
      fire(select, new Event("input", composed));

      expect(calls).toHaveLength(1);
      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("select");
      expect(s[0].values).toEqual(["Toys"]);
      expect(s[0].line).toBe('select combobox "Category:" "Toys"');
      expect(s[0].target).toMatchObject({ role: "combobox", name: "Category:" });
    });

    it("Enter pressed in an <input> inside an open shadow root records a press step targeting the input", () => {
      const { root } = host("custom-input", "open", '<input id="search" aria-label="Search">');
      recorder.start("r1");
      fire(root.querySelector("input") as Element, new KeyboardEvent("keydown", { key: "Enter", ...composed }));

      const s = steps();
      expect(s[0].line).toBe("press Enter");
      expect(s[0].target?.role).toBe("textbox");
    });

    it("click on a <button> inside the extension's own <web-agent-bubble> records nothing", () => {
      const { host: bubble, root } = host("web-agent-bubble", "open", "<button>Close</button>");
      bubble.setAttribute(EXTENSION_UI_ATTR, "true");
      recorder.start("r1");
      fire(root.querySelector("button") as Element, new MouseEvent("click", composed));

      expect(steps()).toHaveLength(0);
    });

    it("click on a <button> inside the site's own <web-agent-bubble> records a click step", () => {
      const { root } = host("web-agent-bubble", "open", "<button>Close</button>");
      recorder.start("r1");
      fire(root.querySelector("button") as Element, new MouseEvent("click", composed));

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].line).toBe('click button "Close"');
    });

    it("wheel scroll where the only visible heading is inside an open shadow root records scroll to heading", () => {
      vi.useFakeTimers();
      const { root } = host("section-card", "open", "<h2>Products Catalog</h2>");
      vi.spyOn(root.querySelector("h2") as Element, "getBoundingClientRect").mockReturnValue({
        top: 100,
        bottom: 130,
        left: 0,
        right: 100,
        width: 100,
        height: 30,
        x: 0,
        y: 100,
        toJSON: () => {},
      });
      recorder.start("r1");
      fire(window, new WheelEvent("wheel", { deltaY: 150 }));
      vi.advanceTimersByTime(REC_SCROLL_QUIET_MS + 50);

      expect(steps()[0].line).toBe('scroll to "Products Catalog"');
    });

    it("click inside a closed shadow root records nothing when the host is not interactive", () => {
      const { root } = host("closed-card", "closed", "<button>Internal Button</button>");
      recorder.start("r1");
      fire(root.querySelector("button") as Element, new MouseEvent("click", composed));

      expect(steps()).toHaveLength(0);
    });

    it("hover on an interactive element inside an open shadow root records a hover step", () => {
      vi.useFakeTimers();
      const { root } = host("custom-link", "open", '<a href="#/catalog">Catalog</a>');
      recorder.start("r1");
      fire(root.querySelector("a") as Element, new PointerEvent("pointermove", composed));
      vi.advanceTimersByTime(REC_HOVER_REST_MS);

      const s = steps();
      expect(s[0].kind).toBe("hover");
      expect(s[0].line).toBe('hover link "Catalog"');
    });

    it("click inside the extension's own bubble with onclick or cursor:pointer still records nothing", () => {
      const { host: bubble, root } = host(
        "web-agent-bubble",
        "open",
        '<div id="ext-div" onclick="" style="cursor:pointer">Dismiss</div>',
      );
      bubble.setAttribute(EXTENSION_UI_ATTR, "true");
      recorder.start("r1");
      fire(root.querySelector("#ext-div") as Element, new MouseEvent("click", composed));

      expect(calls).toHaveLength(0);
    });

    it("pointer-cursor run crossing an open shadow boundary records the shadow host when host has cursor:pointer, else the inner element", () => {
      const { host: ptrHost, root: r1 } = host(
        "ptr-chip",
        "open",
        '<span id="inner1" style="cursor:pointer">Chip label</span>',
      );
      ptrHost.id = "chip-host";
      ptrHost.style.cursor = "pointer";

      const { root: r2 } = host(
        "plain-panel",
        "open",
        '<span id="inner2" style="cursor:pointer">Inner action</span>',
      );

      recorder.start("r1");
      fire(r1.querySelector("#inner1") as Element, new MouseEvent("click", composed));
      fire(r2.querySelector("#inner2") as Element, new MouseEvent("click", composed));

      const s = steps();
      expect(s).toHaveLength(2);
      expect(s[0].line).toBe('click ptr-chip "Chip label"');
      expect(s[0].locators?.id).toBe("chip-host");
      expect(s[1].line).toBe('click span "Inner action"');
      expect(s[1].locators?.shadow).toEqual(["plain-panel:nth-of-type(1)", "#inner2"]);
    });
  });

  describe("extended ARIA roles and pointer/onclick fallbacks (001)", () => {
    it("trusted click on each added ARIA widget role without tabindex records one click step", () => {
      const roles = [
        "combobox", "listbox", "slider", "spinbutton", "searchbox", "textbox",
        "treeitem", "gridcell", "row", "menuitemcheckbox", "menuitemradio",
      ];
      const els = roles.map((role) => {
        const el = document.createElement("div");
        el.setAttribute("role", role);
        el.setAttribute("aria-label", `Item ${role}`);
        document.body.appendChild(el);
        return { role, el };
      });

      recorder.start("r1");
      for (const { el } of els) {
        fire(el, new MouseEvent("click", { bubbles: true, cancelable: true }));
      }

      const s = steps();
      expect(s).toHaveLength(roles.length);
      roles.forEach((role, i) => {
        expect(s[i].kind).toBe("click");
        expect(s[i].line).toBe(`click ${role} "Item ${role}"`);
      });
    });

    it("section 2 controls record one click each, and inner option/gridcell win over outer listbox/row", () => {
      document.body.innerHTML = `
        <div id="divclick" onclick="">Plain div onclick</div>
        <div id="combobox" role="combobox" aria-label="Combobox">Combobox</div>
        <div role="listbox" aria-label="Colours"><div id="opt-red" role="option">Red option</div></div>
        <div id="slider" role="slider" aria-label="Volume">Slider</div>
        <div role="tree"><div id="treeitem" role="treeitem">Tree item A</div></div>
        <div role="grid"><div role="row"><div id="gridcell" role="gridcell">Cell B2</div></div></div>
        <span id="ptrspan" style="cursor:pointer">Pointer span</span>
      `;

      recorder.start("r1");
      for (const id of ["divclick", "combobox", "opt-red", "slider", "treeitem", "gridcell", "ptrspan"]) {
        fire(document.getElementById(id) as Element, new MouseEvent("click", { bubbles: true, cancelable: true }));
      }

      expect(calls).toHaveLength(7);
      expect(steps().map((s) => s.line)).toEqual([
        'click div "Plain div onclick"',
        'click combobox "Combobox"',
        'click option "Red option"',
        'click slider "Volume"',
        'click treeitem "Tree item A"',
        'click gridcell "Cell B2"',
        'click span "Pointer span"',
      ]);
    });

    it("click on a child of a pointer-cursor run records the outermost element of that run, once", () => {
      // jsdom 24 does not inherit cursor across elements, so set style="cursor:pointer"
      // on every node in the run to exercise the parent-cursor check directly.
      document.body.innerHTML = `
        <div id="card" style="cursor:pointer">
          <div id="mid" style="cursor:pointer">
            <span id="leaf" style="cursor:pointer">Card title</span>
          </div>
        </div>
      `;

      recorder.start("r1");
      fire(document.getElementById("leaf") as Element, new MouseEvent("click", { bubbles: true, cancelable: true }));

      expect(calls).toHaveLength(1);
      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].line).toBe('click div "Card title"');
      expect(s[0].locators?.id).toBe("card");
    });

    it("click on a section heading, plain block, body, or html records nothing", () => {
      document.body.innerHTML = `<section><h2 id="hd">2 Not in INTERACTIVE</h2><p id="para">Copy</p></section>`;
      document.body.setAttribute("onclick", "");
      document.body.style.cursor = "pointer";
      document.documentElement.setAttribute("onclick", "");
      document.documentElement.style.cursor = "pointer";

      recorder.start("r1");
      fire(document.getElementById("hd") as Element, new MouseEvent("click", { bubbles: true }));
      fire(document.getElementById("para") as Element, new MouseEvent("click", { bubbles: true }));
      fire(document.body, new MouseEvent("click", { bubbles: true }));
      fire(document.documentElement, new MouseEvent("click", { bubbles: true }));

      expect(calls).toHaveLength(0);

      document.body.removeAttribute("onclick");
      document.body.style.cursor = "";
      document.documentElement.removeAttribute("onclick");
      document.documentElement.style.cursor = "";
    });

    it("resting the pointer on role=combobox or a pointer-cursor run records one hover step", () => {
      vi.useFakeTimers();
      document.body.innerHTML = `
        <div id="combobox" role="combobox" aria-label="Combobox">Combobox</div>
        <div id="card" style="cursor:pointer"><span id="leaf" style="cursor:pointer">Quick card</span></div>
      `;

      recorder.start("r1");
      fire(document.getElementById("combobox") as Element, new PointerEvent("pointermove", { bubbles: true }));
      vi.advanceTimersByTime(REC_HOVER_REST_MS);

      fire(document.getElementById("leaf") as Element, new PointerEvent("pointermove", { bubbles: true }));
      vi.advanceTimersByTime(REC_HOVER_REST_MS);

      const s = steps();
      expect(s).toHaveLength(2);
      expect(s[0].line).toBe('hover combobox "Combobox"');
      expect(s[1].line).toBe('hover div "Quick card"');
      expect(s[1].locators?.id).toBe("card");
    });
  });

  describe("file, range and color inputs (002)", () => {
    /** jsdom cannot open a file chooser, so `files` is defined on the element. */
    function chooseFiles(input: HTMLInputElement, names: string[]): void {
      Object.defineProperty(input, "files", {
        value: names.map((n) => new File(["x"], n)),
        configurable: true,
      });
      fire(input, new Event("input", { bubbles: true, composed: true }));
    }

    function section3(): { file: HTMLInputElement; range: HTMLInputElement; color: HTMLInputElement } {
      document.body.innerHTML = `
        <label>Upload <input type="file" id="file" multiple></label>
        <label>Level <input type="range" id="range" min="0" max="10" value="2"></label>
        <label>Tint <input type="color" id="color" value="#ff0000"></label>
      `;
      return {
        file: document.getElementById("file") as HTMLInputElement,
        range: document.getElementById("range") as HTMLInputElement,
        color: document.getElementById("color") as HTMLInputElement,
      };
    }

    it("choosing one file records one upload step with its name", () => {
      const { file } = section3();
      recorder.start("r1");
      chooseFiles(file, ["a.txt"]);

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("upload");
      expect(s[0].line).toBe('upload file "Upload" "a.txt"');
      expect(s[0].values).toEqual(["a.txt"]);
      expect(s[0].target).toMatchObject({ role: "file", name: "Upload" });
      expect(s[0].locators?.id).toBe("file");
    });

    it("choosing two files lists both names", () => {
      const { file } = section3();
      recorder.start("r1");
      chooseFiles(file, ["a.txt", "b.txt"]);

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].line).toBe('upload file "Upload" "a.txt", "b.txt"');
      expect(s[0].values).toEqual(["a.txt", "b.txt"]);
    });

    it("clearing the files records upload (none) with no values", () => {
      const { file } = section3();
      recorder.start("r1");
      chooseFiles(file, []);

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].line).toBe('upload file "Upload" (none)');
      expect(s[0].values).toEqual([]);
    });

    it("a click on a file input, then input and change, records one upload step", () => {
      const { file } = section3();
      recorder.start("r1");
      fire(file, new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(calls).toHaveLength(0);
      chooseFiles(file, ["a.txt"]);
      fire(file, new Event("change", { bubbles: true }));

      expect(calls).toHaveLength(1);
      expect(steps()[0].kind).toBe("upload");
    });

    it("an upload closes the open fill", () => {
      const { file, range } = section3();
      recorder.start("r1");
      range.value = "3";
      fire(range, new Event("input", { bubbles: true, composed: true }));
      chooseFiles(file, ["a.txt"]);
      range.value = "4";
      fire(range, new Event("input", { bubbles: true, composed: true }));

      const s = steps();
      expect(s.map((x) => x.kind)).toEqual(["fill", "upload", "fill"]);
      expect(s[2].seq).not.toBe(s[0].seq);
    });

    it("an untrusted input on a file input records nothing", () => {
      const { file } = section3();
      recorder.start("r1");
      file.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

      expect(calls).toHaveLength(0);
    });

    it("moving a range updates one fill step in place", () => {
      const { range } = section3();
      recorder.start("r1");
      for (const v of ["3", "6", "9"]) {
        range.value = v;
        fire(range, new Event("input", { bubbles: true, composed: true }));
      }

      expect(calls).toHaveLength(3);
      const seqs = calls.map((c) => (JSON.parse(c) as RecordedStep).seq);
      expect(new Set(seqs).size).toBe(1);
      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("fill");
      expect(s[0].value).toBe("9");
      expect(s[0].line).toBe('fill slider "Level" "9"');
    });

    it("a hover timer armed before a range drag does not split the fill or record a hover", () => {
      vi.useFakeTimers();
      const { range } = section3();
      recorder.start("r1");
      fire(range, new PointerEvent("pointermove", { bubbles: true }));
      range.value = "3";
      fire(range, new Event("input", { bubbles: true, composed: true }));
      vi.advanceTimersByTime(REC_HOVER_REST_MS);
      range.value = "9";
      fire(range, new Event("input", { bubbles: true, composed: true }));

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("fill");
      expect(s[0].value).toBe("9");
    });

    it("pointerdown on a range slider cancels the hover timer and prevents a hover step during a slow drag", () => {
      vi.useFakeTimers();
      const { range } = section3();
      recorder.start("r1");
      // Pointer moves onto the range, arming the hover timer.
      fire(range, new PointerEvent("pointermove", { bubbles: true }));
      // Pointer goes down (drag begins).
      fire(range, new PointerEvent("pointerdown", { bubbles: true }));
      // Time advances past REC_HOVER_REST_MS with NO input event yet (user holds or drags slowly).
      vi.advanceTimersByTime(REC_HOVER_REST_MS + 100);
      // Now the value changes.
      range.value = "9";
      fire(range, new Event("input", { bubbles: true, composed: true }));

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("fill");
      expect(s[0].line).toBe('fill slider "Level" "9"');
    });

    it("picking a color records one fill step with the #rrggbb value", () => {
      const { color } = section3();
      recorder.start("r1");
      fire(color, new MouseEvent("click", { bubbles: true, cancelable: true }));
      for (const v of ["#00ff00", "#00ffff"]) {
        color.value = v;
        fire(color, new Event("input", { bubbles: true, composed: true }));
      }

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("fill");
      expect(s[0].value).toBe("#00ffff");
      expect(s[0].line).toBe('fill colorpicker "Tint" "#00ffff"');
    });

    it("a checkbox and a radio record check and uncheck, not fill, even with an input event", () => {
      document.body.innerHTML = `
        <label>Gift <input type="checkbox" id="gift"></label>
        <label>Fast <input type="radio" id="fast"></label>
      `;
      const gift = document.getElementById("gift") as HTMLInputElement;
      const fast = document.getElementById("fast") as HTMLInputElement;
      recorder.start("r1");
      fire(gift, new MouseEvent("click", { bubbles: true, cancelable: true }));
      fire(gift, new Event("input", { bubbles: true, composed: true }));
      fire(gift, new MouseEvent("click", { bubbles: true, cancelable: true }));
      fire(gift, new Event("input", { bubbles: true, composed: true }));
      fire(fast, new MouseEvent("click", { bubbles: true, cancelable: true }));
      fire(fast, new Event("input", { bubbles: true, composed: true }));

      expect(steps().map((x) => x.kind)).toEqual(["check", "uncheck", "check"]);
    });
  });

  describe("navigation keys and shortcuts (003)", () => {
    function keysField(): HTMLInputElement {
      document.body.innerHTML = '<label>Keys field <input id="keys" value="hello"></label>';
      return document.getElementById("keys") as HTMLInputElement;
    }

    function key(target: EventTarget, init: KeyboardEventInit): void {
      fire(target, new KeyboardEvent("keydown", { bubbles: true, composed: true, ...init }));
    }

    it("ArrowLeft in a text field records press ArrowLeft with the field as its target", () => {
      const input = keysField();
      recorder.start("r1");
      key(input, { key: "ArrowLeft" });

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("press");
      expect(s[0].line).toBe("press ArrowLeft");
      expect(s[0].key).toBe("ArrowLeft");
      expect(s[0].target).toMatchObject({ role: "textbox", name: "Keys field" });
    });

    it("Ctrl+a in a text field records press Control+a", () => {
      const input = keysField();
      recorder.start("r1");
      key(input, { key: "a", ctrlKey: true });

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].line).toBe("press Control+a");
      expect(s[0].key).toBe("Control+a");
    });

    it("typing into a text field leaves the keys to the fill step", () => {
      const input = keysField();
      recorder.start("r1");
      key(input, { key: "x" });
      input.value = "hellox";
      fire(input, new Event("input", { bubbles: true, composed: true }));
      key(input, { key: "Backspace" });
      input.value = "hello";
      fire(input, new Event("input", { bubbles: true, composed: true }));

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("fill");
      expect(s[0].line).toBe('fill textbox "Keys field" "hello"');
    });

    it("a single printable key on the page body records press j with no target", () => {
      keysField();
      recorder.start("r1");
      key(document.body, { key: "j" });

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].kind).toBe("press");
      expect(s[0].line).toBe("press j");
      expect(s[0].target).toBeUndefined();
    });

    it("ArrowDown on the page body records press ArrowDown with no target", () => {
      recorder.start("r1");
      key(document.body, { key: "ArrowDown" });

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].line).toBe("press ArrowDown");
      expect(s[0].target).toBeUndefined();
    });

    it("Space on a button records press Space and targets the button", () => {
      document.body.innerHTML = '<button id="dbl" type="button">Double me</button>';
      const btn = document.getElementById("dbl") as HTMLButtonElement;
      recorder.start("r1");
      key(btn, { key: " " });

      const s = steps();
      expect(s).toHaveLength(1);
      expect(s[0].line).toBe("press Space");
      expect(s[0].key).toBe("Space");
      expect(s[0].target).toMatchObject({ role: "button", name: "Double me" });
    });

    it("holding a key records it once: a repeat keydown records nothing", () => {
      recorder.start("r1");
      key(document.body, { key: "ArrowDown", repeat: true });
      expect(steps()).toHaveLength(0);

      key(document.body, { key: "ArrowDown" });
      expect(steps()).toHaveLength(1);
    });

    it("a modifier on its own records nothing", () => {
      recorder.start("r1");
      key(document.body, { key: "Shift", shiftKey: true });
      key(document.body, { key: "Control", ctrlKey: true });
      key(document.body, { key: "Alt", altKey: true });
      key(document.body, { key: "Meta", metaKey: true });
      key(document.body, { key: "CapsLock" });

      expect(steps()).toHaveLength(0);
    });

    it("Shift+Tab records press Shift+Tab, and Tab alone still records press Tab", () => {
      const btn = document.createElement("button");
      btn.textContent = "OK";
      document.body.appendChild(btn);
      recorder.start("r1");
      key(btn, { key: "Tab", shiftKey: true });
      key(btn, { key: "Tab" });

      const s = steps();
      expect(s).toHaveLength(2);
      expect(s[0].line).toBe("press Shift+Tab");
      expect(s[0].key).toBe("Shift+Tab");
      expect(s[1].line).toBe("press Tab");
    });

    it("Meta+k and Alt+ArrowLeft record their full shortcut", () => {
      recorder.start("r1");
      key(document.body, { key: "k", metaKey: true });
      key(document.body, { key: "ArrowLeft", altKey: true });

      expect(steps().map((x) => x.line)).toEqual(["press Meta+k", "press Alt+ArrowLeft"]);
    });

    it("IME composition keys record nothing", () => {
      recorder.start("r1");
      key(document.body, { key: "Process", isComposing: true });
      key(document.body, { key: "Process" });
      key(document.body, { key: "Dead" });

      expect(steps()).toHaveLength(0);
    });

    it("an untrusted keydown records nothing", () => {
      recorder.start("r1");
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

      expect(steps()).toHaveLength(0);
    });

    it("a keydown inside the extension's own UI records nothing", () => {
      const wrapper = document.createElement("div");
      wrapper.setAttribute(EXTENSION_UI_ATTR, "true");
      const btn = document.createElement("button");
      btn.textContent = "X";
      wrapper.appendChild(btn);
      document.body.appendChild(wrapper);
      recorder.start("r1");
      key(btn, { key: "ArrowDown" });

      expect(steps()).toHaveLength(0);
    });

    it("Enter in a textarea still records press Enter, and the fill step still records the text", () => {
      document.body.innerHTML = '<textarea id="notes" aria-label="Notes"></textarea>';
      const area = document.getElementById("notes") as HTMLTextAreaElement;
      recorder.start("r1");
      area.value = "a\n";
      fire(area, new Event("input", { bubbles: true, composed: true }));
      key(area, { key: "Enter" });

      const s = steps();
      expect(s.map((x) => x.kind)).toEqual(["fill", "press"]);
      expect(s[1].line).toBe("press Enter");
      expect(s[1].target).toBeDefined();
    });

    it("ArrowRight on a focused range input records press ArrowRight, then the fill step", () => {
      document.body.innerHTML = '<label>Level <input type="range" id="range" min="0" max="10" value="2"></label>';
      const range = document.getElementById("range") as HTMLInputElement;
      recorder.start("r1");
      // Browser order: keydown first, then the value change and its input event.
      key(range, { key: "ArrowRight" });
      range.value = "3";
      fire(range, new Event("input", { bubbles: true, composed: true }));

      const s = steps();
      expect(s).toHaveLength(2);
      expect(s[0].kind).toBe("press");
      expect(s[0].line).toBe("press ArrowRight");
      expect(s[0].target).toMatchObject({ role: "slider", name: "Level" });
      expect(s[1].kind).toBe("fill");
      expect(s[1].line).toBe('fill slider "Level" "3"');
    });
  });
});
