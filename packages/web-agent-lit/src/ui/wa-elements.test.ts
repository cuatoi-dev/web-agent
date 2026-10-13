import { afterEach, describe, expect, it, vi } from "vitest";
import { defineUiElements } from "./registry.js";
import { WaButton, WaIconButton, WaIcon, WaCheckbox, WaProgress, WaWorkingDots } from "./wa-elements.js";
import { WaMenu } from "./wa-menu.js";
import { WaTextInput, WaTextArea } from "./wa-text-fields.js";

defineUiElements();
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
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
  it("wa-icon draws the SVG with aria-hidden when unlabeled", () => {
    const el = document.createElement("wa-icon") as WaIcon; el.name = "history"; document.body.append(el);
    const span = el.querySelector("span.wa-icon")!;
    expect(span.querySelector("svg")).not.toBeNull(); expect(span.getAttribute("aria-hidden")).toBe("true");
    el.label = "History";
    expect(span.getAttribute("role")).toBe("img"); expect(span.getAttribute("aria-label")).toBe("History");
    expect(span.hasAttribute("aria-hidden")).toBe(false);
  });
});
