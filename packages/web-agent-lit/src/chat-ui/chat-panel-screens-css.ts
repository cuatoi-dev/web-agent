/** The title-edit row, the history rows, the notices, the queued-message
 *  list, and the Settings and Debug screens.
 *
 *  One slice of the `<style>` block `AgentChatPanel.template()` renders,
 *  moved verbatim out of chat-panel.ts. The slices are concatenated back
 *  together inside the same single `<style>` element, so the emitted CSS
 *  text is unchanged. */
export const PANEL_SCREENS_CSS = `        agent-chat-panel .wa-title-edit-row {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: var(--wa-padding-s, 4px);
        }
        /* The title input (this row's first child) has no width of its own,
           so as a flex child it defaults to its natural (unshrunk) content
           size — same gotcha as a bare input element. Without this it never
           shrinks below ~221px, so at the panel's default 480px width its
           combined size with Save/Cancel (385px) overflows the row's 318px
           allocation and paints under the header's icon buttons. flex:1 +
           min-width:0 lets it absorb the shrink instead; the confirm and
           cancel icon buttons (the row's other children) keep their full
           40x40 box via flex-shrink:0 so their glyphs are never covered or
           cut. Selected by
           position, not by class, because the row's children come from
           whichever registry the host wired in via textInput()/iconButton() —
           the default registry's wa-input-container / wa-icon-btn classes, or
           cat-store's bare md-outlined-text-field / md-icon-button
           elements with no class at all. */
        agent-chat-panel .wa-title-edit-row > :first-child {
          flex: 1;
          min-width: 0;
        }
        agent-chat-panel .wa-title-edit-row > :not(:first-child) {
          flex-shrink: 0;
        }
        agent-chat-panel .wa-history-popup {
          position: fixed;
          z-index: 10000;
          background: var(--wa-dropdown-background-color, #ffffff);
          color: var(--wa-dropdown-item-text-color, #000000);
          border: 1px solid var(--wa-dropdown-border-color, #ccc);
          border-radius: var(--wa-border-radius-l, 8px);
          box-shadow: var(--wa-dropdown-elevation, 0 4px 12px rgba(0, 0, 0, 0.15));
          min-width: 260px;
          max-width: 320px;
          padding: var(--wa-padding-m, 8px) 0;
          contain: layout style paint;
        }
        agent-chat-panel .wa-history-list { max-height: 360px; overflow-y: auto; }
        agent-chat-panel .wa-history-row {
          display: flex;
          align-items: center;
          padding: var(--wa-padding-m, 8px) var(--wa-padding-l, 12px);
          cursor: pointer;
        }
        agent-chat-panel .wa-history-row[aria-current="true"] {
          background: var(--wa-action-color-info-10opc, #f0e6ff);
          font-weight: bold;
        }
        agent-chat-panel .wa-history-info { flex: 1; min-width: 0; }
        agent-chat-panel .wa-history-name {
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        agent-chat-panel .wa-history-time {
          font-size: 11px;
          color: var(--wa-label-color, #888);
          margin-top: var(--wa-padding-xs, 2px);
        }
        agent-chat-panel .wa-history-row[aria-current="true"] .wa-history-time {
          color: var(--wa-text-color, #202124);
        }
        agent-chat-panel .wa-history-row wa-icon-button > * {
          color: var(--wa-action-color-error, #d93025);
        }
        agent-chat-panel .wa-history-new {
          padding: var(--wa-padding-m, 8px) var(--wa-padding-l, 12px);
          border-top: 1px solid var(--wa-border-color, #eee);
        }
        agent-chat-panel .wa-history-clear {
          padding: 0 var(--wa-padding-l, 12px) var(--wa-padding-m, 8px);
        }
        agent-chat-panel .wa-history-new wa-button,
        agent-chat-panel .wa-history-clear wa-button { display: block; }
        agent-chat-panel .wa-history-new wa-button > *,
        agent-chat-panel .wa-history-clear wa-button > * { width: 100%; }
        agent-chat-panel .wa-history-row:hover {
          background: var(--wa-dropdown-item-background-color-hover, #f5f5f5);
        }
        agent-chat-panel .wa-history-row[aria-current="true"]:hover {
          background: var(--wa-action-color-info-20opc, #e8d5ff);
        }
        /* The one notice — an assistant message that happens to be red, not a
           container. Same rule set as .assistant (message-view-styles.ts:46-55):
           transparent, borderless, no radius, vertical padding only. Colour
           is mixed toward text, not the raw error token: the raw token alone
           measures 2.24:1 on wa2-dark and 2.68:1 on wa2-light against the
           containerless list background, under the WCAG AA 4.5:1 floor. The
           mix measures 7.82-8.15:1 across wa1-dark/wa2-dark/wa2-light. */
        agent-chat-panel .wa-notice {
          display: flex;
          align-items: flex-start;
          gap: var(--wa-padding-s, 4px);
          background: transparent;
          border: none;
          border-radius: 0;
          padding: var(--wa-padding-m, 0.5rem) 0;
          margin: 0;
          font-size: 0.85em;
          line-height: 1.5;
          color: color-mix(in oklab, var(--wa-text-color, #202124) 45%, var(--wa-action-color-error, #9b1c1c) 55%);
        }
        agent-chat-panel .wa-notice-icon {
          flex-shrink: 0;
          line-height: 1.4;
        }
        agent-chat-panel .wa-notice-msg {
          flex: 1;
          min-width: 0;
          word-break: break-word;
        }
        agent-chat-panel .wa-notice-actions {
          display: flex;
          gap: var(--wa-padding-s, 4px);
          align-items: center;
          margin-top: var(--wa-padding-s, 4px);
        }
        agent-chat-panel .wa-notice-action {
          background: none;
          border: 1px solid transparent;
          border-radius: var(--wa-border-radius-m, 4px);
          color: inherit;
          font: inherit;
          font-size: 0.95em;
          text-decoration: underline;
          cursor: pointer;
          padding: var(--wa-padding-xs, 2px) var(--wa-padding-s, 4px);
        }
        agent-chat-panel .wa-notice-action:hover {
          border-color: var(--wa-border-color, #e0e0e0);
        }
        agent-chat-panel .wa-notice-action:focus-visible {
          outline: 2px solid var(--wa-outline-color, #1a73e8);
          outline-offset: 1px;
        }
        agent-chat-panel .wa-notice-sep {
          opacity: 0.45;
        }
        /* The progress tone. Muted, not red — a retry in flight is
           progress, not yet a failure. The raw --wa-label-color the old
           .wa-retrying line used measures 3.54:1 on wa1-dark and 4.29:1 on
           wa2-light against --wa-background-color, both under the WCAG AA
           4.5:1 floor. Mixing 60% of the theme text colour into it measures
           8.61:1 / 8.77:1 / 8.82:1 on wa1-dark / wa2-dark / wa2-light. */
        /* The info tone. A completed turn that carried no reply is not
           a failure, so it must not read as one. Same muted mix as the
           progress tone, whose measurement is recorded in the comment above
           (8.61:1 wa1-dark / 8.77:1 wa2-dark / 8.82:1 wa2-light against
           --wa-background-color) — the same declaration against the same
           background. Every colour resolves from a --wa-* token; no
           literal is used except each token's own fallback. */
        agent-chat-panel .wa-notice[data-tone="info"] {
          color: color-mix(in oklab, var(--wa-text-color, #202124) 60%, var(--wa-label-color, #666) 40%);
        }
        agent-chat-panel .wa-notice[data-tone="progress"] {
          color: color-mix(in oklab, var(--wa-text-color, #202124) 60%, var(--wa-label-color, #666) 40%);
        }
        agent-chat-panel .wa-notice[data-tone="progress"] .wa-notice-icon {
          display: inline-block;
          animation: wa-notice-spin 1.2s linear infinite;
        }
        @keyframes wa-notice-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          agent-chat-panel .wa-notice[data-tone="progress"] .wa-notice-icon {
            animation: none;
          }
        }
        /* aria-hidden: the sentence already says "attempt N of M". The dots
           are a glance-level repeat, never the only carrier of the count. */
        agent-chat-panel .wa-notice-dots {
          display: inline-flex;
          align-items: center;
          gap: var(--wa-padding-xs, 2px);
          margin-left: var(--wa-padding-s, 4px);
        }
        agent-chat-panel .wa-notice-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          opacity: 0.3;
        }
        agent-chat-panel .wa-notice-dot[data-filled] {
          opacity: 1;
        }
        agent-chat-panel .wa-queue-list {
          display: flex;
          flex-direction: column;
          gap: var(--wa-padding-s, 0.25rem);
          padding: var(--wa-padding-m, 0.5rem) var(--wa-padding-l, 0.75rem);
          background: var(--wa-background-color-300, #f5f0ff);
          border-top: 1px solid var(--wa-border-color, #f0f0f0);
        }
        agent-chat-panel .wa-queue-item {
          display: flex;
          align-items: center;
          gap: var(--wa-padding-m, 0.5rem);
          background: var(--wa-background-color-50, #ffffff);
          border: 1px solid var(--wa-border-color, #e0e0e0);
          border-radius: var(--wa-border-radius-l, 8px);
          padding: var(--wa-padding-s, 0.25rem) var(--wa-padding-s, 0.25rem) var(--wa-padding-s, 0.25rem) var(--wa-padding-m, 0.5rem); /* 4px 4px 4px 8px */
          font-size: 0.85em;
        }
        agent-chat-panel .wa-queue-text {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--wa-text-color, #333);
        }
        agent-chat-panel .wa-queue-actions {
          display: flex;
          align-items: center;
          gap: 0;
          flex-shrink: 0;
        }
        agent-chat-panel .wa-queue-actions button {
          width: 28px;
          height: 28px;
        }
        agent-chat-panel .wa-queue-actions button svg {
          width: 16px;
          height: 16px;
        }
        agent-chat-panel .wa-config-view {
          flex: 1;
          overflow-y: auto;
          padding: var(--wa-padding-l, 0.75rem);   /* 12px, was 16px */
          background: var(--wa-background-color, #fafafa);
          display: flex;
          flex-direction: column;
          gap: var(--wa-padding-m, 0.75rem);        /* 12px, was 16px */
        }
        agent-chat-panel .wa-config-header {
          display: flex;
          align-items: center;
          gap: var(--wa-padding-m, 0.5rem);
          font-weight: bold;
          font-size: var(--wa-font-size-l, 1rem);   /* 1rem, was 1.05em */
        }
        agent-chat-panel .wa-config-section {
          display: flex;
          flex-direction: column;
          gap: var(--wa-padding-m, 0.5rem);   /* 8px, was 10px */
          background: var(--wa-background-color-300, white);
          border: 1px solid var(--wa-border-color, #eee);
          border-radius: var(--wa-border-radius-l, 8px);
          padding: var(--wa-padding-l, 0.75rem);   /* 12px */
        }
        agent-chat-panel .wa-config-section-title {
          font-weight: 600;
          font-size: 0.9em;
          color: var(--wa-label-color, #555);
        }
        agent-chat-panel .wa-screen-view {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--wa-background-color, #fafafa);
        }
        agent-chat-panel .wa-screen-header {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: var(--wa-padding-m, 0.5rem);
          padding: var(--wa-padding-m, 0.5rem) var(--wa-padding-l, 0.75rem);
          border-bottom: 1px solid var(--wa-border-color, #e0e0e0);
          background: var(--wa-background-color-100, #f5f5f5);
          font-weight: 600;
          font-size: var(--wa-font-size-l, 1rem);
        }
        agent-chat-panel .wa-screen-title {
          flex: 1;
          min-width: 0;
        }
        agent-chat-panel .wa-screen-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        agent-chat-panel .wa-config-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--wa-padding-l, 0.75rem);
        }
        agent-chat-panel .wa-config-seg {
          display: flex;
          gap: var(--wa-padding-s, 0.25rem);   /* 4px, was 6px */
        }
        agent-chat-panel .wa-debug-view {
          flex: 1;
          overflow-y: auto;
          padding: var(--wa-padding-l, 0.75rem);   /* 12px, was 16px */
          background: var(--wa-background-color, #fafafa);
          display: flex;
          flex-direction: column;
          gap: var(--wa-padding-m, 0.75rem);        /* 12px, was 16px */
        }
        agent-chat-panel .wa-debug-section {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }
        agent-chat-panel .wa-debug-ta {
          flex: 1;
          width: 100%;
          box-sizing: border-box;
          min-height: 120px;
          font-family: monospace;
          font-size: 0.8em;
          white-space: pre;
          overflow: auto;
          resize: vertical;
          background: var(--wa-input-background-color, white);
          border: 1px solid var(--wa-input-border-color, #e0e0e0);
          border-radius: var(--wa-border-radius-m, 4px);
          padding: var(--wa-padding-m, 0.5rem);   /* 8px */
          color: var(--wa-input-text-color, #222);
        }
        agent-chat-panel .wa-debug-copy-row {
          margin-top: var(--wa-padding-s, 0.25rem);   /* 4px, was 6px */
        }`;
