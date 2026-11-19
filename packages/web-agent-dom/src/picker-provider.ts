// picker-provider.ts — point-at-elements picker, registered as an
// AttachmentProvider on core's `attachmentProviders` seam.
//
// Framework-agnostic re-implementation of the picking interaction
// (web-agent-lit's `PointerController` covers the same ground but isn't
// reusable here — this package must not depend on a framework binding).
// On `onUserPrompt`, this provider takes a focused snapshot of every picked
// element with `DomAdapter.snapshotFocused()` and appends it to the message as
// a "# Pointed elements" text part (`buildPointedElementsBlock`). Core has no
// picker-specific handling.
import type { AttachmentProvider, AttachmentChip, MessagePart } from "@cuatoi/web-agent-core";
import { attachmentChipsMeta } from "@cuatoi/web-agent-core";
import { describeElementParts, DomAdapter } from "./adapters/dom-adapter.js";
import { buildPointedElementsBlock } from "./utils/pointed-elements.js";

import type { PickedEntry, PickerProviderOptions } from "./types.js";

// Re-exported so importers of this module keep their existing import path.
export type { PickerProviderOptions } from "./types.js";

const DEFAULT_MAX_ITEMS = 8;
const PICKING_CLASS = "wa-dom-picking";
const PINNABLE_SELECTOR =
  'button, a[href], input, select, textarea, [role], [contenteditable="true"], [onclick]';
const LAYER_Z_INDEX = 2147482000;

/** Rules for the hover outline, which lives in `document.body`. */
const OUTLINE_CSS = `
.wa-dom-picker-outline {
  position: fixed;
  border: 2px solid var(--wa-action-color-info, #6750A4);
  background: var(--wa-action-color-info-10opc, rgba(103, 80, 164, 0.12));
  border-radius: var(--wa-border-radius-m, 4px);
  pointer-events: none;
  z-index: ${LAYER_Z_INDEX};
  display: none;
}
html.${PICKING_CLASS}, html.${PICKING_CLASS} * {
  cursor: crosshair !important;
}
`;

/** Rules for the chip strip, which the panel renders inside itself. */
const STRIP_CSS = `
.wa-dom-picker-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wa-padding-s, 4px);
  padding: var(--wa-padding-s, 4px) 0;
}
.wa-dom-picker-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--wa-padding-s, 4px);
  padding: var(--wa-padding-xs, 2px) var(--wa-padding-m, 8px);
  border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
  background: var(--wa-background-color-100, #eee);
  color: var(--wa-text-color, #222);
  font: 12px/1.6 system-ui;
}
.wa-dom-picker-chip button {
  border: none;
  background: none;
  cursor: pointer;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  padding: 0;
}
`;

/** `Element.closest()` that pierces shadow-root boundaries. */
function closestAcrossShadow(el: Element, selector: string): Element | null {
  let node: Element | null = el;
  while (node) {
    const hit = node.closest(selector);
    if (hit) return hit;
    const root = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

function realTarget(ev: Event): Element | null {
  const path = ev.composedPath();
  return (path[0] as Element) ?? (ev.target as Element | null);
}

export function pickerAttachmentProvider(
  opts: PickerProviderOptions = {},
): AttachmentProvider {
  const agentUiSelector = opts.agentUiSelector ?? "[data-agent-ui]";
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;

  let active = false;
  let items: PickedEntry[] = [];
  let nextId = 1;
  let outlineEl: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  const root = document.createElement("div");
  root.setAttribute("data-attachment-slot", "picker");
  // Rendered inside `root`, which the panel places in its own tree, so the chip
  // rules travel with it. No `id`: a page may hold more than one panel.
  const stripStyle = document.createElement("style");
  stripStyle.setAttribute("data-wa-styles", "dom-picker-strip");
  stripStyle.textContent = STRIP_CSS;
  root.appendChild(stripStyle);
  const strip = document.createElement("div");
  strip.className = "wa-dom-picker-strip";
  strip.style.display = "none";
  root.appendChild(strip);

  function isExcluded(el: Element): boolean {
    if (closestAcrossShadow(el, agentUiSelector)) return true;
    if (root.contains(el)) return true;
    return false;
  }

  function resolvePinnable(el: Element): Element {
    return el.closest(PINNABLE_SELECTOR) ?? el;
  }

  function ensureOutline(): void {
    if (outlineEl && document.body.contains(outlineEl)) return;
    outlineEl = document.createElement("div");
    outlineEl.className = "wa-dom-picker-outline";
    outlineEl.setAttribute("data-agent-ui", "true");
    // The outline carries its own rules. A `<style>` child renders nothing (the
    // user-agent stylesheet gives it `display: none`), and the sheet applies to
    // the whole tree the outline is in — `document.body`, so the
    // `html.wa-dom-picking` cursor rule still reaches `<html>`.
    const outlineStyle = document.createElement("style");
    outlineStyle.setAttribute("data-wa-styles", "dom-picker-outline");
    outlineStyle.textContent = OUTLINE_CSS;
    outlineEl.appendChild(outlineStyle);
    document.body.appendChild(outlineEl);
  }

  function positionOutline(el: Element): void {
    if (!outlineEl) return;
    const rect = el.getBoundingClientRect();
    outlineEl.style.display = "block";
    outlineEl.style.left = `${rect.left}px`;
    outlineEl.style.top = `${rect.top}px`;
    outlineEl.style.width = `${rect.width}px`;
    outlineEl.style.height = `${rect.height}px`;
  }

  function hideOutline(): void {
    if (outlineEl) outlineEl.style.display = "none";
  }

  function onPointerMove(ev: PointerEvent): void {
    const raw = realTarget(ev);
    if (!raw || isExcluded(raw)) {
      hideOutline();
      return;
    }
    positionOutline(resolvePinnable(raw));
  }

  function onClick(ev: MouseEvent): void {
    const el = realTarget(ev);
    if (!el || isExcluded(el)) return;
    ev.preventDefault();
    ev.stopPropagation();
    pinAt(el);
  }

  function onSuppress(ev: Event): void {
    const el = realTarget(ev);
    if (!el || isExcluded(el)) return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  function pinAt(rawTarget: Element): void {
    const target = resolvePinnable(rawTarget);
    const existing = items.find((e) => e.el === target);
    if (existing) {
      unpin(existing.id);
      return;
    }
    if (items.length >= maxItems) return;
    const { role, name } = describeElementParts(target);
    items.push({ id: nextId++, el: target, role, name });
    renderStrip();
    notify();
  }

  function unpin(id: number): void {
    items = items.filter((e) => e.id !== id);
    renderStrip();
    notify();
  }

  function renderStrip(): void {
    strip.innerHTML = "";
    if (items.length === 0) {
      strip.style.display = "none";
      return;
    }
    strip.style.display = "flex";
    items.forEach((entry) => {
      const chip = document.createElement("span");
      chip.className = "wa-dom-picker-chip";
      const label = document.createElement("span");
      label.textContent = entry.name ? `${entry.role} "${entry.name}"` : entry.role;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `Remove pointed element ${entry.name || entry.role}`);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => unpin(entry.id));
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      strip.appendChild(chip);
    });
  }

  function enable(): void {
    if (active || typeof document === "undefined") return;
    active = true;
    ensureOutline();
    document.documentElement.classList.add(PICKING_CLASS);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", onSuppress, true);
    document.addEventListener("pointerdown", onSuppress, true);
    notify();
  }

  function disable(): void {
    if (!active || typeof document === "undefined") return;
    active = false;
    document.documentElement.classList.remove(PICKING_CLASS);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", onSuppress, true);
    document.removeEventListener("pointerdown", onSuppress, true);
    hideOutline();
    notify();
  }

  return {
    id: "picker",
    label: "Point at elements",
    icon: "ads_click",
    pick: () => (active ? disable() : enable()),
    hasPending: () => items.length > 0,
    slot: () => root,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async onUserPrompt(payload) {
      if (items.length === 0) return;
      const taken = items;
      const chips: AttachmentChip[] = [
        {
          providerId: "picker",
          label: taken.length === 1 ? "1 element pointed" : `${taken.length} elements pointed`,
        },
      ];
      items = [];
      renderStrip();
      disable();
      const adapter = opts.getDomAdapter?.() ?? new DomAdapter({ agentUiSelector });
      const snapshots = await adapter.snapshotFocused(taken.map((t) => t.el));
      const block = buildPointedElementsBlock(snapshots);
      const typed = payload.parts
        .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      return {
        parts: [...payload.parts, { type: "text", text: block }],
        userDisplayText: typed,
        meta: attachmentChipsMeta(chips),
      };
    },
    dispose() {
      disable();
      listeners.clear();
      root.remove();
      outlineEl?.remove();
      outlineEl = null;
    },
  };
}
