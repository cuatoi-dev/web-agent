import type { CheckVisibilityCapable } from "./types.js";

/**
 * Is this element visible per CSS?
 *
 * Uses `Element.checkVisibility` where the platform has it. **jsdom does not
 * implement `checkVisibility`**, so the fallback below runs in every unit test;
 * the native path is exercised only by stubbing the method.
 */
export function isElementVisible(el: Element): boolean {
  const cap = el as CheckVisibilityCapable;
  if (typeof cap.checkVisibility === "function") {
    return cap.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  return isElementVisibleFallback(el);
}

/**
 * Fallback for platforms without `checkVisibility` (jsdom). Walks the element
 * and its ancestors and reproduces the three conditions `checkVisibility`
 * covers with the options above: `display:none`, `visibility:hidden|collapse`,
 * and a computed opacity of 0. It does NOT reproduce `content-visibility`, and
 * like the native method it does not see `clip-path` — that case is caught by
 * the alpha scan instead.
 *
 * Exported so unit tests can call the fallback directly and prove which path
 * they took.
 */
export function isElementVisibleFallback(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view) return true;
  let node: Element | null = el;
  while (node) {
    const s = view.getComputedStyle(node);
    if (s.display === "none") return false;
    if (s.visibility === "hidden" || s.visibility === "collapse") return false;
    // jsdom returns "" for an unset opacity, and Number("") is 0 — without this
    // guard every element in every unit test would read as hidden.
    if (s.opacity !== "" && Number(s.opacity) === 0) return false;
    node = node.parentElement;
  }
  return true;
}
