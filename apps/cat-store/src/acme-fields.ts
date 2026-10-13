import "@material/web/menu/menu.js";
import "@material/web/menu/menu-item.js";
import "@material/web/textfield/outlined-text-field.js";
import { AcmeElement } from "./acme-element-base";
import type { WaMenuItem } from "@cuatoi/web-agent-lit";
import type { MaterialField, MdMenuInternal } from "./acme-fields.types";

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
      const mi = document.createElement("md-menu-item") as HTMLElement & { disabled: boolean };
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
    const field = document.createElement("md-outlined-text-field") as MaterialField;
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
  get value() { return this._value; }
  set value(v: string) { if (v === this._value) return; this._value = v; if (this._inner) this.sync(); }
  get placeholder() { return this._placeholder; }
  set placeholder(v: string) { if (v === this._placeholder) return; this._placeholder = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const field = document.createElement("md-outlined-text-field") as MaterialField;
    field.type = "textarea";
    field.style.width = "100%";
    field.addEventListener("input", () => {
      this.adjustHeight();
      this._value = field.value;
      this.fire("value-input", { value: field.value });
    });
    this.setOneRow(field);
    void field.updateComplete?.then(() => this.setOneRow(field));
    return field;
  }
  protected sync(): void {
    const field = this._inner as MaterialField;
    if (field.value !== this._value) { field.value = this._value; this.adjustHeight(); }
    field.placeholder = this._placeholder;
    field.disabled = this._disabled;
  }
  private setOneRow(field: MaterialField): void {
    const inner = field.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;
    if (inner) inner.rows = 1;
  }
  private adjustHeight(): void {
    const field = this._inner as MaterialField | null;
    if (!field) return;
    field.style.height = "auto";
    const inner = field.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;
    const chrome = inner ? field.getBoundingClientRect().height - inner.clientHeight : 0;
    const scrollH = inner ? inner.scrollHeight : field.scrollHeight;
    const panel = field.closest("agent-chat-panel") || field.parentElement;
    const panelHeight = panel ? panel.getBoundingClientRect().height : 600;
    const maxPx = panelHeight * 0.5;
    const natural = scrollH + chrome;
    if (natural > maxPx) { field.style.height = `${maxPx}px`; if (inner) inner.style.overflowY = "auto"; }
    else { if (natural > 0) field.style.height = `${natural}px`; if (inner) inner.style.overflowY = "hidden"; }
  }
  resetHeight(): void {
    this._value = "";
    const field = this._inner as MaterialField | null;
    if (!field) return;
    field.value = "";
    this.setOneRow(field);
    const inner = field.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;
    if (inner) inner.style.overflowY = "hidden";
    this.adjustHeight();
  }
}
