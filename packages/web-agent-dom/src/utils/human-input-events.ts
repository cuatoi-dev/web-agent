// human-input-events.ts — drives a field through the event sequence a real
// person produces, so a host that commits on blur/change/keydown sees the
// agent's input. Orders and flags are measured in Chromium 151 and jsdom 24.

/** `document.activeElement` is the shadow HOST for a field inside a shadow
 *  root, so the field's own root is what must be asked. In the light DOM the
 *  two are the same node. */
export function holdsFocus(el: Element): boolean {
  const root = el.getRootNode() as unknown as DocumentOrShadowRoot;
  return root?.activeElement === el;
}

/** pointerdown → mousedown → focus (+ focusin). `pointer: false` for a
 *  <select>, whose sequence in the task is focus only. */
export function focusLikeHuman(el: HTMLElement, opts?: { pointer?: boolean }): void {
  const init = { bubbles: true, cancelable: true, composed: true };
  if (opts?.pointer !== false) {
    // jsdom has no PointerEvent — same fallback click() already uses.
    const PointerClass = typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
    el.dispatchEvent(new PointerClass("pointerdown", init));
    el.dispatchEvent(new MouseEvent("mousedown", init));
  }
  el.focus?.();
  if (!holdsFocus(el)) {
    // focus() did nothing (element not focusable in this environment): fire the
    // pair a browser would have fired so host handlers still run.
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false, composed: true }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
  }
}

/** keydown → beforeinput → `commit()` → input → keyup for one chunk of text.
 *  `commit` is what actually writes the value, so the caller keeps using the
 *  native prototype setter. */
export function typeChunkLikeHuman(el: Element, chunk: string, commit: () => void): void {
  const key = chunk.slice(-1);
  const keyInit = { bubbles: true, cancelable: true, composed: true, key };
  el.dispatchEvent(new KeyboardEvent("keydown", keyInit));
  el.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: chunk,
  }));
  commit();
  el.dispatchEvent(new InputEvent("input", {
    bubbles: true, cancelable: false, composed: true, inputType: "insertText", data: chunk,
  }));
  el.dispatchEvent(new KeyboardEvent("keyup", keyInit));
}

/** The commit event. `composed: true` so it crosses a shadow boundary — a real
 *  browser's change does not, and a field inside a shadow root needs it to
 *  cross. */
export function dispatchChangeLikeHuman(el: Element): void {
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

/** blur (+ focusout). Does nothing when the field no longer holds focus: the
 *  host moved focus itself, the browser already fired its own blur/focusout,
 *  and firing a second pair would run a host handler twice. */
export function blurLikeHuman(el: HTMLElement): void {
  if (!holdsFocus(el)) return;
  el.blur?.();
  if (holdsFocus(el)) {
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false, composed: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  }
}
