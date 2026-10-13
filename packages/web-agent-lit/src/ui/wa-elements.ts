import { WaElement } from "./wa-element-base.js";
import { iconNode } from "./icon-svgs.js";
import { WaMenu } from "./wa-menu.js";
import { WaTextInput, WaTextArea } from "./wa-text-fields.js";
import type { WaButtonVariant, WaElementEntry } from "./types.js";

export class WaButton extends WaElement {
  static get observedAttributes() { return ["label", "variant"]; }
  private _label = "";
  private _variant: WaButtonVariant = "primary";
  private _disabled = false;
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  get variant() { return this._variant; }
  set variant(v: WaButtonVariant) { if (v === this._variant) return; this._variant = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const b = document.createElement("button");
    b.addEventListener("click", (e) => {
      if (this._disabled) { e.preventDefault(); e.stopPropagation(); return; }
      this.fire("press");
    });
    return b;
  }
  protected sync(): void {
    const b = this._inner as HTMLButtonElement;
    b.className = this._variant === "secondary" ? "border wa-btn wa-btn-secondary"
      : this._variant === "danger" ? "error wa-btn wa-btn-danger"
      : "primary wa-btn wa-btn-primary";
    if (b.textContent !== this._label) b.textContent = this._label;
    b.disabled = this._disabled;
    b.classList.toggle("disabled", this._disabled);
  }
}

export class WaIconButton extends WaElement {
  static get observedAttributes() { return ["icon", "label"]; }
  private _icon = "";
  private _label = "";
  private _disabled = false;
  private _drawnIcon: string | null = null;
  get icon() { return this._icon; }
  set icon(v: string) { if (v === this._icon) return; this._icon = v; if (this._inner) this.sync(); }
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const b = document.createElement("button");
    b.className = "circle transparent wa-icon-btn";
    b.addEventListener("click", () => { if (!this._disabled) this.fire("press"); });
    return b;
  }
  protected sync(): void {
    const b = this._inner as HTMLButtonElement;
    b.disabled = this._disabled;
    b.setAttribute("aria-label", this._label);
    if (this._drawnIcon !== this._icon) {
      b.replaceChildren(iconNode(this._icon));
      this._drawnIcon = this._icon;
    }
  }
}

export class WaIcon extends WaElement {
  static get observedAttributes() { return ["name", "label"]; }
  private _name = "";
  private _label = "";
  private _drawnName: string | null = null;
  get name() { return this._name; }
  set name(v: string) { if (v === this._name) return; this._name = v; if (this._inner) this.sync(); }
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement { const span = document.createElement("span"); span.className = "wa-icon"; return span; }
  protected sync(): void {
    const span = this._inner!;
    if (this._label) {
      span.setAttribute("aria-label", this._label);
      span.setAttribute("role", "img");
      span.removeAttribute("aria-hidden");
    } else {
      span.removeAttribute("aria-label");
      span.removeAttribute("role");
      span.setAttribute("aria-hidden", "true");
    }
    if (this._drawnName !== this._name) {
      span.replaceChildren(iconNode(this._name));
      this._drawnName = this._name;
    }
  }
}

export class WaCheckbox extends WaElement {
  static get observedAttributes() { return ["label"]; }
  private _checked = false;
  private _label = "";
  private _disabled = false;
  private _input: HTMLInputElement | null = null;
  private _text: HTMLSpanElement | null = null;
  get checked() { return this._checked; }
  set checked(v: boolean) { if (v === this._checked) return; this._checked = v; if (this._inner) this.sync(); }
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox wa-checkbox-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "wa-checkbox";
    input.addEventListener("change", () => {
      this._checked = input.checked;
      this.fire("checked-change", { checked: input.checked });
    });
    const span = document.createElement("span");
    wrapper.append(input, span);
    this._input = input;
    this._text = span;
    return wrapper;
  }
  protected sync(): void {
    this._input!.checked = this._checked;
    this._input!.disabled = this._disabled;
    if (this._text!.textContent !== this._label) this._text!.textContent = this._label;
  }
}

export class WaProgress extends WaElement {
  private _indeterminate = false;
  get indeterminate() { return this._indeterminate; }
  set indeterminate(v: boolean) { if (v === this._indeterminate) return; this._indeterminate = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement { const p = document.createElement("progress"); p.className = "primary wa-progress"; return p; }
  protected sync(): void {
    const p = this._inner as HTMLProgressElement;
    if (this._indeterminate) p.removeAttribute("value"); else p.value = 0;
  }
}

export class WaWorkingDots extends WaElement {
  protected build(): HTMLElement {
    const el = document.createElement("div");
    el.className = "wa-working-dots";
    el.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    return el;
  }
  protected sync(): void {}
}

/** Every tag of the default registry. */
export const DEFAULT_ELEMENTS: readonly WaElementEntry[] = [
  ["wa-button", WaButton],
  ["wa-icon-button", WaIconButton],
  ["wa-icon", WaIcon],
  ["wa-checkbox", WaCheckbox],
  ["wa-menu", WaMenu],
  ["wa-text-input", WaTextInput],
  ["wa-text-area", WaTextArea],
  ["wa-progress", WaProgress],
  ["wa-working-dots", WaWorkingDots],
];
