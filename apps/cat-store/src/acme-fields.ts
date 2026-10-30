import "@material/web/menu/menu.js";
import "@material/web/menu/menu-item.js";
import "@material/web/textfield/outlined-text-field.js";
import { AcmeElement } from "./acme-element-base";
import type { WaMenuItem } from "@cuatoi/web-agent-lit";
import type { MaterialField, MdMenuInternal } from "./acme-fields.types";

/** Newline count plus one — the number of lines the text occupies when it
 *  wraps nowhere. Counted from the text instead of read from the DOM, so the
 *  shrink check needs no layout. */
function countLines(s: string): number {
  let n = 1;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++;
  }
  return n;
}

export class AcmeMenu extends AcmeElement {
  private _open = false;
  private _items: WaMenuItem[] = [];
  private _attached = false;
  get open() { return this._open; }
  set open(v: boolean) {
    this._open = !!v;
    if (this.isConnected) { if (this._open) this.attach(); else this.detach(); }
    if (this._inner) this.sync();
  }
  get items() { return this._items; }
  set items(v: WaMenuItem[]) {
    if (v === this._items) return;
    this._items = v;
    if (this._inner) this.renderItems();
  }
  connectedCallback(): void { super.connectedCallback(); if (this._open) this.attach(); }
  disconnectedCallback(): void { this.detach(); }
  protected build(): HTMLElement {
    const md = document.createElement("md-menu") as unknown as MdMenuInternal;
    md.anchor = "";
    const ctrl = md.menuPositionController;
    if (ctrl && typeof ctrl.close === "function") {
      const origClose = ctrl.close.bind(ctrl);
      ctrl.close = () => {
        if (this._open || md.open) return;
        origClose();
      };
    }
    md.addEventListener("closed", () => {
      if (this._open) {
        if (md.open) {
          md.reposition?.();
        } else {
          this.fire("request-close");
        }
      }
    });
    this._inner = md;
    this.renderItems();
    return md;
  }
  protected sync(): void {
    const md = this._inner as MdMenuInternal | null;
    if (!md) return;
    if (this._open) {
      md.anchor = "";
      const anchor = this.anchor();
      if (anchor) md.anchorElement = anchor;
    }
    md.open = this._open;
  }
  private renderItems(): void {
    const items = this._items.map((item) => {
      const mi = document.createElement("md-menu-item") as unknown as HTMLElement & {
        disabled: boolean;
        renderRipple?: () => string;
      };
      // No ripple element is created for a menu row; the hover background is a
      // CSS rule in ACME_PANEL_MD_STYLES instead.
      mi.renderRipple = () => "";
      const headline = document.createElement("div");
      headline.setAttribute("slot", "headline");
      headline.textContent = item.label;
      mi.append(headline);
      mi.disabled = !!item.disabled;
      if (!item.disabled) mi.addEventListener("click", (e) => { e.stopPropagation(); this.fire("select", { id: item.id }); });
      return mi;
    });
    this._inner!.replaceChildren(...items);
  }
  private attach(): void {
    if (this._attached) return;
    this._attached = true;
    document.addEventListener("pointerdown", this._onOutside, { capture: true });
    document.addEventListener("keydown", this._onKey, { capture: true });
    const anchor = this.anchor();
    if (anchor) (this._inner as HTMLElement & { anchorElement: HTMLElement | null }).anchorElement = anchor;
  }
  private detach(): void {
    if (!this._attached) return;
    document.removeEventListener("pointerdown", this._onOutside, { capture: true });
    document.removeEventListener("keydown", this._onKey, { capture: true });
    this._attached = false;
  }
  private readonly _onOutside = (e: Event): void => {
    const path = e.composedPath();
    const anchor = this.anchor();
    if (path.includes(this) || (anchor && path.includes(anchor))) return;
    this.fire("request-close");
  };
  private readonly _onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.fire("request-close");
  };
  private anchor(): HTMLElement | null {
    const id = this.getAttribute("anchor-id");
    if (!id) return null;
    return (this.getRootNode() as Document | ShadowRoot).getElementById?.(id) ?? document.getElementById(id);
  }
}

export class AcmeTextInput extends AcmeElement {
  static get observedAttributes() { return ["value", "placeholder", "type", "min", "max", "name"]; }
  private _value = "";
  private _placeholder = "";
  private _disabled = false;
  private _type = "text";
  private _min: string | number | undefined;
  private _max: string | number | undefined;
  private _required = false;
  private _name = "";
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
    const field = document.createElement("md-outlined-text-field") as unknown as MaterialField;
    field.style.width = "100%";
    field.addEventListener("input", () => { this._value = field.value; this.fire("value-input", { value: field.value }); });
    return field;
  }
  protected sync(): void {
    const f = this._inner as MaterialField;
    if (f.value !== this._value) f.value = this._value;
    f.placeholder = this._placeholder;
    f.disabled = this._disabled;
    f.type = this._type;
    f.min = this._min === undefined ? "" : String(this._min);
    f.max = this._max === undefined ? "" : String(this._max);
    f.required = this._required;
    f.name = this._name;
  }
}

export class AcmeTextArea extends AcmeElement {
  static get observedAttributes() { return ["value", "placeholder"]; }
  private _value = "";
  private _placeholder = "";
  private _disabled = false;
  /** Length and line count of the last measurement, so a keystroke that cannot
   *  have made the text shorter can take the no-write fast path. */
  private _prevLen = 0;
  private _prevLines = 1;
  /** Height the Material field spends on its own chrome (label, padding) around
   *  the inner `<textarea>`. Measured once, because it does not change. */
  private _chromePx: number | null = null;
  /** The field's inner `<textarea>`, once its shadow root exists. A keystroke
   *  would otherwise query the shadow root again on every `input` event. */
  private _textarea: HTMLTextAreaElement | null = null;
  /** Set once `value` is bound to the shadow `<textarea>`. A keystroke that
   *  lands before the deferred bind runs binds it immediately, so the typed
   *  text is never read from the silenced Material property. */
  private _directValueBound = false;
  get value() { return this._value; }
  set value(v: string) { if (v === this._value) return; this._value = v; if (this._inner) this.sync(); }
  get placeholder() { return this._placeholder; }
  set placeholder(v: string) { if (v === this._placeholder) return; this._placeholder = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const field = document.createElement("md-outlined-text-field") as unknown as MaterialField;
    field.type = "textarea";
    field.rows = 1;
    field.style.width = "100%";
    // Replace Material's per-keystroke reactive `handleInput` before first
    // Lit render so typing into the shadow `<textarea>` skips FormAssociated,
    // ConstraintValidation, and `<md-outlined-field count=...>` re-renders.
    field.handleInput = () => {};
    field.addEventListener("input", (e) => {
      const inner = this._getInnerTextarea(field);
      if (
        !this._directValueBound &&
        inner &&
        inner.isConnected &&
        (e.composedPath()[0] === inner || inner.value.length > 0)
      ) {
        this._bindDirectValue(field);
      }
      this.adjustHeight();
      const val = this._readFieldValue(field, e);
      this._value = val;
      this.fire("value-input", { value: val });
    });
    this.setOneRow(field);
    // `value` is bound after the field's first render, not in `build()`: an own
    // `value` accessor on a Lit element before its first update makes Lit's dev
    // build throw a class-field-shadowing error, which aborts that update and
    // every later one. By this point the field has rendered.
    void field.updateComplete?.then(() => {
      this._bindDirectValue(field);
      this.setOneRow(field);
    });
    return field;
  }
  /** The text a keystroke should record. Once `value` is bound to the shadow
   *  `<textarea>` that is its text. Before the bind runs, Material's own
   *  `value` is stale (its `handleInput` is silenced), so the shadow node's
   *  text wins as soon as the event came from it or it holds any text. */
  private _readFieldValue(field: MaterialField, event?: Event): string {
    const inner = this._getInnerTextarea(field);
    if (inner && inner.isConnected) {
      if (this._directValueBound || event?.composedPath()[0] === inner || inner.value.length > 0) {
        return inner.value;
      }
    }
    return field.value ?? "";
  }
  /** Bind the field's `value` straight to the shadow `<textarea>`, so reading
   *  and writing it costs no Material render, form-value write or validation
   *  pass. While the shadow tree has no `<textarea>` (and in `jsdom`, which has
   *  none) the accessor falls back to the Material property it replaced. */
  private _bindDirectValue(field: MaterialField): void {
    if (this._directValueBound) return;
    this._directValueBound = true;
    let proto: object | null = Object.getPrototypeOf(field) as object | null;
    let desc: PropertyDescriptor | undefined;
    while (proto && !desc) {
      desc = Object.getOwnPropertyDescriptor(proto, "value");
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    // Read the accessors off their descriptors: a bare method reference held
    // across statements trips `@typescript-eslint/unbound-method`.
    const protoGet = desc
      ? (Object.getOwnPropertyDescriptor(desc, "get")?.value as ((this: MaterialField) => string) | undefined)
      : undefined;
    const protoSet = desc
      ? (Object.getOwnPropertyDescriptor(desc, "set")?.value as
          | ((this: MaterialField, v: string) => void)
          | undefined)
      : undefined;
    // Seed from the shadow `<textarea>` when it already holds text: a keystroke
    // that arrived before this bind is still in the DOM node, not in Material's
    // silenced reactive property, and seeding from `""` would erase it.
    const inner = this._getInnerTextarea(field);
    const seed =
      inner && inner.isConnected && inner.value.length > 0
        ? inner.value
        : (protoGet ? protoGet.call(field) : "") || this._value;
    let current = seed;
    if (inner && inner.isConnected && inner.value !== seed) {
      inner.value = seed;
    }
    if (seed.length > 0 && this._value === "") {
      this._value = seed;
    }
    Object.defineProperty(field, "value", {
      configurable: true,
      get: () => {
        const inner = this._getInnerTextarea(field);
        return inner && inner.isConnected ? inner.value : current;
      },
      set: (v: string) => {
        const next = v ?? "";
        current = next;
        const inner = this._getInnerTextarea(field);
        if (inner && inner.isConnected) {
          if (inner.value !== next) inner.value = next;
        } else if (protoSet) {
          protoSet.call(field, next);
        }
      },
    });
  }
  protected sync(): void {
    const field = this._inner as MaterialField;
    if (field.value !== this._value) { field.value = this._value; this.adjustHeight(); }
    field.placeholder = this._placeholder;
    field.disabled = this._disabled;
  }
  private _getInnerTextarea(field: MaterialField): HTMLTextAreaElement | null {
    if (this._textarea && this._textarea.isConnected) return this._textarea;
    this._textarea = (field.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null) ?? null;
    return this._textarea;
  }
  private setOneRow(field: MaterialField): void {
    const inner = this._getInnerTextarea(field);
    if (inner) inner.rows = 1;
  }
  /** Grow the field to fit its text, capped at half the panel height.
   *
   *  A keystroke that cannot have made the text shorter and whose text still
   *  fits the current box height returns before the first style write, so it
   *  costs no style recalculation and no forced layout. Before this, every key
   *  wrote `height: auto` and then forced a reflow with
   *  `getBoundingClientRect()`, which a profile of a 55-key question showed as
   *  three layouts and three style recalcs per key. */
  private adjustHeight(): void {
    const field = this._inner as MaterialField | null;
    if (!field) return;
    const val = this._readFieldValue(field);
    const lines = countLines(val);
    const shrank = val.length < this._prevLen || lines < this._prevLines;
    this._prevLen = val.length;
    this._prevLines = lines;

    const inner = this._getInnerTextarea(field);
    // Text still fits the box and nothing was deleted: nothing to measure.
    if (inner && inner.clientHeight > 0 && !shrank && inner.scrollHeight <= inner.clientHeight) {
      return;
    }
    if (shrank && !field.style.height) {
      return;
    }

    field.style.height = "auto";
    const chrome =
      inner && inner.clientHeight > 0
        ? (this._chromePx ?? (this._chromePx = field.getBoundingClientRect().height - inner.clientHeight))
        : 0;
    const scrollH = inner ? (inner.scrollHeight || field.scrollHeight) : field.scrollHeight;
    const panel = field.closest("agent-chat-panel") || field.parentElement;
    const panelHeight = panel ? panel.getBoundingClientRect().height : 600;
    const maxPx = panelHeight * 0.5;
    const natural = scrollH + chrome;
    if (natural > maxPx) {
      field.style.height = `${maxPx}px`;
      if (inner) inner.style.overflowY = "auto";
    } else {
      if (val.length === 0) field.style.height = "";
      else if (natural > 0) field.style.height = `${natural}px`;
      if (inner) inner.style.overflowY = "hidden";
    }
  }
  resetHeight(): void {
    this._value = "";
    this._prevLen = 0;
    this._prevLines = 1;
    const field = this._inner as MaterialField | null;
    if (!field) return;
    field.value = "";
    field.style.height = "";
    this.setOneRow(field);
    const inner = this._getInnerTextarea(field);
    if (inner) inner.style.overflowY = "hidden";
  }
}
