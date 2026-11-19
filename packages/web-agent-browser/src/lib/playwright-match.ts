// The name-matching helper both panel tools share, and Playwright
// 1.58.2's own counting rules for getBy* locators, reimplemented for the MAIN
// world. Verified against playwright-core 1.58.2's injected script.
import { getName, getRole } from "@cuatoi/web-agent-dom";
import type { MaybeCheckVisibility } from "./types";

/** normalize(): collapse whitespace, trim, lower-case. */
export function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** nameMatches(): non-exact, like Playwright's default. */
export function nameMatches(actual: string, expected: string): boolean {
  return normalize(actual).includes(normalize(expected));
}

/** Playwright's normalizeWhiteSpace (keeps case). */
export function pwNormalizeWhiteSpace(s: string): string {
  return s.replace(/[\u200B\u00AD]/g, "").trim().replace(/\s+/g, " ");
}

/** Every element under `root`, in Playwright's result order: light DOM first,
 *  then each open shadow root depth-first in host order. `skip` prunes an
 *  element and everything under it (used to leave out the agent UI). */
export function queryAllPierce(root: Document | ShadowRoot, skip?: (el: Element) => boolean): Element[] {
  const out: Element[] = [];
  const shadows: ShadowRoot[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (skip?.(el)) continue;
    out.push(el);
    if (el.shadowRoot) shadows.push(el.shadowRoot);
  }
  for (const s of shadows) out.push(...queryAllPierce(s, skip));
  return out;
}

function skipForText(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  const head = el.ownerDocument.head;
  return tag === "SCRIPT" || tag === "NOSCRIPT" || tag === "STYLE" || (!!head && head.contains(el));
}

/** Playwright's elementText(...).full. */
export function pwElementText(node: Element | ShadowRoot): string {
  if (node instanceof Element && skipForText(node)) return "";
  if (node instanceof HTMLInputElement && (node.type === "submit" || node.type === "button")) return node.value;
  let full = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) full += child.nodeValue ?? "";
    else if (child.nodeType === Node.ELEMENT_NODE) full += pwElementText(child as Element);
  }
  if (node instanceof Element && node.shadowRoot) full += pwElementText(node.shadowRoot);
  return full;
}

/** Playwright's lax (non-exact) text matcher. */
function laxMatches(text: string, needle: string): boolean {
  return pwNormalizeWhiteSpace(text).toLowerCase().includes(pwNormalizeWhiteSpace(needle).toLowerCase());
}

function isVisibleTextNode(node: Node): boolean {
  const range = node.ownerDocument?.createRange();
  // jsdom 24 has no Range.getBoundingClientRect (probe, 2026-09-17).
  if (!range || typeof range.getBoundingClientRect !== "function") return false;
  range.selectNode(node);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function styleVisibilityVisible(el: Element, style: CSSStyleDeclaration | undefined): boolean {
  if (!style) return true;
  const cap = el as MaybeCheckVisibility;
  if (typeof cap.checkVisibility === "function") {
    if (!cap.checkVisibility()) return false;
  } else {
    const d = el.closest("details,summary");
    if (d !== el && d?.nodeName === "DETAILS" && !(d as HTMLDetailsElement).open) return false;
  }
  return style.visibility === "visible";
}

function parentOrShadowHost(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const p = el.parentNode;
  return p instanceof ShadowRoot ? p.host : null;
}

function belongsToDisplayNoneOrAriaHidden(el: Element): boolean {
  if (el.parentElement?.shadowRoot && !el.assignedSlot) return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style || style.display === "none" || el.getAttribute("aria-hidden")?.toLowerCase() === "true") return true;
  const parent = parentOrShadowHost(el);
  return parent ? belongsToDisplayNoneOrAriaHidden(parent) : false;
}

/** Playwright's isElementHiddenForAria. */
export function isHiddenForAria(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  if (tag === "STYLE" || tag === "SCRIPT" || tag === "NOSCRIPT" || tag === "TEMPLATE") return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  const isSlot = tag === "SLOT";
  if (style?.display === "contents" && !isSlot) {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.ELEMENT_NODE && !isHiddenForAria(c as Element)) return false;
      if (c.nodeType === Node.TEXT_NODE && isVisibleTextNode(c)) return false;
    }
    return true;
  }
  const isOptionInsideSelect = tag === "OPTION" && !!el.closest("select");
  if (!isOptionInsideSelect && !isSlot && !styleVisibilityVisible(el, style)) return true;
  return belongsToDisplayNoneOrAriaHidden(el);
}

/** Playwright's getElementLabels, as label texts. */
export function pwLabels(el: Element): string[] {
  const ids = (el.getAttribute("aria-labelledby") ?? "").split(" ").filter((id) => !!id);
  if (el.hasAttribute("aria-labelledby")) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const refs: Element[] = [];
    for (const id of ids) {
      // Same escaping as element-semantics.ts:227. Not CSS.escape: jsdom 24
      // does not implement it (probe, 2026-09-17).
      const found = root.querySelector(`[id="${id.replace(/["\\]/g, "\\$&")}"]`);
      if (found && !refs.includes(found)) refs.push(found);
    }
    if (refs.length > 0) return refs.map((r) => pwElementText(r));
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim()) return [ariaLabel];
  const tag = el.tagName.toUpperCase();
  const labelable =
    ["BUTTON", "METER", "OUTPUT", "PROGRESS", "SELECT", "TEXTAREA"].includes(tag) ||
    (el instanceof HTMLInputElement && el.type !== "hidden");
  if (labelable) {
    const labels = (el as HTMLInputElement).labels;
    if (labels) return Array.from(labels).map((l) => pwElementText(l));
  }
  return [];
}

/** getByRole(role, { name }) matches. */
export function matchByRole(doc: Document, role: string, name: string): Element[] {
  return queryAllPierce(doc).filter((e) => getRole(e) === role && !isHiddenForAria(e) && nameMatches(getName(e), name));
}

/** True when `ancestor` is `node` itself or a composed ancestor of it. */
function composedContains(ancestor: Element, node: Element): boolean {
  for (let cur: Element | null = node; cur; cur = parentOrShadowHost(cur)) {
    if (cur === ancestor) return true;
  }
  return false;
}

/** The name to record for `el`: the leading run of tokens that hold a letter,
 *  when that shorter name still finds exactly `el`. Otherwise the full name.
 *  A count or a sort arrow changes while the page is used, and getByRole
 *  matches a substring, so the shorter name survives the change. An element
 *  with no role is found by its text instead, so its shorter name must match
 *  one element that `el` is or contains. */
export function stableName(el: Element, doc: Document, role: string, name: string): string {
  if (name === "") return name;
  const prefix: string[] = [];
  for (const token of name.split(/\s+/)) {
    if (!/\p{L}/u.test(token)) break;
    prefix.push(token);
  }
  const short = prefix.join(" ");
  if (short === "" || short === name) return name;
  if (role === "") {
    const textHits = matchByText(doc, short);
    return textHits.length === 1 && composedContains(el, textHits[0]) ? short : name;
  }
  const hits = matchByRole(doc, role, short);
  return hits.length === 1 && hits[0] === el ? short : name;
}

/** getByText(text) matches: "self" matches only. */
export function matchByText(doc: Document, text: string): Element[] {
  return queryAllPierce(doc).filter((e) => {
    if (skipForText(e) || !laxMatches(pwElementText(e), text)) return false;
    for (let c = e.firstElementChild; c; c = c.nextElementSibling) {
      if (laxMatches(pwElementText(c), text)) return false;
    }
    if (e.shadowRoot && laxMatches(pwElementText(e.shadowRoot), text)) return false;
    return true;
  });
}

/** getByLabel(text) matches. */
export function matchByLabel(doc: Document, text: string): Element[] {
  return queryAllPierce(doc).filter((e) => pwLabels(e).some((l) => laxMatches(l, text)));
}

/** getByPlaceholder / getByAltText / getByTitle matches (whitespace not collapsed). */
export function matchByAttribute(doc: Document, attr: "placeholder" | "alt" | "title", value: string): Element[] {
  const needle = value.toLowerCase();
  return queryAllPierce(doc).filter((e) => {
    const v = e.getAttribute(attr);
    return v !== null && v.toLowerCase().includes(needle);
  });
}

/** getByTestId(id) matches (exact). */
export function matchByTestId(doc: Document, id: string): Element[] {
  return queryAllPierce(doc).filter((e) => e.getAttribute("data-testid") === id);
}
