// snapshot-format.ts — line formatting and significant-node counting for the
// snapshot walk. Split out of dom-adapter.ts.

import type { InteractiveCache } from "./types.js";
import { getRole, isInteractive, tagLC } from "./element-semantics.js";

/** Escape special chars for display in a quoted snapshot string. */
export function esc(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** Build state-annotation string. */
export function stateTags(el: Element, role: string): string {
  const parts: string[] = [];

  const valueRoles = new Set(["textbox", "searchbox", "spinbutton", "textarea"]);
  if (valueRoles.has(role) || (role === "combobox" && tagLC(el) === "select")) {
    const v = (el as HTMLInputElement | HTMLTextAreaElement).value;
    if (v !== undefined) parts.push(`value="${esc(v)}"`);
  }

  const checkRoles = new Set(["checkbox", "radio", "switch"]);
  if (checkRoles.has(role) && (el as HTMLInputElement).checked) {
    parts.push("checked");
  }

  if ((el as HTMLInputElement).disabled) parts.push("disabled");
  if ((el as HTMLInputElement).required) parts.push("required");

  const ac = el.getAttribute("aria-current");
  if (ac === "true" || ac === "page") parts.push("(current)");

  // Select options
  if (role === "combobox" && tagLC(el) === "select") {
    const sel = el as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.label || o.value);
    const shown = opts.length > 20 ? opts.slice(0, 20) : opts;
    const list = shown.map((o) => `"${esc(o)}"`).join(",");
    let optsStr = `options=[${list}]`;
    if (opts.length > 20) optsStr += ` …+${opts.length - 20} more`;
    parts.push(optsStr);
  }

  return parts.length > 0 ? " " + parts.join(" ") : "";
}

/** Check if element should be skipped. */
export function skipElement(el: Element): boolean {
  const tag = tagLC(el);
  if (tag === "script" || tag === "style") return true;
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;

  const style = el.getAttribute("style");
  if (style) {
    const s = style.toLowerCase().replace(/\s+/g, "");
    if (s.includes("display:none") || s.includes("visibility:hidden")) {
      return true;
    }
  }
  return false;
}

// An ELEMENT emits its own snapshot line iff it has a role or is interactive.
function isSignificantElement(el: Element, cache: InteractiveCache): boolean {
  return !!getRole(el) || isInteractive(el, cache);
}

export function countSignificant(
  node: Node,
  interactiveOnly: boolean,
  agentUiEl: Element | null,
  cache: InteractiveCache = new Map(),
  // Counts only the nodes the `include_text` filter keeps, so a filtered
  // snapshot's `+N nodes hidden` markers and `TRUNCATED` line report matching
  // nodes instead of the whole page. Defaults to "count everything", which is
  // what every unfiltered call site gets without changing.
  matchesTerm: (nd: Node) => boolean = () => true,
): number {
  let n = 0;
  const visit = (nd: Node): void => {
    if (nd.nodeType === Node.TEXT_NODE) {
      if (interactiveOnly) return;
      const t = nd.textContent?.trim();
      if (!t) return;
      const p = nd.parentElement;
      if (p && isInteractive(p, cache)) return;
      if (!matchesTerm(nd)) return;
      n++;
      return;
    }
    if (nd.nodeType !== Node.ELEMENT_NODE) return;
    const el = nd as Element;
    if (skipElement(el)) return;
    if (agentUiEl && (el === agentUiEl || agentUiEl.contains(el))) return;
    if (isSignificantElement(el, cache) && matchesTerm(el)) n++;
    // recurse: slot → assigned nodes; else light DOM + open shadow root
    if (tagLC(el) === "slot") {
      for (const a of (el as HTMLSlotElement).assignedNodes({ flatten: true })) visit(a);
    } else {
      el.childNodes.forEach(visit);
      if (el.shadowRoot) el.shadowRoot.childNodes.forEach(visit);
    }
  };
  // count DESCENDANTS of `node`, not `node` itself
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (tagLC(el) === "slot") {
      for (const a of (el as HTMLSlotElement).assignedNodes({ flatten: true })) visit(a);
    } else {
      el.childNodes.forEach(visit);
      if (el.shadowRoot) el.shadowRoot.childNodes.forEach(visit);
    }
  }
  return n;
}
