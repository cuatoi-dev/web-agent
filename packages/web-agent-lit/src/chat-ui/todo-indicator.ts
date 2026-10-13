import { Component } from "../ui/component.js";
import { html } from "../ui/template.js";
import type { TodoItem } from "@cuatoi/web-agent-core";

export class AgentTodoIndicator extends Component {
  private _items: TodoItem[] = [];
  get items() { return this._items; }
  set items(val: TodoItem[]) {
    this._items = Array.isArray(val) ? val : [];
    this.requestUpdate();
  }

  private _open = false;

  private _setOpen(next: boolean) {
    if (this._open === next) return;
    this._open = next;
    this.requestUpdate();
  }

  /** The popover's ceiling is HALF THE PANEL's height, not half the viewport
   *  and not 50% of its own containing block — the containing block here is the
   *  40px indicator, so a plain `max-height: 50%` would resolve to 20px. It is
   *  therefore measured from the panel on every render. With no panel ancestor
   *  (the gallery mounts the element directly in some tiles) it falls back to
   *  50vh, which is the same intent against the only box that exists. */
  updated() {
    const pop = this.querySelector<HTMLElement>(".todo-pop");
    if (!pop) return;
    const panel = this.closest("agent-chat-panel");
    const h = panel?.getBoundingClientRect().height ?? 0;
    pop.style.maxHeight = h > 0 ? `${Math.round(h * 0.5)}px` : "50vh";
  }

  template() {
    const items = this._items;
    const total = items.length;
    const remaining = items.filter((i) => i.status !== "done").length;
    const doneCount = total - remaining;
    const allDone = total > 0 && remaining === 0;

    const label = allDone
      ? `Todo list: all ${total} done`
      : `Todo list: ${doneCount} of ${total} done, ${remaining} remaining`;

    return html`
      <style>
        agent-todo-indicator {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          position: relative;
          color: var(--wa-text-color, #fff);
        }
        agent-todo-indicator .todo-wrapper {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          position: relative;
          /* A status readout, not a control: no pointer. It is focusable only so the
             popover can be opened from the keyboard (criterion 12). */
          cursor: default;
          outline-offset: -2px;
        }
        agent-todo-indicator .todo-svg {
          width: 18px;
          height: 18px;
          stroke: currentColor;
          stroke-width: 1.5;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        agent-todo-indicator .todo-badge {
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
          /* 068/003 — measured 2026-09-07, do not substitute a raw accent token.
             Same rule and same reason as schedule-clock.ts:82-104: the pill must clear
             4.5:1 for its numeral AND 3:1 as a shape against the composer surface
             (--wa-input-background-color) in all three themes, and every plain
             accent token fails one of those floors somewhere. Measured against
             #0b0f18 / #ffffff: pending 8.08 / 7.94 / 7.50, done 11.58 / 11.07 / 8.34,
             greyscale identical in every case. */
          background: color-mix(in oklab, var(--wa-action-color-info, #8657ff) 60%, var(--wa-text-color, #fff));
          color: var(--wa-input-background-color, #fff);
          border: 1.5px solid var(--wa-input-background-color, #fff);
        }
        agent-todo-indicator .todo-badge.all-done {
          background: color-mix(in oklab, var(--wa-action-color-success, #1dbf70) 60%, var(--wa-text-color, #fff));
        }
        agent-todo-indicator .todo-badge svg {
          width: 8px;
          height: 8px;
          display: block;
          fill: none;
          stroke: var(--wa-input-background-color, #fff);
          stroke-width: 3;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        agent-todo-indicator .todo-pop {
          position: absolute;
          bottom: 46px;
          right: -6px;
          z-index: 10001;
          min-width: 268px;
          max-width: 320px;
          overflow-y: auto;
          box-sizing: border-box;
          background: var(--wa-dropdown-background-color, #ffffff);
          border: 1px solid var(--wa-border-color, #cccccc);
          border-radius: var(--wa-padding-s, 4px);
          box-shadow: var(--wa-dropdown-elevation, 0 4px 12px rgba(0, 0, 0, 0.15));
          padding: var(--wa-padding-m, 8px) 0;
          font-size: var(--wa-dropdown-item-font-size, 12px);
          text-align: left;
          color: var(--wa-text-color, #fff);
          cursor: default;
        }
        agent-todo-indicator .todo-pop-head {
          display: flex;
          align-items: center;
          gap: var(--wa-padding-m, 8px);
          padding: 0 var(--wa-padding-l, 12px) var(--wa-padding-m, 8px);
          margin-bottom: var(--wa-padding-m, 8px);
          border-bottom: 1px solid var(--wa-border-color, #cccccc);
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        agent-todo-indicator .todo-pop-head .n {
          margin-left: auto;
          font-weight: 600;
          letter-spacing: 0;
          font-variant-numeric: tabular-nums;
        }
        agent-todo-indicator .todo-row {
          display: flex;
          align-items: flex-start;
          gap: var(--wa-padding-m, 8px);
          padding: var(--wa-padding-s, 4px) var(--wa-padding-l, 12px);
          line-height: 1.4;
        }
        agent-todo-indicator .todo-text {
          flex: 1;
          min-width: 0;
          /* Wraps, never truncates — criterion 16. No white-space/ellipsis here. */
          overflow-wrap: anywhere;
        }
        agent-todo-indicator .todo-row.is-done .todo-text {
          text-decoration: line-through;
        }
        /* Status reads by SHAPE first — ring, half-filled, filled-with-tick — so the
           list survives a greyscale conversion (criterion 21). */
        agent-todo-indicator .todo-dot {
          width: 12px;
          height: 12px;
          flex: 0 0 auto;
          border-radius: 50%;
          position: relative;
          box-sizing: border-box;
          margin-top: 2.5px;${/* eslint-disable-line wa/no-raw-spacing -- 2.5px is not on the theme spacing ladder (between --wa-padding-xs 2px and --wa-padding-s 4px); it optically centres the 12px status dot on the first line of wrapping text, and snapping it to a token would shift the dot off the line. */ ""}
        }
        agent-todo-indicator .todo-dot.pending {
          border: 2px solid var(--wa-label-color, #808080);
        }
        agent-todo-indicator .todo-dot.in_progress {
          border: 2px solid var(--wa-action-color-warn, #ff932e);
          overflow: hidden;
        }
        agent-todo-indicator .todo-dot.in_progress::after {
          content: "";
          position: absolute;
          inset: 0;
          background: var(--wa-action-color-warn, #ff932e);
          clip-path: polygon(0 0, 50% 0, 50% 100%, 0 100%);
        }
        agent-todo-indicator .todo-dot.done {
          background: var(--wa-action-color-success, #1dbf70);
          border: 2px solid var(--wa-action-color-success, #1dbf70);
        }
        agent-todo-indicator .todo-dot.done::after {
          content: "";
          position: absolute;
          left: 2px;
          top: 3.4px;
          width: 4px;
          height: 1.6px;
          border-left: 1.6px solid var(--wa-dropdown-background-color, #ffffff);
          border-bottom: 1.6px solid var(--wa-dropdown-background-color, #ffffff);
          transform: rotate(-45deg);
        }
      </style>
      <div
        class="todo-wrapper"
        tabindex="0"
        role="img"
        title=${label}
        aria-label=${label}
        @pointerenter=${() => this._setOpen(true)}
        @pointerleave=${() => this._setOpen(false)}
        @focusin=${() => this._setOpen(true)}
        @focusout=${() => this._setOpen(false)}
        @keydown=${(e: KeyboardEvent) => { if (e.key === "Escape") this._setOpen(false); }}
      >
        ${this._open ? this._renderPop(doneCount, total) : ""}
        <svg class="todo-svg" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3.2 5.6l1.6 1.6 3-3"></path>
          <path d="M3.2 12.4l1.6 1.6 3-3"></path>
          <path d="M11 6.2h6M11 13h6"></path>
        </svg>
        <span class="todo-badge ${allDone ? "all-done" : ""}">
          ${allDone
            ? html`<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 6.2l2.2 2.2 5-5.2"></path></svg>`
            : remaining}
        </span>
      </div>
    `;
  }

  private _renderPop(doneCount: number, total: number) {
    return html`
      <div class="todo-pop" role="list">
        <div class="todo-pop-head">
          <span>TODO</span><span class="n">${doneCount} of ${total} done</span>
        </div>
        ${this._items.map((it) => html`
          <div class="todo-row ${it.status === "done" ? "is-done" : ""}" role="listitem">
            <span class="todo-dot ${it.status}"></span>
            <span class="todo-text">${it.text}</span>
          </div>
        `)}
      </div>
    `;
  }
}

if (!customElements.get("agent-todo-indicator")) {
  customElements.define("agent-todo-indicator", AgentTodoIndicator);
}
