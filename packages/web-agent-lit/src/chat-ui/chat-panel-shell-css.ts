/** The panel shell, the header, the message list and the jump button.
 *
 *  One slice of the `<style>` block `AgentChatPanel.template()` renders,
 *  moved verbatim out of chat-panel.ts. The slices are concatenated back
 *  together inside the same single `<style>` element, so the emitted CSS
 *  text is unchanged. */
export const PANEL_SHELL_CSS = `        agent-chat-panel {
          display: flex;
          flex-direction: column;
          /* 002: the panel no longer places or sizes itself — it fills the box
             the host gives it. 'relative' (not 'static') keeps the panel the
             containing block for the confirm scrim, which is appended to this
             element as an absolutely positioned overlay pinned to all four
             edges (confirm-scrim.ts). 'border-box' makes the 1px border fit
             inside the container instead of overflowing it by 2px. */
          position: relative;
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          background: var(--wa-background-color, white);
          border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
          box-shadow: var(--wa-elevation-l, 0 5px 40px rgba(0, 0, 0, 0.16));
          overflow: hidden;
          z-index: 9999;
          border: 1px solid var(--wa-border-color, #e0e0e0);
          color: var(--wa-text-color, inherit);
          font-family: var(--wa-font-family, "Public Sans", system-ui, -apple-system, sans-serif);
        }
        agent-chat-panel[hide-header] {
          background: transparent;
          border-radius: 0;
          box-shadow: none;
          border: none;
          z-index: auto;
        }
        agent-chat-panel .input-area #input {
          flex: 0 0 auto;
          min-width: 0;
        }
        agent-chat-panel .header {
          background: var(--wa-background-color-900, #6200ee);
          color: var(--wa-text-color, white);
          padding: var(--wa-padding-m, 0.5rem) var(--wa-padding-l, 0.75rem);   /* was 12px 16px */
          display: flex;
          /* The left group is flex:1, so it absorbs all the free space and
             there is nothing left to distribute. With space-between and
             three children the pencil was pushed into the middle of the
             bar — that was the defect this task fixes. Do not put it back. */
          align-items: center;
          gap: var(--wa-padding-m, 0.5rem);
          font-weight: bold;
        }
        agent-chat-panel .header-title {
          font-size: var(--wa-font-size-l, 1rem);   /* was 1.1em */
          /* 'display: block', not 'flex'. The span holds text and nothing
             else (see the headerTitle expression in AgentChatPanel.template()), and text-overflow
             only truncates in a block container — on a flex container the
             ellipsis never appears. min-width:0 lets it shrink below its
             text width as a flex child of .wa-header-left, which is what
             makes a long title truncate instead of pushing the action
             buttons off the right edge. */
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        agent-chat-panel .wa-header-left {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: var(--wa-padding-s, 0.25rem);
        }
        agent-chat-panel .wa-header-actions {
          position: relative;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: var(--wa-padding-m, 0.5rem);
        }
        /* The pencil is revealed on hover, on keyboard focus anywhere in the
           header, and always on a coarse pointer. 'opacity' — never
           'display:none' or 'visibility' — so the 40x40 box is always there
           and the title never shifts when the pointer enters or leaves.
           'pointer-events: none' while hidden so an invisible control is
           never clickable. */
        agent-chat-panel .wa-header-left .wa-title-edit-btn {
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms;
        }
        agent-chat-panel .header:hover .wa-title-edit-btn,
        agent-chat-panel .header:focus-within .wa-title-edit-btn {
          opacity: 0.8;
          pointer-events: auto;
        }
        @media (hover: none) {
          agent-chat-panel .wa-header-left .wa-title-edit-btn {
            opacity: 0.8;
            pointer-events: auto;
          }
        }
        agent-chat-panel .messages-list {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: var(--wa-padding-l, 0.75rem);   /* 12px, was 16px */
          background: var(--wa-background-color, #fafafa);
          contain: layout style paint;
        }
        /* 010 — the scroll-to-bottom button.
           The anchor always reserves space between the list and the composer
           so the list never resizes when the button toggles. It follows a
           growing composer without letting the button cover the last
           transcript line. */
        agent-chat-panel .wa-jump-anchor {
          position: relative;
          height: calc(var(--wa-padding-m, 8px) + 34px);
          flex: 0 0 auto;
          z-index: 3;
        }
        /* Overrides the wa-icon-btn 40px / transparent default
           (ui/registry-styles.ts) for the default registry, and
           the Material host width/height rule for cat-store's md-icon-button:
           an outer-tree author rule beats a :host rule in the shadow tree,
           and the Material inner button is background none, so the host's own
           background is what shows.
           The info action colour on the info action text colour measures
           4.56 / 4.57 / 4.57 to 1 across the three themes, clearing the 4.5:1
           WCAG AA text floor in every theme.
           The 1px ring was added when the FILL alone measured 2.92:1 against
           the list background in wa1-dark, under the 3:1 non-text floor
           (SC 1.4.11). The fill now measures 3.09:1 there and
           wa-tokens.test.ts case 14 covers all three themes; the ring stays
           as the boundary. The text colour token is the one token
           measured at 3:1 or better against the list background in ALL three
           themes (14.09 / 12.77 / 13.46 to 1), so the boundary is compliant
           everywhere without changing a theme value. */
        /* wa-icon-button.wa-jump-btn is a wrapper, not the real clickable
           element (the old factory seam used to return that element
           directly). 'display: contents' takes the wrapper out of the box
           tree, so the rules below — sized, positioned and focused — apply
           to its real inner button exactly as they did before. */
        agent-chat-panel .wa-jump-btn {
          display: contents;
        }
        agent-chat-panel .wa-jump-btn .wa-icon-btn,
        agent-chat-panel .wa-jump-btn md-icon-button {
          position: absolute;
          left: 50%;
          bottom: var(--wa-padding-m, 8px);
          transform: translateX(-50%);
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: var(--wa-action-color-info, #1a73e8);
          color: var(--wa-action-text-color-info, #ffffff);
          border: 1px solid var(--wa-text-color, #ffffff);
          box-shadow: var(--wa-elevation-l, 0 5px 40px rgba(0, 0, 0, 0.16));
          box-sizing: border-box;
          cursor: pointer;
          /* The Material icon size token sizes a slotted icon and ignores the
             SVG's own width/height attributes. 20px keeps the glyph clear of
             a 34px circle's edge. */
          --md-icon-button-state-layer-height: 34px;
          --md-icon-button-state-layer-width: 34px;
          --md-icon-button-icon-size: 20px;
        }
        /* The default registry's <button> holds the SVG in the light DOM, so
           size it directly. Harmless in cat-store, where the SVG is slotted
           into the shadow root and Material's own rule wins. */
        agent-chat-panel .wa-jump-btn .wa-icon-btn svg {
          width: 20px;
          height: 20px;
        }
        /* Acceptance criterion 5. The default icon button style sets no
           outline and Material draws its focus ring inside its own shadow
           root, so neither registry indicates focus on the host by itself.
           Both selectors are needed: script-driven focus (element.focus(),
           which is also how the e2e asserts it) and mouse-click focus match
           :focus but not :focus-visible in Chromium, so a :focus-visible-only
           rule leaves those paths with no visible indication. The text colour
           token measures 4.56 / 4.14 / 3.30 to 1 against the button fill and
           14.09 / 12.77 / 13.46 to 1 against the list background, so the ring
           is visible over both in every theme. */
        agent-chat-panel .wa-jump-btn .wa-icon-btn:focus-visible,
        agent-chat-panel .wa-jump-btn .wa-icon-btn:focus,
        agent-chat-panel .wa-jump-btn md-icon-button:focus-visible,
        agent-chat-panel .wa-jump-btn md-icon-button:focus {
          outline: 2px solid var(--wa-text-color, #ffffff);
          outline-offset: 2px;
        }
        /* 004 — the panel-scoped image overlay. Pinned to the panel's four
           edges exactly like the confirm scrim, so it never covers the host
           page or the browser tab beside the side panel. */
        agent-chat-panel .wa-image-overlay {
          position: absolute;
          inset: 0;
          background: var(--wa-black-color-80opc, rgba(0, 0, 0, 0.8));
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--wa-padding-l, 0.75rem);
          box-sizing: border-box;
          cursor: zoom-out;
        }
        agent-chat-panel .wa-image-overlay img {
          max-width: 100%;
          max-height: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
        }
`;
