// gallery-demos-blocks.ts — the generative-UI blocks demo extracted from gallery-demos.ts.

import { html, LitElement, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderBlocks, type RenderableBlock } from "@cuatoi/web-agent-lit";

// ============================================================================
// 3d. BLOCKS DEMO
// ============================================================================

const activeBlocks: RenderableBlock[] = [
  {
    type: "chart",
    title: "Cat Breed Average Weights",
    config: {
      type: "bar",
      data: {
        labels: ["Abyssinian", "Bengal", "Birman", "Maine Coon", "Persian", "Siamese"],
        datasets: [
          {
            label: "Avg Weight (kg)",
            data: [4.0, 5.5, 4.5, 8.0, 4.2, 3.8],
          },
        ],
      },
    },
  },
  {
    type: "form",
    id: "adoption-form",
    title: "Cat Adoption Application Form",
    fields: [
      { "kind": "text", "name": "applicant_name", "label": "Your Name", "required": true },
      { "kind": "number", "name": "cats_owned", "label": "Number of cats owned before", "min": 0 },
      { "kind": "select", "name": "cat_breed", "label": "Target Breed", "options": ["Maine Coon", "Bengal", "Siamese", "Persian"] },
      { "kind": "checkbox", "name": "has_yard", "label": "Do you have a yard?", "default": false },
      { "kind": "date", "name": "pickup_date", "label": "Expected Pickup Date" },
    ],
    "submit_label": "Apply to Adopt",
  },
  {
    type: "buttons",
    options: [
      { "label": "Submit Application", "prompt": "Process my adoption application" },
      { "label": "Contact Shelter", "prompt": "Connect with shelter support" },
      { "label": "Show Catalog", "prompt": "Go back to product list" },
    ],
  },
  {
    type: "chart",
    title: "Forbidden URL Chart (CB2 Rejection)",
    config: {
      type: "line",
      data: {
        url: "https://example.com/dataset.json",
        datasets: [],
      },
    },
  },
  {
    type: "chart",
    title: "Too Many Rows Chart (CB3 Rejection)",
    config: {
      type: "line",
      data: {
        labels: Array.from({ length: 2001 }, (_, i) => String(i)),
        datasets: [
          {
            label: "Values",
            data: Array.from({ length: 2001 }, (_, i) => i),
          },
        ],
      },
    },
  },
];

@customElement("gallery-blocks-demo-app")
export class GalleryBlocksDemoApp extends LitElement {
  @state()
  private _logs: string[] = [];

  static styles = css`
    :host {
      display: block;
      font-family: var(--wa-font-family, system-ui, -apple-system, sans-serif);
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;${/* eslint-disable-line wa/no-raw-spacing -- 24px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      background: var(--wa-background-color, #0f0f17);
      color: var(--wa-text-color, #e2e8f0);
    }
    h1 {
      color: var(--wa-header-text-color, #a78bfa);
      margin-bottom: 24px;${/* eslint-disable-line wa/no-raw-spacing -- 24px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
    }
    .columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;${/* eslint-disable-line wa/no-raw-spacing -- 32px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
    }
    .column {
      background: var(--wa-background-color-300, #1e1e2e);
      border: 1px solid var(--wa-border-color, #313244);
      border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ css``}
      padding: 24px;${/* eslint-disable-line wa/no-raw-spacing -- 24px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      box-shadow: 0 4px 20px var(--wa-black-color-20opc, rgba(0, 0, 0, 0.25));
    }
    h2 {
      margin-top: 0;
      color: var(--wa-header-text-color, #f9e2af);
      border-bottom: 1px solid var(--wa-border-color, #313244);
      padding-bottom: var(--wa-padding-m, 8px);
    }
    .log-panel {
      margin-top: 24px;${/* eslint-disable-line wa/no-raw-spacing -- 24px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      background: var(--wa-background-color-700, #11111b);
      border: 1px solid var(--wa-border-color, #313244);
      border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ css``}
      padding: var(--wa-padding-xl, 16px);
    }
    .log-title {
      font-weight: bold;
      color: var(--wa-label-color, #a6e3a1);
      margin-bottom: var(--wa-padding-m, 8px);
    }
    .log-entry {
      font-family: monospace;
      font-size: 0.9em;
      margin-bottom: var(--wa-padding-s, 4px);
      color: var(--wa-text-color, #cdd6f4);
    }
  `;

  private readonly _handleBlockSubmit = (e: CustomEvent<{ id: string; values: Record<string, unknown> }>) => {
    this._addLog(`[block-submit] id=${e.detail.id} values=${JSON.stringify(e.detail.values)}`);
  };

  private readonly _handleBlockButton = (e: CustomEvent<{ prompt: string }>) => {
    this._addLog(`[block-button] prompt="${e.detail.prompt}"`);
  };

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("block-submit", this._handleBlockSubmit as EventListener);
    this.addEventListener("block-button", this._handleBlockButton as EventListener);
  }

  disconnectedCallback() {
    this.removeEventListener("block-submit", this._handleBlockSubmit as EventListener);
    this.removeEventListener("block-button", this._handleBlockButton as EventListener);
    super.disconnectedCallback();
  }

  private _addLog(msg: string) {
    this._logs = [...this._logs, `[${new Date().toLocaleTimeString()}] ${msg}`];
  }

  render() {
    return html`
      <h1>🧩 Generative-UI Blocks Renderer Demo</h1>
      <div class="columns">
        <div class="column">
          <h2>Active Blocks</h2>
          <div>
            ${renderBlocks(activeBlocks, { disabled: false })}
          </div>
        </div>
        <div class="column">
          <h2>Disabled / Expired Blocks</h2>
          <div>
            ${renderBlocks(activeBlocks, { disabled: true })}
          </div>
        </div>
      </div>
      <div class="log-panel">
        <div class="log-title">Console Actions Log</div>
        ${this._logs.length === 0 ? html`<div class="log-entry">No interactions yet... Click buttons or submit forms in active column.</div>` : ""}
        ${this._logs.map(log => html`<div class="log-entry">${log}</div>`)}
      </div>
    `;
  }
}

export function mountBlocksDemo(host: HTMLElement): void {
  const el = document.createElement("gallery-blocks-demo-app");
  host.appendChild(el);
}
