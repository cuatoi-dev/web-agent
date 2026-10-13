import { css } from "lit";

/** Styles for `<orders-page>`, moved out of `orders-page.ts` unchanged. */
export const ordersPageStyles = css`
    :host {
      display: block;
      padding: var(--wa-padding-xl, 16px) 0;
    }
    input, button, textarea, select, option {
      font-family: inherit;
    }
    h2 {
      margin: 0 0 var(--wa-padding-xl, 16px);
      color: var(--wa-text-color, #333);
    }
    .controls-card {
      background: var(--wa-smart-list-background-color, #ffffff);
      padding: var(--wa-padding-xl, 16px);
      border-radius: var(--wa-border-radius-l, 8px);
      box-shadow: var(--wa-elevation-m, 0 2px 4px rgba(0,0,0,0.08));
      margin-bottom: 20px;${/* eslint-disable-line wa/no-raw-spacing -- 20px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
    }
    .filter-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--wa-padding-l, 12px);
      align-items: end;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
    }
    .filter-group label {
      font-size: 0.85em;
      font-weight: 600;
      color: var(--wa-label-color, #555);
    }
    /* Native controls for automated testing/agent targeting */
    .filter-group input, .filter-group select {
      border: 1px solid var(--wa-input-border-color, #ccc);
      background: var(--wa-input-background-color, #fff);
      color: var(--wa-input-text-color, #333);
      border-radius: var(--wa-border-radius-m, 4px);
      padding: var(--wa-padding-m, 8px) var(--wa-padding-l, 12px);
      font-size: 0.9em;
      outline: none;
      transition: border-color 0.2s;
    }
    .filter-group input:focus, .filter-group select:focus {
      border-color: var(--wa-action-color-info, #6200ee);
    }
    .table-card {
      background: var(--wa-smart-list-background-color, #ffffff);
      border-radius: var(--wa-border-radius-l, 8px);
      box-shadow: var(--wa-elevation-m, 0 2px 4px rgba(0,0,0,0.08));
      overflow-x: auto;
      margin-bottom: var(--wa-padding-xl, 16px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: var(--wa-padding-l, 12px) var(--wa-padding-xl, 16px);
      text-align: left;
      border-bottom: 1px solid var(--wa-border-color, #eee);
      font-size: 0.9em;
    }
    th {
      background: var(--wa-background-color-500, #fafafa);
      font-weight: 600;
      color: var(--wa-text-color, #333);
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
    }
    th.sortable:hover {
      background: var(--wa-background-color-700, #f0f0f0);
      color: var(--wa-action-color-info, #6200ee);
    }
    .sort-indicator {
      display: inline-block;
      margin-left: var(--wa-padding-s, 4px);
      font-size: 0.8em;
    }
    tbody tr:hover {
      background: var(--wa-background-color-300, #f9f9f9);
    }
    .status-badge {
      display: inline-block;
      padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px);
      border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ css``}
      font-size: 0.8em;
      font-weight: 600;
      text-transform: capitalize;
    }
    .status-placed {
      background: var(--wa-action-color-info-10opc, #e0f2fe);
      color: var(--wa-action-color-info, #0369a1);
    }
    .status-shipped {
      background: var(--wa-action-color-warn-10opc, #fef3c7);
      color: var(--wa-action-color-warn, #d97706);
    }
    .status-delivered {
      background: var(--wa-action-color-success-10opc, #dcfce7);
      color: var(--wa-action-color-success, #15803d);
    }
    .status-cancelled {
      background: var(--wa-action-color-error-10opc, #fee2e2);
      /* 009: tbody tr:hover repaints the row under this chip, and over that
         backdrop the error token alone measures 3.45:1 (wa1-dark) and 4.37:1
         (wa2-light). The same mix used by .error-container measures 6.14:1 /
         8.04:1 / 7.39:1 hovered and 10.40:1 / 9.90:1 / 7.89:1 at rest. */
      color: color-mix(in oklab, var(--wa-text-color, #202124) 50%, var(--wa-action-color-error, #b91c1c) 50%);
    }
    .loading-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 40px;${/* eslint-disable-line wa/no-raw-spacing -- 40px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      font-size: 1.1em;
      color: var(--wa-label-color, #666);
    }
    .empty-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 40px;${/* eslint-disable-line wa/no-raw-spacing -- 40px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      font-size: 1.1em;
      color: var(--wa-text-color-disabled, #888);
    }
    .error-container {
      padding: var(--wa-padding-xl, 16px);
      background: var(--wa-action-color-error-10opc, #fee2e2);
      /* 009: this box sits on the page background, not on a card, so the error
         token alone measures 4.21:1 (wa1-dark), 4.29:1 (wa2-dark) and 4.19:1
         (wa2-light) against its own 10% tint — all under 4.5:1. Same remedy as
         chat-panel-screens-css.ts's .wa-notice: mix the error hue with the theme text
         colour, which measures 7.49:1 / 7.15:1 / 7.10:1. */
      color: color-mix(in oklab, var(--wa-text-color, #202124) 50%, var(--wa-action-color-error, #b91c1c) 50%);
      border-radius: var(--wa-border-radius-l, 8px);
      margin-bottom: 20px;${/* eslint-disable-line wa/no-raw-spacing -- 20px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
    }
    .pagination {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--wa-padding-m, 8px) 0;
    }
    .pagination-info {
      font-size: 0.9em;
      color: var(--wa-label-color, #555);
    }
    .pagination-buttons {
      display: flex;
      gap: var(--wa-padding-l, 12px);
    }
`;
