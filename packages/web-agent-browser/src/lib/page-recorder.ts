// 131/004 — the recorder, in the "web-agent-recorder" isolated world that the
// side panel installs with Page.addScriptToEvaluateOnNewDocument. It runs in
// EVERY frame of the debugged tab, same-site and cross-site, and again in every
// new document, so a recording survives a navigation.
//
// It reaches the panel through the Runtime.addBinding function __waRecStep,
// which takes exactly ONE string argument — so every step is JSON.
import { EXTENSION_UI_SELECTOR, REC_HOVER_REST_MS, REC_SCROLL_QUIET_MS } from "./constants";
import { journalTarget, locatorSet } from "./locator-builder";
import {
  describe,
  eventElements,
  headings,
  innermost,
  isPrintable,
  isTextEntry,
  MODIFIER_KEYS,
  named,
  playwrightKey,
  target,
} from "./page-recorder-helpers";
import {
  clearClosedClicks,
  closedDblClick,
  closedHostOf,
  forgetClosedDblClick,
  reserveClosedClick,
  resolveClosedClick,
} from "./page-recorder-closed";
import { pwNormalizeWhiteSpace } from "./playwright-match";
import type { PendingClosedMessage, RecordedStep, RecordedStepKind } from "./recorder.types";

/** The extension's own bubble (content.ts). An event inside it is never the
 *  user acting on the page. A site's own <web-agent-bubble> IS the page, so it
 *  is recorded like any other element. */
const AGENT_UI = EXTENSION_UI_SELECTOR;

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
/** The last Enter or Space press and the step it became. The browser turns that
 *  key on a button or link into a synthetic click; the click is the same user
 *  action, so it records nothing. */
let lastActivationKey: { el: Element; seq: number } | null = null;
/** The last emitted `click` step, replaced in place if a `dblclick` immediately follows on the same element. */
let lastClick: { el: Element; step: RecordedStep } | null = null;
/** The in-page HTML5 drag source between `dragstart` and `drop` / `dragend`. */
let dragSource: Element | null = null;

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
function emit(step: RecordedStep | PendingClosedMessage): void {
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

/** Any step other than a wheel ends the open scroll and the open fill. */
function closeOpen(): void {
  openScroll = null;
  openFill = null;
}

function onClick(event: MouseEvent): void {
  if (ignored(event)) return;
  const el = target(event);
  const host = closedHostOf(event, el);
  const clicked = el ?? host;
  if (!clicked) return;
  window.clearTimeout(hoverTimer);
  restedEl = clicked;
  // `detail` is 0 for a click the browser made from the keyboard. When the step
  // just emitted is the Enter or Space press on this element, that click is the
  // press itself, not a second action.
  if (event.detail === 0 && lastActivationKey?.seq === seq - 1) {
    const pressed = lastActivationKey.el;
    lastActivationKey = null;
    if (pressed === clicked || clicked.contains(pressed)) return;
  }
  const isCheckable = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
  // The 2nd+ click of a double-click: `onDblClick` replaces the 1st click in place.
  if (event.detail >= 2 && !isCheckable) return;
  // A field's own click is not a step: the fill step records what was typed.
  if (
    el instanceof HTMLSelectElement ||
    el instanceof HTMLOptionElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable) ||
    (el instanceof HTMLInputElement && !isCheckable)
  ) {
    return;
  }
  // 005 — a keyboard click is at (0, 0), so a lookup would find the wrong node.
  if (host && event.detail >= 1) {
    const s = seq++;
    lastClick = null;
    closeOpen();
    emit(reserveClosedClick(event, host, el !== null, s, recordingId));
    return;
  }
  if (!el) return;
  closeOpen();
  if (isCheckable) {
    // `checked` is already the state AFTER the click: the HTML standard runs
    // the pre-click activation steps before dispatching `click`, and reverts
    // them only if the event is canceled.
    lastClick = null;
    const kind = el.checked ? "check" : "uncheck";
    emit(withTarget(el, kind, `${kind} ${named(el)}`));
    return;
  }
  const step = withTarget(el, "click", `click ${named(el)}`);
  lastClick = { el, step };
  emit(step);
}

function onDblClick(event: MouseEvent): void {
  if (ignored(event)) return;
  const closed = closedDblClick(event, seq);
  if (closed !== null) {
    window.clearTimeout(hoverTimer);
    restedEl = innermost(event);
    if (closed !== "handled") emit(closed);
    return;
  }
  const el = target(event);
  if (!el) return;
  window.clearTimeout(hoverTimer);
  restedEl = el;
  closeOpen();
  if (lastClick && lastClick.el === el && lastClick.step.seq === seq - 1) {
    emit({ ...lastClick.step, kind: "dblclick", line: `dblclick ${named(el)}` });
  } else {
    emit(withTarget(el, "dblclick", `dblclick ${named(el)}`));
  }
  lastClick = null;
}

function onContextMenu(event: MouseEvent): void {
  if (ignored(event)) return;
  const el = target(event);
  if (!el) return;
  window.clearTimeout(hoverTimer);
  restedEl = el;
  lastClick = null;
  closeOpen();
  emit(withTarget(el, "rightclick", `right-click ${named(el)}`));
}

function onDragStart(event: DragEvent): void {
  if (ignored(event)) {
    dragSource = null;
    return;
  }
  // Chromium can fire one `pointermove` across a neighbor control before crossing
  // the drag threshold and firing `dragstart` + `pointercancel`. Cancel the hover
  // timer here so a slow drag never emits a stray `hover` step mid-drag.
  window.clearTimeout(hoverTimer);
  pointerEl = null;
  restedEl = null;
  dragSource = target(event) ?? innermost(event);
}

function onDrop(event: DragEvent): void {
  const src = dragSource;
  dragSource = null;
  if (ignored(event) || !src) return;
  const dest = target(event) ?? innermost(event);
  if (!dest) return;
  window.clearTimeout(hoverTimer);
  const hoverDest = target(event);
  pointerEl = hoverDest;
  restedEl = hoverDest;
  lastClick = null;
  closeOpen();
  emit(
    withTarget(src, "drag", `drag ${named(src)} to ${named(dest)}`, {
      dropTarget: journalTarget(dest, document, describe(dest)),
      dropLocators: locatorSet(dest, document),
    }),
  );
}

function onDragEnd(): void {
  dragSource = null;
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
  if (!isTextEntry(el)) return;
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
  // A held key repeats: it is one action, not one per repeat.
  if (event.repeat) return;
  // A modifier on its own is a state, not an action on the page.
  if (MODIFIER_KEYS.includes(event.key)) return;
  // An IME composition is still being typed; the fill rule records its result.
  if (event.isComposing || event.key === "Process" || event.key === "Dead") return;
  const el = innermost(event);
  const combo = event.ctrlKey || event.altKey || event.metaKey;
  // Typing in a text field is the fill step's job. A shortcut there is not
  // text, so a combo is always recorded.
  if (el && isTextEntry(el) && !combo && (isPrintable(event.key) || event.key === "Backspace" || event.key === "Delete")) {
    return;
  }
  const key = playwrightKey(event);
  closeOpen();
  const line = `press ${key}`;
  // A press on <body> has no target: the exported code uses page.keyboard.
  if (!el || el === document.body || el === document.documentElement) {
    emit(nextStep("press", line, { key }));
    return;
  }
  const step = withTarget(el, "press", line, { key });
  lastActivationKey = key === "Enter" || key === "Space" ? { el, seq: step.seq } : null;
  emit(step);
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
  if (ignored(event) || dragSource) return;
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
  on("dblclick", onDblClick);
  on("contextmenu", onContextMenu);
  on("dragstart", onDragStart);
  on("drop", onDrop);
  on("dragend", onDragEnd);
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
  lastClick = null;
  clearClosedClicks();
  dragSource = null;
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
  lastActivationKey = null;
  lastClick = null;
  clearClosedClicks();
  dragSource = null;
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
  lastClick = null;
  forgetClosedDblClick();
  dragSource = null;
}

/** 005 — the panel calls this with the node its CDP lookup found, or null when
 *  the lookup failed. A pause does not stop it: the click came first. */
export function finishClosed(inner: Node | null, s: number): void {
  const step = resolveClosedClick(inner, s, recordingId);
  if (step) emit(step);
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
  lastActivationKey = null;
}
