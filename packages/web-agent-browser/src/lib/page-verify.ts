// page_verify's four checks, run in the MAIN world against the
// panel's own DomAdapter. A FAIL is a normal result (isError false); isError
// is only for a bad ref. Input validation runs in the panel before this.
import { getName, getRole, isElementVisible } from "@cuatoi/web-agent-dom";
import { nameMatches, queryAllPierce } from "./playwright-match";
import { journalTarget } from "./locator-builder";
import type { VerifyAdapter, VerifyInput, VerifyOutcome, VerifyResolved } from "./types";

const pass = (text: string): VerifyOutcome => ({ text: `PASS ${text}`, isError: false });
const fail = (text: string): VerifyOutcome => ({ text: `FAIL ${text}`, isError: false });

/** `<role> "<name>"`, or just `<role>` when no name was given. */
function roleTarget(role: string, name: string | undefined): string {
  return name ? `${role} "${name}"` : role;
}

/** Page elements outside the agent UI, in Playwright's order. */
function pageElements(adapter: VerifyAdapter, doc: Document): Element[] {
  const agentUis = Array.from(doc.querySelectorAll(adapter.agentUiSelector));
  return queryAllPierce(doc, (el) => agentUis.some((a) => el === a || a.contains(el)));
}

function byRole(adapter: VerifyAdapter, doc: Document, role: string, name: string | undefined): Element[] {
  return pageElements(adapter, doc).filter((el) => getRole(el) === role && (!name || nameMatches(getName(el), name)));
}

/** `<role> "<name>"`, or just `<role>` when no name was given — the same text
 *  DomAdapter.describeElement produces (dom-adapter.ts:183-186). */
function describeElement(el: Element): string {
  const role = getRole(el);
  const name = getName(el);
  return name ? `${role} "${name}"` : role;
}

/** The ref's element is resolved by the panel through CDP and handed
 *  in, so there is no ref table here any more. A call that reaches runVerify
 *  always has a live element. */
function resolve(adapter: VerifyAdapter): VerifyResolved {
  return { ok: true, el: adapter.el, desc: describeElement(adapter.el) };
}

function skipForText(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  const head = el.ownerDocument.head;
  return tag === "SCRIPT" || tag === "NOSCRIPT" || tag === "STYLE" || (!!head && head.contains(el));
}

function visibleText(node: Element | ShadowRoot, adapter: VerifyAdapter): string {
  if (node instanceof Element) {
    if (skipForText(node)) return "";
    const agentUis = Array.from(node.ownerDocument.querySelectorAll(adapter.agentUiSelector));
    if (agentUis.some((a) => node === a || a.contains(node))) return "";
    if (!isElementVisible(node)) return "";
    if (node instanceof HTMLInputElement && (node.type === "submit" || node.type === "button")) return node.value;
  }
  let full = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) full += child.nodeValue ?? "";
    else if (child.nodeType === Node.ELEMENT_NODE) full += visibleText(child as Element, adapter);
  }
  if (node instanceof Element && node.shadowRoot) full += visibleText(node.shadowRoot, adapter);
  return full;
}

export function runVerify(input: VerifyInput, adapter: VerifyAdapter, doc: Document): VerifyOutcome {
  if (input.kind === "element_visible") {
    let targets: Element[];
    let target: string;
    if (input.ref) {
      const r = resolve(adapter);
      if (!r.ok) return r.outcome;
      targets = [r.el];
      target = r.desc;
    } else {
      targets = byRole(adapter, doc, input.role ?? "", input.name);
      target = roleTarget(input.role ?? "", input.name);
    }
    const visible = targets.find(isElementVisible);
    if (visible) {
      const label = input.ref ? `[${input.ref}] ${target}` : target;
      return { ...pass(`${target} is visible.`), target: journalTarget(visible, doc, label) };
    }
    if (targets.length === 0) {
      return fail(`expected ${target} to be visible; found no matching element.`);
    }
    return fail(`expected ${target} to be visible; found ${targets.length} matching, none visible.`);
  }

  if (input.kind === "text_visible") {
    const text = input.text ?? "";
    const candidates = pageElements(adapter, doc).filter((el) => nameMatches(visibleText(el, adapter), text) && isElementVisible(el));
    const smallest = candidates.filter((el) => !candidates.some((o) => o !== el && el.contains(o)));
    if (smallest.length > 0) {
      return pass(`text "${text}" is visible.`);
    }
    return fail(`expected text "${text}" to be visible; found no matching text.`);
  }

  if (input.kind === "value") {
    const r = resolve(adapter);
    if (!r.ok) return r.outcome;
    const actual =
      r.el instanceof HTMLInputElement || r.el instanceof HTMLTextAreaElement || r.el instanceof HTMLSelectElement
        ? r.el.value
        : (r.el.textContent ?? "");
    if (actual === input.value) {
      return { ...pass(`[${input.ref}] ${r.desc} has value "${input.value}".`), target: journalTarget(r.el, doc, `[${input.ref}] ${r.desc}`) };
    }
    return fail(`expected [${input.ref}] ${r.desc} to have value "${input.value}"; found "${actual}".`);
  }

  if (input.kind === "list") {
    const items = input.items ?? [];
    let lists: Element[];
    let target: string;
    if (input.ref) {
      const r = resolve(adapter);
      if (!r.ok) return r.outcome;
      lists = [r.el];
      target = `[${input.ref}] ${r.desc}`;
    } else {
      lists = byRole(adapter, doc, input.role ?? "", input.name).filter(isElementVisible);
      target = roleTarget(input.role ?? "", input.name);
    }
    if (lists.length === 0) {
      return fail(`expected ${target} to be visible; found no matching element.`);
    }
    const missingFor = (list: Element) =>
      items.filter((item) => !Array.from(list.querySelectorAll("*")).some((d) => isElementVisible(d) && nameMatches(visibleText(d, adapter), item)));

    for (const list of lists) {
      if (missingFor(list).length === 0) {
        return { ...pass(`${target} shows all ${items.length} items.`), target: journalTarget(list, doc, target) };
      }
    }
    const missing = missingFor(lists[0]);
    return fail(`expected ${target} to show ${missing.map((m) => `"${m}"`).join(", ")}; not found.`);
  }

  return fail("unsupported verify kind");
}
