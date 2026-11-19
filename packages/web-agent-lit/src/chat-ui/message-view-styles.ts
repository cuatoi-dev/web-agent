import { html } from "../ui/template.js";

/** The <style> block for <agent-message-view>, moved verbatim out of
 *  message-view.ts. Rendered as a nested template from template(), so the
 *  emitted CSS text is unchanged. */
export const messageViewStyles = html`
      <style>
        agent-message-view {
          display: block;
          contain: style;
        }
        agent-message-view .message-row { display: flex; margin: var(--wa-padding-m, 0.5rem) 0; }
        agent-message-view .message-row.user { justify-content: flex-end; }
        agent-message-view .message-row.assistant { justify-content: stretch; }
        agent-message-view .message-row.system { justify-content: center; }
        agent-message-view .message-container {
          display: flex;
          flex-direction: column;
          max-width: 85%;
          padding: var(--wa-padding-m, 0.5rem) var(--wa-padding-l, 0.75rem);  /* 8px 12px */
          border-radius: 0.75rem;   /* 12px */${/* eslint-disable-line wa/no-raw-spacing -- 0.75rem is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 0.75rem); tokenizing would snap the rendered value and change the layout. */ ""}
          font-size: var(--wa-font-size-m, 0.9375rem);   /* 15px */
          line-height: var(--wa-line-height-m, 21px);
          font-family: var(--wa-font-family, "Public Sans", system-ui, -apple-system, sans-serif);
          overflow: hidden;
        }
        agent-message-view .user {
          align-self: auto;
          width: fit-content;
          max-width: 90%;
          margin-left: auto;
          text-align: left;
          background-color: var(--wa-action-color-info, #e0dbff);
          color: var(--wa-action-text-color-info, #23005c);
          border-bottom-right-radius: 2px;
        }
        agent-message-view .pointed-chips {
          display: flex; flex-wrap: wrap; gap: var(--wa-padding-s, 4px);
          margin-bottom: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
        }
        agent-message-view .pointed-chip {
          display: inline-flex; align-items: center;
          background: var(--wa-background-color-900, #141926); border: 1px solid var(--wa-border-color, rgba(255,255,255,0.2));
          border-radius: 10px; padding: 1px var(--wa-padding-m, 8px); font-size: 0.72rem;${/* eslint-disable-line wa/no-raw-spacing -- 10px is not on the theme border-radius ladder (between --wa-border-radius-l 8px and --wa-border-radius-xl 16px); tokenizing would snap the rendered value and change the layout. | 1px is not on the theme spacing ladder (below the lowest step --wa-padding-xs 2px); tokenizing would snap the rendered value and change the layout. */ ""}
          color: var(--wa-text-color, #ffffff);
        }
        agent-message-view .assistant {
          align-self: stretch;
          flex: 1 1 auto;          /* fill the row — max-width:100% alone won't */
          max-width: 100%;
          color: var(--wa-text-color, #202124);
          background-color: transparent;             /* blend into the themed list bg — no card */
          border: none;                              /* no hairline; assistant is not a bubble */
          border-radius: 0;                          /* no rounded card corners */
          padding: var(--wa-padding-m, 0.5rem) 0;    /* vertical only; text spans panel width */
        }
        agent-message-view .system {
          align-self: center;
          background-color: var(--wa-action-color-warn-10opc, #fef7e0);
          color: var(--wa-text-color, #b06000);
          text-align: center;
          max-width: 90%;
        }
        agent-message-view .content {
          word-break: break-word;
        }
        agent-message-view .content p {
          margin: var(--wa-padding-s, 0.25rem) 0;   /* 4px */
        }
        agent-message-view .content a {
          color: var(--wa-link-color, hsl(216deg 86% 47%));
        }
        agent-message-view .content a:visited {
          color: var(--wa-link-color-visited, hsl(271deg 100% 46%));
        }
        agent-message-view .content a:hover {
          color: var(--wa-link-color-hover, hsl(216deg 86% 52%));
        }
        agent-message-view .content a:active {
          color: var(--wa-link-color-active, hsl(271deg 100% 56%));
        }
        agent-message-view .user .content a,
        agent-message-view .user .content a:visited,
        agent-message-view .user .content a:hover,
        agent-message-view .user .content a:active {
          /* The shared link tokens above measured
             1.21:1 on the user bubble's rgb(131,82,255) background. Reuse the
             bubble's own text token, which already measures 4.55:1 there in
             every theme, and underline so a link still reads apart from
             plain bubble text without relying on colour. */
          color: var(--wa-action-text-color-info, #23005c);
          text-decoration: underline;
        }
        agent-message-view .content pre {
          background: var(--wa-background-color-300, #f0f1f3);   /* one step off the list bg so code reads */
          border: 1px solid var(--wa-border-color, #e4e6e9);     /* hairline so the block reads even if bg ~ list */
          padding: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
          border-radius: var(--wa-border-radius-m, 4px);
          overflow-x: auto;
        }
        /* Faint table borders so tabular data reads on the card surface */
        agent-message-view .content table {
          border-collapse: collapse;
          display: block;                 /* let wide tables scroll inside the card */
          overflow-x: auto;
          max-width: 100%;
          margin: var(--wa-padding-s, 0.25rem) 0;
          font-size: var(--wa-font-size-m, 0.9375rem);
        }
        agent-message-view .content th,
        agent-message-view .content td {
          border: 1px solid var(--wa-border-color, #e0e0e0);
          padding: var(--wa-padding-s, 0.25rem) var(--wa-padding-m, 0.5rem);  /* 4px 8px */
          text-align: left;
          vertical-align: top;
          /* The inherited .content word-break: break-word
             behaves like overflow-wrap: anywhere and lets the browser's auto
             table layout shrink a short column (e.g. "Level") to a min-content
             width of one character, breaking words like "log" mid-letter.
             Reset to the standard pair here so a cell only wraps at a space;
             .content's own word-break: break-word still applies to prose
             outside tables. Measured in Chromium at 420px: 35px (broken) vs
             58px (whole) for the "Level" column. */
          word-break: normal;
          overflow-wrap: break-word;
        }
        agent-message-view .content th {
          background: var(--wa-background-color-700, #f1f3f4);
          font-weight: 600;
        }
        agent-message-view .content tbody tr:nth-child(even) td {
          background: var(--wa-background-color-300, #f0f1f3);   /* zebra distinct from the themed list bg */
        }
        agent-message-view .image-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
          margin-top: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
        }
        agent-message-view .msg-thumbnail {
          max-width: 160px;
          max-height: 120px;
          border-radius: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme border-radius ladder (between --wa-border-radius-m 4px and --wa-border-radius-l 8px); tokenizing would snap the rendered value and change the layout. */ ""}
          object-fit: cover;
          border: 1px solid var(--wa-border-color, rgba(0,0,0,0.12));
          cursor: zoom-in;
        }
        /* The padding leaves room for the focus ring: the message container
           clips its overflow, so a ring outside a thumbnail on the strip's
           edge would lose that side. The ring is 2px plus a 1px offset. */
        agent-message-view .tool-image-strip {
          display: flex;
          flex-wrap: wrap;
          gap: var(--wa-padding-s, 0.25rem);
          padding: var(--wa-padding-s, 0.25rem);
        }
        agent-message-view .tool-thumb {
          width: 96px;
          height: 72px;
          padding: 0;
          border: 1px solid var(--wa-border-color, rgba(0,0,0,0.12));
          border-radius: var(--wa-border-radius-l, 8px);
          overflow: hidden;
          cursor: zoom-in;
          background: var(--wa-background-color-300, #f0f1f3);
          display: block;
          box-sizing: border-box;
        }
        agent-message-view .tool-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        agent-message-view .tool-thumb:focus-visible {
          outline: 2px solid var(--wa-text-color, #202124);
          outline-offset: 1px;
        }
        agent-message-view .blocks-container {
          margin-top: var(--wa-padding-m, 8px);
          width: 100%;
          max-width: 100%;
        }
        agent-message-view .tool-step {
          display: flex;
          align-items: center;
          gap: var(--wa-padding-s, 0.25rem);              /* 4px, was 6px */
          margin: var(--wa-padding-s, 0.25rem) 0;         /* 4px */
          padding: var(--wa-padding-xs, 0.1875rem) var(--wa-padding-m, 0.5rem);  /* 3px 8px */
          font-size: var(--wa-font-size-s, 0.75rem);       /* 12px, was 0.78em */
          line-height: var(--wa-line-height-s, 18px);
          /* --wa-label-color alone measures 4.44:1 on wa2-light — just
             under the 4.5:1 floor. Blending it toward --wa-text-color
             keeps the caption visually secondary while landing
             at ~9:1 in every theme. */
          color: color-mix(in oklab, var(--wa-text-color, #202124) 60%, var(--wa-label-color, #80868b) 40%);
          background: var(--wa-background-color-300, rgba(0, 0, 0, 0.04));  /* faint recess */
          border-left: 2px solid var(--wa-border-color, #dadce0);      /* neutral rule, not brand purple */
          border-radius: var(--wa-border-radius-m, 4px);
          width: fit-content;
          max-width: 100%;
          box-sizing: border-box;
        }
        agent-message-view .tool-step-icon {
          font-size: 0.9em;
          flex-shrink: 0;
        }
        agent-message-view .tool-step-phrase {
          /* No opacity dimming here — it multiplies down the already-muted
             --wa-label-color and drops light-theme contrast below the
             4.5:1 floor (measured 2.70:1). Font-size/color alone
             already read as secondary against the assistant's main text. */
          overflow: hidden;
          min-width: 0;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        agent-message-view .tool-step-phrase.saved-output-phrase {
          overflow: visible;
          text-overflow: clip;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        agent-message-view .compaction-card {
          align-self: stretch;
          background: var(--wa-background-color-300, rgba(0, 0, 0, 0.04));
          border: 1px solid var(--wa-border-color, #dadce0);
          border-radius: var(--wa-border-radius-l, 8px);
          padding: var(--wa-padding-s, 0.25rem) var(--wa-padding-m, 0.5rem);
          margin: var(--wa-padding-s, 0.25rem) 0;
          display: flex;
          flex-direction: column;
          gap: var(--wa-padding-xs, 0.1875rem);
          box-sizing: border-box;
          max-width: 100%;
        }
        agent-message-view .compaction-card-line1 {
          font-weight: 600;
          font-size: var(--wa-font-size-s, 0.75rem);
          line-height: var(--wa-line-height-s, 18px);
          color: var(--wa-text-color, #202124);
        }
        agent-message-view .compaction-card-line2 {
          font-size: var(--wa-font-size-s, 0.75rem);
          line-height: var(--wa-line-height-s, 18px);
          color: color-mix(in oklab, var(--wa-text-color, #202124) 60%, var(--wa-label-color, #80868b) 40%);
          overflow-wrap: break-word;
        }
      </style>
    `;
