import { Component } from "../ui/component.js";
import { html } from "../ui/template.js";

/**
 * The plan's `tooltipText(schedules, reminders)` pseudo code, verbatim.
 * A kind with a zero count is omitted entirely — the summary never reads
 * "0 schedules".
 */
export function scheduleSummary(schedules: number, reminders: number): string {
  const parts: string[] = [];
  if (schedules > 0) parts.push(`${schedules} ${schedules === 1 ? "schedule" : "schedules"}`);
  if (reminders > 0) parts.push(`${reminders} ${reminders === 1 ? "reminder" : "reminders"}`);
  return `${parts.join(", ")}. Use /schedule-list to see or cancel them.`;
}

/** The clock's own rules. The panel concatenates this into its single
 *  `<style>` block, so no extra stylesheet is parsed inside the panel's shadow
 *  root when the clock mounts. Mounted on its own, it still renders the block
 *  itself. */
export const SCHEDULE_CLOCK_CSS = `        agent-schedule-clock {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          position: relative;
          /* A status indicator, not a control: no pointer, no focus ring. */
          cursor: default;
          color: var(--wa-text-color, #fff);
        }
        agent-schedule-clock .clock-svg {
          width: 18px;
          height: 18px;
        }
        agent-schedule-clock .clock-badge {
          position: absolute;
          top: 3px;
          right: 3px;
          min-width: 15px;
          height: 15px;
          box-sizing: border-box;
          border-radius: var(--wa-border-radius-l, 8px);
          padding: 0 3px;${/* eslint-disable-line wa/no-raw-spacing -- 3px is not on the theme spacing ladder (between --wa-padding-xs 2px and --wa-padding-s 4px); tokenizing would snap the rendered value and change the layout. */ ""}
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: var(--wa-font-family, "Public Sans", system-ui, -apple-system, sans-serif);
          font-size: 9.5px;
          font-weight: 600;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          /* 109/003 — measured, do not substitute a raw accent token.
             The badge must clear TWO floors in all three themes: 4.5:1 for its
             numeral, and 3:1 for the pill against the composer surface it sits
             on (--wa-input-background-color, chat-panel-composer-css.ts:21).
             Every plain accent token fails one of them:
               action-color-info-100 + black : 7.79 / 4.28 FAIL / 7.79 text,
                                               7.09 / 3.90 / 2.69 FAIL shape
               action-color-info-900 + white : 6.54 / 12.71 / 6.54 text,
                                               2.92 FAIL / 1.50 FAIL / 6.54 shape
               action-color-info     + white : 4.56 / 4.36 FAIL / 4.36 FAIL text
             The 60% mix below is the same pattern the gauge already uses
             (context-gauge.ts:163-167): it lightens the accent on a dark
             surface and darkens it on a light one, so one rule serves all
             three themes. Measured 2026-09-05:
               wa1-dark 8.08:1  wa2-dark 8.13:1  wa2-light 7.29:1
             Greyscale contrast is identical to the colour figure in every
             theme, so the count never rests on colour alone. */
          background: color-mix(in oklab, var(--wa-action-color-info, #8657ff) 60%, var(--wa-text-color, #fff));
          color: var(--wa-input-background-color, #fff);
          /* Separates the pill from the glyph beneath it; the composer surface
             colour, so it reads as a gap rather than a stroke. */
          border: 1.5px solid var(--wa-input-background-color, #fff);
        }
`;

export class AgentScheduleClock extends Component {
  private _schedules = 0;
  get schedules() { return this._schedules; }
  set schedules(val: number) {
    if (this._schedules !== val) { this._schedules = val; this.requestUpdate(); }
  }

  private _reminders = 0;
  get reminders() { return this._reminders; }
  set reminders(val: number) {
    if (this._reminders !== val) { this._reminders = val; this.requestUpdate(); }
  }

  static get observedAttributes() {
    return ["schedules", "reminders"];
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
    if (newVal === null) return;
    const num = parseInt(newVal, 10);
    if (isNaN(num)) return;
    if (name === "schedules") this.schedules = num;
    else if (name === "reminders") this.reminders = num;
  }

  template() {
    // scheduler.ts:228 defines `total` as `schedules + reminders`, so the badge
    // shows exactly `pendingCounts().total` without needing a third property.
    const total = this._schedules + this._reminders;
    const summary = scheduleSummary(this._schedules, this._reminders);

    return html`
      ${this.closest("agent-chat-panel") ? "" : html`<style>${SCHEDULE_CLOCK_CSS}</style>`}
      <div class="clock-wrapper" title=${summary} role="img" aria-label=${summary}>
        <svg class="clock-svg" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="7.4" stroke="currentColor" stroke-width="1.5"></circle>
          <path d="M10 5.4V10l3 1.9" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <span class="clock-badge">${total}</span>
      </div>
    `;
  }
}

if (!customElements.get("agent-schedule-clock")) {
  customElements.define("agent-schedule-clock", AgentScheduleClock);
}
