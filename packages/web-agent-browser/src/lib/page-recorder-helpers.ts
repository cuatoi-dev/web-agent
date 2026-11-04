// Stateless DOM, element-naming, key-formatting and heading helpers used by
// page-recorder.ts. Split out to stay under eslint.config.mjs's 500-line cap.
import { describeElementParts } from "@cuatoi/web-agent-dom";
import { EXTENSION_UI_SELECTOR } from "./constants";

const INTERACTIVE_ROLES = [
  "button", "link", "checkbox", "radio", "tab", "menuitem", "option", "switch",
  "combobox", "listbox", "slider", "spinbutton", "searchbox", "textbox",
  "treeitem", "gridcell", "row", "menuitemcheckbox", "menuitemradio",
];

/** Semantic controls and ARIA widget roles matched first on the composed path. */
const INTERACTIVE = [
  "a", "button", "input", "select", "textarea", "summary", "label",
  '[contenteditable="true"]', "[tabindex]",
  ...INTERACTIVE_ROLES.map((r) => `[role="${r}"]`),
].join(", ");

/** Elements on the event's path, innermost first, across open shadow roots and slots. */
export function eventElements(event: Event): Element[] {
  if (typeof event.composedPath !== "function") {
    return event.target instanceof Element ? [event.target] : [];
  }
  return event.composedPath().filter((n): n is Element => n instanceof Element);
}

/** The real element that received the event, innermost first. Replaces event.target. */
export function innermost(event: Event): Element | null {
  const path = eventElements(event);
  return path.length > 0 ? path[0] : null;
}

function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

function hasPointerCursor(el: Element): boolean {
  return (el.ownerDocument.defaultView ?? window).getComputedStyle(el).cursor === "pointer";
}

/** The click or hover target on the composed path: closest INTERACTIVE match
 *  first, then an `onclick` attribute or the outermost `cursor: pointer` element. */
export function target(event: Event): Element | null {
  const path = eventElements(event);
  for (const el of path) {
    if (el.matches(INTERACTIVE)) return el;
  }
  for (const el of path) {
    if (el === document.documentElement || el === document.body) break;
    if (el.hasAttribute("onclick")) return el;
    if (hasPointerCursor(el)) {
      const parent = composedParent(el);
      if (!parent || !hasPointerCursor(parent)) return el;
    }
  }
  return null;
}

export function describe(el: Element): string {
  const { role, name } = describeElementParts(el);
  return name ? `${role} "${name}"` : role;
}

/** `button "Apply"` — the plan's readable-line element part. */
export function named(el: Element): string {
  const { role, name } = describeElementParts(el);
  return `${role} "${name}"`;
}

/** The text-entry test shared by the fill rule and the key rule: an <input>
 *  that fills, a <textarea>, or a contenteditable element. */
export function isTextEntry(el: Element): boolean {
  return (
    (el instanceof HTMLInputElement && !["checkbox", "radio", "file"].includes(el.type)) ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** Keys that are a state of the keyboard, not an action on the page. */
export const MODIFIER_KEYS = [
  "Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "Fn", "OS",
];

/** True for a key whose value is a single character, space included. */
export function isPrintable(key: string): boolean {
  return key.length === 1;
}

/** One key press as a Playwright `keyboard.press` string, for example
 *  "ArrowDown", "Space", "Control+a" or "Shift+Tab".
 *  `event.key` of a printable already carries the shift — Shift+a is "A" — so
 *  Shift is added only to a key that has no character of its own. */
export function playwrightKey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  if (event.shiftKey && !isPrintable(event.key)) parts.push("Shift");
  parts.push(event.key === " " ? "Space" : event.key);
  return parts.join("+");
}

/** All headings in composed tree order, crossing open shadow roots and skipping AGENT_UI. */
export function* headings(root: ParentNode): Generator<Element> {
  for (const el of root.children) {
    if (el.matches(EXTENSION_UI_SELECTOR)) continue;
    if (el.matches("h1, h2, h3, h4, h5, h6")) yield el;
    if (el.shadowRoot) yield* headings(el.shadowRoot);
    yield* headings(el);
  }
}
