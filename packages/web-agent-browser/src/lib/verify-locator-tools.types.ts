// The shapes for the panel's page_verify tool (122/002). Imports only the
// element target type, mirroring act-by-ref-tools.types.ts; spliced into
// types.ts's BridgeMessage union and re-exported from there.

import type { ElementTarget } from "./element-target.types";

/** A ref resolved for page_verify, or the tool result to return instead. */
export type VerifyResolved = { ok: true; el: Element; desc: string } | { ok: false; outcome: VerifyOutcome };

/** The four checks page_verify runs. */
export type VerifyKind = "element_visible" | "text_visible" | "value" | "list";

/** page_verify's input, minus `tabId`, as it travels to the MAIN world. */
export interface VerifyInput {
  kind: VerifyKind;
  role?: string;
  name?: string;
  text?: string;
  ref?: string;
  value?: string;
  items?: string[];
}

/** One tool result computed in the MAIN world. `isError` false for PASS and FAIL. */
export interface VerifyOutcome {
  text: string;
  isError: boolean;
  /** 124/004 — a PASS check's element. Absent for text_visible and FAIL. */
  target?: ElementTarget;
}

/** An element that may or may not implement `checkVisibility` (jsdom does not). */
export type MaybeCheckVisibility = Element & { checkVisibility?: () => boolean };

/** The panel `DomAdapter` members page_verify and the locator handler use. */
export interface VerifyAdapter {
  agentUiSelector: string;
  /** The element the panel resolved for `input.ref`, or `document.documentElement`
   *  for a by-role or text_visible check. */
  el: Element;
}
