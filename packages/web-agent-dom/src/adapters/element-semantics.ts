// element-semantics.ts — role, accessible name and interactivity derivation for
// a DOM element. Split out of dom-adapter.ts; the code is unchanged.

import type { InteractiveCache } from "./types.js";

// ---------------------------------------------------------------------------
// Implicit ARIA role mapping (pragmatic subset per §5.1 S1)
// ---------------------------------------------------------------------------
const TAG_ROLES: Record<string, string> = {
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  section: "region",
  article: "article",
  form: "form",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
  dialog: "dialog",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "img",
  select: "combobox",
  textarea: "textbox",
  button: "button",
};

const INPUT_TYPE_ROLES: Record<string, string> = {
  text: "textbox",
  search: "searchbox",
  email: "textbox",
  url: "textbox",
  tel: "textbox",
  number: "spinbutton",
  password: "textbox",
  checkbox: "checkbox",
  radio: "radio",
  submit: "button",
  reset: "button",
  button: "button",
  file: "file",
  range: "slider",
  date: "datepicker",
  time: "timepicker",
  color: "colorpicker",
};

/** Traverse children recursively, resolving open shadow roots and slot elements. */
function getTextContentWithSlots(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (tagLC(el) === "slot") {
      const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
      return assigned.map(getTextContentWithSlots).join("");
    }
    let text = "";
    if (el.shadowRoot) {
      for (let i = 0; i < el.shadowRoot.childNodes.length; i++) {
        text += getTextContentWithSlots(el.shadowRoot.childNodes[i]);
      }
    } else {
      for (let i = 0; i < el.childNodes.length; i++) {
        text += getTextContentWithSlots(el.childNodes[i]);
      }
    }
    return text;
  }
  return "";
}

/** Determine ARIA role for an element. */
export function getRole(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();

  if (tag === "a" && el.hasAttribute("href")) return "link";

  if (tag === "input") {
    const type = (el as HTMLInputElement).type || "text";
    return INPUT_TYPE_ROLES[type] || "textbox";
  }

  return TAG_ROLES[tag] || "";
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "checkbox",
  "radio",
  "combobox",
  "switch",
]);

/** True when any ancestor — crossing open shadow-root hosts — is itself
 *  interactive. Used to keep a synthetic control from also ref'ing its own
 *  inner icon/label wrappers, which inherit `cursor: pointer`. */
function hasInteractiveAncestor(el: Element, cache: InteractiveCache): boolean {
  let node: Node | null = el.parentNode;
  while (node) {
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      node = (node as ShadowRoot).host ?? null;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (isInteractive(node as Element, cache)) return true;
      node = node.parentNode;
    } else {
      break;
    }
  }
  return false;
}

/** True when any descendant — crossing open shadow roots — is interactive.
 *  Keeps a `cursor: pointer` wrapper from stealing a ref from the real
 *  control inside it (e.g. Material's host element around its own
 *  `<button>`). */
function hasInteractiveDescendant(el: Element, cache: InteractiveCache): boolean {
  let found = false;
  const visit = (n: Node): void => {
    if (found || n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    if (e !== el && isInteractive(e, cache)) { found = true; return; }
    if (e.shadowRoot) e.shadowRoot.childNodes.forEach(visit);
    e.childNodes.forEach(visit);
  };
  visit(el);
  return found;
}

/** Is the element interactive per §5.1 S2? `cache` is optional so call
 *  sites outside a single snapshot pass (tests, ad-hoc checks) don't need
 *  one; every snapshot-walk call site threads a shared per-call cache — see
 *  `InteractiveCache` in `types.ts` for why that isn't just a speed-up. */
export function isInteractive(el: Element, cache: InteractiveCache = new Map()): boolean {
  const cached = cache.get(el);
  if (cached !== undefined) return cached;

  const tag = el.tagName.toLowerCase();

  if (
    (tag === "a" && el.hasAttribute("href")) ||
    tag === "button" ||
    tag === "input" ||
    tag === "select" ||
    tag === "textarea"
  ) {
    return true;
  }

  if (el.getAttribute("contenteditable") === "true") return true;
  if (el.hasAttribute("onclick")) return true;

  const role = el.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  // A focusable author-defined control. `tabindex="0"` (or any non-negative
  // value) is the ARIA-authoring signal for "this div behaves as a control".
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null && Number(tabindex) >= 0) return true;

  // Last resort for a control that exposes no attribute at all: a pointer
  // cursor, a name to show, no interactive ancestor and no interactive
  // descendant. See `isPointerControl` for why every clause is needed.
  // Provisional false while this recurses — see `InteractiveCache`.
  cache.set(el, false);
  const result = isPointerControl(el, cache);
  cache.set(el, result);
  return result;
}

/** A control that exposes no interactive attribute at all — the shape a
 *  framework produces from `@click` / `onClick` / `(click)`, which bind with
 *  `addEventListener` and leave nothing in the DOM to read.
 *
 *  Every clause below is load-bearing. Measured on the cat-store store page
 *  (330 elements walked, shadow roots included) on 2026-08-12:
 *    - `cursor: pointer` alone                                   → 156 matches
 *    - plus "no interactive descendant"                          → 142 matches
 *    - plus "no interactive ancestor" and "has a name"           →   0 matches
 *  The 142 are Material internals (`md-ripple`, `md-elevation`,
 *  `md-focus-ring`, `slot`, `span`, `i`) that inherit the host button's
 *  cursor. Dropping any clause reintroduces them and would spend the
 *  400-line node budget on noise. */
function isPointerControl(el: Element, cache: InteractiveCache): boolean {
  if (typeof window === "undefined" || !window.getComputedStyle) return false;
  if (getComputedStyle(el).cursor !== "pointer") return false;
  const name = getName(el);
  if (!name || name.length > 120) return false;
  if (hasInteractiveAncestor(el, cache)) return false;
  if (hasInteractiveDescendant(el, cache)) return false;
  return true;
}

/** The tree the element lives in: its own open shadow root, else the document.
 *  `document.getElementById` and `document.querySelector` do not enter a
 *  shadow root, so a label next to the element inside one is found here. */
function ownRoot(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : document;
}

/** Compute an accessible name (pragmatic §5.1 S1). */
export function getName(el: Element): string {
  // aria-label
  const aLabel = el.getAttribute("aria-label");
  if (aLabel?.trim()) return aLabel.trim();

  // aria-labelledby
  const aLabelledBy = el.getAttribute("aria-labelledby");
  if (aLabelledBy) {
    const texts = aLabelledBy
      .split(/\s+/)
      .map((id) => (ownRoot(el).getElementById(id) ?? document.getElementById(id))?.textContent?.trim())
      .filter(Boolean);
    if (texts.length > 0) return texts.join(" ");
  }

  // <label for="elId">
  const id = el.getAttribute("id");
  if (id) {
    const escaped = id.replace(/["\\]/g, "\\$&");
    const selector = `label[for="${escaped}"]`;
    const label = ownRoot(el).querySelector(selector) ?? document.querySelector(selector);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  // wrapping <label>
  const parentLabel = el.closest("label");
  if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();

  // alt
  const alt = el.getAttribute("alt");
  if (alt?.trim()) return alt.trim();

  // title
  const title = el.getAttribute("title");
  if (title?.trim()) return title.trim();

  // button textContent
  if (tagLC(el) === "button") {
    const t = getTextContentWithSlots(el).trim();
    if (t && t.length <= 120) return t;
  }

  // Generic fallback: short text content
  const text = getTextContentWithSlots(el).trim();
  if (text.length > 0 && text.length <= 120) return text;
  if (text.length > 120) return text.slice(0, 120) + "…";

  return "";
}

export function tagLC(el: Element): string {
  return el.tagName.toLowerCase();
}

/** Pure {role, name} for an element — same logic the snapshot/describe use.
 *  Exported so UI (pick mode) can label elements without a DomAdapter. */
export function describeElementParts(el: Element): { role: string; name: string } {
  return { role: getRole(el) || el.tagName.toLowerCase(), name: getName(el) };
}
