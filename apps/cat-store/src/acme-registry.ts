import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/checkbox/checkbox.js";
import "@material/web/menu/menu.js";
import "@material/web/menu/menu-item.js";
import "@material/web/progress/linear-progress.js";
import { ACME_ELEMENTS } from "./acme-elements";

/** The panel now renders inside <web-agent-bubble>'s shadow root, and CSS
 *  rules are tree-scoped — these would no longer reach it from document.head.
 *  The head copy below still serves the light-DOM panels (the gallery and the
 *  ?frame= renderer); `apps/cat-store/src/web/index.ts` places a second copy
 *  inside the bubble's shadow root. */
export const ACME_PANEL_MD_STYLES = `
    agent-chat-panel {
      --md-focus-ring-color: var(--wa-text-color, #ffffff);
    }
    agent-chat-panel md-outlined-button {
      --md-outlined-button-label-text-color: var(--wa-text-color, #ffffff);
      --md-outlined-button-hover-label-text-color: var(--wa-text-color, #ffffff);
      --md-outlined-button-focus-label-text-color: var(--wa-text-color, #ffffff);
      --md-outlined-button-pressed-label-text-color: var(--wa-text-color, #ffffff);
      --md-outlined-button-outline-color: var(--wa-text-color, #ffffff);
      --md-outlined-button-pressed-outline-color: var(--wa-text-color, #ffffff);
    }
    agent-chat-panel md-icon-button {
      --md-icon-button-icon-color: var(--wa-text-color, #ffffff);
      --md-icon-button-hover-icon-color: var(--wa-text-color, #ffffff);
      --md-icon-button-focus-icon-color: var(--wa-text-color, #ffffff);
      --md-icon-button-pressed-icon-color: var(--wa-text-color, rgba(255,255,255,0.8));
      --md-icon-button-hover-state-layer-color: var(--wa-text-color, #ffffff);
      --md-icon-button-pressed-state-layer-color: var(--wa-text-color, #ffffff);
      --md-icon-button-disabled-icon-color: var(--wa-label-color, #888888);
      --md-icon-button-disabled-icon-opacity: 1;
    }
    /* The scroll-to-bottom button is the one panel icon button drawn ON
       the accent fill, so its glyph takes the on-accent token instead of the
       body text colour the block above sets for every other one.
       --wa-action-text-color-info on --wa-action-color-info measures
       4.56 / 4.57 / 4.57 : 1 (wa1-dark / wa2-dark / wa2-light) — WCAG AA in
       all three, and the pair wa-tokens.test.ts case 13 already pins. */
    agent-chat-panel .wa-jump-btn md-icon-button {
      --md-icon-button-icon-color: var(--wa-action-text-color-info, #ffffff);
      --md-icon-button-hover-icon-color: var(--wa-action-text-color-info, #ffffff);
      --md-icon-button-focus-icon-color: var(--wa-action-text-color-info, #ffffff);
      --md-icon-button-pressed-icon-color: var(--wa-action-text-color-info, #ffffff);
    }
    agent-chat-panel md-outlined-text-field {
      --md-outlined-text-field-input-text-color: var(--wa-input-text-color, var(--wa-text-color, #ffffff));
      --md-outlined-text-field-focus-input-text-color: var(--wa-input-text-color, var(--wa-text-color, #ffffff));
      --md-outlined-text-field-input-text-placeholder-color: var(--wa-label-color, #888888);
      --md-outlined-text-field-outline-color: var(--wa-border-color, #888888);
      --md-outlined-text-field-hover-outline-color: var(--wa-border-color, #888888);
      --md-outlined-text-field-focus-outline-color: var(--wa-outline-color, #1a73e8);
    }
    agent-chat-panel .composer > md-outlined-text-field {
      --md-outlined-text-field-outline-color: transparent;
      --md-outlined-text-field-hover-outline-color: transparent;
      --md-outlined-text-field-focus-outline-color: transparent;
    }
    /* md-menu paints from its own --md-* properties, which default to the
       Material LIGHT palette, so the kebab menu stayed near-white on a dark
       panel. Map them onto the --wa-dropdown-* tokens, same as the
       md-icon-button / md-outlined-text-field blocks above. */
    agent-chat-panel md-menu {
      --md-menu-container-color: var(--wa-dropdown-background-color, #ffffff);
    }
    agent-chat-panel md-menu-item {
      --md-menu-item-container-color: var(--wa-dropdown-item-background-color, transparent);
      --md-menu-item-label-text-color: var(--wa-dropdown-item-text-color, #000000);
      --md-menu-item-hover-state-layer-color: var(--wa-dropdown-item-text-color, #000000);
      --md-menu-item-pressed-state-layer-color: var(--wa-dropdown-item-text-color, #000000);
      --md-menu-item-selected-container-color: var(--wa-dropdown-item-background-color-selected, #1a73e8);
      --md-menu-item-selected-label-text-color: var(--wa-dropdown-item-text-color-selected, #ffffff);
    }
    /* The ripple is suppressed on menu rows (acme-fields.ts), so the hover
       background comes from CSS instead of the ripple's state layer. */
    agent-chat-panel md-menu-item:not([disabled]):hover {
      --md-menu-item-container-color: var(--wa-dropdown-item-background-color-hover, transparent);
    }
    /* "Choose model" is a disabled group header (chat-panel.ts:172). Material
       dims disabled items to opacity 0.3 and exposes no disabled label colour,
       so undim it and set the label colour on the [disabled] attribute instead
       — the same shape as --md-icon-button-disabled-icon-color +
       --md-icon-button-disabled-icon-opacity above.
       --wa-label-color measures 4.80 / 6.22 / 4.79 : 1 on the menu surface
       (wa1-dark / wa2-dark / wa2-light) — AA in all three.
       NOT --wa-dropdown-item-text-color-disabled: 2.01 / 1.09 / 2.11 : 1.
       NOT --wa-text-color-disabled: 2.53:1 in wa2-light (see the workingDots comment below). */
    agent-chat-panel md-menu-item[disabled] {
      --md-menu-item-label-text-color: var(--wa-label-color, #888888);
      --md-menu-item-disabled-opacity: 1;
    }
`;

// Wire Material Web icon-button / outlined-text-field colors to theme tokens.
// md-icon-button ignores inherited style.color; it uses CSS custom properties set
// in its shadow DOM. Scope-free so both header and input-area controls adapt per theme.
if (typeof document !== "undefined") {
  const _s = document.createElement("style");
  _s.textContent = `
    :root {
      --md-ref-typeface-plain: "Public Sans", system-ui, -apple-system, sans-serif;
      --md-ref-typeface-brand: "Public Sans", system-ui, -apple-system, sans-serif;
    }
  ` + ACME_PANEL_MD_STYLES;
  document.head.appendChild(_s);
}

/** Registers cat-store's Material-backed UI elements. */
export function defineUiElements(): void {
  for (const [tag, cls] of ACME_ELEMENTS) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }
}
