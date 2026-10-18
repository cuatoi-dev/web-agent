// 131/002 — the ref tools' page-side half. The side panel installs the bundle
// built from this module into an isolated world (Page.createIsolatedWorld), so
// the page's own scripts can neither see nor change it. Every function takes
// the element itself: the isolated world has no RefTable and no DomAdapter.
import {
  describeElementParts,
  disabledRef,
  blockedByPolicy,
  resolveAgentPermission,
} from "@cuatoi/web-agent-dom";
import { buildLocator, journalTarget } from "./locator-builder";
import { runVerify } from "./page-verify";
import type { ElementTarget, FileSpec, VerifyInput, VerifyOutcome, LocatorBuildResult } from "./types";
import type { HelperDescribe } from "./helper-api.types";

export type { HelperDescribe } from "./helper-api.types";

/** `<role> "<name>"` — the same text `DomAdapter.describeElement` produces
 *  (packages/web-agent-dom/src/adapters/dom-adapter.ts:183-186). */
function describeElement(el: Element): string {
  const { role, name } = describeElementParts(el);
  return name ? `${role} "${name}"` : role;
}

export function describe(el: Element, ref: string): HelperDescribe {
  if (!el.isConnected) {
    return { connected: false, name: "", desc: "", permission: "allow", disabled: false };
  }
  const { name } = describeElementParts(el);
  const desc = describeElement(el);
  const { permission, reason } = resolveAgentPermission(el);
  const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
  const out: HelperDescribe = { connected: true, name, desc, permission, disabled };
  if (reason !== undefined) out.reason = reason;
  if (disabled) out.refusal = disabledRef(ref, name);
  else if (permission === "block") out.refusal = blockedByPolicy(ref, name, reason);
  return out;
}

/** The target for `el`, once an action has been performed on it. Same
 *  label shape `content-act-by-ref.ts:195` and `:281` built today. */
export function target(el: Element, ref: string, desc: string): ElementTarget {
  return journalTarget(el, document, `[${ref}] ${desc}`);
}

export function locator(el: Element, ref: string, desc: string): { text: string; isError: boolean } {
  const built: LocatorBuildResult = buildLocator(el, document);
  return built.ok
    ? { text: built.line, isError: false }
    : { text: `Could not make a unique locator for [${ref}] ${desc}.`, isError: true };
}

/** 131/003 — a selector for ONE `<iframe>`/`<frame>` element, for
 *  `page.frameLocator(<selector>)`. The first attribute that matches exactly
 *  one frame element in this document wins; `nth=` is the last resort. */
export function iframeSelector(el: Element): { selector: string } {
  const tag = el.tagName.toLowerCase();
  if (tag !== "iframe" && tag !== "frame") return { selector: "" };
  const all = [...document.querySelectorAll(`${tag}`)];
  const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const unique = (sel: string) => {
    const hits = [...document.querySelectorAll(sel)];
    return hits.length === 1 && hits[0] === el;
  };
  const id = el.getAttribute("id");
  if (id !== null && id !== "" && unique(`${tag}#${CSS.escape(id)}`)) {
    return { selector: `${tag}#${CSS.escape(id)}` };
  }
  for (const attr of ["name", "title", "src"]) {
    const v = el.getAttribute(attr);
    if (v === null || v === "") continue;
    const sel = `${tag}[${attr}=${quote(v)}]`;
    if (unique(sel)) return { selector: sel };
  }
  return { selector: `${tag} >> nth=${all.indexOf(el)}` };
}

export function verify(el: Element, input: VerifyInput, agentUiSelector: string): VerifyOutcome {
  return runVerify(input, { agentUiSelector, el }, document);
}

export function fillPrepare(el: Element, ref: string): { ok: true; hadText: boolean } | { ok: false; message: string } {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.select();
    return { ok: true, hadText: el.value.length > 0 };
  }
  if (el instanceof HTMLElement && (el.isContentEditable || el.getAttribute("contenteditable") === "true")) {
    el.focus();
    window.getSelection()?.selectAllChildren(el);
    return { ok: true, hadText: (el.textContent ?? "").length > 0 };
  }
  // Same text DomAdapter's fill throws today (web-agent-dom interactions.ts:164).
  return { ok: false, message: `Ref ${ref} is not a text input, textarea, or contenteditable.` };
}

export function readValue(el: Element): { value?: string } {
  if ("value" in el) return { value: (el as HTMLInputElement).value };
  const text = el.textContent;
  return text === null ? {} : { value: text };
}

export function setFiles(
  el: Element,
  ref: string,
  specs: FileSpec[],
): { ok: true; desc: string; sizes: number[]; target: ElementTarget } | { ok: false; message: string } {
  const desc = describeElement(el);
  if (!(el instanceof HTMLInputElement) || el.type !== "file") {
    return { ok: false, message: `Element [${ref}] ${desc} is not a file input.` };
  }
  if (specs.length > 1 && !el.multiple) {
    return { ok: false, message: `Element [${ref}] ${desc} accepts one file.` };
  }
  try {
    const t = target(el, ref, desc);
    const dt = new DataTransfer();
    const sizes: number[] = [];
    for (const spec of specs) {
      const content =
        typeof spec.text === "string"
          ? new Blob([spec.text])
          : typeof spec.base64 === "string"
            ? Uint8Array.from(atob(spec.base64), (c) => c.charCodeAt(0))
            : new Uint8Array(spec.size ?? 0).fill((spec.fill ?? "").charCodeAt(0));
      const file = new File([content], spec.name, { type: spec.mimeType });
      dt.items.add(file);
      sizes.push(file.size);
    }
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, desc, sizes, target: t };
  } catch (e) {
    // For example atob() on base64 that is not valid.
    const message = e instanceof Error ? e.message || String(e) : String(e);
    return { ok: false, message };
  }
}

export { selectPrepare, selectExecute } from "./helper-api-actions";
