import { WaElement } from "./wa-element-base.js";

export class WaTextInput extends WaElement {
  static get observedAttributes() { return ["value", "placeholder", "type", "min", "max", "name"]; }
  private _value = "";
  private _placeholder = "";
  private _disabled = false;
  private _type = "text";
  private _min: string | number | undefined;
  private _max: string | number | undefined;
  private _required = false;
  private _name = "";
  private _field: HTMLInputElement | null = null;
  get value() { return this._value; }
  set value(v: string) { if (v === this._value) return; this._value = v; if (this._inner) this.sync(); }
  get placeholder() { return this._placeholder; }
  set placeholder(v: string) { if (v === this._placeholder) return; this._placeholder = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  get type() { return this._type; }
  set type(v: string) { if (v === this._type) return; this._type = v; if (this._inner) this.sync(); }
  get min() { return this._min; }
  set min(v: string | number | undefined) { if (v === this._min) return; this._min = v; if (this._inner) this.sync(); }
  get max() { return this._max; }
  set max(v: string | number | undefined) { if (v === this._max) return; this._max = v; if (this._inner) this.sync(); }
  get required() { return this._required; }
  set required(v: boolean) { if (v === this._required) return; this._required = v; if (this._inner) this.sync(); }
  get name() { return this._name; }
  set name(v: string) { if (v === this._name) return; this._name = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "wa-input-container";
    const input = document.createElement("input");
    input.className = "wa-input";
    input.addEventListener("input", () => { this._value = input.value; this.fire("value-input", { value: input.value }); });
    wrapper.append(input);
    this._field = input;
    return wrapper;
  }
  protected sync(): void {
    const f = this._field!;
    if (f.type !== this._type) f.type = this._type;
    if (f.value !== this._value) f.value = this._value;
    f.placeholder = this._placeholder;
    f.disabled = this._disabled;
    this._inner!.classList.toggle("disabled", this._disabled);
    for (const [attr, v] of [["min", this._min], ["max", this._max]] as const) {
      if (v === undefined || v === "") f.removeAttribute(attr);
      else f.setAttribute(attr, String(v));
    }
    f.required = this._required;
    if (this._name) f.name = this._name; else f.removeAttribute("name");
  }
}

export class WaTextArea extends WaElement {
  static get observedAttributes() { return ["value", "placeholder"]; }
  private _value = "";
  private _placeholder = "";
  private _disabled = false;
  private _field: HTMLTextAreaElement | null = null;
  get value() { return this._value; }
  set value(v: string) { if (v === this._value) return; this._value = v; if (this._inner) this.sync(); }
  get placeholder() { return this._placeholder; }
  set placeholder(v: string) { if (v === this._placeholder) return; this._placeholder = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "wa-input-container";
    const textarea = document.createElement("textarea");
    textarea.className = "wa-textarea";
    textarea.rows = 1;
    textarea.addEventListener("input", () => {
      this.adjustHeight();
      this._value = textarea.value;
      this.fire("value-input", { value: textarea.value });
    });
    wrapper.append(textarea);
    this._field = textarea;
    return wrapper;
  }
  protected sync(): void {
    const f = this._field!;
    if (f.value !== this._value) { f.value = this._value; this.adjustHeight(); }
    f.placeholder = this._placeholder;
    f.disabled = this._disabled;
    this._inner!.classList.toggle("disabled", this._disabled);
  }
  private adjustHeight(): void {
    const f = this._field!;
    f.style.height = "auto";
    const wrapper = this._inner!;
    const panel = wrapper.closest("agent-chat-panel") || wrapper.closest(".wa-panel") || wrapper.parentElement;
    const maxPx = (panel ? panel.getBoundingClientRect().height : 600) * 0.5;
    const scrollH = f.scrollHeight;
    if (scrollH > maxPx) { f.style.height = `${maxPx}px`; f.style.overflowY = "auto"; }
    else { f.style.height = `${scrollH}px`; f.style.overflowY = "hidden"; }
  }
  resetHeight(): void {
    this._value = "";
    const f = this._field;
    if (!f) return;
    f.value = "";
    f.style.height = "auto";
    f.style.overflowY = "hidden";
  }
}
