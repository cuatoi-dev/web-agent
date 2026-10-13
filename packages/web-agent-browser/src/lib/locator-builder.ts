// 122/002 — builds a Playwright locator for one element, in the idea's tool
// table order, counting matches the way Playwright 1.58.2 does. Pure DOM, in
// the content bundle, so task 004's journal can reuse it.
import { getName, getRole } from "@cuatoi/web-agent-dom";
import {
  matchByAttribute,
  matchByLabel,
  matchByRole,
  matchByTestId,
  matchByText,
  pwElementText,
  pwLabels,
  pwNormalizeWhiteSpace,
} from "./playwright-match";
import type { JournalTarget, LocatorBuildResult, LocatorCandidate } from "./types";

/** A single-quoted JavaScript string literal body: escapes `\` then `'`. */
export function escapeLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** The label text used for a getByLabel candidate. The plan names three
 *  sources (line 100): aria-labelledby, <label for>, wrapping <label>. Read in
 *  Playwright's precedence, so the candidate can match `el`; an element whose
 *  Playwright labels come from aria-label gets no label candidate. */
function labelCandidateText(el: Element): string {
  if (el.hasAttribute("aria-labelledby") || !el.getAttribute("aria-label")?.trim()) {
    const first = pwLabels(el)[0];
    return first === undefined ? "" : pwNormalizeWhiteSpace(first);
  }
  return "";
}

/** Candidates in the decided order, skipping any whose input is empty. */
export function locatorCandidates(el: Element, doc: Document): LocatorCandidate[] {
  const out: LocatorCandidate[] = [];
  const role = getRole(el);
  const name = getName(el);
  if (role && name) {
    out.push({ source: `getByRole('${escapeLiteral(role)}', { name: '${escapeLiteral(name)}' })`, matches: matchByRole(doc, role, name) });
  }
  const label = labelCandidateText(el);
  if (label) out.push({ source: `getByLabel('${escapeLiteral(label)}')`, matches: matchByLabel(doc, label) });
  const text = pwNormalizeWhiteSpace(pwElementText(el));
  if (text) out.push({ source: `getByText('${escapeLiteral(text)}')`, matches: matchByText(doc, text) });
  for (const [attr, method] of [["placeholder", "getByPlaceholder"], ["alt", "getByAltText"], ["title", "getByTitle"]] as const) {
    const v = el.getAttribute(attr);
    if (v !== null && v.trim()) out.push({ source: `${method}('${escapeLiteral(v)}')`, matches: matchByAttribute(doc, attr, v) });
  }
  const testId = el.getAttribute("data-testid");
  if (testId) out.push({ source: `getByTestId('${escapeLiteral(testId)}')`, matches: matchByTestId(doc, testId) });
  return out;
}

/** 124/004 — the journal's locator for `el`: the same choice as
 *  page_generate_locator, without `page.` and the match note. Undefined when
 *  no candidate matches `el`. */
export function journalLocator(el: Element, doc: Document): string | undefined {
  const candidates = locatorCandidates(el, doc);
  const unique = candidates.find((c) => c.matches.length === 1 && c.matches[0] === el);
  if (unique) return unique.source;
  const first = candidates.find((c) => c.matches.includes(el));
  return first ? `${first.source}.nth(${first.matches.indexOf(el)})` : undefined;
}

/** 124/004 — what the panel's journal needs about `el`. `label` is the text
 *  after "no stable locator for " when `locator` is absent. */
export function journalTarget(el: Element, doc: Document, label: string): JournalTarget {
  const locator = journalLocator(el, doc);
  return {
    role: getRole(el),
    name: getName(el),
    label,
    ...(locator !== undefined ? { locator } : {}),
    isPassword: el instanceof HTMLInputElement && el.type === "password",
  };
}

/** The plan's page_generate_locator loop. */
export function buildLocator(el: Element, doc: Document): LocatorBuildResult {
  const source = journalLocator(el, doc);
  if (source === undefined) return { ok: false };
  return /\.nth\(\d+\)$/.test(source)
    ? { ok: true, line: `page.${source} — matches 1 element (by position)` }
    : { ok: true, line: `page.${source} — matches 1 element` };
}
