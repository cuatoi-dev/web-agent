// The select-option half of helper-api.ts, split out to stay under
// this file's 500-line cap (eslint.config.mjs max-lines). `selectOptionMissing`,
// `invisibleTargetNote`, `focusLikeHuman`, `dispatchChangeLikeHuman` and
// `blurLikeHuman` are not exported from @cuatoi/web-agent-dom, so their
// bodies are copied here verbatim from interactions.ts / error-messages.ts /
// human-input-events.ts rather than adding new exports to that package.
import { describeElementParts, isElementVisible } from "@cuatoi/web-agent-dom";
import { journalTarget } from "./locator-builder";
import type { SelectPrepareResult } from "./helper-api.types";

export type { SelectPrepareResult } from "./helper-api.types";

function describeElement(el: Element): string {
  const { role, name } = describeElementParts(el);
  return name ? `${role} "${name}"` : role;
}

/** Copied from web-agent-dom's tools/error-messages.ts. */
function selectOptionMissing(opt: string, options: string[]): string {
  const listed = options.slice(0, 20);
  return `No option "${opt}". Available: ${listed.join(", ")}${options.length > 20 ? ` …+${options.length - 20} more` : ""}.`;
}

/** Copied from web-agent-dom's tools/error-messages.ts. */
function invisibleTargetNote(ref: string, name?: string): string {
  const label = name ? ` ("${name}")` : "";
  return `Note: ref ${ref}${label} is not visible on screen.`;
}

/** Copied from web-agent-dom's utils/human-input-events.ts. */
function holdsFocus(el: Element): boolean {
  const root = el.getRootNode() as unknown as DocumentOrShadowRoot;
  return root?.activeElement === el;
}

/** Copied from web-agent-dom's utils/human-input-events.ts. */
function focusLikeHuman(el: HTMLElement, opts?: { pointer?: boolean }): void {
  const init = { bubbles: true, cancelable: true, composed: true };
  if (opts?.pointer !== false) {
    const PointerClass = typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
    el.dispatchEvent(new PointerClass("pointerdown", init));
    el.dispatchEvent(new MouseEvent("mousedown", init));
  }
  el.focus?.();
  if (!holdsFocus(el)) {
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false, composed: true }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
  }
}

/** Copied from web-agent-dom's utils/human-input-events.ts. */
function dispatchChangeLikeHuman(el: Element): void {
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

/** Copied from web-agent-dom's utils/human-input-events.ts. */
function blurLikeHuman(el: HTMLElement): void {
  if (!holdsFocus(el)) return;
  el.blur?.();
  if (holdsFocus(el)) {
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false, composed: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  }
}

function findOption(options: HTMLOptionElement[], val: string): HTMLOptionElement | undefined {
  let matched = options.find((opt) => (opt.label || opt.text || "").trim() === val.trim());
  if (!matched) matched = options.find((opt) => opt.value === val);
  if (!matched) {
    const lower = val.trim().toLowerCase();
    matched = options.find((opt) => (opt.label || opt.text || "").trim().toLowerCase() === lower);
  }
  return matched;
}

/** The type-specific checks for one action. Permission
 *  is handled generically by the shared `describe` step; this
 *  keeps only the type-specific checks. */
export function selectPrepare(el: Element, ref: string, values: string[]): SelectPrepareResult {
  if (!(el instanceof HTMLSelectElement)) {
    return { ok: false, message: `Ref ${ref} is not a native <select>. Custom dropdowns: click to open then click the option.` };
  }
  if (!el.multiple && values.length !== 1) {
    return { ok: false, message: `Ref ${ref} is a single-choice select; pass exactly one value.` };
  }
  const { name } = describeElementParts(el);
  return { ok: true, name, target: journalTarget(el, document, `[${ref}] ${describeElement(el)}`) };
}

/** A port of `interactions.ts` `performSelectOption` (:197-242) and
 *  `performSelectOptions` (:244-317) with `InteractionContext` removed: no
 *  `actionCue`, no `AbortSignal` (the panel adapter passes neither today), and
 *  no permission/disabled checks (already run by the shared `describe` step). */
export function selectExecute(el: Element, ref: string, values: string[]): { text: string } {
  const selectEl = el as HTMLSelectElement;
  const { name } = describeElementParts(selectEl);
  const options = Array.from(selectEl.options);
  const isCSSVisible = isElementVisible(selectEl);
  const rect = selectEl.getBoundingClientRect?.();
  const hasZeroBox = !rect || rect.width <= 0 || rect.height <= 0;
  const note = !isCSSVisible || hasZeroBox ? ` ${invisibleTargetNote(ref, name)}` : "";
  const description = describeElement(selectEl);

  if (!selectEl.multiple) {
    const matched = findOption(options, values[0]);
    if (!matched) {
      const optionNames = options.map((opt) => (opt.label || opt.text || opt.value || "").trim()).filter(Boolean);
      throw new Error(selectOptionMissing(values[0], optionNames));
    }
    focusLikeHuman(selectEl, { pointer: false });
    selectEl.value = matched.value;
    selectEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    dispatchChangeLikeHuman(selectEl);
    blurLikeHuman(selectEl);
    const label = (matched.label || matched.text || "").trim();
    return { text: `Selected "${label}" in [${ref}] ${description}.${note}`.trim() };
  }

  const matchedOptions: HTMLOptionElement[] = [];
  for (const val of values) {
    const matched = findOption(options, val);
    if (!matched) {
      const optionNames = options.map((opt) => (opt.label || opt.text || opt.value || "").trim()).filter(Boolean);
      throw new Error(selectOptionMissing(val, optionNames));
    }
    matchedOptions.push(matched);
  }
  focusLikeHuman(selectEl, { pointer: false });
  for (const opt of options) opt.selected = matchedOptions.includes(opt);
  selectEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  dispatchChangeLikeHuman(selectEl);
  blurLikeHuman(selectEl);
  const labels = matchedOptions.map((opt) => `"${(opt.label || opt.text || "").trim()}"`).join(", ");
  return { text: `Selected ${labels} in [${ref}] ${description}.${note}`.trim() };
}
