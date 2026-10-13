import { Component } from "../ui/component.js";
import { html } from "../ui/template.js";

export class AgentContextGauge extends Component {
  private _percent = 0;
  private _tokens = 0;
  private _max = 0;
  private _warnAt = 0.75; // autoCompactPercent
  private _disabled = true; // compact unavailable until canCompact is true

  get percent() {
    return this._percent;
  }
  set percent(val: number) {
    if (this._percent !== val) {
      this._percent = val;
      this.requestUpdate();
    }
  }

  get tokens() {
    return this._tokens;
  }
  set tokens(val: number) {
    if (this._tokens !== val) {
      this._tokens = val;
      this.requestUpdate();
    }
  }

  get max() {
    return this._max;
  }
  set max(val: number) {
    if (this._max !== val) {
      this._max = val;
      this.requestUpdate();
    }
  }

  get warnAt() {
    return this._warnAt;
  }
  set warnAt(val: number) {
    if (this._warnAt !== val) {
      this._warnAt = val;
      this.requestUpdate();
    }
  }

  get disabled() {
    return this._disabled;
  }
  set disabled(val: boolean) {
    if (this._disabled !== val) {
      this._disabled = val;
      this.requestUpdate();
    }
  }

  private _busy = false;
  get busy() {
    return this._busy;
  }
  set busy(val: boolean) {
    if (this._busy !== val) {
      this._busy = val;
      this.requestUpdate();
    }
  }

  static get observedAttributes() {
    return ["percent", "tokens", "max", "warn-at", "warnat"];
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
    if (newVal === null) return;
    const num = parseFloat(newVal);
    if (isNaN(num)) return;
    if (name === "percent") {
      this.percent = num;
    } else if (name === "tokens") {
      this.tokens = num;
    } else if (name === "max") {
      this.max = num;
    } else if (name === "warn-at" || name === "warnat") {
      this.warnAt = num;
    }
  }

  template() {
    const r = 7;
    const circumference = 2 * Math.PI * r;
    const strokeDashoffset = circumference - (Math.min(Math.max(this.percent, 0), 1) * circumference);

    // Color logic as we approach warnAt
    let colorClass = "color-green";
    if (this.percent >= this.warnAt) {
      colorClass = "color-red";
    } else if (this.percent >= this.warnAt - 0.15) {
      colorClass = "color-amber";
    }

    const pctText = `${Math.round(this.percent * 100)}%`;
    const tokensText = Math.round(this.tokens).toLocaleString();
    const maxText = this.max.toLocaleString();
    const tooltip = this._busy
      ? `Compacting the conversation — ${pctText} · ${tokensText} / ${maxText} tokens`
      : this._disabled
        ? `${pctText} · ${tokensText} / ${maxText} tokens`
        : `Compact conversation — ${pctText} · ${tokensText} / ${maxText} tokens`;
    const emit = () => {
      if (this._disabled) return;
      this.dispatchEvent(new CustomEvent("compact-request", { bubbles: true, composed: true }));
    };

    return html`
      <style>
        agent-context-gauge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          position: relative;
        }
        agent-context-gauge .gauge-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          cursor: default;
        }
        agent-context-gauge .gauge-wrapper.clickable {
          cursor: pointer;
        }
        agent-context-gauge .gauge-wrapper.disabled .bg-circle {
          /* 005: the disabled gauge is distinguished by a DASHED track, not by
             dimming. Opacity was measured and rejected: at 0.45 the ring falls
             to 1.84:1 in wa2-light and 2.74:1 in wa2-dark, below the 3:1 AA
             floor for a graphical object, and the opacity that does pass (0.75)
             is not visibly different. A dash pattern keeps the stroke at full
             contrast, reads at a glance, and survives a greyscale conversion
             because it carries no colour. */
          stroke-dasharray: 2 2;
        }
        agent-context-gauge .gauge-svg {
          transform: rotate(-90deg);
          width: 18px;
          height: 18px;
        }
        agent-context-gauge .gauge-svg.busy {
          animation: agent-gauge-spin 1.2s linear infinite;
        }
        @keyframes agent-gauge-spin {
          from { transform: rotate(-90deg); }
          to { transform: rotate(270deg); }
        }
        agent-context-gauge .bg-circle {
          fill: none;
          /* 002: the gauge now sits on --wa-input-background-color (white in
             wa2-light), where the raw tokens measure 1.55–2.53:1. Mixing 60% of
             the token with the theme text colour darkens it on the light surface
             and brightens it on the dark one: 5.12:1 light / 9.04:1 dark. */
          stroke: color-mix(in oklab, var(--wa-text-color-disabled, rgba(255, 255, 255, 0.25)) 60%, var(--wa-text-color));
          stroke-width: 3;
        }
        agent-context-gauge .fg-circle {
          fill: none;
          stroke-width: 3;
          stroke-linecap: round;
          transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
        }
        agent-context-gauge .color-green {
          /* 3.60:1 light / 14.20:1 dark */
          stroke: color-mix(in oklab, var(--wa-gauge-green-color, #10b981) 60%, var(--wa-text-color)); /* emerald-500 */
        }
        agent-context-gauge .color-amber {
          /* 4.66:1 light / 11.60:1 dark */
          stroke: color-mix(in oklab, var(--wa-gauge-orange-color, #f59e0b) 60%, var(--wa-text-color)); /* amber-500 */
        }
        agent-context-gauge .color-red {
          /* 6.20:1 light / 9.11:1 dark */
          stroke: color-mix(in oklab, var(--wa-gauge-red-color, #ef4444) 60%, var(--wa-text-color)); /* red-500 */
        }
      </style>
      <div
        class=${`gauge-wrapper${this._disabled ? " disabled" : " clickable"}`}
        title=${tooltip}
        role="button"
        aria-disabled=${this._disabled ? "true" : "false"}
        tabindex=${this._disabled ? -1 : 0}
        @click=${emit}
        @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); emit(); } }}
      >
        <svg class="gauge-svg${this._busy ? " busy" : ""}" viewBox="0 0 20 20">
          <circle class="bg-circle" cx="10" cy="10" r=${r}></circle>
          <circle
            class=${`fg-circle ${colorClass}`}
            cx="10"
            cy="10"
            r=${r}
            stroke-dasharray=${circumference}
            stroke-dashoffset=${strokeDashoffset}
          ></circle>
        </svg>
      </div>
    `;
  }
}

if (!customElements.get("agent-context-gauge")) {
  customElements.define("agent-context-gauge", AgentContextGauge);
}
