import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/checkbox/checkbox.js";
import "@material/web/progress/linear-progress.js";
import { AcmeElement } from "./acme-element-base";
import { iconNode } from "./acme-icon-svgs";
import { AcmeMenu, AcmeTextInput, AcmeTextArea } from "./acme-fields";
import type { WaButtonVariant, WaElementEntry } from "@cuatoi/web-agent-lit";

export class AcmeButton extends AcmeElement {
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
  private make(): HTMLElement {
    const btn = document.createElement(this._variant === "secondary" ? "md-outlined-button" : "md-filled-button");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._disabled) { e.preventDefault(); return; }
      this.fire("press");
    });
    return btn;
  }
  protected build(): HTMLElement { return this.make(); }
  protected sync(): void {
    const wanted = this._variant === "secondary" ? "md-outlined-button" : "md-filled-button";
    if (this._inner!.localName !== wanted) {
      const root = this.getRootNode() as Document | ShadowRoot;
      const hadFocus = root.activeElement === this._inner;
      const next = this.make() as HTMLElement & { updateComplete?: Promise<boolean> };
      this._inner!.replaceWith(next);
      this._inner = next;
      if (hadFocus) {
        next.focus();
        if (root.activeElement !== next) {
          void next.updateComplete?.then(() => { if (this._inner === next) next.focus(); });
        }
      }
    }
    const btn = this._inner as HTMLElement & { disabled: boolean };
    if (btn.textContent !== this._label) btn.textContent = this._label;
    btn.disabled = this._disabled;
    if (this._variant === "danger") {
      btn.style.setProperty("--md-filled-button-container-color", "var(--wa-action-color-error, #d93025)");
      btn.style.setProperty("--md-filled-button-label-text-color", "var(--wa-action-text-color-error, #ffffff)");
    } else {
      btn.style.removeProperty("--md-filled-button-container-color");
      btn.style.removeProperty("--md-filled-button-label-text-color");
    }
  }
}

export class AcmeIconButton extends AcmeElement {
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
    const btn = document.createElement("md-icon-button");
    btn.addEventListener("click", (e) => { e.stopPropagation(); if (!this._disabled) this.fire("press"); });
    return btn;
  }
  protected sync(): void {
    const btn = this._inner as HTMLElement & { disabled: boolean };
    btn.disabled = this._disabled;
    btn.setAttribute("aria-label", this._label);
    if (this._drawnIcon !== this._icon) { btn.replaceChildren(iconNode(this._icon)); this._drawnIcon = this._icon; }
  }
}

export class AcmeIcon extends AcmeElement {
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
    if (this._label) { span.setAttribute("aria-label", this._label); span.setAttribute("role", "img"); span.removeAttribute("aria-hidden"); }
    else { span.removeAttribute("aria-label"); span.removeAttribute("role"); span.setAttribute("aria-hidden", "true"); }
    if (this._drawnName !== this._name) { span.replaceChildren(iconNode(this._name)); this._drawnName = this._name; }
  }
}

export class AcmeCheckbox extends AcmeElement {
  static get observedAttributes() { return ["label"]; }
  private _checked = false;
  private _label = "";
  private _disabled = false;
  private _input: (HTMLElement & { checked: boolean; disabled: boolean }) | null = null;
  private _text: HTMLSpanElement | null = null;
  get checked() { return this._checked; }
  set checked(v: boolean) { if (v === this._checked) return; this._checked = v; if (this._inner) this.sync(); }
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "8px";
    wrapper.style.cursor = "pointer";
    wrapper.style.fontFamily = "inherit";
    const cb = document.createElement("md-checkbox") as HTMLElement & { checked: boolean; disabled: boolean };
    cb.addEventListener("change", () => { this._checked = cb.checked; this.fire("checked-change", { checked: cb.checked }); });
    const span = document.createElement("span");
    span.style.color = "var(--wa-text-color, #202124)";
    wrapper.append(cb, span);
    this._input = cb;
    this._text = span;
    return wrapper;
  }
  protected sync(): void {
    this._input!.checked = this._checked;
    this._input!.disabled = this._disabled;
    if (this._text!.textContent !== this._label) this._text!.textContent = this._label;
  }
}

export class AcmeProgress extends AcmeElement {
  private _indeterminate = false;
  get indeterminate() { return this._indeterminate; }
  set indeterminate(v: boolean) { if (v === this._indeterminate) return; this._indeterminate = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement { const p = document.createElement("md-linear-progress"); p.style.width = "100%"; return p; }
  protected sync(): void { (this._inner as HTMLElement & { indeterminate: boolean }).indeterminate = this._indeterminate; }
}

export class AcmeWorkingDots extends AcmeElement {
  protected build(): HTMLElement {
    const el = document.createElement("div");
    el.className = "wa-working-dots";
    el.style.display = "flex";
    el.style.gap = "4px";
    el.style.padding = "12px 16px";
    el.style.alignItems = "center";
    el.style.animation = "wa-fade-in 0.2s 400ms both";
    el.innerHTML = `<style>
      @keyframes wa-bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
      @keyframes wa-fade-in { from { opacity: 0; } to { opacity: 1; } }
    </style>
    <span style="width:6px;height:6px;border-radius:50%;background:var(--wa-text-color, #c4c7c5);animation:wa-bounce 1.4s infinite ease-in-out both;animation-delay:-0.32s"></span>
    <span style="width:6px;height:6px;border-radius:50%;background:var(--wa-text-color, #c4c7c5);animation:wa-bounce 1.4s infinite ease-in-out both;animation-delay:-0.16s"></span>
    <span style="width:6px;height:6px;border-radius:50%;background:var(--wa-text-color, #c4c7c5);animation:wa-bounce 1.4s infinite ease-in-out both;"></span>`;
    return el;
  }
  protected sync(): void {}
}

export const ACME_ELEMENTS: readonly WaElementEntry[] = [
  ["wa-button", AcmeButton], ["wa-icon-button", AcmeIconButton],
  ["wa-icon", AcmeIcon], ["wa-checkbox", AcmeCheckbox],
  ["wa-menu", AcmeMenu], ["wa-text-input", AcmeTextInput],
  ["wa-text-area", AcmeTextArea], ["wa-progress", AcmeProgress],
  ["wa-working-dots", AcmeWorkingDots],
];
