import { html } from "@cuatoi/web-agent-lit";

/** Rendered as a child of every `agent-chart-block`, so the rules travel with the
 *  element into whatever tree it is placed in. Nothing goes to `document.head`. */
export const CHART_BLOCK_STYLES = html`
  <style>
    agent-chart-block {
      display: block;
      margin: var(--wa-padding-l, 12px) 0;
      font-family: var(--wa-font-family, "Public Sans", system-ui, -apple-system, sans-serif);
    }
    agent-chart-block .error-card {
      background-color: var(--wa-action-color-error-10opc, #fde8e8);
      border: 1px solid var(--wa-action-color-error-40opc, #f98080);
      border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
      padding: var(--wa-padding-xl, 16px);
      color: var(--wa-text-color, #9b1c1c);
    }
    agent-chart-block .error-title {
      font-weight: bold;
      margin-bottom: var(--wa-padding-m, 8px);
      display: flex;
      align-items: center;
      gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
    }
    agent-chart-block details {
      margin-top: var(--wa-padding-m, 8px);
      font-size: 0.85em;
      cursor: pointer;
    }
    agent-chart-block summary {
      color: var(--wa-label-color, #771d1d);
      font-weight: 500;
    }
    agent-chart-block pre {
      background: var(--wa-background-color-300, #fdf2f2);
      padding: var(--wa-padding-m, 8px);
      border-radius: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme border-radius ladder (between --wa-border-radius-m 4px and --wa-border-radius-l 8px); tokenizing would snap the rendered value and change the layout. */ ""}
      overflow-x: auto;
      margin-top: var(--wa-padding-s, 4px);
      font-family: monospace;
      font-size: 0.9em;
    }
    agent-chart-block .chart-container {
      background: var(--wa-background-color-300, white);
      border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
      border: 1px solid var(--wa-border-color, #e0e0e0);
      padding: var(--wa-padding-xl, 16px);
      transition: opacity 0.3s, filter 0.3s;
      overflow: hidden;
    }
    agent-chart-block .chart-container.disabled {
      opacity: 0.5;
      pointer-events: none;
      filter: grayscale(1);
    }
    agent-chart-block h3 {
      margin-top: 0;
      margin-bottom: var(--wa-padding-l, 12px);
      font-size: 1.1em;
      color: var(--wa-text-color, #3c4043);
    }
    agent-chart-block .chart-canvas {
      width: 100%;
      position: relative;
      min-height: 280px;
      overflow: hidden;
    }
    agent-chart-block .chart-canvas canvas {
      display: block;
    }
    agent-chart-block .refresh-controls {
      display: flex;
      align-items: center;
      gap: var(--wa-padding-m, 8px);
      margin-top: var(--wa-padding-m, 8px);
      font-size: 0.8em;
      color: var(--wa-label-color, #666);
    }
    agent-chart-block .refresh-controls button {
      background: var(--wa-background-color-500, #f0f0f0);
      border: 1px solid var(--wa-border-color, #ccc);
      border-radius: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme border-radius ladder (between --wa-border-radius-m 4px and --wa-border-radius-l 8px); tokenizing would snap the rendered value and change the layout. */ ""}
      padding: var(--wa-padding-s, 4px) 10px;${/* eslint-disable-line wa/no-raw-spacing -- 10px is not on the theme spacing ladder (between --wa-padding-m 8px and --wa-padding-l 12px); tokenizing would snap the rendered value and change the layout. */ ""}
      font-size: 0.85em;
      cursor: pointer;
      color: var(--wa-text-color, #333);
      transition: background 0.15s;
    }
    agent-chart-block .refresh-controls button:hover {
      background: var(--wa-background-color-700, #e0e0e0);
    }
    agent-chart-block .refresh-controls button.refresh-btn {
      background: var(--wa-action-color-info, #6200ee);
      color: var(--wa-action-text-color-info, white);
      border-color: var(--wa-action-color-info, #6200ee);
    }
    agent-chart-block .refresh-controls button.refresh-btn:hover {
      background: var(--wa-action-color-info-700, #5000d0);
    }
    agent-chart-block .mode-indicator {
      font-weight: 500;
      padding: var(--wa-padding-xs, 2px) var(--wa-padding-m, 8px);
      border-radius: var(--wa-border-radius-m, 4px);
      cursor: pointer;
      user-select: none;
    }
    agent-chart-block .mode-indicator.auto {
      /* 004 review: --wa-action-color-success alone measures 2.73:1 on
         the wa2-light card — under the WCAG AA 4.5:1 floor, so raise it
         with a text-color mix like message-view does. */
      color: color-mix(in oklab, var(--wa-text-color, #202124) 40%, var(--wa-action-color-success, #2e7d32) 60%);
    }
    agent-chart-block .mode-indicator.manual {
      color: var(--wa-action-color-warn, #e65100);
    }
    agent-chart-block .mode-indicator.off {
      color: var(--wa-text-color-disabled, #888);
    }
    agent-chart-block .updated-stamp {
      margin-left: auto;
      /* 004 review: --wa-label-color alone measures 4.44:1 on the
         wa2-light card — just under the WCAG AA 4.5:1 floor, so raise it
         with a text-color mix. */
      color: color-mix(in oklab, var(--wa-text-color, #202124) 60%, var(--wa-label-color, #80868b) 40%);
      font-size: 0.9em;
    }
  </style>
`;
