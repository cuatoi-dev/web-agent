import { DEFAULT_ELEMENTS } from "./wa-elements.js";

/** Registers the default UI elements. Safe to call more than once. */
export function defineUiElements(): void {
  for (const [tag, cls] of DEFAULT_ELEMENTS) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }
}
