// 005 — clicks inside closed shadow roots. The recorder's isolated world cannot
// see inside a closed root, so it reserves the step's seq at click time and asks
// the panel to look the node up through CDP (debugger-recorder-closed.ts).
//
// Known limit: the lookup runs after the click event has finished. On a page
// that renames a control during the click event, the step shows the new name.
// The locator and the position come from the host, so replay is not affected.
import { journalTarget, locatorSet } from "./locator-builder";
import { composedParent, describe, innermost, INTERACTIVE, named } from "./page-recorder-helpers";
import type { PendingClosedClick, PendingClosedMessage, RecordedStep } from "./recorder.types";

/** Clicks waiting for the panel's lookup, by reserved local seq. */
const pending = new Map<number, PendingClosedClick>();
/** The last reserved click, so a `dblclick` can replace it at the same seq. */
let last: { host: Element; seq: number; step: RecordedStep | null } | null = null;

/** The host when this event MAY have been retargeted from a closed root. An
 *  isolated world reads `shadowRoot` as null for a closed root and for no root,
 *  so a custom element with no shadow root matches too. The lookup tells them
 *  apart: it returns the host itself for that element. */
export function closedHostOf(event: Event, el: Element | null): Element | null {
  const first = innermost(event);
  if (!first || !first.localName.includes("-") || first.shadowRoot !== null) return null;
  return el === null || el === first ? first : null;
}

/** Stores the click and returns the message for the panel. The offset origin
 *  is the padding box, because that is what Playwright's `position` uses. */
export function reserveClosedClick(
  event: MouseEvent,
  host: Element,
  interactive: boolean,
  seq: number,
  recordingId: string,
): PendingClosedMessage {
  const rect = host.getBoundingClientRect();
  pending.set(seq, {
    host,
    interactive,
    kind: "click",
    offsetX: Math.round(event.clientX - rect.left - host.clientLeft),
    offsetY: Math.round(event.clientY - rect.top - host.clientTop),
  });
  last = { host, seq, step: null };
  return { recordingId, seq, pendingClosed: { x: event.clientX, y: event.clientY } };
}

/** True when `el` is inside the closed root of `host`, at any open-root depth. */
function insideRootOf(el: Element, host: Element): boolean {
  let at: Element = el;
  for (;;) {
    const root = at.getRootNode();
    if (!(root instanceof ShadowRoot)) return false;
    if (root.host === host) return true;
    at = root.host;
  }
}

/** The element to name: the nearest INTERACTIVE ancestor up to the host, else
 *  the node itself. Null when the node is not inside the host's root. */
function innerTarget(inner: Node, host: Element): Element | null {
  const start = inner instanceof Element ? inner : inner.parentElement;
  if (!start || !insideRootOf(start, host)) return null;
  for (let at: Element | null = start; at; at = composedParent(at)) {
    if (at.matches(INTERACTIVE)) return at;
    if (at === host) break;
  }
  return start;
}

/** The late step, or null when it records nothing. `inner` is null when the
 *  lookup failed. Nothing is reserved for a seq after `clearClosedClicks`, so a
 *  lookup that ends after stop records nothing. */
export function resolveClosedClick(inner: Node | null, seq: number, recordingId: string): RecordedStep | null {
  const p = pending.get(seq);
  pending.delete(seq);
  if (!p) return null;
  const { host } = p;
  const build = (el: Element, extra: Partial<RecordedStep>): RecordedStep => {
    // Never through nextStep: that burns a seq and breaks the `seq - 1` checks.
    const step: RecordedStep = {
      recordingId,
      seq,
      kind: p.kind,
      line: `${p.kind} ${named(el)}`,
      target: journalTarget(host, document, describe(host)),
      locators: locatorSet(host, document),
      ...extra,
    };
    if (last?.seq === seq) last.step = step;
    return step;
  };
  // The host itself: not a click inside a closed root, so an ordinary click.
  if (inner === host) return p.interactive ? build(host, {}) : null;
  // A failed lookup, or a node outside this host's root, names the host.
  const el = (inner && innerTarget(inner, host)) ?? host;
  return build(el, {
    closedShadow: { inner: journalTarget(el, document, describe(el)), offsetX: p.offsetX, offsetY: p.offsetY },
  });
}

/** Task 004's rule for a reserved click: one `dblclick` at the same seq. Returns
 *  null when the event is not for the last reserved click, "handled" when there
 *  is nothing to emit now, or the replacement step. */
export function closedDblClick(event: Event, seq: number): RecordedStep | "handled" | null {
  if (!last || last.host !== innermost(event) || last.seq !== seq - 1) return null;
  const { seq: reserved, step } = last;
  last = null;
  const p = pending.get(reserved);
  if (p) {
    p.kind = "dblclick";
    return "handled";
  }
  if (!step) return "handled";
  return { ...step, kind: "dblclick", line: step.line.replace(/^click /, "dblclick ") };
}

export function forgetClosedDblClick(): void {
  last = null;
}

export function clearClosedClicks(): void {
  pending.clear();
  last = null;
}
