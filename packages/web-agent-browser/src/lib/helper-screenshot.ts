// 127/005 — page-side parts of page_screenshot: finding the first element for a
// CSS or XPath target, and the temporary red outline. Installed on
// `globalThis.__waHelper` through helper-api.ts. All functions are synchronous.
import type { ScreenshotOutline, ScreenshotSelection, ScreenshotStyleDeclaration, Styled } from "./helper-screenshot.types";

// XPathResult type constants (DOM Standard). Numeric, so they work in any frame.
const XPATH_NUMBER = 1;
const XPATH_STRING = 2;
const XPATH_BOOLEAN = 3;
const XPATH_ORDERED_NODE_SNAPSHOT = 7;
const XPATH_FIRST_ORDERED_NODE = 9;
const ELEMENT_NODE = 1;

const OUTLINE_PROPERTIES = ["outline", "outline-width", "outline-style", "outline-color", "outline-offset"];

function isStyled(el: Element): el is Styled {
  return "style" in el && (el as Styled).style !== undefined;
}

/** Matches in the open shadow roots under `root`, in `queryAllPierce` order:
 *  each root's light tree first, then the roots of its hosts, depth-first. */
function shadowMatches(root: Document | ShadowRoot, selector: string): Element[] {
  const hosts: ShadowRoot[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.shadowRoot) hosts.push(el.shadowRoot);
  }
  const out: Element[] = [];
  for (const shadow of hosts) {
    out.push(...Array.from(shadow.querySelectorAll(selector)), ...shadowMatches(shadow, selector));
  }
  return out;
}

function selectCss(doc: Document, selector: string): ScreenshotSelection {
  let matches: Element[];
  try {
    matches = Array.from(doc.querySelectorAll(selector));
    if (matches.length === 0) matches = shadowMatches(doc, selector);
  } catch {
    return { ok: false, error: `Invalid CSS selector: ${selector}` };
  }
  const first = matches[0];
  if (!first) return { ok: false, error: `No element matches ${selector}.` };
  return { ok: true, element: first, count: matches.length };
}

function selectXPath(doc: Document, selector: string): ScreenshotSelection {
  const notElement = `XPath did not select an element: ${selector}`;
  let first: Node | null;
  let count: number;
  try {
    const probe = doc.evaluate(selector, doc, null, 0, null).resultType;
    if (probe === XPATH_NUMBER || probe === XPATH_STRING || probe === XPATH_BOOLEAN) {
      return { ok: false, error: notElement };
    }
    first = doc.evaluate(selector, doc, null, XPATH_FIRST_ORDERED_NODE, null).singleNodeValue;
    count = doc.evaluate(selector, doc, null, XPATH_ORDERED_NODE_SNAPSHOT, null).snapshotLength;
  } catch {
    return { ok: false, error: `Invalid XPath: ${selector}` };
  }
  if (first === null) return { ok: false, error: `No element matches ${selector}.` };
  if (first.nodeType !== ELEMENT_NODE) return { ok: false, error: notElement };
  return { ok: true, element: first as Element, count };
}

/** The first element for a CSS selector (top document, then open shadow roots)
 *  or an XPath (top document only), and how many elements matched. */
export function screenshotSelect(root: Element, kind: "css" | "xpath", selector: string): ScreenshotSelection {
  const doc = root.ownerDocument;
  return kind === "css" ? selectCss(doc, selector) : selectXPath(doc, selector);
}

function recordOutline(el: Styled): ScreenshotOutline {
  const declarations: ScreenshotStyleDeclaration[] = [];
  for (let i = 0; i < el.style.length; i++) {
    const name = el.style.item(i);
    if (OUTLINE_PROPERTIES.includes(name)) {
      declarations.push({
        name,
        value: el.style.getPropertyValue(name),
        priority: el.style.getPropertyPriority(name),
      });
    }
  }
  return { declarations };
}

/** Sets the red outline and returns what it replaced. */
export function screenshotHighlight(el: Element): ScreenshotOutline {
  if (!isStyled(el)) throw new Error("The element has no inline style, so it cannot be outlined.");
  const saved = recordOutline(el);
  try {
    el.style.outline = "3px solid red";
    el.style.outlineOffset = "2px";
  } catch (err) {
    screenshotRestore(el, saved);
    throw err;
  }
  return saved;
}

/** Puts back the declarations `screenshotHighlight` recorded, in their
 *  original order. Other inline styles are not touched. */
export function screenshotRestore(el: Element, saved: ScreenshotOutline): void {
  if (!isStyled(el)) return;
  for (const name of OUTLINE_PROPERTIES) el.style.removeProperty(name);
  for (const d of saved.declarations) el.style.setProperty(d.name, d.value, d.priority);
}

export function screenshotScroll(el: Element): void {
  el.scrollIntoView({ block: "center", behavior: "instant" });
}
