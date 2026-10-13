/** The input area, the composer and the "/" command menu.
 *
 *  One slice of the `<style>` block `AgentChatPanel.template()` renders,
 *  moved verbatim out of chat-panel.ts. The slices are concatenated back
 *  together inside the same single `<style>` element, so the emitted CSS
 *  text is unchanged. */
export const PANEL_COMPOSER_CSS = `        agent-chat-panel .input-area {
          display: block;
          padding: var(--wa-padding-l, 0.5rem);   /* 8px, was 12px */
          background: var(--wa-background-color-700, white);
          border-top: 1px solid var(--wa-border-color, #f0f0f0);
        }
        agent-chat-panel .composer {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: var(--wa-padding-s, 0.25rem);
          border: 1px solid var(--wa-border-color, #c4c7c5);
          border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
          padding: var(--wa-padding-m, 0.5rem);
          background: var(--wa-input-background-color, #fff);
          box-sizing: border-box;
          min-width: 0;
        }
        agent-chat-panel .composer > #input {
          border: none;
          border-radius: 0;
          background: transparent;
          padding: 0;
          width: 100%;
          box-sizing: border-box;
          min-width: 0;
        }
        agent-chat-panel .composer-controls {
          display: flex;
          align-items: center;
          gap: var(--wa-padding-s, 0.25rem);
        }
        agent-chat-panel .composer-controls .composer-spacer {
          flex: 1;
          min-width: 0;
        }
        /* 105/003 — the "/" menu. Every colour is a --wa-* token; the
           literals are only the var() fallbacks, matching the history panel
           (chat-panel-history.ts:80-91). Contrast measured 2026-09-05 across
           wa1-dark, wa2-dark and wa2-light — see the refine's contrast
           table before changing any colour here. */
        agent-chat-panel .wa-slash-anchor {
          position: relative;
          display: block;
        }
        agent-chat-panel .wa-slash-menu {
          position: absolute;
          bottom: 100%;
          left: 0;
          right: 0;
          margin-bottom: var(--wa-padding-s, 4px);
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          overflow: hidden;
          background: var(--wa-dropdown-background-color, #ffffff);
          color: var(--wa-dropdown-item-text-color, #000000);
          border: 1px solid var(--wa-dropdown-border-color, #cccccc);
          border-radius: var(--wa-dropdown-border-radius, 4px);
          box-shadow: var(--wa-dropdown-elevation, 0 4px 12px rgba(0, 0, 0, 0.15));
          z-index: 10000;
        }
        agent-chat-panel .wa-slash-menu[hidden] {
          display: none;
        }
        agent-chat-panel .wa-slash-list {
          overflow-y: auto;
          min-height: 0;
        }
        agent-chat-panel .wa-slash-row {
          display: flex;
          align-items: center;
          gap: var(--wa-padding-s, 4px);
          padding: var(--wa-dropdown-item-padding, 8px);
          cursor: pointer;
          font-size: var(--wa-dropdown-item-font-size, 14px);
          /* The highlight is an accent BAR, not a fill. A solid
             --wa-action-color-info fill against its own on-colour measures
             4.55:1 in both wa2 themes since task 005 lowered the accent to
             hsl(257deg 100% 66%), so it now clears the 4.5:1 AA floor for
             normal text. The bar is kept because it reads as a selection
             indicator, not because a fill would fail. As a non-text indicator
             (3:1 floor) it measures 3.95:1 / 4.21:1 / 4.55:1 against the
             dropdown background. */
          box-shadow: inset 3px 0 0 0 transparent;
        }
        agent-chat-panel .wa-slash-row.is-highlighted {
          background: var(--wa-dropdown-item-background-color-hover, transparent);
          box-shadow: inset 3px 0 0 0 var(--wa-action-color-info, #1a73e8);
        }
        agent-chat-panel .wa-slash-icon {
          display: inline-flex;
          align-items: center;
          flex: 0 0 auto;
        }
        agent-chat-panel .wa-slash-name {
          flex: 0 0 auto;
          white-space: nowrap;
          color: var(--wa-dropdown-item-text-color, #000000);
        }
        agent-chat-panel .wa-slash-row.is-highlighted .wa-slash-name {
          font-weight: bold;
        }
        agent-chat-panel .wa-slash-alias,
        agent-chat-panel .wa-slash-arg {
          flex: 0 0 auto;
          white-space: nowrap;
          font-size: var(--wa-font-size-s, 12px);
          color: var(--wa-label-color, #888888);
        }
        agent-chat-panel .wa-slash-desc {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: var(--wa-font-size-s, 12px);
          color: var(--wa-label-color, #888888);
        }
        /* On the highlighted row the 10 % wash lifts the background, which drops
           --wa-label-color to 4.45:1 (wa1-dark) and 4.22:1 (wa2-light) —
           below AA. The secondary text switches to the full item text colour on
           that row only: measured 17.70:1 / 15.86:1 / 13.26:1. */
        agent-chat-panel .wa-slash-row.is-highlighted .wa-slash-alias,
        agent-chat-panel .wa-slash-row.is-highlighted .wa-slash-arg,
        agent-chat-panel .wa-slash-row.is-highlighted .wa-slash-desc {
          color: var(--wa-dropdown-item-text-color, #000000);
        }
        agent-chat-panel .wa-slash-legend {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--wa-padding-m, 8px);
          padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px);
          border-top: 1px solid var(--wa-dropdown-border-color, #cccccc);
          font-size: var(--wa-font-size-s, 12px);
          color: var(--wa-label-color, #888888);
        }
        agent-chat-panel .wa-slash-legend-item {
          display: inline-flex;
          align-items: center;
          gap: var(--wa-padding-s, 4px);
        }
        agent-chat-panel .wa-slash-keys {
          margin-left: auto;
          /* Public Sans has no U+2191/U+2193 (verified 2026-09-05 with fontTools
             against apps/cat-store/vendor/public-sans/PublicSans-Regular.woff2),
             and --wa-font-family resolves to "Public Sans" alone, so name a
             fallback that does have them rather than leaving it to the browser
             default. DejaVu Sans, Liberation Sans and FreeSans all cover them. */
          font-family: var(--wa-font-family, "Public Sans", "DejaVu Sans", "Liberation Sans", sans-serif);
        }
        agent-chat-panel .input-area .field {
          flex: 1;
          margin: 0;
        }
        agent-chat-panel .wa-thumb-strip {
          background: var(--wa-background-color-700, white);
          border-top: 1px solid var(--wa-border-color, #f0f0f0);
        }

        agent-chat-panel .wa-thumb-wrap img:hover {
          opacity: 0.85;
        }
`;
