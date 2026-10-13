import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { store } from "../store";
import { navigate } from "../router";
import { selectCartCount } from "../store/cart-slice";
import { listThemes } from "@cuatoi/web-agent-lit/themes";
import { getStoredTheme, setStoredTheme, THEME_CHANGE_EVENT } from "../theme";
import "./landing-view";
import "./store-view";
import "./cart-view";
import "./toast-host";
import "./orders-page";
import "./agent-page";

@customElement("app-root")
export class AppRoot extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      font-family: var(--wa-font-family, "Public Sans", system-ui, sans-serif);
      min-height: 100vh;
      background: var(--wa-background-color, #f5f5f5);
      color: var(--wa-text-color, #333);
    }
    .top-bar {
      display: flex;
      flex-wrap: wrap;
      row-gap: var(--wa-padding-m, 8px);
      align-items: center;
      justify-content: space-between;
      padding: var(--wa-padding-m, 8px) var(--wa-padding-xl, 16px);
      background: var(--wa-action-color-info, #6200ee);
      color: var(--wa-action-text-color-info, #fff);
      position: sticky;
      top: 0;
      z-index: 1100;
    }
    .logo {
      font-size: 1.2em;
      font-weight: 600;
    }
    .nav {
      display: flex;
      flex-wrap: wrap;
      row-gap: var(--wa-padding-m, 8px);
      gap: var(--wa-padding-l, 12px);
      align-items: center;
    }
    .theme-menu-wrap {
      position: relative;
    }
    .theme-menu-button {
      background: var(--wa-toast-background-color, #202124);
      color: var(--wa-toast-text-color, #fff);
      border: 1px solid var(--wa-white-color-30opc, rgba(255, 255, 255, 0.35));
      border-radius: var(--wa-border-radius-m, 4px);
      padding: var(--wa-padding-xs, 2px) var(--wa-padding-s, 8px);
      font-size: var(--wa-font-size-s, 12px);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: var(--wa-padding-s, 4px);
      transition: filter 0.15s ease;
    }
    .theme-menu-button:hover {
      filter: brightness(1.25);
    }
    .theme-menu-button:focus-visible {
      outline: 2px solid var(--wa-white-color, #ffffff);
      outline-offset: 2px;
    }
    .theme-menu-button:focus-visible:active {
      filter: none;
    }
    .theme-menu-button:active {
      filter: brightness(0.9);
    }
    .theme-menu {
      position: absolute;
      top: 100%;
      right: 0;
      z-index: 200;
      min-width: 180px;
      margin: var(--wa-padding-xs, 2px) 0 0;
      padding: var(--wa-padding-s, 4px) 0;
      list-style: none;
      background: var(--wa-dropdown-background-color, #fff);
      color: var(--wa-dropdown-item-text-color, #000);
      border: 1px solid var(--wa-dropdown-border-color, #ccc);
      border-radius: var(--wa-dropdown-border-radius, 4px);
      box-shadow: var(--wa-dropdown-elevation, 0 4px 12px rgba(0, 0, 0, 0.15));
    }
    .theme-menu-header {
      padding: var(--wa-padding-s, 4px) var(--wa-padding-l, 12px);
      font-size: var(--wa-font-size-s, 12px);
      font-weight: 600;
    }
    .theme-menu-item {
      display: flex;
      align-items: center;
      gap: var(--wa-padding-m, 8px);
      width: 100%;
      padding: var(--wa-dropdown-item-padding, 8px) var(--wa-padding-l, 12px);
      border: none;
      background: var(--wa-dropdown-item-background-color, transparent);
      color: inherit;
      font-family: var(--wa-font-family, "Public Sans", system-ui, sans-serif);
      font-size: var(--wa-dropdown-item-font-size, 13px);
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
    }
    .theme-menu-item:hover,
    .theme-menu-item:focus-visible {
      background: var(--wa-dropdown-item-hover-background-color, rgba(98, 0, 238, 0.1));
    }
    .theme-menu-item[aria-checked="true"] {
      background: var(--wa-dropdown-item-background-color-selected, #6200ee);
      color: var(--wa-dropdown-item-text-color-selected, #fff);
      font-weight: 600;
    }
    .theme-menu-check {
      display: inline-block;
      width: 1em;
      text-align: center;
    }
    .nav a {
      color: var(--wa-action-text-color-info, #fff);
      text-decoration: none;
      cursor: pointer;
      padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px);
      border-radius: var(--wa-border-radius-m, 4px);
    }
    .nav a:hover {
      background: var(--wa-white-color-20opc, rgba(255, 255, 255, 0.2));
    }
    .nav a.active {
      background: var(--wa-white-color-30opc, rgba(255, 255, 255, 0.25));
      font-weight: 600;
    }
    .badge {
      background: var(--wa-action-color-error, #ff4081);
      color: var(--wa-action-text-color-error, #fff);
      border-radius: 999px;${/* eslint-disable-line wa/no-raw-spacing -- 999px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 999px); tokenizing would snap the rendered value and change the layout. */ css``}
      padding: 0 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      font-size: 0.75em;
      min-width: 18px;
      text-align: center;
      display: inline-block;
    }
    .view-container {
      box-sizing: border-box;
      width: 100%;
      max-width: 960px;
      margin: 0 auto;
      padding: var(--wa-padding-xl, 16px);
    }
    agent-page {
      flex: 1 1 auto;
      min-height: 0;
    }
  `;

  @state()
  private _route = store.getState().ui.route;

  @state()
  private _cartCount = selectCartCount(store.getState());

  @state()
  private _theme: string = getStoredTheme();

  @state()
  private _themeMenuOpen = false;

  private _chooseTheme(id: string) {
    setStoredTheme(id);
    this._setThemeMenuOpen(false);
  }

  /** Opens or closes the theme menu. While it is open, a pointer press
   *  outside it or Escape closes it. */
  private _setThemeMenuOpen(open: boolean) {
    if (open === this._themeMenuOpen) return;
    this._themeMenuOpen = open;
    if (open) {
      document.addEventListener("pointerdown", this._onOutsidePointer, true);
      document.addEventListener("keydown", this._onMenuKey, true);
    } else {
      document.removeEventListener("pointerdown", this._onOutsidePointer, true);
      document.removeEventListener("keydown", this._onMenuKey, true);
    }
  }

  private _onOutsidePointer = (e: Event) => {
    const wrap = this.shadowRoot?.querySelector(".theme-menu-wrap");
    if (wrap && e.composedPath().includes(wrap)) return;
    this._setThemeMenuOpen(false);
  };

  private _onMenuKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this._setThemeMenuOpen(false);
  };

  private _onThemeChange = (e: Event) => {
    this._theme = (e as CustomEvent<string>).detail;
  };

  private _unsub?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this._unsub = store.subscribe(() => {
      const s = store.getState();
      this._route = s.ui.route;
      this._cartCount = selectCartCount(s);
    });
    window.addEventListener(THEME_CHANGE_EVENT, this._onThemeChange);
    // Re-sync in case the theme changed while this element was detached.
    this._theme = getStoredTheme();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    window.removeEventListener(THEME_CHANGE_EVENT, this._onThemeChange);
    this._setThemeMenuOpen(false);
  }

  private _nav(path: string) {
    return (e: Event) => {
      e.preventDefault();
      navigate(path);
    };
  }

  private _renderThemeMenu() {
    return html`<ul class="theme-menu" role="menu" aria-label="Theme">
      <li class="theme-menu-header" role="presentation">Theme</li>
      ${listThemes().map((t) => {
        const active = t.id === this._theme;
        return html`<li role="none">
          <button
            class="theme-menu-item"
            role="menuitemradio"
            aria-checked=${active ? "true" : "false"}
            data-theme-id=${t.id}
            @click=${() => this._chooseTheme(t.id)}
          ><span class="theme-menu-check" aria-hidden="true">${active ? "✓" : ""}</span>${t.label}</button>
        </li>`;
      })}
    </ul>`;
  }

  render() {
    const isActive = (path: string) =>
      this._route === path ? "active" : "";

    return html`
      <div class="top-bar">
        <span class="logo">🐾 Cat Bodega</span>
        <nav class="nav">
          <a href="#/" class="${isActive("/")}" @click=${this._nav("/")}>Home</a>
          <a href="#/store" class="${isActive("/store")}" @click=${this._nav("/store")}>Store</a>
          <a href="#/cart" class="${isActive("/cart")}" @click=${this._nav("/cart")}>
            Cart${this._cartCount > 0 ? html` <span class="badge">${this._cartCount}</span>` : ""}
          </a>
          <a href="#/orders" class="${isActive("/orders")}" @click=${this._nav("/orders")}>Orders</a>
          <a href="#/agent" class="${isActive("/agent")}" @click=${this._nav("/agent")}>Agent</a>
          <div class="theme-menu-wrap">
            <button
              class="theme-menu-button"
              aria-haspopup="menu"
              aria-expanded=${this._themeMenuOpen ? "true" : "false"}
              aria-label="Theme menu"
              @click=${() => this._setThemeMenuOpen(!this._themeMenuOpen)}
            >Theme</button>
            ${this._themeMenuOpen ? this._renderThemeMenu() : nothing}
          </div>
        </nav>
      </div>
      ${this._route === "/agent"
        ? html`<agent-page></agent-page>`
        : html`<div class="view-container">
            ${this._route === "/"
              ? html`<landing-view></landing-view>`
              : this._route === "/store"
                ? html`<store-view></store-view>`
                : this._route === "/cart"
                  ? html`<cart-view></cart-view>`
                  : this._route === "/orders"
                    ? html`<orders-page></orders-page>`
                    : html`<p>404 — not found</p>`}
          </div>`}
      <toast-host></toast-host>
    `;
  }
}
