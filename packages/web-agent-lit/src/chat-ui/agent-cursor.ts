import { SPEED_PRESETS } from "@cuatoi/web-agent-core";
import type { AgentCursor } from "./types.js";

export type { AgentCursor };

const MIN_MOVE_MS = 120;
const MAX_MOVE_MS = 1200;

const SVG_CURSOR = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0L16 8L10 10L8 16Z" fill="var(--wa-action-color-info, #6750A4)" stroke="var(--wa-text-color, white)" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

const CSS = `
@keyframes wa-cursor-pulse {
  from { transform: scale(0.2); opacity: 0.65; }
  to   { transform: scale(2.4); opacity: 0; }
}
@keyframes wa-cursor-flash {
  from { opacity: 0.45; }
  to   { opacity: 0; }
}
.wa-agent-cursor-layer {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 2147483000;
}
.wa-agent-cursor {
  position: fixed;
  left: 0; top: 0;
  width: 24px; height: 24px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  will-change: transform;
}
.wa-agent-cursor--visible {
  opacity: 1;
}
.wa-cursor-pulse {
  position: fixed;
  width: 32px; height: 32px;
  border: 2px solid var(--wa-action-color-info, #6750A4);
  border-radius: 50%;
  animation: wa-cursor-pulse 600ms ease-out forwards;
  pointer-events: none;
}
.wa-cursor-flash {
  position: fixed;
  background: var(--wa-action-color-info-20opc, rgba(103, 80, 164, 0.25));
  animation: wa-cursor-flash 500ms ease-out forwards;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .wa-cursor-pulse, .wa-cursor-flash { animation: none !important; }
  .wa-agent-cursor { transition: none !important; }
}
`;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function createCursor(): AgentCursor {
  let lastPos = { x: -100, y: -100 };
  let visible = false;
  let _layer: HTMLElement | null = null;
  let _pointer: HTMLElement | null = null;
  let _styleEl: HTMLStyleElement | null = null;
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  let moveResolve: (() => void) | null = null;

  function ensureElements(): { layer: HTMLElement; pointer: HTMLElement } | null {
    if (typeof document === "undefined") return null;
    if (_layer && !document.body.contains(_layer)) {
      _layer = null;
      _pointer = null;
      _styleEl = null;
    }
    if (!_layer) {
      _layer = document.createElement("div");
      _layer.className = "wa-agent-cursor-layer";
      _layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(_layer);

      // The rules live inside the layer, not in `document.head`, so they reach
      // the cursor wherever the layer is placed. No `id`: an id in the light DOM
      // would still answer `document.getElementById`, which is the global scope
      // that shadow-DOM hosting must avoid.
      _styleEl = document.createElement("style");
      _styleEl.setAttribute("data-wa-styles", "agent-cursor");
      _styleEl.textContent = CSS;
      _layer.appendChild(_styleEl);

      _pointer = document.createElement("div");
      _pointer.className = "wa-agent-cursor";
      _pointer.innerHTML = SVG_CURSOR;
      _pointer.style.transform = `translate(${lastPos.x}px, ${lastPos.y}px)`;
      _layer.appendChild(_pointer);

      if (visible) {
        _pointer.classList.add("wa-agent-cursor--visible");
      }
    }
    return { layer: _layer, pointer: _pointer! };
  }

  function scheduleTransientRemove(el: HTMLElement, animMs: number) {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      el.remove();
    }, animMs);
    pendingTimers.add(id);
    el.addEventListener("animationend", () => el.remove());
  }

  const cursor: AgentCursor = {
    show() {
      if (typeof document === "undefined") return;
      const els = ensureElements();
      if (!els) return;
      visible = true;
      els.pointer.classList.add("wa-agent-cursor--visible");
    },

    hide() {
      if (typeof document === "undefined") return;
      visible = false;
      _pointer?.classList.remove("wa-agent-cursor--visible");
    },

    async moveTo(point, speed = "slow") {
      if (typeof document === "undefined") return;
      cursor.show();
      const els = ensureElements();
      if (!els) return;

      if (prefersReducedMotion()) {
        els.pointer.style.transition = "none";
        els.pointer.style.transform = `translate(${point.x}px, ${point.y}px)`;
        lastPos = { ...point };
        return;
      }

      const dx = point.x - lastPos.x;
      const dy = point.y - lastPos.y;
      const dist = Math.hypot(dx, dy);
      const pxPerMs = SPEED_PRESETS[speed].travelPxPerSec / 1000;
      const dur = Math.max(MIN_MOVE_MS, Math.min(MAX_MOVE_MS, dist / pxPerMs));

      els.pointer.style.transition = `transform ${dur}ms ease-in-out`;
      els.pointer.style.transform = `translate(${point.x}px, ${point.y}px)`;
      lastPos = { ...point };

      if (moveResolve) {
        const prev = moveResolve;
        moveResolve = null;
        prev();
      }

      return new Promise<void>((resolve) => {
        moveResolve = resolve;
        const id = setTimeout(() => {
          pendingTimers.delete(id);
          if (moveResolve === resolve) {
            moveResolve = null;
            resolve();
          }
        }, dur);
        pendingTimers.add(id);
      });
    },

    clickPulse() {
      if (typeof document === "undefined") return;
      if (prefersReducedMotion()) return;
      const els = ensureElements();
      if (!els) return;
      const pulse = document.createElement("span");
      pulse.className = "wa-cursor-pulse";
      pulse.style.left = `${lastPos.x - 16}px`;
      pulse.style.top = `${lastPos.y - 16}px`;
      scheduleTransientRemove(pulse, 600);
      els.layer.appendChild(pulse);
    },

    flash(rect) {
      if (typeof document === "undefined") return;
      if (prefersReducedMotion()) return;
      const els = ensureElements();
      if (!els) return;
      const flashEl = document.createElement("span");
      flashEl.className = "wa-cursor-flash";
      flashEl.style.left = `${rect.x}px`;
      flashEl.style.top = `${rect.y}px`;
      flashEl.style.width = `${rect.width}px`;
      flashEl.style.height = `${rect.height}px`;
      scheduleTransientRemove(flashEl, 500);
      els.layer.appendChild(flashEl);
    },

    clear() {
      if (typeof document === "undefined") return;
      const ids = [...pendingTimers];
      for (const id of ids) clearTimeout(id);
      pendingTimers.clear();
      if (moveResolve) {
        const r = moveResolve;
        moveResolve = null;
        r();
      }
      if (_layer) {
        const children = [..._layer.children];
        for (const child of children) {
          if (child !== _pointer && child !== _styleEl) child.remove();
        }
      }
      cursor.hide();
    },

    destroy() {
      if (typeof document === "undefined") return;
      cursor.clear();
      _layer?.remove();
      _layer = null;
      _pointer = null;
      _styleEl = null;
      lastPos = { x: -100, y: -100 };
      visible = false;
    },

    reset() {
      cursor.clear();
    },
  };

  return cursor;
}

let _cursor: AgentCursor | null = null;

function getOrCreateCursor(): AgentCursor {
  if (!_cursor) {
    _cursor = createCursor();
  }
  return _cursor;
}

export const agentCursor: AgentCursor = new Proxy({} as AgentCursor, {
  get(_, p) {
    return (getOrCreateCursor() as unknown as Record<string | symbol, unknown>)[p];
  },
});

export function getAgentCursor(): AgentCursor {
  return agentCursor;
}
