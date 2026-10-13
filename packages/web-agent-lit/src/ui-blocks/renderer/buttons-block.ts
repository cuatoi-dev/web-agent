import { Component } from "../../ui/component.js";
import { html } from "../../ui/template.js";
import { defineUiElements } from "../../ui/registry.js";
import { ButtonsBlock } from "@cuatoi/web-agent-core";

defineUiElements();

/** Rendered as a child of every `agent-buttons-block` — see form-block.ts. */
const BUTTONS_BLOCK_STYLES = html`
  <style>
    agent-buttons-block {
      display: block;
      margin: var(--wa-padding-l, 12px) 0;
      font-family: var(--wa-font-family, "Public Sans", system-ui, -apple-system, sans-serif);
    }
    agent-buttons-block .buttons-container {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;${/* eslint-disable-line wa/no-raw-spacing -- 10px is not on the theme spacing ladder (between --wa-padding-m 8px and --wa-padding-l 12px); tokenizing would snap the rendered value and change the layout. */ ""}
      padding: var(--wa-padding-l, 12px);
      border: 1px dashed var(--wa-border-color);
      border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
      background: var(--wa-background-color-300);
      color: var(--wa-text-color);
      transition: all 0.3s ease;
    }
    agent-buttons-block .buttons-container .wa-btn-secondary,
    agent-buttons-block .buttons-container md-outlined-button {
      color: var(--wa-text-color);
      border-color: var(--wa-border-color);
      --md-outlined-button-label-text-color: var(--wa-text-color);
      --md-outlined-button-outline-color: var(--wa-border-color);
    }
    /* The disabled state must stay legible, so it is dimmed by choosing colours
       rather than by fading the whole box. Measured against the container fill,
       wa1-dark / wa2-dark / wa2-light:
         label  6.94 / 9.88 / 9.18 : 1  (AA needs 4.5)
         border 3.87 / 4.17 / 3.36 : 1  (WCAG 1.4.11 needs 3.0)
       The old opacity: .5 plus filter: grayscale(1) measured 1.03:1 in
       wa2-dark and 1.50:1 in wa2-light — the labels were unreadable. */
    agent-buttons-block .buttons-container.disabled {
      pointer-events: none;
      color: color-mix(in oklab, var(--wa-text-color, currentColor) 60%, var(--wa-label-color, currentColor) 40%);
      border-color: color-mix(in oklab, var(--wa-text-color, currentColor) 50%, var(--wa-background-color-300, currentColor) 50%);
    }
    agent-buttons-block .buttons-container.disabled .wa-btn:disabled,
    agent-buttons-block .buttons-container.disabled md-outlined-button[disabled] {
      /* The shared .wa-btn:disabled rule fades to 0.5; Material fades its own label
         to 0.38 of a near-black default (its --md-sys-color-on-surface token). Both
         are opaque-ified here so the measured colours above are what actually
         renders. On hosts without the --wa-* tokens (gallery.html?frame=demo-blocks) the
         currentColor fallback makes the label inherit the host's own text colour
         instead of Material's near-black default. */
      opacity: 1;
      color: color-mix(in oklab, var(--wa-text-color, currentColor) 60%, var(--wa-label-color, currentColor) 40%);
      border-color: color-mix(in oklab, var(--wa-text-color, currentColor) 50%, var(--wa-background-color-300, currentColor) 50%);
      --md-outlined-button-disabled-label-text-color: color-mix(in oklab, var(--wa-text-color, currentColor) 60%, var(--wa-label-color, currentColor) 40%);
      --md-outlined-button-disabled-label-text-opacity: 1;
      --md-outlined-button-disabled-outline-color: color-mix(in oklab, var(--wa-text-color, currentColor) 50%, var(--wa-background-color-300, currentColor) 50%);
      --md-outlined-button-disabled-outline-opacity: 1;
    }
  </style>
`;

export class AgentButtonsBlock extends Component {
  private _block!: ButtonsBlock;
  private _disabled = false;

  get block() {
    return this._block;
  }
  set block(v) {
    this._block = v;
    this.requestUpdate();
  }

  get disabled() {
    return this._disabled;
  }
  set disabled(v) {
    this._disabled = !!v;
    this.requestUpdate();
  }

  private _handleClick(prompt: string) {
    if (this.disabled) return;
    this.dispatchEvent(
      new CustomEvent("block-button", {
        detail: { prompt },
        bubbles: true,
        composed: true,
      })
    );
  }

  template() {
    if (!this.block || !this.block.options) return BUTTONS_BLOCK_STYLES;

    // Limit to max 6 options
    const options = this.block.options.slice(0, 6);

    const containerClass = this.disabled ? "buttons-container disabled" : "buttons-container";

    return html`
      ${BUTTONS_BLOCK_STYLES}
      <div class=${containerClass}>
        ${options.map(
          (opt) => html`<wa-button
            .label=${opt.label}
            variant="secondary"
            .disabled=${this.disabled}
            @press=${() => this._handleClick(opt.prompt)}
          ></wa-button>`
        )}
      </div>
    `;
  }
}


if (!customElements.get("agent-buttons-block")) {
  customElements.define("agent-buttons-block", AgentButtonsBlock);
}
