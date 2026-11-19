// CSS rules are tree-scoped, so the bubble ships its own. Beer CSS
// class names cannot cross this boundary, and neither can a host rule that
// targets `web-agent-bubble #launcher`. Everything paints from --wa-*
// tokens, which are custom properties and DO cross. A host that needs a
// different launcher targets `web-agent-bubble::part(launcher)`.
export const BUBBLE_SHADOW_HTML = `
      <style data-wa-styles="bubble">
        #panel-container {
          position: fixed;
          bottom: 80px;
          right: 20px;
          /* A host sets these two inherited properties on any ancestor
             ('web-agent-bubble', 'body', ':root') to resize the box. The
             fallbacks are the defaults, so a host that sets nothing is
             unaffected. The panel inside fills this box. */
          width: var(--web-agent-panel-width, 480px);
          height: var(--web-agent-panel-height, 660px);
          max-height: 80vh;
          display: none;
          flex-direction: column;
          overflow: hidden;
          z-index: 1000;
          background: var(--wa-background-color, #ffffff);
          border-radius: var(--wa-border-radius-l, 12px);
        }
        #launcher {
          position: fixed;
          right: 0;
          bottom: 0;
          margin: var(--wa-padding-xl, 16px);
          width: 56px;
          height: 56px;
          padding: 0;
          border: none;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 26px;
          line-height: 1;
          z-index: 1000;
          background: var(--wa-action-color-info, #7d54ff);
          color: var(--wa-action-text-color-info, #ffffff);
          box-shadow: var(--wa-elevation-l, 0 5px 10px rgba(0, 0, 0, 0.4));
          transition: filter 0.15s ease;
        }
        #launcher:hover { filter: brightness(0.92); }
        #launcher:active { filter: brightness(0.85); }
        #launcher:focus-visible {
          outline: 3px solid var(--wa-text-color, #202124);
          outline-offset: 2px;
        }
        /* Scoped to the launcher: a bare 'i' rule would reach markdown italics
           in the panel below. No font-family here — a host that uses an icon
           font supplies it through ::part(launcher-icon), which inherits into
           this element. */
        #launcher-icon i {
          font-style: normal;
          line-height: 1;
        }
        .wa-launcher-avatar {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        }
        /* The panel holds the only Stop button, so collapsing it mid-run
           left the user with no way to stop the agent. This control sits above
           the launcher and is shown only while a run is in flight AND the
           panel is closed. */
        #stop-run {
          position: fixed;
          right: 0;
          bottom: 72px;
          margin: var(--wa-padding-xl, 16px);
          width: 40px;
          height: 40px;
          padding: 0;
          border: none;
          border-radius: 50%;
          display: none;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          line-height: 1;
          z-index: 1000;
          /* The on-colour is theme-dependent — near-black on the light
             error surface of the dark themes, white on the dark error surface
             of wa2-light. Read it from the token; never hard-code white. */
          background: var(--wa-action-color-error, #d93025);
          color: var(--wa-action-text-color-error, #ffffff);
          box-shadow: var(--wa-elevation-l, 0 5px 10px rgba(0, 0, 0, 0.4));
          transition: filter 0.15s ease;
        }
        #stop-run[data-visible="true"] { display: flex; }
        #stop-run:hover { filter: brightness(0.92); }
        #stop-run:active { filter: brightness(0.85); }
        #stop-run:focus-visible {
          outline: 3px solid var(--wa-text-color, #202124);
          outline-offset: 2px;
        }
        #stop-run svg { width: 20px; height: 20px; }
      </style>
      <button id="launcher" part="launcher" aria-label="Open chat">
        <span id="launcher-icon" part="launcher-icon" class="wa-launcher-icon"><i>chat</i></span>
      </button>
      <button id="stop-run" part="stop-run" type="button" aria-label="Stop" title="Stop">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>
      </button>
      <div id="panel-container" part="panel-container" style="display: none;">
      </div>
    `;
