// snapshot-match.ts — the `include_text` filter's matching rule. Kept
// apart from `snapshot-format.ts` (line formatting) and `snapshot-walk.ts`
// (traversal) so the rule has one home and one import path.

import { tagLC } from "./element-semantics.js";

/** Name attributes the filter reads in addition to inner text. Required, not a
 *  nicety: a control can carry its whole label in an attribute. Measured on
 *  `en.wikipedia.org/wiki/World_War_II` on 2026-09-12 — the page has 83
 *  text-less controls, 19 of which can be matched only through one of these,
 *  including `a[title="Edit this at Wikidata"]`. */
const SEARCH_ATTRS = ["title", "aria-label", "alt", "placeholder"];

/** Everything the filter reads for one node: full inner text — which includes
 *  descendants' text — plus this element's OWN name attributes, plus its
 *  `value` when it is a form control. A text node contributes its own text.
 *
 *  Note what this deliberately does NOT do: it does not read a descendant's
 *  attributes. That is why the term gates SELECTION and never traversal in
 *  `snapshot-walk.ts` — an ancestor of an attribute-only match does not match,
 *  so pruning the branch above it would make it unreachable. */
export function searchText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const parts: string[] = [el.textContent ?? ""];
  for (const attr of SEARCH_ATTRS) {
    const value = el.getAttribute(attr);
    if (value !== null) parts.push(value);
  }
  const tag = tagLC(el);
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const value = (el as HTMLInputElement).value;
    if (value) parts.push(value);
  }
  return parts.join(" ");
}

/** A case-insensitive substring test over `searchText`. An absent, empty or
 *  whitespace-only term yields a predicate that is true for every node, so an
 *  unfiltered walk behaves exactly as it did before this filter existed. */
export function makeTermMatcher(
  includeText: string | undefined,
): (node: Node) => boolean {
  const term = (includeText ?? "").trim().toLowerCase();
  if (term === "") return () => true;
  return (node: Node) => searchText(node).toLowerCase().includes(term);
}
