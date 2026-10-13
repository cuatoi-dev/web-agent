import { Component } from "../../ui/component.js";
import { html } from "../../ui/template.js";
import { defineUiElements } from "../../ui/registry.js";
import type { FormBlockWithSubmission } from "./form-block.types.js";
import type { WaCheckedChangeDetail, WaValueInputDetail } from "../../ui/types.js";

defineUiElements();

/** Rendered as a child of every `agent-form-block`, so the rules travel with the
 *  element into whatever tree it is placed in. Nothing goes to `document.head`. */
const FORM_BLOCK_STYLES = html`
  <style>
    agent-form-block {
      display: block;
      margin: var(--wa-padding-l, 12px) 0;
      font-family: var(--wa-font-family, "Public Sans", system-ui, -apple-system, sans-serif);
    }
    agent-form-block .form-container {
      background: var(--wa-background-color-300, #ffffff);
      border: 1px solid var(--wa-border-color, #e0e0e0);
      border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
      padding: 20px;${/* eslint-disable-line wa/no-raw-spacing -- 20px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ ""}
      box-shadow: var(--wa-elevation-s, 0 4px 12px rgba(0, 0, 0, 0.05));
      transition: all 0.3s ease;
    }
    /* The disabled state must stay legible, so it is dimmed by choosing
       colours rather than by fading the whole box — same root cause and same
       fix pattern as buttons-block.ts (task 008). The old blanket opacity
       fade plus a darker background measured 1.04:1 in wa2-dark. */
    agent-form-block .form-container.disabled {
      pointer-events: none;
      background: var(--wa-background-color-300, #fafafa);
      box-shadow: none;
    }
    agent-form-block .form-container.disabled .wa-btn:disabled,
    agent-form-block .form-container.disabled button[disabled] {
      opacity: 1;
      background-color: var(--wa-background-color-300, currentColor);
      color: color-mix(in oklab, var(--wa-text-color, currentColor) 60%, var(--wa-label-color, currentColor) 40%);
      border-color: color-mix(in oklab, var(--wa-text-color, currentColor) 50%, var(--wa-background-color-300, currentColor) 50%);
    }
    /* cat-store aliases the registry to Material Web (AGENTS.md), so the
       submit control there is <md-filled-button>, not a plain <button> — the
       rule above never matches it. Material's own disabled defaults
       (container-opacity 0.12, label-text-opacity 0.38 against a near-black
       default) is what measured 1.04:1 in wa2-dark; same fix pattern as
       buttons-block.ts's md-outlined-button[disabled] handling. */
    agent-form-block .form-container.disabled md-filled-button[disabled] {
      --md-filled-button-disabled-container-color: var(--wa-background-color-300, currentColor);
      --md-filled-button-disabled-container-opacity: 1;
      --md-filled-button-disabled-label-text-color: color-mix(in oklab, var(--wa-text-color, currentColor) 60%, var(--wa-label-color, currentColor) 40%);
      --md-filled-button-disabled-label-text-opacity: 1;
    }
    /* docs-site's vendored Beer CSS (apps/docs-site/vendor/beercss) styles the
       checkbox wrapper's own ".checkbox" class — matched because the vanilla
       registry's checkbox() also assigns that class — and fades its label
       span to opacity: 0.5 on a disabled input. That measured 1.53:1 against
       this panel's background in wa2-dark. The extra class/element/pseudo
       in this selector out-specifies Beer's rule. */
    agent-form-block .form-container.disabled .wa-checkbox-label input:disabled + span {
      opacity: 1;
      color: color-mix(in oklab, var(--wa-text-color, currentColor) 60%, var(--wa-label-color, currentColor) 40%);
    }
    agent-form-block h3 {
      margin-top: 0;
      margin-bottom: var(--wa-padding-xl, 16px);
      font-size: 1.15em;
      /* --wa-action-color-info-300 is a bright accent tuned for dark
         surfaces; on wa2-light it measures 3.20:1 against this panel's
         background — below the 4.5:1 floor. --wa-text-color is the
         accessible choice in every theme (task 017). */
      color: var(--wa-text-color, #1a73e8);
      font-weight: 600;
    }
    agent-form-block .field-group {
      margin-bottom: var(--wa-padding-xl, 16px);
      display: flex;
      flex-direction: column;
      gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
    }
    agent-form-block .field-label {
      font-size: 0.85em;
      font-weight: 500;
      /* --wa-label-color alone measures 4.44:1 on wa2-light — just
         under the 4.5:1 floor (task 017). Blending it toward
         --wa-text-color keeps the label visually secondary to the
         field value while landing at ~9:1 in every theme. */
      color: color-mix(in oklab, var(--wa-text-color, #202124) 60%, var(--wa-label-color, #5f6368) 40%);
    }
    agent-form-block .select-wrapper {
      display: flex;
      flex-direction: column;
      gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
    }
    agent-form-block select {
      padding: 10px var(--wa-padding-l, 12px);${/* eslint-disable-line wa/no-raw-spacing -- 10px is not on the theme spacing ladder (between --wa-padding-m 8px and --wa-padding-l 12px); tokenizing would snap the rendered value and change the layout. */ ""}
      border-radius: var(--wa-border-radius-l, 8px);
      border: 1px solid var(--wa-input-border-color, #c4c7c5);
      background-color: var(--wa-input-background-color, white);
      color: var(--wa-input-text-color, #202124);
      font-family: inherit;
      font-size: 1em;
      outline: none;
      transition: border-color 0.2s;
    }
    agent-form-block select:focus {
      border-color: var(--wa-action-color-info, #1a73e8);
    }
    /* The dedicated disabled-text token was rejected on measurement (task
       008) — it is tuned to sit near-invisible against a component's own
       disabled fill, not against this form's neutral background. The same
       text/label mix used for the disabled button above stays readable. */
    agent-form-block select:disabled {
      background-color: var(--wa-background-color-300, #f1f3f4);
      color: color-mix(in oklab, var(--wa-text-color, currentColor) 60%, var(--wa-label-color, currentColor) 40%);
    }
    agent-form-block .checkbox-wrapper {
      display: flex;
      align-items: center;
      gap: var(--wa-padding-m, 8px);
      padding: var(--wa-padding-s, 4px) 0;
    }
    agent-form-block .submit-row {
      margin-top: 20px;${/* eslint-disable-line wa/no-raw-spacing -- 20px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ ""}
      display: flex;
      justify-content: flex-end;
    }
  </style>
`;

export class AgentFormBlock extends Component {
  private _block!: FormBlockWithSubmission;
  private _disabled = false;
  private _values: Record<string, string | number | boolean | null> = {};

  get block() {
    return this._block;
  }
  set block(v: FormBlockWithSubmission) {
    this._block = v;
    this._resetValues();
    this.requestUpdate();
  }

  get disabled() {
    return this._disabled;
  }
  set disabled(v) {
    this._disabled = !!v;
    this.requestUpdate();
  }

  private _resetValues() {
    this._values = {};
    if (!this.block || !this.block.fields) return;
    // A field the block was already submitted with shows what was submitted,
    // not its declared default — the disabled form is an echo of what the
    // agent received, and a field the user never touched already holds its
    // default in that snapshot (form-block.ts:174-183 spreads every current
    // value, touched or not), so this alone covers AC-2 too.
    const submitted = this.block.__submittedValues;
    for (const field of this.block.fields) {
      if (submitted && Object.prototype.hasOwnProperty.call(submitted, field.name)) {
        this._values[field.name] = submitted[field.name];
      } else if (field.kind === "checkbox") {
        this._values[field.name] = field.default !== undefined ? !!field.default : false;
      } else if (field.kind === "select") {
        this._values[field.name] = field.default !== undefined ? field.default : (field.options?.[0] || "");
      } else {
        this._values[field.name] = "";
      }
    }
  }

  private _handleSubmit(e: Event) {
    e.preventDefault();
    if (this.disabled) return;

    const form = this.querySelector("form");
    if (form && !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const values = { ...this._values };
    // Stash on the block object (see FormBlockWithSubmission) so the NEXT
    // render — a brand-new element, once this block is disabled — starts
    // from what was submitted instead of resetting to defaults.
    this.block.__submittedValues = values;

    this.dispatchEvent(
      new CustomEvent("block-submit", {
        detail: {
          id: this.block.id,
          values,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  template() {
    if (!this.block || !this.block.fields) return FORM_BLOCK_STYLES;

    const containerClass = this.disabled ? "form-container disabled" : "form-container";

    return html`
      ${FORM_BLOCK_STYLES}
      <div class=${containerClass}>
        ${this.block.title ? html`<h3>${this.block.title}</h3>` : ""}
        <form @submit=${(e: Event) => this._handleSubmit(e)}>
          ${this.block.fields.map((field) => {
            if (field.kind === "text" || field.kind === "number" || field.kind === "date") {
              const kind = field.kind;
              return html`
                <div class="field-group">
                  <span class="field-label">${field.label}</span>
                  <wa-text-input
                    .value=${String(this._values[field.name] ?? "")}
                    .placeholder=${(kind === "text" ? field.placeholder : undefined) || ""}
                    .type=${kind}
                    .min=${kind === "number" && field.min !== undefined ? String(field.min) : undefined}
                    .max=${kind === "number" && field.max !== undefined ? String(field.max) : undefined}
                    .required=${field.required === true}
                    .name=${field.name}
                    data-name=${field.name}
                    ?disabled=${this.disabled}
                    @value-input=${(e: CustomEvent<WaValueInputDetail>) => {
                      if (kind === "number") {
                        this._values[field.name] = e.detail.value !== "" ? Number(e.detail.value) : null;
                      } else {
                        this._values[field.name] = e.detail.value;
                      }
                    }}
                  ></wa-text-input>
                </div>
              `;
            } else if (field.kind === "select") {
              return html`
                <div class="field-group select-wrapper">
                  <span class="field-label">${field.label}</span>
                  <select
                    data-name=${field.name}
                    ?disabled=${this.disabled}
                    @change=${(e: Event) => {
                      this._values[field.name] = (e.target as HTMLSelectElement).value;
                    }}
                  >
                    ${field.options.map(
                      (opt) => html`
                        <option value=${opt} ?selected=${opt === this._values[field.name]}>
                          ${opt}
                        </option>
                      `
                    )}
                  </select>
                </div>
              `;
            } else if (field.kind === "checkbox") {
              return html`
                <div class="field-group checkbox-wrapper">
                  <wa-checkbox
                    .checked=${!!this._values[field.name]}
                    .label=${field.label}
                    .disabled=${this.disabled}
                    data-name=${field.name}
                    @checked-change=${(e: CustomEvent<WaCheckedChangeDetail>) => {
                      this._values[field.name] = e.detail.checked;
                    }}
                  ></wa-checkbox>
                </div>
              `;
            }
            return html``;
          })}
          <div class="submit-row">
            ${(() => {
              return html`<wa-button
                .label=${this.block.submit_label || "Submit"}
                variant="primary"
                .disabled=${this.disabled}
                @press=${() => { const f = this.querySelector("form"); f?.requestSubmit(); }}
              ></wa-button>`;
            })()}
          </div>
        </form>
      </div>
    `;
  }
}

if (!customElements.get("agent-form-block")) {
  customElements.define("agent-form-block", AgentFormBlock);
}
