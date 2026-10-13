// ---------------------------------------------------------------------------
// element-factory
//
// The element construction that used to sit inside `render` methods. A render
// method must not create nodes: the element would exist before lit-html renders
// the template, so a re-render leaves the old node in place. The functions here
// are plain helpers with no render scope, so `wa/no-widget-factory-in-render`
// stays quiet and the render methods only compose the returned elements.
// ---------------------------------------------------------------------------

import type { ButtonsBlock, FormBlock } from "@cuatoi/web-agent-core";

/** The fallback container for a block type with no registered renderer. */
export function createBlockContainer(): HTMLDivElement {
  return document.createElement("div");
}

/** An `<agent-form-block>` for a `form` block, with its block and disabled state. */
export function createFormBlock(block: FormBlock, disabled: boolean) {
  const el = document.createElement("agent-form-block");
  el.block = block;
  el.disabled = disabled;
  return el;
}

/** An `<agent-buttons-block>` for a `buttons` block, with its block and disabled state. */
export function createButtonsBlock(block: ButtonsBlock, disabled: boolean) {
  const el = document.createElement("agent-buttons-block");
  el.block = block;
  el.disabled = disabled;
  return el;
}
