import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import "@material/web/button/filled-button.js";
import { navigate } from "../router";

@customElement("landing-view")
export class LandingView extends LitElement {
  static styles = css`
    :host {
      display: block;
      text-align: center;
      padding: 48px var(--wa-padding-xl, 16px);${/* eslint-disable-line wa/no-raw-spacing -- 48px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
    }
    h1 {
      font-size: 2.5em;
      margin: 0 0 var(--wa-padding-xl, 16px);
      color: var(--wa-text-color, #333);
    }
    .hero-emoji {
      font-size: 4em;
      margin-bottom: var(--wa-padding-xl, 16px);
    }
    p {
      font-size: 1.1em;
      color: var(--wa-label-color, #666);
      max-width: 480px;
      margin: 0 auto 32px;${/* eslint-disable-line wa/no-raw-spacing -- 32px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      line-height: 1.6;
    }
  `;

  private _shop() {
    navigate("/store");
  }

  render() {
    return html`
      <div class="hero-emoji">🐱</div>
      <h1>Welcome to Cat Bodega</h1>
      <p>
        Your one-stop shop for premium cat supplies. From tasty treats to cozy beds —
        everything your feline friend deserves.
      </p>
      <md-filled-button @click=${() => this._shop()}>Shop cat products</md-filled-button>
    `;
  }
}
