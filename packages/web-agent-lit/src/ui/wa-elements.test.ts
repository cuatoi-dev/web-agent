import { afterEach, describe, expect, it, vi } from "vitest";
import { ICON_SVGS, iconNode } from "./icon-svgs.js";
import { defineUiElements } from "./registry.js";
import { WaButton, WaIconButton, WaIcon, WaCheckbox, WaProgress, WaWorkingDots } from "./wa-elements.js";
import { WaMenu } from "./wa-menu.js";
import { WaTextInput, WaTextArea } from "./wa-text-fields.js";

defineUiElements();
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });
const mount = <T extends HTMLElement>(tag: string): T => {
  const el = document.createElement(tag) as T;
  document.body.append(el);
  return el;
};

describe("default UI elements", () => {
  it("defines every tag in the contract", () => {
    for (const tag of ["wa-button", "wa-icon-button", "wa-icon", "wa-checkbox", "wa-menu", "wa-text-input", "wa-text-area", "wa-progress", "wa-working-dots"]) {
      expect(customElements.get(tag)).toBeDefined();
    }
    expect(() => defineUiElements()).not.toThrow();
  });
  it("wa-button keeps its inner node when props change", () => {
    const el = document.createElement("wa-button") as WaButton;
    el.label = "Go"; document.body.append(el);
    const inner = el.firstElementChild!;
    expect(inner.tagName).toBe("BUTTON");
    expect(inner.textContent).toBe("Go");
    expect(inner.className).toContain("wa-btn-primary");
    el.variant = "secondary"; el.label = "Stop";
    expect(el.firstElementChild).toBe(inner);
    expect(inner.className).toContain("wa-btn-secondary");
    expect(inner.textContent).toBe("Stop");
  });
  it("wa-button fires press, not when disabled", () => {
    const el = mount<WaButton>("wa-button");
    const onPress = vi.fn(); el.addEventListener("press", onPress);
    (el.firstElementChild as HTMLButtonElement).click();
    el.disabled = true; (el.firstElementChild as HTMLButtonElement).click();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it("wa-button reads string attributes", () => {
    const el = document.createElement("wa-button") as WaButton;
    el.setAttribute("label", "Hi"); document.body.append(el);
    expect(el.firstElementChild?.textContent).toBe("Hi");
  });
  it("wa-icon-button draws the SVG and swaps only the glyph", () => {
    const el = document.createElement("wa-icon-button") as WaIconButton;
    el.icon = "delete"; el.label = "Delete"; document.body.append(el);
    const inner = el.firstElementChild!; const svg = inner.firstElementChild;
    expect(svg?.localName).toBe("svg");
    expect(inner.textContent).not.toContain("delete");
    expect(inner.getAttribute("aria-label")).toBe("Delete");
    el.icon = "close";
    expect(el.firstElementChild).toBe(inner);
    expect(inner.firstElementChild).not.toBe(svg);
    expect(inner.firstElementChild?.localName).toBe("svg");
  });
  it("wa-checkbox fires checked-change and keeps its input", () => {
    const el = mount<WaCheckbox>("wa-checkbox");
    const input = el.querySelector("input")!;
    const onChange = vi.fn(); el.addEventListener("checked-change", onChange);
    input.click();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail.checked).toBe(true);
    el.checked = false;
    expect(el.querySelector("input")).toBe(input);
    expect(input.checked).toBe(false);
  });
  it("wa-menu renders items open or closed and fires select", () => {
    const el = document.createElement("wa-menu") as WaMenu;
    el.items = [{ id: "a", label: "A" }, { id: "b", label: "B", disabled: true }];
    document.body.append(el);
    const buttons = el.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    expect(buttons).toHaveLength(2);
    expect((el.firstElementChild as HTMLElement).style.display).toBe("none");
    const onSelect = vi.fn(); el.addEventListener("select", onSelect);
    buttons[0].click(); buttons[1].click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0][0] as CustomEvent).detail.id).toBe("a");
  });
  it("wa-menu draws each item icon before its label text", () => {
    const iconA = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>';
    const iconB = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16"/></svg>';
    const el = document.createElement("wa-menu") as WaMenu;
    el.items = [
      { id: "a", label: "Alpha", icon: iconA },
      { id: "b", label: "Beta", icon: iconB },
      { id: "c", label: "Gamma" },
    ];
    document.body.append(el);
    const buttons = el.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    expect(buttons).toHaveLength(3);
    for (const [i, expected] of [[0, "Alpha"], [1, "Beta"]] as const) {
      const btn = buttons[i];
      expect(btn.firstElementChild?.className).toContain("wa-menu-icon");
      expect(btn.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
      expect(btn.firstElementChild?.querySelector("svg")).not.toBeNull();
      expect(btn.lastChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(btn.lastChild?.textContent).toBe(expected);
    }
    expect(buttons[2].querySelector(".wa-menu-icon")).toBeNull();
    expect(buttons[2].textContent).toBe("Gamma");
  });
  it("wa-menu renders label only for icon strings that hold no SVG", () => {
    const el = document.createElement("wa-menu") as WaMenu;
    el.items = [
      { id: "a", label: "Empty", icon: "" },
      { id: "b", label: "Text", icon: "not markup" },
      { id: "c", label: "<b>label</b>", icon: '<div><svg viewBox="0 0 24 24"></svg><svg viewBox="0 0 24 24"></svg></div>' },
    ];
    document.body.append(el);
    const buttons = el.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    expect(buttons[0].querySelector(".wa-menu-icon")).toBeNull();
    expect(buttons[0].textContent).toBe("Empty");
    expect(buttons[1].querySelector(".wa-menu-icon")).toBeNull();
    expect(buttons[1].textContent).toBe("Text");
    expect(buttons[2].querySelectorAll(".wa-menu-icon svg").length).toBe(1);
    expect(buttons[2].querySelector("b")).toBeNull();
    expect(buttons[2].textContent).toBe("<b>label</b>");
  });
  it("wa-menu redraws a changed icon and keeps select on enabled items", () => {
    const el = document.createElement("wa-menu") as WaMenu;
    el.items = [{ id: "a", label: "Alpha", icon: '<svg viewBox="0 0 24 24"><circle r="6"/></svg>' }];
    document.body.append(el);
    const oldSvg = el.querySelector(".wa-menu-icon svg");
    el.items = [{ id: "a", label: "Alpha", icon: '<svg viewBox="0 0 24 24"><rect width="8" height="8"/></svg>' }];
    const newSvg = el.querySelector(".wa-menu-icon svg");
    expect(newSvg).not.toBe(oldSvg);
    expect(newSvg?.querySelector("rect")).not.toBeNull();
    expect(newSvg?.querySelector("circle")).toBeNull();

    el.items = [
      { id: "a", label: "Alpha", checked: true },
      { id: "b", label: "Beta", disabled: true },
    ];
    const onSelect = vi.fn(); el.addEventListener("select", onSelect);
    el.querySelectorAll<HTMLButtonElement>("[role=menuitem]").forEach((b) => b.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0][0] as CustomEvent).detail.id).toBe("a");
  });
  it("wa-menu keeps its item buttons when the same array is set again", () => {
    const el = mount<WaMenu>("wa-menu");
    const items = [{ id: "a", label: "A" }]; el.items = items;
    const first = el.querySelector("button");
    el.items = items; expect(el.querySelector("button")).toBe(first);
    el.items = [...items]; expect(el.querySelector("button")).not.toBe(first);
  });
  it("wa-menu listener balance", () => {
    const el = mount<WaMenu>("wa-menu"); el.setAttribute("anchor-id", "anc");
    const da = vi.spyOn(document, "addEventListener"); const dr = vi.spyOn(document, "removeEventListener");
    const wa = vi.spyOn(window, "addEventListener"); const wr = vi.spyOn(window, "removeEventListener");
    el.open = true; el.open = true; el.open = true; el.open = true;
    const own = (calls: unknown[][]) => calls.filter((c) => ["pointerdown", "keydown", "scroll", "resize"].includes(c[0] as string));
    expect(own(da.mock.calls)).toHaveLength(2); expect(own(wa.mock.calls)).toHaveLength(2);
    el.open = false;
    expect(own(dr.mock.calls)).toHaveLength(2); expect(own(wr.mock.calls)).toHaveLength(2);
    el.open = true; el.remove();
    expect(own(dr.mock.calls)).toHaveLength(4); expect(own(wr.mock.calls)).toHaveLength(4);
  });
  it("wa-menu Escape closes even when the panel stops propagation", () => {
    const host = document.createElement("div"); document.body.append(host);
    host.addEventListener("keydown", (e) => e.stopPropagation());
    const el = document.createElement("wa-menu") as WaMenu; el.items = [{ id: "a", label: "A" }]; host.append(el);
    const close = vi.fn(); el.addEventListener("request-close", close); el.open = true;
    el.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("wa-menu outside pointerdown", () => {
    const anchor = document.createElement("button"); anchor.id = "anc"; document.body.append(anchor);
    const el = mount<WaMenu>("wa-menu"); el.setAttribute("anchor-id", "anc");
    el.items = [{ id: "a", label: "A" }]; const close = vi.fn(); el.addEventListener("request-close", close); el.open = true;
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    anchor.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    el.querySelector("button")!.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("wa-menu finds its anchor inside a shadow root", async () => {
    const host = document.createElement("div"); document.body.append(host); const root = host.attachShadow({ mode: "open" });
    const anchor = document.createElement("button"); anchor.id = "anc"; root.append(anchor);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: 10, right: 40, top: 20, bottom: 50, width: 30, height: 30 } as DOMRect);
    const el = document.createElement("wa-menu") as WaMenu; el.setAttribute("anchor-id", "anc"); root.append(el); el.open = true;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((el.firstElementChild as HTMLElement).style.top).toBe("50px");
    expect((el.firstElementChild as HTMLElement).style.left).toBe("10px");
  });
  it("wa-menu uses the anchor next to it when another panel repeats the anchor id", async () => {
    const other = document.createElement("div"); other.hidden = true;
    const otherAnchor = document.createElement("button"); otherAnchor.id = "anc"; other.append(otherAnchor);
    const panel = document.createElement("div");
    const anchor = document.createElement("button"); anchor.id = "anc"; panel.append(anchor);
    document.body.append(other, panel);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: 10, right: 40, top: 20, bottom: 50, width: 30, height: 30 } as DOMRect);
    const el = document.createElement("wa-menu") as WaMenu; el.setAttribute("anchor-id", "anc"); panel.append(el); el.open = true;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((el.firstElementChild as HTMLElement).style.top).toBe("50px");
    expect((el.firstElementChild as HTMLElement).style.left).toBe("10px");
  });
  it("wa-menu items carry the hover class and no inline background", () => {
    const el = document.createElement("wa-menu") as WaMenu;
    el.items = [{ id: "a", label: "A" }]; document.body.append(el);
    const button = el.querySelector<HTMLButtonElement>("[role=menuitem]")!;
    expect(button.classList.contains("wa-menu-item")).toBe(true);
    expect(button.style.background).toBe("");
  });
  it("wa-text-input applies type, min, max and fires value-input", () => {
    const el = document.createElement("wa-text-input") as WaTextInput;
    el.type = "number"; el.min = 1; el.max = 5; document.body.append(el);
    const input = el.querySelector("input")!;
    expect(input.type).toBe("number"); expect(input.getAttribute("min")).toBe("1"); expect(input.getAttribute("max")).toBe("5");
    el.min = undefined; expect(input.hasAttribute("min")).toBe(false);
    const onInput = vi.fn(); el.addEventListener("value-input", onInput);
    input.value = "3"; input.dispatchEvent(new Event("input", { bubbles: true }));
    expect((onInput.mock.calls[0][0] as CustomEvent).detail.value).toBe("3");
  });
  it("wa-text-area fires value-input and resetHeight clears it", () => {
    const el = mount<WaTextArea>("wa-text-area"); const area = el.querySelector("textarea")!;
    const onInput = vi.fn(); el.addEventListener("value-input", onInput);
    area.value = "hi"; area.dispatchEvent(new Event("input", { bubbles: true }));
    expect((onInput.mock.calls[0][0] as CustomEvent).detail.value).toBe("hi");
    el.resetHeight(); expect(area.value).toBe("");
  });
  it("wa-progress and wa-working-dots", () => {
    const p = document.createElement("wa-progress") as WaProgress; p.indeterminate = true; document.body.append(p);
    expect(p.querySelector("progress")!.hasAttribute("value")).toBe(false);
    expect(mount<WaWorkingDots>("wa-working-dots").querySelectorAll("span")).toHaveLength(3);
  });

  /** The dots fade and pulse from timers, not from a CSS animation: a running
   *  `@keyframes` keeps Blink stepping `DocumentAnimations` on the main thread
   *  on every frame for the whole turn. */
  describe("wa-working-dots timing", () => {
    const mountDots = (): { el: WaWorkingDots; wrap: HTMLElement; dots: HTMLElement[] } => {
      vi.useFakeTimers();
      const el = mount<WaWorkingDots>("wa-working-dots");
      const wrap = el.firstElementChild as HTMLElement;
      const dots = Array.from(wrap.querySelectorAll("span")) as HTMLElement[];
      return { el, wrap, dots };
    };
    const frame = (dots: HTMLElement[]) => dots.map((d) => d.style.transform).join("|");

    it("starts transparent and fades in at 400 ms", () => {
      const { wrap } = mountDots();
      expect(wrap.style.opacity).toBe("0");
      vi.advanceTimersByTime(399);
      expect(wrap.style.opacity).toBe("0");
      vi.advanceTimersByTime(1);
      expect(wrap.style.opacity).toBe("1");
    });

    it("cycles the dot scales every 350 ms, and every dot reaches full scale", () => {
      const { dots } = mountDots();
      const frames = [frame(dots)];
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(350);
        frames.push(frame(dots));
      }
      expect(new Set(frames).size).toBe(4);
      for (let dot = 0; dot < 3; dot++) {
        expect(frames.some((f) => f.split("|")[dot] === "scale(1)")).toBe(true);
      }
    });

    it("leaves a frozen dot at its parked scale", () => {
      const { dots } = mountDots();
      dots[1].style.animation = "none";
      dots[1].style.transform = "scale(1)";
      vi.advanceTimersByTime(350 * 2);
      expect(dots[1].style.transform).toBe("scale(1)");
      expect(dots[0].style.transform).not.toBe("scale(1)");
    });

    /** Two of the twelve per-cycle writes repeat the value already on the dot
     *  (dot 0 from step 2 to 3, dot 2 from step 3 to 0). A repeated write still
     *  dirties the style attribute and costs a style recalculation, so the
     *  frame must skip it. */
    it("writes only the dots whose scale changes", () => {
      const { dots } = mountDots();
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
      // Step 3 of the cycle holds dot 0 at scale(0.2), where step 2 left it.
      vi.advanceTimersByTime(350 * 3);
      expect(writes).toEqual([2, 3, 3]);
      expect(dots[0].style.transform).toBe("scale(0.2)");
      // Step 0 then holds dot 2 at scale(0.2), where step 3 left it.
      vi.advanceTimersByTime(350);
      expect(writes).toEqual([3, 4, 3]);
      expect(dots[2].style.transform).toBe("scale(0.2)");
    });

    it("stops both timers when the element is removed", () => {
      const { el, wrap, dots } = mountDots();
      el.remove();
      const frozen = frame(dots);
      vi.advanceTimersByTime(350 * 10);
      expect(frame(dots)).toBe(frozen);
      // Still transparent: the 400 ms fade timer was cleared, not just the pulse.
      expect(wrap.style.opacity).toBe("0");
    });

    /** A hidden tab cannot show the pulse, so a tick there is pure cost: it
     *  still commits, re-lays out and re-layers the dots. */
    it("skips a pulse tick while the document is hidden", () => {
      const { dots } = mountDots();
      const first = frame(dots);
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      try {
        vi.advanceTimersByTime(350 * 2);
        expect(frame(dots)).toBe(first);
      } finally {
        delete (document as unknown as { hidden?: unknown }).hidden;
      }
      vi.advanceTimersByTime(350);
      expect(frame(dots)).not.toBe(first);
    });
  });

  /** The composer textarea grows to fit its text. A keystroke that cannot have
   *  made the text shorter and still fits the box must not measure or write
   *  anything: it used to force three layouts and three style recalcs per key. */
  describe("wa-text-area auto-grow", () => {
    /** The panel height cap is read from the nearest `<agent-chat-panel>`, so
     *  the element is mounted inside one, as the real composer is. */
    const mountArea = (): { area: HTMLTextAreaElement; panel: HTMLElement; box: { clientHeight: number; scrollHeight: number } } => {
      const panel = document.createElement("agent-chat-panel");
      const el = document.createElement("wa-text-area");
      panel.append(el);
      document.body.append(panel);
      const area = el.querySelector("textarea")!;
      const box = { clientHeight: 40, scrollHeight: 40 };
      Object.defineProperty(area, "clientHeight", { configurable: true, get: () => box.clientHeight });
      Object.defineProperty(area, "scrollHeight", { configurable: true, get: () => box.scrollHeight });
      return { area, panel, box };
    };
    const type = (area: HTMLTextAreaElement, value: string): void => {
      area.value = value;
      area.dispatchEvent(new Event("input", { bubbles: true }));
    };

    it("measures nothing while the text still fits the box", () => {
      const { area, panel } = mountArea();
      const rect = vi.spyOn(panel, "getBoundingClientRect");
      type(area, "hello");
      type(area, "hello there");
      expect(rect).not.toHaveBeenCalled();
      expect(area.style.height).toBe("");
    });

    it("grows when the text overflows, and shrinks again when a line is deleted", () => {
      const { area, panel, box } = mountArea();
      vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ height: 600 } as DOMRect);
      box.scrollHeight = 80;
      type(area, "a\nb");
      expect(area.style.height).toBe("80px");
      box.scrollHeight = 40;
      type(area, "a");
      expect(area.style.height).toBe("40px");
    });
  });
  it("wa-icon draws the SVG with aria-hidden when unlabeled", () => {
    const el = document.createElement("wa-icon") as WaIcon; el.name = "history"; document.body.append(el);
    const span = el.querySelector("span.wa-icon")!;
    expect(span.querySelector("svg")).not.toBeNull(); expect(span.getAttribute("aria-hidden")).toBe("true");
    el.label = "History";
    expect(span.getAttribute("role")).toBe("img"); expect(span.getAttribute("aria-label")).toBe("History");
    expect(span.hasAttribute("aria-hidden")).toBe(false);
  });
  it("ICON_SVGS includes inline visibility and visibility_off icons without URLs", () => {
    for (const name of ["visibility", "visibility_off"] as const) {
      expect(typeof ICON_SVGS[name]).toBe("string");
      expect(ICON_SVGS[name]).not.toMatch(/https?:|url\(/i);
      const node = iconNode(name);
      expect(node.localName).toBe("svg");
      expect(node.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(node.querySelector("path")?.getAttribute("d") ?? "").not.toBe("");
    }
    expect(iconNode("visibility").outerHTML).not.toBe(iconNode("visibility_off").outerHTML);
  });
});
