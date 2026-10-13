/**
 * 003 — drag the top-left grip to resize the open chat box.
 *
 * Host-side only. It sets the two custom properties task 002 added
 * (`--web-agent-panel-width`, `--web-agent-panel-height`) on the <web-agent-bubble> element,
 * and reads the box of the bubble's own `#panel-container` div, which lives in
 * the bubble's OPEN shadow root. It never queries, styles, or modifies
 * anything inside `agent-chat-panel`.
 *
 * This file is duplicated in `apps/cat-store/src/web/panel-resize.ts` on purpose.
 * Task 001 deleted `apps/_shared/` so each app can be lifted out of the repo on
 * its own. Do not extract it into a shared module or package.
 */

import type { Size } from './types';
export type { Size } from './types';

/** User decision, 2026-08-10: the box never gets smaller than this. */
export const MIN_WIDTH = 360;
export const MIN_HEIGHT = 420;

/** User decision, 2026-08-10: the box never gets larger than the window less
 *  these margins, so it cannot be dragged off-screen or under the launcher. */
export const VIEWPORT_MARGIN_X = 40;
export const VIEWPORT_MARGIN_Y = 100;

const GRIP_SIZE = 28;

/** Inline SVG, not an icon font: the two apps share no font, and a missing
 *  glyph is a tofu box. The arrow points up-left and down-right on one
 *  diagonal stroke, matching the `nwse-resize` cursor. */
const GRIP_ARROW_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M4 4 L20 20 M4 4 L9 4 M4 4 L4 9 M20 20 L15 20 M20 20 L20 15" ' +
  'fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Keeps a size inside the agreed bounds. The minimum wins when the window is
 *  too small for it, so the returned size is never below the minimum. */
export function clampPanelSize(size: Size, viewport: Size): Size {
  const maxWidth = Math.max(MIN_WIDTH, viewport.width - VIEWPORT_MARGIN_X);
  const maxHeight = Math.max(MIN_HEIGHT, viewport.height - VIEWPORT_MARGIN_Y);
  return {
    width: Math.min(maxWidth, Math.max(MIN_WIDTH, size.width)),
    height: Math.min(maxHeight, Math.max(MIN_HEIGHT, size.height)),
  };
}

/** The grip is at the TOP-LEFT and the box is anchored bottom-right, so moving
 *  the pointer left or up (a negative delta) makes the box bigger. */
export function resizeFromGrip(start: Size, deltaX: number, deltaY: number, viewport: Size): Size {
  return clampPanelSize(
    { width: Math.round(start.width - deltaX), height: Math.round(start.height - deltaY) },
    viewport,
  );
}

/** The grip carries its own rules, so they travel with it into whatever tree the
 *  host puts the bubble in. Nothing is written to `document.head`, and the
 *  element carries no `id` — an id in the light DOM would still answer
 *  `document.getElementById`, which is the global scope this task removes. */
function createStyleEl(): HTMLStyleElement {
  const style = document.createElement("style");
  style.setAttribute("data-wa-styles", "resize-grip");
  style.textContent = `
    .wa-resize-grip {
      position: fixed;
      z-index: 1001;
      display: none;
      width: ${GRIP_SIZE}px;
      height: ${GRIP_SIZE}px;
      color: var(--wa-text-color, #202124);
      cursor: nwse-resize;
      touch-action: none;
    }
    /* The arrow is an inline SVG, never an icon font: the two apps do not
       share a font, and a missing glyph would render as a tofu box. Hidden at
       rest, shown on hover and while dragging. The grip div stays hit-testable
       at all times, so a touch drag needs no hover. */
    .wa-resize-grip svg {
      display: block;
      width: 100%;
      height: 100%;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .wa-resize-grip:hover svg,
    .wa-resize-grip[data-wa-dragging] svg {
      opacity: 1;
    }
    /* 003: this sheet now lives inside the bubble's shadow root, so ':host'
       is the <web-agent-bubble> element and '#panel-container' is a sibling
       subtree. Lifts the bubble's own 'max-height: 80vh' once the user has
       dragged. Specificity (1 id, 2 pseudo/attribute) beats the bubble's own
       rule (1 id), so source order does not matter. With no drag the
       attribute is absent and the 80vh cap still applies. */
    :host([data-wa-resized]) #panel-container { max-height: none; }
  `;
  return style;
}

/** Opt in. Call once per bubble, after it is in the DOM.
 *
 *  003: the bubble is a shadow element. Its root is open precisely so a host
 *  can attach chrome like this grip next to the panel container, in the same
 *  tree — which is also what lets the grip's own <style> reach it. */
export function enablePanelResize(bubble: HTMLElement): void {
  const root = bubble.shadowRoot;
  if (!root) return;
  const container = root.querySelector<HTMLElement>("#panel-container");
  if (!container) return;

  const grip = document.createElement("div");
  grip.className = "wa-resize-grip";
  grip.innerHTML = GRIP_ARROW_SVG;
  // After `innerHTML`, never before — assigning `innerHTML` would wipe the sheet.
  grip.appendChild(createStyleEl());
  root.appendChild(grip);

  const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });
  const boxSize = (): Size => {
    const r = container.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  };

  const apply = (size: Size): void => {
    bubble.style.setProperty("--web-agent-panel-width", `${size.width}px`);
    bubble.style.setProperty("--web-agent-panel-height", `${size.height}px`);
    bubble.setAttribute("data-wa-resized", "");
  };

  /** Flush: the grip's bottom-right corner sits exactly on the box's top-left
   *  corner, with no overlap and no gap. */
  const placeGrip = (): void => {
    const r = container.getBoundingClientRect();
    grip.style.left = `${r.left - GRIP_SIZE}px`;
    grip.style.top = `${r.top - GRIP_SIZE}px`;
  };

  /** No persistence: closing the chat drops the dragged size. */
  const reset = (): void => {
    bubble.style.removeProperty("--web-agent-panel-width");
    bubble.style.removeProperty("--web-agent-panel-height");
    bubble.removeAttribute("data-wa-resized");
    grip.removeAttribute("data-wa-dragging");
  };

  let start: Size | null = null;
  let startX = 0;
  let startY = 0;

  const onMove = (e: PointerEvent): void => {
    if (!start) return;
    apply(resizeFromGrip(start, e.clientX - startX, e.clientY - startY, viewport()));
    placeGrip();
  };

  const onEnd = (): void => {
    start = null;
    grip.removeAttribute("data-wa-dragging");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onEnd);
    document.removeEventListener("pointercancel", onEnd);
  };

  grip.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    grip.setAttribute("data-wa-dragging", "");
    start = boxSize();
    startX = e.clientX;
    startY = e.clientY;
    // Commit the size that is already on screen before lifting the 80vh cap, so
    // the box cannot jump on the first pixel of the drag.
    apply(clampPanelSize(start, viewport()));
    placeGrip();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
  });

  window.addEventListener("resize", () => {
    if (grip.style.display !== "block") return;
    // The agreed maximum is the window, so a smaller window pulls a dragged box
    // back inside it.
    if (bubble.hasAttribute("data-wa-resized")) apply(clampPanelSize(boxSize(), viewport()));
    placeGrip();
  });

  // The bubble opens and closes by setting `#panel-container.style.display`
  // (packages/web-agent-lit/src/embed/web-agent-embed.ts:343 and :410). Watching
  // that attribute is how the host learns about open and close without reaching
  // inside the panel.
  const sync = (): void => {
    const open = container.style.display === "flex";
    grip.style.display = open ? "block" : "none";
    if (open) placeGrip();
    else reset();
  };

  new MutationObserver(sync).observe(container, { attributes: true, attributeFilter: ["style"] });
  sync();
}
