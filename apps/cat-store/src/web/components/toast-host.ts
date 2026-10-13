import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { store } from "../store";
import { setToast } from "../store/ui-slice";

@customElement("toast-host")
export class ToastHost extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
    }
    .toast {
      background: var(--wa-toast-background-color, #323232);
      color: var(--wa-toast-text-color, #fff);
      padding: var(--wa-padding-l, 12px) 24px;${/* eslint-disable-line wa/no-raw-spacing -- 24px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      border-radius: 8px;${/* eslint-disable-line wa/no-raw-spacing -- 8px is on the ladder as --wa-border-radius-l, but this element's semantic token --wa-toast-border-radius resolves to --wa-border-radius-m (4px) in every theme; substituting either one changes the rendered radius. */ css``}
      font-size: 1em;
      box-shadow: var(--wa-elevation-l, 0 4px 12px rgba(0,0,0,0.3));
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  @state()
  private _msg: string | null = store.getState().ui.toast;

  private _unsub?: () => void;
  private _timer?: ReturnType<typeof setTimeout>;

  connectedCallback() {
    super.connectedCallback();
    this._unsub = store.subscribe(() => {
      const msg = store.getState().ui.toast;
      if (msg !== this._msg) {
        this._msg = msg;
        if (msg) {
          clearTimeout(this._timer);
          this._timer = setTimeout(() => {
            store.dispatch(setToast(null));
          }, 3000);
        }
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    clearTimeout(this._timer);
  }

  render() {
    return this._msg ? html`<div class="toast">${this._msg}</div>` : "";
  }
}
