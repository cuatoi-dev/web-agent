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
  /** Length and line count of the last measurement, so a keystroke that cannot
   *  have made the text shorter can take the no-write fast path. */
  private _prevLen = 0;
  private _prevLines = 1;
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
  /** Grow the field to fit its text, capped at half the panel height.
   *
   *  A keystroke that cannot have made the text shorter and whose text still
   *  fits the current box height returns before the first style write, so it
   *  costs no style recalculation and no forced layout. Before this, every key
   *  wrote `height: auto` and read `scrollHeight`, which a profile of a 55-key
   *  question showed as three layouts and three style recalcs per key.
   *
   *  Reading `scrollHeight` is the measurement itself, so it cannot be
   *  avoided. It is cheap only while the box is already dirty, which the
   *  height writes above guarantee. */
  private adjustHeight(): void {
    const f = this._field!;
    const val = f.value ?? "";
    let lines = 1;
    for (let i = 0; i < val.length; i++) {
      if (val.charCodeAt(i) === 10) lines++;
    }
    const shrank = val.length < this._prevLen || lines < this._prevLines;
    this._prevLen = val.length;
    this._prevLines = lines;

    // Text still fits the box and nothing was deleted: the box is already the
    // right height, so there is nothing to measure or write.
    if (f.clientHeight > 0 && !shrank && f.scrollHeight <= f.clientHeight) {
      return;
    }
    if (shrank && (!f.style.height || f.style.height === "auto")) {
      return;
    }

    f.style.height = "auto";
    const wrapper = this._inner!;
    const panel = wrapper.closest("agent-chat-panel") || wrapper.closest(".wa-panel") || wrapper.parentElement;
    const maxPx = (panel ? panel.getBoundingClientRect().height : 600) * 0.5;
    const scrollH = f.scrollHeight;
    if (scrollH > maxPx) { f.style.height = `${maxPx}px`; f.style.overflowY = "auto"; }
    else { f.style.height = val.length === 0 ? "auto" : `${scrollH}px`; f.style.overflowY = "hidden"; }
  }
  resetHeight(): void {
    this._value = "";
    this._prevLen = 0;
    this._prevLines = 1;
    const f = this._field;
    if (!f) return;
    f.value = "";
    f.style.height = "auto";
    f.style.overflowY = "hidden";
  }
}
