import { css } from "lit";

/** The panels inside `<agent-page>`: the session column, the provider picker,
 *  the switch confirmation, the session list and the config view. Moved out of
 *  `agent-page.ts` unchanged. */
export const agentPagePanelsStyles = css`
    /* --- left column: sessions ------------------------------------- */
    .sessions-inner {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      box-sizing: border-box;
    }
    .new-chat {
      flex: 0 0 auto;
      margin: var(--wa-padding-m, 8px);
      padding: 6px var(--wa-padding-m, 8px);${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      font: inherit;
      font-size: var(--wa-font-size-s, 12px);
      color: var(--wa-text-color, #333);
      background: var(--wa-button-background-color, #fff);
      border: 1px solid var(--wa-button-border-color, #ccc);
      border-radius: var(--wa-border-radius-m, 4px);
      cursor: pointer;
      text-align: center;
    }
    .new-chat:hover,
    .config-btn:hover,
    .row-btn:hover {
      background: var(--wa-button-background-color-hover, #e0e0e0);
    }
    .new-chat:focus-visible,
    .config-btn:focus-visible,
    .row-btn:focus-visible,
    .session-row:focus-visible {
      outline: 2px solid var(--wa-outline-color, #6200ee);
      outline-offset: 1px;
    }
    /* Sits at the bottom of the session column: the provider picker takes the
       free width, the config icon button keeps its fixed size at the right. */
    .sessions-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: var(--wa-padding-m, 8px);
      padding: var(--wa-padding-m, 8px);
      flex: 0 0 auto;
      /* Anchors .provider-list, which opens upward over the session list. */
      position: relative;
    }
    .config-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      margin: 0;
      color: var(--wa-text-color, #333);
      background: var(--wa-button-background-color, #fff);
      border: 1px solid var(--wa-button-border-color, #ccc);
      border-radius: var(--wa-border-radius-m, 4px);
      cursor: pointer;
    }
    .config-btn svg {
      display: block;
      width: 16px;
      height: 16px;
    }

    /* --- provider picker ------------------------------------------- */
    .provider-combo {
      flex: 1 1 auto;
      min-width: 0;
    }
    .provider-trigger {
      display: flex;
      align-items: center;
      gap: var(--wa-padding-s, 4px);
      width: 100%;
      box-sizing: border-box;
      padding: var(--wa-padding-s, 4px) 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      font: inherit;
      font-size: var(--wa-font-size-s, 12px);
      text-align: left;
      color: var(--wa-text-color, #333);
      background: var(--wa-button-background-color, #fff);
      border: 1px solid var(--wa-button-border-color, #ccc);
      border-radius: var(--wa-border-radius-m, 4px);
      cursor: pointer;
    }
    .provider-trigger:hover {
      background: var(--wa-button-background-color-hover, #e0e0e0);
    }
    .provider-trigger:focus-visible,
    .provider-option:focus-visible {
      outline: 2px solid var(--wa-outline-color, #6200ee);
      outline-offset: 1px;
    }
    /* The label wraps instead of truncating: the column is 200px and an entry
       label does not fit on one line at this size. */
    .provider-current {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: break-word;
    }
    .provider-trigger svg {
      flex: 0 0 auto;
      display: block;
      width: 12px;
      height: 12px;
    }
    /* Opens UPWARD: the footer is the last row of the column, so a downward
       list would fall outside .col-sessions, which is overflow: hidden. */
    .provider-list {
      position: absolute;
      bottom: calc(100% - 8px);
      left: 8px;
      right: 8px;
      z-index: 3;
      margin: 0;
      padding: var(--wa-padding-s, 4px) 0;
      list-style: none;
      max-height: 260px;
      overflow-y: auto;
      color: var(--wa-text-color, #333);
      background: var(--wa-dialog-background-color, #fff);
      border: 1px solid var(--wa-border-color, #e0e0e0);
      border-radius: var(--wa-border-radius-m, 4px);
      box-shadow: var(--wa-dialog-box-shadow, 0 4px 24px rgba(0, 0, 0, 0.2));
    }
    .provider-option {
      display: flex;
      align-items: flex-start;
      gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      padding: 6px var(--wa-padding-m, 8px);${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      font-size: var(--wa-font-size-s, 12px);
      cursor: pointer;
      overflow-wrap: break-word;
    }
    .provider-option:hover {
      background: var(--wa-button-background-color-hover, #e0e0e0);
    }
    /* The selected entry is marked by the check icon AND by bold text, so it
       reads in greyscale; the tint is a third, redundant cue. */
    .provider-option.selected {
      background: var(--wa-action-color-info-10opc, #f0e6ff);
      font-weight: 700;
    }
    .provider-option svg {
      flex: 0 0 auto;
      display: block;
      width: 12px;
      height: 12px;
      margin-top: var(--wa-padding-xs, 2px);
    }
    .option-check-spacer {
      flex: 0 0 auto;
      width: 12px;
    }

    /* --- switch confirmation --------------------------------------- */
    .confirm-scrim {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--wa-padding-xl, 16px);
      box-sizing: border-box;
      background: var(--wa-black-color-50opc, rgba(0, 0, 0, 0.5));
    }
    .confirm-card {
      width: 100%;
      max-width: 360px;
      box-sizing: border-box;
      padding: 20px;${/* eslint-disable-line wa/no-raw-spacing -- 20px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      color: var(--wa-text-color, #333);
      background: var(--wa-dialog-background-color, #fff);
      border-radius: var(--wa-border-radius-m, 4px);
      box-shadow: var(--wa-dialog-box-shadow, 0 4px 24px rgba(0, 0, 0, 0.2));
    }
    .confirm-title {
      margin: 0 0 var(--wa-padding-m, 8px);
      font-size: 1.05em;
    }
    .confirm-body {
      margin: 0 0 var(--wa-padding-xl, 16px);
      font-size: var(--wa-font-size-s, 12px);
    }
    .confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--wa-padding-m, 8px);
    }
    .confirm-cancel,
    .confirm-ok {
      font: inherit;
      font-size: var(--wa-font-size-s, 12px);
      padding: 6px var(--wa-padding-l, 12px);${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      border-radius: var(--wa-border-radius-m, 4px);
      cursor: pointer;
    }
    .confirm-cancel {
      color: var(--wa-text-color, #333);
      background: var(--wa-button-background-color, #fff);
      border: 1px solid var(--wa-button-border-color, #ccc);
    }
    .confirm-ok {
      color: var(--wa-button-text-color, #fff);
      background: var(--wa-action-color-info, #6200ee);
      border: 1px solid var(--wa-action-color-info, #6200ee);
    }
    .confirm-cancel:hover {
      background: var(--wa-button-background-color-hover, #e0e0e0);
    }
    .confirm-cancel:focus-visible,
    .confirm-ok:focus-visible {
      outline: 2px solid var(--wa-outline-color, #6200ee);
      outline-offset: 2px;
    }
    .session-list {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: 1px solid var(--wa-border-color, #e0e0e0);
      border-bottom: 1px solid var(--wa-border-color, #e0e0e0);
    }
    .session-row {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px) var(--wa-padding-s, 4px) 11px;${/* eslint-disable-line wa/no-raw-spacing -- 11px is not on the theme spacing ladder (between --wa-padding-m 8px and --wa-padding-l 12px); tokenizing would snap the rendered value and change the layout. */ css``}
      min-height: 32px;
      box-sizing: border-box;
      cursor: pointer;
      color: var(--wa-text-color, #333);
    }
    .session-row.active {
      background: var(--wa-action-color-info-10opc, #f0e6ff);
    }
    /* Second, non-colour marker for the active row: a 3px bar. Meaning is
       carried by the bar and by the bold title, so a greyscale conversion
       still reads. */
    .active-bar {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--wa-text-color, #333);
    }
    .session-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--wa-font-size-s, 12px);
      line-height: 24px;
    }
    .session-row.active .session-title {
      font-weight: 700;
    }
    .rename-input {
      flex: 1 1 auto;
      min-width: 0;
      width: 100%;
      height: 24px;
      box-sizing: border-box;
      font: inherit;
      font-size: var(--wa-font-size-s, 12px);
      color: var(--wa-input-text-color, #333);
      background: var(--wa-input-background-color, #fff);
      border: 1px solid var(--wa-input-border-color, #ccc);
      border-radius: var(--wa-border-radius-m, 4px);
      padding: var(--wa-padding-xs, 2px) var(--wa-padding-s, 4px);
    }
    .row-actions {
      display: flex;
      gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      flex: 0 0 auto;
      opacity: 0;
      transition: opacity 150ms ease-in-out;
    }
    .session-row:hover .row-actions,
    .session-row:focus-within .row-actions {
      opacity: 1;
    }
    @media (pointer: coarse) {
      .row-actions {
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .row-actions {
        transition: none;
      }
    }
    .row-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      color: var(--wa-text-color, #333);
      background: var(--wa-button-background-color, #fff);
      border: 1px solid var(--wa-button-border-color, #ccc);
      border-radius: var(--wa-border-radius-m, 4px);
      cursor: pointer;
    }
    .row-btn svg {
      display: block;
      width: 14px;
      height: 14px;
    }
    /* --- middle column: config view -------------------------------- */
    .config-view {
      height: 100%;
      box-sizing: border-box;
      overflow-y: auto;
      padding: var(--wa-padding-xl, 16px);
      color: var(--wa-text-color, #333);
      background: var(--wa-background-color, #f5f5f5);
    }
    .config-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--wa-padding-xl, 16px);
    }
    .config-title {
      margin: 0;
      font-size: 1.1em;
      font-weight: 700;
    }
    .config-reset-btn {
      font: inherit;
      font-size: var(--wa-font-size-s, 12px);
      color: var(--wa-text-color, #333);
      background: transparent;
      border: none;
      padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px);
      cursor: pointer;
      text-decoration: underline;
      border-radius: var(--wa-border-radius-m, 4px);
    }
    .config-reset-btn:hover {
      background: var(--wa-button-background-color-hover, #e0e0e0);
    }
    .config-reset-btn:focus-visible {
      outline: 2px solid var(--wa-outline-color, #6200ee);
      outline-offset: 2px;
    }
    .config-field {
      margin-bottom: var(--wa-padding-xl, 16px);
    }
    .field-label {
      display: block;
      font-size: var(--wa-font-size-s, 12px);
      font-weight: 700;
      color: var(--wa-text-color, #333);
      margin-bottom: var(--wa-padding-s, 4px);
    }
    .field-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      margin-bottom: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
    }
    .preset-btn {
      font: inherit;
      font-size: var(--wa-font-size-s, 12px);
      color: var(--wa-text-color, #333);
      background: var(--wa-button-background-color, #fff);
      border: 1px solid var(--wa-button-border-color, #ccc);
      border-radius: var(--wa-border-radius-m, 4px);
      padding: var(--wa-padding-xs, 2px) var(--wa-padding-m, 8px);
      cursor: pointer;
      text-decoration: underline;
    }
    .preset-btn:hover {
      background: var(--wa-button-background-color-hover, #e0e0e0);
    }
    .preset-btn:focus-visible {
      outline: 2px solid var(--wa-outline-color, #6200ee);
      outline-offset: 2px;
    }
    .field-textarea {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      font-size: var(--wa-font-size-s, 12px);
      color: var(--wa-input-text-color, #333);
      background: var(--wa-input-background-color, #fff);
      border: 1px solid var(--wa-input-border-color, #ccc);
      border-radius: var(--wa-border-radius-m, 4px);
      padding: 6px var(--wa-padding-m, 8px);${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      resize: vertical;
      min-height: 48px;
    }
    .field-textarea::placeholder {
      color: var(--wa-label-color, #666);
      opacity: 1;
    }
    .field-textarea:focus {
      outline: 2px solid var(--wa-outline-color, #6200ee);
      outline-offset: -1px;
    }
    .config-note {
      margin-top: var(--wa-padding-xl, 16px);
      font-size: var(--wa-font-size-s, 12px);
      color: var(--wa-text-color, #333);
    }
`;
