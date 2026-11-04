// 131/004 — the recorder, in the "web-agent-recorder" isolated world that the
// side panel installs with Page.addScriptToEvaluateOnNewDocument. It runs in
// EVERY frame of the debugged tab, same-site and cross-site, and again in every
// new document, so a recording survives a navigation.
//
// It reaches the panel through the Runtime.addBinding function __waRecStep,
// which takes exactly ONE string argument — so every step is JSON.
import { describeElementParts } from "@cuatoi/web-agent-dom";
import { EXTENSION_UI_SELECTOR, REC_HOVER_REST_MS, REC_SCROLL_QUIET_MS } from "./constants";
import { journalTarget, locatorSet } from "./locator-builder";
import { pwNormalizeWhiteSpace } from "./playwright-match";
import type { RecordedStep, RecordedStepKind } from "./recorder.types";

/** The extension's own bubble (content.ts). An event inside it is never the
 *  user acting on the page. A site's own <web-agent-bubble> IS the page, so it
 *  is recorded like any other element. */
const AGENT_UI = EXTENSION_UI_SELECTOR;

const INTERACTIVE_ROLES = [
  "button", "link", "checkbox", "radio", "tab", "menuitem", "option", "switch",
  "combobox", "listbox", "slider", "spinbutton", "searchbox", "textbox",
  "treeitem", "gridcell", "row", "menuitemcheckbox", "menuitemradio",
];

/** Semantic controls and ARIA widget roles matched first on the composed path. */
const INTERACTIVE = [
  "a", "button", "input", "select", "textarea", "summary", "label",
  '[contenteditable="true"]', "[tabindex]",
  ...INTERACTIVE_ROLES.map((r) => `[role="${r}"]`),
].join(", ");

let recordingId = "";
let seq = 0;
let paused = false;
let detachers: (() => void)[] = [];
/** The step a further `input` event on the same field updates in place. */
let openFill: { el: Element; step: RecordedStep } | null = null;
/** The step further wheel events add their delta to. */
let openScroll: RecordedStep | null = null;
let scrollTimer: number | undefined;
let hoverTimer: number | undefined;
/** The element the pointer is currently over, and the one it already rested
 *  on — so one rest records one hover until the pointer leaves. */
let pointerEl: Element | null = null;
let restedEl: Element | null = null;

/** Elements on the event's path, innermost first, across open shadow roots and slots. */
function eventElements(event: Event): Element[] {
  if (typeof event.composedPath !== "function") {
    return event.target instanceof Element ? [event.target] : [];
  }
  return event.composedPath().filter((n): n is Element => n instanceof Element);
}

/** The real element that received the event, innermost first. Replaces event.target. */
function innermost(event: Event): Element | null {
  const path = eventElements(event);
  return path.length > 0 ? path[0] : null;
}

function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

function hasPointerCursor(el: Element): boolean {
  return (el.ownerDocument.defaultView ?? window).getComputedStyle(el).cursor === "pointer";
}

/** The click or hover target on the composed path: closest INTERACTIVE match
 *  first, then an `onclick` attribute or the outermost `cursor: pointer` element. */
function target(event: Event): Element | null {
  const path = eventElements(event);
  for (const el of path) {
    if (el.matches(INTERACTIVE)) return el;
  }
  for (const el of path) {
    if (el === document.documentElement || el === document.body) break;
    if (el.hasAttribute("onclick")) return el;
    if (hasPointerCursor(el)) {
      const parent = composedParent(el);
      if (!parent || !hasPointerCursor(parent)) return el;
    }
  }
  return null;
}

/** True when this event must not be recorded: not recording, paused, not a
 *  real user event, or inside the agent's own UI. */
function ignored(event: Event): boolean {
  if (recordingId === "" || paused) return true;
  if (!event.isTrusted) return true;
  return eventElements(event).some((el) => el.matches(AGENT_UI));
}

function nextStep(kind: RecordedStepKind, line: string, extra: Partial<RecordedStep> = {}): RecordedStep {
  return { recordingId, seq: seq++, kind, line, ...extra };
}

/** Hands one step to the panel through the CDP binding. A binding takes
 *  exactly one STRING argument, so the step is JSON. A later call with the
 *  SAME `seq` replaces it in the panel's list (the panel upserts by seq). */
function emit(step: RecordedStep): void {
  const send = (globalThis as unknown as { __waRecStep?: (s: string) => void }).__waRecStep;
  // The binding is installed before the script runs, but a document that
  // started loading first can reach here once without it. Dropping the step is
  // correct: there is no panel listening for it yet.
  if (typeof send !== "function") return;
  try {
    send(JSON.stringify(step));
  } catch {
    // A binding whose session detached throws. The recording is over.
  }
}

/** A step with an element: its role, name and neutral locator set. */
function withTarget(el: Element, kind: RecordedStepKind, line: string, extra: Partial<RecordedStep> = {}): RecordedStep {
  // 131/004 — no ref: the panel DomAdapter and its RefTable are gone with the
  // page script, and an isolated world cannot reach the MAIN world's one.
  const target = journalTarget(el, document, describe(el));
  const locators = locatorSet(el, document);
  return nextStep(kind, line, { target, locators, ...extra });
}

function describe(el: Element): string {
  const { role, name } = describeElementParts(el);
  return name ? `${role} "${name}"` : role;
}

/** `button "Apply"` — the plan's readable-line element part. */
function named(el: Element): string {
  const { role, name } = describeElementParts(el);
  return `${role} "${name}"`;
}

/** Any step other than a wheel ends the open scroll and the open fill. */
function closeOpen(): void {
  openScroll = null;
  openFill = null;
}

function onClick(event: MouseEvent): void {
  if (ignored(event)) return;
  const el = target(event);
  if (!el) return;
  window.clearTimeout(hoverTimer);
  restedEl = el;
  // A field's own click is not a step: the fill step records what was typed.
  if (
    el instanceof HTMLSelectElement ||
    el instanceof HTMLOptionElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable) ||
    (el instanceof HTMLInputElement && !["checkbox", "radio"].includes(el.type))
  ) {
    return;
  }
  closeOpen();
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    // `checked` is already the state AFTER the click: the HTML standard runs
    // the pre-click activation steps before dispatching `click`, and reverts
    // them only if the event is canceled.
    const kind = el.checked ? "check" : "uncheck";
    emit(withTarget(el, kind, `${kind} ${named(el)}`));
    return;
  }
  emit(withTarget(el, "click", `click ${named(el)}`));
}

function onInput(event: Event): void {
  if (ignored(event)) return;
  const el = innermost(event);
  if (!el) return;
  if (el instanceof HTMLSelectElement) {
    closeOpen();
    const values = [...el.selectedOptions].map((o) => pwNormalizeWhiteSpace(o.label));
    const line = `select ${named(el)} ${values.map((v) => `"${v}"`).join(", ")}`;
    emit(withTarget(el, "select", line, { values }));
    return;
  }
  if (el instanceof HTMLInputElement && el.type === "file") {
    closeOpen();
    // A page sees File.name only, never a local path.
    const names = [...(el.files ?? [])].map((f) => f.name);
    const chosen = names.length > 0 ? names.map((n) => `"${n}"`).join(", ") : "(none)";
    emit(withTarget(el, "upload", `upload ${named(el)} ${chosen}`, { values: names }));
    return;
  }
  const isText =
    (el instanceof HTMLInputElement && !["checkbox", "radio", "file"].includes(el.type)) ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable);
  if (!isText) return;
  // A range drag fires its click only on release. Without this, a hover timer
  // armed when the pointer reached the slider fires during the drag, closes
  // the open fill and splits one drag into two fill steps.
  if (el instanceof HTMLInputElement && el.type === "range") window.clearTimeout(hoverTimer);

  const masked = el instanceof HTMLInputElement && el.type === "password";
  // A password's text is never read, so it can reach neither the step, the
  // journal, the panel, nor chrome.storage.
  const value = masked
    ? undefined
    : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value
      : (el.textContent ?? "");
  const shown = masked ? "<password>" : `"${value ?? ""}"`;
  const line = `fill ${named(el)} ${shown}`;

  if (openFill && openFill.el === el) {
    // Same field as the last step: update it in place, same seq.
    openFill.step = { ...openFill.step, line, ...(masked ? { masked: true } : { value }) };
    emit(openFill.step);
    return;
  }
  openScroll = null;
  const step = withTarget(el, "fill", line, masked ? { masked: true } : { value });
  openFill = { el, step };
  emit(step);
}

function onKeyDown(event: KeyboardEvent): void {
  if (ignored(event)) return;
  if (!["Enter", "Escape", "Tab"].includes(event.key)) return;
  closeOpen();
  const el = innermost(event);
  const line = `press ${event.key}`;
  // A press on <body> has no target: the exported code uses page.keyboard.
  if (!el || el === document.body || el === document.documentElement) {
    emit(nextStep("press", line, { key: event.key }));
    return;
  }
  emit(withTarget(el, "press", line, { key: event.key }));
}

function onWheel(event: WheelEvent): void {
  if (ignored(event)) return;
  if (openScroll) {
    openScroll.deltaY = (openScroll.deltaY ?? 0) + event.deltaY;
  } else {
    openFill = null;
    openScroll = nextStep("scroll", "", { deltaY: event.deltaY });
  }
  const step = openScroll;
  emit({ ...step, line: scrollLine(step) });
  window.clearTimeout(scrollTimer);
  // The label is read after the page has settled, so the heading it names is
  // the one the user is actually looking at.
  scrollTimer = window.setTimeout(() => {
    step.line = scrollLine(step);
    emit(step);
  }, REC_SCROLL_QUIET_MS);
}

/** All headings in composed tree order, crossing open shadow roots and skipping AGENT_UI. */
function* headings(root: ParentNode): Generator<Element> {
  for (const el of root.children) {
    if (el.matches(AGENT_UI)) continue;
    if (el.matches("h1, h2, h3, h4, h5, h6")) yield el;
    if (el.shadowRoot) yield* headings(el.shadowRoot);
    yield* headings(el);
  }
}

/** The first heading whose top is inside the viewport, else the raw delta. */
function scrollLine(step: RecordedStep): string {
  let heading: Element | undefined;
  for (const h of headings(document)) {
    const top = h.getBoundingClientRect().top;
    if (top >= 0 && top <= window.innerHeight) {
      heading = h;
      break;
    }
  }
  if (heading) return `scroll to "${pwNormalizeWhiteSpace(heading.textContent ?? "")}"`;
  const delta = step.deltaY ?? 0;
  return `scroll ${delta < 0 ? "up" : "down"} ${Math.abs(Math.round(delta))} px`;
}

function onPointerDown(event: PointerEvent): void {
  if (ignored(event)) return;
  const el = target(event);
  if (!el) return;
  window.clearTimeout(hoverTimer);
  restedEl = el;
}

function onPointerMove(event: PointerEvent): void {
  if (ignored(event)) return;
  const el = target(event);
  if (el === pointerEl) return;
  pointerEl = el;
  restedEl = null;
  window.clearTimeout(hoverTimer);
  if (!el) return;
  hoverTimer = window.setTimeout(() => {
    if (recordingId === "" || paused || restedEl === el) return;
    restedEl = el;
    closeOpen();
    emit(withTarget(el, "hover", `hover ${named(el)}`));
  }, REC_HOVER_REST_MS);
}

function attach(): void {
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
    // Capture phase: a page that calls stopPropagation on its own handlers
    // must not hide the user's action from the recorder.
    window.addEventListener(type, fn as EventListener, true);
    detachers.push(() => window.removeEventListener(type, fn as EventListener, true));
  };
  on("click", onClick);
  on("input", onInput);
  on("keydown", onKeyDown);
  on("wheel", onWheel);
  on("pointerdown", onPointerDown);
  on("pointermove", onPointerMove);
}

function detach(): void {
  for (const off of detachers) off();
  detachers = [];
  window.clearTimeout(scrollTimer);
  window.clearTimeout(hoverTimer);
  scrollTimer = undefined;
  hoverTimer = undefined;
  openFill = null;
  openScroll = null;
  pointerEl = null;
  restedEl = null;
  paused = false;
  recordingId = "";
}

/** Starts recording in THIS document. Called by the installed script with the
 *  recording id the panel minted. A second call re-arms cleanly. */
export function start(id: string): void {
  if (recordingId !== "") detach();
  recordingId = id;
  seq = 0;
  paused = false;
  attach();
}

export function stop(): void {
  detach();
}

export function pause(): void {
  paused = true;
}

export function resume(): void {
  paused = false;
  // A paused hover or scroll timer would fire against the agent's own action,
  // so both are dropped rather than resumed — as content-recorder.ts:354-360.
  window.clearTimeout(hoverTimer);
  pointerEl = null;
  restedEl = null;
  openFill = null;
  openScroll = null;
}

/** True while this document is recording. Read by the panel through
 *  Runtime.evaluate when it needs to know whether a new document armed. */
export function isRecording(): boolean {
  return recordingId !== "";
}

/** Test seam: the module keeps its state in module scope, like the console
 *  buffer in `core/run-console.ts`. A unit test resets it between cases. */
export function __resetRecorderForTest(): void {
  detach();
  seq = 0;
}
