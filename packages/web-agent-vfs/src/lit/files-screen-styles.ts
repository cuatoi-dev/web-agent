import { html } from "@cuatoi/web-agent-lit";

export const FILES_SCREEN_STYLES = html`
  <style>
    agent-files-screen {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      box-sizing: border-box;
      font-family: var(--wa-font-family, system-ui, -apple-system, sans-serif);
      color: var(--wa-text-color, #1a1a1a);
      background: var(--wa-background-color, #ffffff);
    }
    agent-files-screen * {
      box-sizing: border-box;
    }
    agent-files-screen .wa-files-screen {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    agent-files-screen .wa-ftree {
      padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px);
      display: flex;
      flex-direction: column;
      gap: var(--wa-padding-xs, 2px);
    }
    agent-files-screen .wa-ftree-row {
      display: flex;
      align-items: center;
      gap: var(--wa-padding-s, 4px);
      padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px);
      border-radius: var(--wa-border-radius-m, 6px);
      cursor: pointer;
      user-select: none;
      background: transparent;
      border: none;
      font-family: inherit;
      font-size: var(--wa-font-size-m, 0.875rem);
      color: inherit;
      text-align: left;
      width: 100%;
    }
    agent-files-screen .wa-ftree-row:hover {
      background: var(--wa-background-color-100, rgba(0, 0, 0, 0.05));
    }
    agent-files-screen .wa-ftree-row.selected {
      background: var(--wa-action-color-info-10opc, rgba(0, 0, 0, 0.08));
      font-weight: 600;
    }
    agent-files-screen .wa-ftree-row-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    agent-files-screen .wa-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--wa-padding-xs, 2px);
      padding: var(--wa-padding-xs, 2px) var(--wa-padding-s, 4px);
      border-radius: var(--wa-border-radius-s, 4px);
      font-size: var(--wa-font-size-xs, 0.75rem);
      line-height: 1;
      background: var(--wa-background-color-100, #eee);
      color: var(--wa-text-color, #1a1a1a);
    }
    agent-files-screen .wa-meta {
      font-size: var(--wa-font-size-xs, 0.75rem);
      color: var(--wa-label-color, #777);
      white-space: nowrap;
      margin-left: auto;
    }
    agent-files-screen .wa-empty-notice {
      padding: var(--wa-padding-xl, 16px);
      color: var(--wa-label-color, #666);
      font-size: var(--wa-font-size-m, 0.875rem);
      text-align: center;
      font-style: italic;
    }
    agent-files-screen .wa-fileview {
      display: flex;
      flex-direction: column;
      padding: var(--wa-padding-m, 8px);
      border-top: 1px solid var(--wa-border-color, #e0e0e0);
      background: var(--wa-background-color, #fff);
    }
    agent-files-screen .wa-file-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--wa-padding-s, 4px);
      margin-bottom: var(--wa-padding-m, 8px);
    }
    agent-files-screen .wa-file-breadcrumb {
      display: flex;
      align-items: center;
      gap: var(--wa-padding-xs, 2px);
      font-size: var(--wa-font-size-s, 0.8125rem);
      color: var(--wa-label-color, #555);
      flex-wrap: wrap;
      flex: 1;
      min-width: 0;
    }
    agent-files-screen .wa-file-actions {
      display: flex;
      align-items: center;
      gap: var(--wa-padding-xs, 2px);
      flex-shrink: 0;
    }
    /* Two registries draw this glyph two different ways, so this needs two
       rules, both self-contained (no ambient stylesheet assumed):
       - The default registry's inner <button> gets a UA-stylesheet "color:
         buttontext" that "color" on an ancestor alone does not override, so
         the button itself is targeted directly; its SVG glyph then inherits
         from ITS OWN color via fill="currentColor".
       - A Material-backed registry (e.g. cat-store's Acme elements) draws the
         glyph from --md-icon-button-*-icon-color on <md-icon-button> itself.
         Setting that custom property only on the wrapper is not enough: for a
         given element, a rule that matches the element DIRECTLY always wins
         over a value merely inherited from an ancestor, regardless of that
         ancestor selector's specificity — and the generic
         "agent-chat-panel md-icon-button" rule (ACME_PANEL_MD_STYLES) matches
         <md-icon-button> directly. So <md-icon-button> itself is targeted
         here too, with a selector specific enough to win that cascade. */
    agent-files-screen .wa-file-actions wa-icon-button.danger,
    agent-files-screen .wa-file-actions wa-icon-button.danger button {
      color: var(--wa-action-color-error, #d32f2f);
    }
    agent-files-screen .wa-file-actions wa-icon-button.danger,
    agent-files-screen .wa-file-actions wa-icon-button.danger md-icon-button {
      --md-icon-button-icon-color: var(--wa-action-color-error, #d32f2f);
      --md-icon-button-hover-icon-color: var(--wa-action-color-error, #d32f2f);
      --md-icon-button-focus-icon-color: var(--wa-action-color-error, #d32f2f);
      --md-icon-button-pressed-icon-color: var(--wa-action-color-error, #d32f2f);
      --md-icon-button-disabled-icon-color: var(--wa-action-color-error, #d32f2f);
      /* Round 2: the pressed ripple defaults to Material's neutral
         on-surface-variant colour, which LIGHTENS a dark panel surface
         enough that the red icon drops to 2.8:1 on release (below the 3:1
         WCAG AA non-text floor) — rest (4.9:1) and hover (3.9:1) pass. A
         dark shade of the same error token keeps the pressed surface dark
         instead of neutral-light, so contrast holds at every state. */
      --md-icon-button-pressed-state-layer-color: var(--wa-action-color-error-900, #4a141d);
    }
    agent-files-screen .wa-file-op-error {
      padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px);
      color: var(--wa-action-color-error, #d32f2f);
      font-size: var(--wa-font-size-s, 0.8125rem);
      margin-bottom: var(--wa-padding-s, 4px);
    }
    agent-files-screen .wa-file-breadcrumb strong {
      font-weight: 600;
      color: var(--wa-text-color, #111);
    }
    agent-files-screen .wa-file-text {
      overflow: auto;
      margin: 0;
      padding: var(--wa-padding-m, 8px);
      background: var(--wa-background-color-100, #f8f8f8);
      border: 1px solid var(--wa-border-color, #e0e0e0);
      border-radius: var(--wa-border-radius-m, 6px);
      font-family: var(--wa-font-family, monospace);
      font-size: var(--wa-font-size-s, 0.8125rem);
      line-height: 1.4;
      color: var(--wa-text-color, #222);
      white-space: pre;
    }
    agent-files-screen .wa-file-img {
      max-width: 100%;
      max-height: 300px;
      object-fit: contain;
      border-radius: var(--wa-border-radius-m, 6px);
      border: 1px solid var(--wa-border-color, #e0e0e0);
      background: var(--wa-background-color-100, #f8f8f8);
      align-self: center;
    }
    agent-files-screen .wa-file-meta-row {
      margin-top: var(--wa-padding-s, 4px);
      font-size: var(--wa-font-size-xs, 0.75rem);
      color: var(--wa-label-color, #666);
      text-align: center;
    }
    agent-files-screen .wa-truncation-notice {
      margin-top: var(--wa-padding-s, 4px);
      font-size: var(--wa-font-size-xs, 0.75rem);
      color: var(--wa-label-color, #666);
      font-style: italic;
    }
    agent-files-screen .wa-file-error {
      padding: var(--wa-padding-m, 8px);
      color: var(--wa-action-color-error, #d32f2f);
      font-size: var(--wa-font-size-s, 0.8125rem);
    }
  </style>
`;
