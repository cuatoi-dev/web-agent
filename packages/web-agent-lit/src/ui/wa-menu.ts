import { WaElement } from "./wa-element-base.js";
import type { WaMenuItem } from "./types.js";

export class WaMenu extends WaElement {
  private _open = false;
  private _items: WaMenuItem[] = [];
  private _attached = false;
  private _list: HTMLUListElement | null = null;

  get open(): boolean { return this._open; }
  set open(v: boolean) {
    this._open = !!v;
    if (this.isConnected) {
      if (this._open) this.attach(); else this.detach();
    }
    if (this._inner) this.sync();
  }
  get items(): WaMenuItem[] { return this._items; }
  set items(v: WaMenuItem[]) {
    if (v === this._items) return;
    this._items = v;
    if (this._list) this.renderItems();
  }
  connectedCallback(): void {
    super.connectedCallback();
    if (this._open) this.attach();
  }
  disconnectedCallback(): void { this.detach(); }

  protected build(): HTMLElement {
    const menuEl = document.createElement("div");
    menuEl.className = "wa-menu-container";
    menuEl.setAttribute("role", "menu");
    menuEl.style.position = "fixed";
    menuEl.style.backgroundColor = "var(--wa-dropdown-background-color, #ffffff)";
    menuEl.style.color = "var(--wa-dropdown-item-text-color, #000000)";
    menuEl.style.border = "1px solid var(--wa-dropdown-border-color, #ccc)";
    menuEl.style.borderRadius = "8px";
    menuEl.style.boxShadow = "var(--wa-dropdown-elevation, 0 4px 12px rgba(0, 0, 0, 0.15))";
    menuEl.style.padding = "4px 0";
    menuEl.style.zIndex = "9999";
    menuEl.style.minWidth = "120px";
    const list = document.createElement("ul");
    list.style.listStyle = "none";
    list.style.margin = "0";
    list.style.padding = "0";
    menuEl.append(list);
    this._list = list;
    this.renderItems();
    return menuEl;
  }
  protected sync(): void { this._inner!.style.display = this._open ? "block" : "none"; }

  private renderItems(): void {
    const lis = this._items.map((item) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.className = "flat wa-menu-item";
      btn.textContent = item.label;
      btn.disabled = !!item.disabled;
      btn.style.display = "block";
      btn.style.width = "100%";
      btn.style.textAlign = "left";
      btn.style.padding = "8px 16px";
      btn.style.border = "none";
      btn.style.color = "inherit";
      btn.style.cursor = item.disabled ? "default" : "pointer";
      if (!item.disabled) btn.addEventListener("click", () => this.fire("select", { id: item.id }));
      li.append(btn);
      return li;
    });
    this._list!.replaceChildren(...lis);
  }
  private attach(): void {
    if (this._attached) return;
    this._attached = true;
    document.addEventListener("pointerdown", this._onOutside, { capture: true });
    document.addEventListener("keydown", this._onKey, { capture: true });
    window.addEventListener("scroll", this._position, { capture: true, passive: true });
    window.addEventListener("resize", this._position, { passive: true });
    requestAnimationFrame(this._position);
  }
  private detach(): void {
    if (!this._attached) return;
    document.removeEventListener("pointerdown", this._onOutside, { capture: true });
    document.removeEventListener("keydown", this._onKey, { capture: true });
    window.removeEventListener("scroll", this._position, { capture: true });
    window.removeEventListener("resize", this._position);
    this._attached = false;
  }
  private readonly _onOutside = (e: Event): void => {
    const path = e.composedPath();
    const anchor = this.anchor();
    if (path.includes(this) || (anchor !== null && path.includes(anchor))) return;
    this.fire("request-close");
  };
  private readonly _onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.fire("request-close");
  };
  private readonly _position = (): void => {
    if (!this._inner || !this._open) return;
    const anchor = this.anchor();
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = this._inner.getBoundingClientRect().width;
    const height = this._inner.getBoundingClientRect().height;
    let top = rect.bottom;
    let left = rect.left;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (left + width > vw) left = rect.right - width;
    if (left < 4) left = 4;
    if (top + height > vh) top = rect.top - height;
    if (top < 4) top = 4;
    this._inner.style.top = `${top}px`;
    this._inner.style.left = `${left}px`;
  };
  private anchor(): HTMLElement | null {
    const id = this.getAttribute("anchor-id");
    if (!id) return null;
    // Several panels can sit in one document with the same anchor id. The
    // anchor shares the menu's parent, so look there before the whole root.
    const sibling = Array.from(this.parentElement?.children ?? []).find((el) => el.id === id);
    if (sibling instanceof HTMLElement) return sibling;
    const root = this.getRootNode() as Document | ShadowRoot;
    return root.getElementById?.(id) ?? document.getElementById(id);
  }
}
