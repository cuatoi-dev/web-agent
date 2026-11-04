// 127/002 — the neutral locator set for one element: role and name with their
// match count, plus every unique id, data-testid, name attribute, CSS selector
// and XPath. A Selenium-based framework consumes it. Pure DOM: the helper world
// and the recorder world both bundle it.
import { getName, getRole } from "@cuatoi/web-agent-dom";
import { matchByRole, stableName } from "./playwright-match";
import type { ElementTarget, LocatorSet } from "./types";
import type { Scope } from "./locator-builder.types";

const HTML_NS = "http://www.w3.org/1999/xhtml";

/** A double-quoted CSS string: escapes `\` then `"`. */
function cssString(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** An XPath 1.0 string literal. XPath has no escape character, so a value
 *  that holds `'` is split with concat(). */
export function xpathLiteral(v: string): string {
  if (!v.includes("'")) return `'${v}'`;
  return `concat('${v.split("'").join(`', "'", '`)}')`;
}

/** True when `sel` matches exactly `el` inside `scope`. A selector the engine
 *  rejects matches nothing. */
function only(scope: Scope, el: Element, sel: string): boolean {
  let hits: NodeListOf<Element>;
  try {
    hits = scope.querySelectorAll(sel);
  } catch {
    return false;
  }
  return hits.length === 1 && hits[0] === el;
}

/** True when the XPath `xp` matches exactly `el` in `doc`. */
function onlyX(doc: Document, el: Element, xp: string): boolean {
  try {
    const r = doc.evaluate(xp, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return r.snapshotLength === 1 && r.snapshotItem(0) === el;
  } catch {
    return false;
  }
}

function idOf(el: Element): string {
  return el.getAttribute("id") ?? "";
}

/** True when `el`'s id is set and unique in `scope`. */
function uniqueId(scope: Scope, el: Element): boolean {
  const id = idOf(el);
  return id !== "" && only(scope, el, `#${CSS.escape(id)}`);
}

/** 1-based position of `node` among its siblings of the same type (same local
 *  name and namespace) — what `:nth-of-type()` and XPath `name[k]` count. */
function typeIndex(node: Element): number {
  let k = 1;
  for (let s = node.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.localName === node.localName && s.namespaceURI === node.namespaceURI) k++;
  }
  return k;
}

/** `button:nth-of-type(2)`. */
export function cssSegment(node: Element): string {
  return `${CSS.escape(node.localName)}:nth-of-type(${typeIndex(node)})`;
}

/** `button[2]`, or `*[local-name()='svg'][1]` for an element outside the HTML
 *  namespace: in an HTML document an XPath name test matches HTML elements
 *  only (Chromium probe, Playwright 1.58.2, 2026-10-18). */
export function xpathSegment(node: Element): string {
  const k = typeIndex(node);
  return node.namespaceURI === HTML_NS
    ? `${node.localName}[${k}]`
    : `*[local-name()=${xpathLiteral(node.localName)}][${k}]`;
}

/** The plan's css walk for `el`, run inside `scope` (the page or one shadow
 *  root). Undefined when the selector it builds is not unique. */
export function cssIn(scope: Scope, el: Element): string | undefined {
  if (uniqueId(scope, el)) return `#${CSS.escape(idOf(el))}`;
  const testId = el.getAttribute("data-testid");
  if (testId && only(scope, el, `[data-testid=${cssString(testId)}]`)) return `[data-testid=${cssString(testId)}]`;
  const segs: string[] = [];
  let node: Element | null = el;
  let sel = "";
  while (node) {
    segs.unshift(cssSegment(node));
    node = node.parentElement;
    const path = segs.join(" > ");
    // The top of a shadow root (or the <html> element itself) has no parent element.
    if (!node) {
      sel = path;
      break;
    }
    if (uniqueId(scope, node)) {
      sel = `#${CSS.escape(idOf(node))} > ${path}`;
      break;
    }
    if (node === node.ownerDocument.documentElement) {
      sel = `html > ${path}`;
      break;
    }
    if (only(scope, el, path)) {
      sel = path;
      break;
    }
  }
  return sel !== "" && only(scope, el, sel) ? sel : undefined;
}

/** The plan's xpath walk for a light-DOM `el`. Undefined when not unique. */
export function xpathIn(doc: Document, el: Element): string | undefined {
  if (uniqueId(doc, el)) {
    const xp = `//*[@id=${xpathLiteral(idOf(el))}]`;
    return onlyX(doc, el, xp) ? xp : undefined;
  }
  const segs: string[] = [];
  let node: Element | null = el;
  let xp = "";
  while (node) {
    segs.unshift(xpathSegment(node));
    node = node.parentElement;
    const path = segs.join("/");
    if (!node) {
      xp = `/${path}`;
      break;
    }
    if (uniqueId(doc, node)) {
      xp = `//*[@id=${xpathLiteral(idOf(node))}]/${path}`;
      break;
    }
    if (node === doc.documentElement) {
      xp = `/html/${path}`;
      break;
    }
  }
  return xp !== "" && onlyX(doc, el, xp) ? xp : undefined;
}

function isShadowRoot(n: Node): n is ShadowRoot {
  return n.nodeType === Node.DOCUMENT_FRAGMENT_NODE && "host" in n;
}

/** The shadow roots from the page down to `el`'s own root (empty for a
 *  light-DOM element), and whether any of them is closed. */
function shadowRoots(el: Element): { roots: ShadowRoot[]; closed: boolean } {
  const roots: ShadowRoot[] = [];
  let closed = false;
  let root: Node = el.getRootNode();
  while (isShadowRoot(root)) {
    if (root.mode !== "open") closed = true;
    roots.unshift(root);
    root = root.host.getRootNode();
  }
  return { roots, closed };
}

/** The plan's shadow chain: each host's CSS in the scope that holds it, then
 *  `el`'s CSS in its own root. Undefined when any level is not unique. */
function shadowChain(doc: Document, el: Element, roots: ShadowRoot[]): string[] | undefined {
  const scopes: Scope[] = [doc, ...roots];
  const targets: Element[] = [...roots.map((r) => r.host), el];
  const chain: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const sel = cssIn(scopes[i], targets[i]);
    if (sel === undefined) return undefined;
    chain.push(sel);
  }
  return chain;
}

/** The plan's locatorSet. `frames` is added by the panel, which knows the
 *  frame chain; this function runs inside one frame. */
export function locatorSet(el: Element, doc: Document, name: string = getName(el)): LocatorSet {
  const role = getRole(el);
  const out: LocatorSet = { role, name, roleMatches: matchByRole(doc, role, name).length };
  const { roots, closed } = shadowRoots(el);
  const scope: Scope = roots.length > 0 ? roots[roots.length - 1] : doc;

  if (uniqueId(scope, el)) out.id = idOf(el);
  const testId = el.getAttribute("data-testid");
  if (testId && only(scope, el, `[data-testid=${cssString(testId)}]`)) out.testId = testId;
  const nameAttr = el.getAttribute("name");
  if (nameAttr && only(scope, el, `${CSS.escape(el.localName)}[name=${cssString(nameAttr)}]`)) out.nameAttr = nameAttr;

  if (roots.length > 0) {
    // XPath cannot cross a shadow root; the chain replaces css. A closed root
    // cannot be opened by Selenium, so it gets no chain.
    if (!closed) {
      const chain = shadowChain(doc, el, roots);
      if (chain) out.shadow = chain;
    }
    return out;
  }
  const css = cssIn(doc, el);
  if (css !== undefined) out.css = css;
  const xpath = xpathIn(doc, el);
  if (xpath !== undefined) out.xpath = xpath;
  return out;
}

/** The locator set the recorder stores for a step: role+name uses the stable
 *  name. page_generate_locator calls locatorSet and keeps the full name. */
export function stepLocatorSet(el: Element, doc: Document): LocatorSet {
  return locatorSet(el, doc, stableName(el, doc, getRole(el), getName(el)));
}

/** What the page tools report about `el`: its role, name and `label`. */
export function journalTarget(el: Element, _doc: Document, label: string): ElementTarget {
  return {
    role: getRole(el),
    name: getName(el),
    label,
    isPassword: el instanceof HTMLInputElement && el.type === "password",
  };
}
