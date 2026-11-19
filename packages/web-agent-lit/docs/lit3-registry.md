---
title: Lit 3 support & the UI element seam
---

# Lit 3 support & the UI element seam

This page shows how to swap the agent UI from the default implementation to
**Lit 3 / Material Web 3** components. The cat-store app is the worked
reference.

---

## 1. Why the seam exists

**Background:** The web-agent is designed to be dropped into an
airgapped internal repo that already has its own design system. The host team
must not need to fork or patch the binding. The element seam makes that
possible: the chat UI never imports vendor widgets (`md-*` and similar)
directly. It renders `<wa-*>` tags in its lit-html templates instead, and a
host swaps the classes those tags resolve to at build time.

```
NormalModuleReplacementPlugin
  ui/registry.js  ──→  src/acme-registry.ts (your Lit 3 impl)
```

This design lets you drop the agent into an airgapped repo and wire its UI to
your existing design system without forking the package.

The seam's original rationale, and how it sits inside the agent as a whole, is
documented in the `@cuatoi/web-agent-core` package docs,
`docs/registry.md` — that package is where the loop lives; this package
renders it.

---

## 1a. The tag contract

The chat UI renders these tags directly in its templates. Each is a plain
custom element — a light-DOM wrapper around whatever the active element set
builds, so its inner node survives every re-render:

| Tag | Properties | Events |
|---|---|---|
| `<wa-button>` | `label`, `variant` (`"primary"` \| `"secondary"` \| `"danger"`), `disabled` | `press` |
| `<wa-icon-button>` | `icon`, `label`, `disabled` | `press` |
| `<wa-icon>` | `name`, `label` | — |
| `<wa-checkbox>` | `checked`, `label`, `disabled` | `checked-change` (`detail.checked`) |
| `<wa-menu>` | `open`, `items` (`WaMenuItem[]`), `anchor-id` | `select` (`detail.id`), `request-close` |
| `<wa-text-input>` | `value`, `placeholder`, `type`, `min`, `max`, `required`, `name`, `disabled` | `value-input` (`detail.value`) |
| `<wa-text-area>` | `value`, `placeholder`, `disabled`, plus a `resetHeight()` method | `value-input` (`detail.value`) |
| `<wa-progress>` | `indeterminate` | — |
| `<wa-working-dots>` | — | — |

Every role is a real DOM node, built once in `connectedCallback()` and never
rebuilt — lit-html keeps the same tag instance across renders, so typing in a
`<wa-text-area>` or an open `<wa-menu>` survives the surrounding template
re-rendering for an unrelated reason.

**Responsive-shell rules:** these elements are placed inside the agent's flex
shell. `<wa-text-input>` and `<wa-progress>` must accept `width: 100%` so the
composer and the turn indicator stretch properly. Buttons and icon buttons
should not set a fixed width.

---

## 1b. Default element set

`packages/web-agent-lit/src/ui/wa-elements.ts` is the default
implementation — it renders plain `<button>`/`<input>`/`<textarea>` elements
styled by the rules in `src/ui/registry-styles.ts`, with inline SVG icons from
`src/ui/icon-svgs.ts`. `DEFAULT_ELEMENTS` (`wa-elements.ts`) lists the tag →
class pairs; `defineUiElements()` (`src/ui/registry.ts`) registers them with
`customElements.define()`, guarded so it is safe to call more than once.

`REGISTRY_STYLES` in `src/ui/registry-styles.ts` holds the default set's CSS.
The panel renders it as a `<style>` element inside itself
(`src/chat-ui/chat-panel-elements.ts`), so it applies in the light DOM and
inside a host's shadow root. The package writes nothing to `document.head`.

---

## 2. Implementing a Lit 3 element set

File: `apps/cat-store/src/acme-elements.ts` and `apps/cat-store/src/acme-fields.ts`

Each class extends `AcmeElement` (`apps/cat-store/src/acme-element-base.ts`),
which mirrors the default set's `WaElement` base: `build()` runs once, on
first connect, and returns the real Material node; `sync()` runs on every
property write and pushes the current property values onto it.

### Imports

```ts
import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/checkbox/checkbox.js";
import "@material/web/menu/menu.js";
import "@material/web/menu/menu-item.js";
import "@material/web/progress/linear-progress.js";
```

Each side-effect import registers the corresponding custom element
(`<md-filled-button>`, `<md-outlined-text-field>`, etc.) globally.

### Button (`AcmeButton`)

```ts
export class AcmeButton extends AcmeElement {
  private _label = ""; private _variant: WaButtonVariant = "primary"; private _disabled = false;
  private make(): HTMLElement {
    const btn = document.createElement(this._variant === "secondary" ? "md-outlined-button" : "md-filled-button");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._disabled) { e.preventDefault(); return; }
      this.fire("press");
    });
    return btn;
  }
  protected build(): HTMLElement { return this.make(); }
  protected sync(): void {
    // swaps the inner tag when variant changes, then sets label/disabled/danger colours
  }
}
```

`"primary"` → `<md-filled-button>`, `"secondary"` → `<md-outlined-button>`. A
variant change swaps the inner Material tag and re-focuses it if it had focus.
Danger sets Material's container CSS custom properties **token-first** —
`var(--wa-action-color-error, #d93025)` and
`var(--wa-action-text-color-error, #ffffff)` — the literals are only
fallbacks. The `disabled` guard on click is required (see section 5).

### Icon button (`AcmeIconButton`)

```ts
export class AcmeIconButton extends AcmeElement {
  protected build(): HTMLElement {
    const btn = document.createElement("md-icon-button");
    btn.addEventListener("click", (e) => { e.stopPropagation(); if (!this._disabled) this.fire("press"); });
    return btn;
  }
  protected sync(): void {
    // sets disabled, aria-label, and redraws the icon SVG when it changed
  }
}
```

The icon comes from `iconNode()` (`apps/cat-store/src/acme-icon-svgs.ts`),
which returns inline SVG for the names the chat UI uses (see section 5c) and falls
back to a `<span>` holding the raw name for anything else — the button shows
the name as text but stays clickable.

### Text input (`AcmeTextInput`, in `acme-fields.ts`)

```ts
export class AcmeTextInput extends AcmeElement {
  protected build(): HTMLElement {
    const field = document.createElement("md-outlined-text-field");
    field.addEventListener("input", () => this.fire("value-input", { value: field.value }));
    field.style.width = "100%";
    return field;
  }
  protected sync(): void {
    // pushes value/placeholder/type/min/max/required/disabled onto the field
  }
}
```

Material's `<md-outlined-text-field>` handles the label-floating animation,
focus ring, and error state natively.

### Checkbox (`AcmeCheckbox`)

```ts
export class AcmeCheckbox extends AcmeElement {
  protected build(): HTMLElement {
    const wrapper = document.createElement("label");
    const cb = document.createElement("md-checkbox");
    cb.addEventListener("change", () => this.fire("checked-change", { checked: cb.checked }));
    const span = document.createElement("span");
    wrapper.append(cb, span);
    return wrapper;
  }
  protected sync(): void {
    // pushes checked/disabled onto the checkbox, and the label text onto the span
  }
}
```

The `<label>` wrapper lets the text label toggle the checkbox.

### Menu (`AcmeMenu`, in `acme-fields.ts`)

The Material `<md-menu>` uses `anchorElement`, a DOM reference, rather than a
CSS selector. `AcmeMenu` reads the `anchor-id` attribute, resolves it with
`document.getElementById` first, and falls back to a `setTimeout(…, 0)` retry
against `this.getRootNode()` when the anchor has not rendered yet — searching
the menu's own root node, not `document`, because the anchor can be inside
`<web-agent-bubble>`'s shadow root.

### Progress (`AcmeProgress`)

```ts
protected build(): HTMLElement { const p = document.createElement("md-linear-progress"); p.style.width = "100%"; return p; }
protected sync(): void { (this._inner as HTMLElement & { indeterminate: boolean }).indeterminate = this._indeterminate; }
```

Material's linear progress handles the animation natively.

### Working dots (`AcmeWorkingDots`)

```ts
protected build(): HTMLElement {
  const el = document.createElement("div");
  el.className = "wa-working-dots";
  // three <span>s, coloured via --wa-text-color, animated with @keyframes wa-bounce
  return el;
}
```

The `wa-working-dots` class is the hook outer-tree code (the demo/gallery
freeze-dots feature) selects the element by; it carries no styling of its own
in cat-store, since every visual rule here is inline.

### Text area (`AcmeTextArea`, in `acme-fields.ts`)

This is the composer. It grows with its content and exposes `resetHeight()`,
called by the chat panel after every send
(`src/chat-ui/chat-panel-composer.ts`):

```ts
export class AcmeTextArea extends AcmeElement {
  resetHeight(): void {
    // clears the value, collapses the inner <textarea> to one row
  }
}
```

`type = "textarea"` switches the Material element into its multiline mode. The
shadow-DOM `<textarea>` is reset to `rows = 1` on construction and after send.
The auto-grow measures the difference between the field's outer box and its
inner textarea (`chrome`), so the height count is the height of the visible
text. Growth caps at `maxPx = panelHeight * 0.5`; above that cap, the field
scrolls internally.

### Runtime contracts for custom composers

Two runtime contracts govern how the chat panel interacts with the composer
tag:

1. **Slash-command menu caret & selection contract**: when the slash menu
   picks an entry (`src/chat-ui/chat-panel-composer.ts`), it writes the
   command text into `_composerValue`, sets it on the composer element
   directly, then places the caret with
   `host.setSelectionRange?.(value.length, value.length)`. The panel obtains
   `host` from `this._slashComposerHost()`, which looks for a light-DOM
   `<textarea>`/`<input>` inside the `#input` element and falls back to that
   element itself. Material Web's `md-outlined-text-field` keeps its
   `<textarea>` in shadow DOM but implements `setSelectionRange` directly on
   the host custom element (per `@material/web` 2.4.1 `text-field.d.ts` line
   284), satisfying the contract. A custom component that hides its input
   inside shadow DOM without implementing `setSelectionRange` on its host
   breaks caret placement.
2. **Keystrokes stay light**: the panel does not re-render the whole template
   on every keystroke, because a re-render would tear down active DOM
   components and charts elsewhere in the transcript. `<wa-text-area>` fires
   `value-input` on every keystroke; the panel's handler updates its own
   `_composerValue` field directly (so a later, unrelated render never
   clobbers what was typed) and calls `requestUpdate()` only when the Stop/
   Send choice or the Send button's enabled state actually changes.

---

## 3. Wiring the Webpack alias

File: `apps/cat-store/webpack.config.js:100-103`

```js
const webpack = require("webpack");
const path = require("path");

module.exports = {
  // ...
  plugins: [
    new webpack.NormalModuleReplacementPlugin(
      /[\\/]ui[\\/]registry\.js$/,
      path.resolve(__dirname, "src/acme-registry.ts")
    ),
    // ...
  ],
};
```

The regex matches the resolved path `…/ui/registry.js` inside
`packages/web-agent-lit`. Webpack substitutes your `acme-registry.ts` instead.
The rest of the binding imports `defineUiElements` by several relative
specifiers (`"./registry.js"`, `"../ui/registry.js"`, `"../../ui/registry.js"`),
so the match has to be a regex on the resolved path — a bare `'./registry'`
`resolve.alias` key does not match any of them. No import paths, type casts, or
conditionals change.

**Important:** the alias target must be a TypeScript/JS file that exports a
`defineUiElements()` function registering a tag list under the same nine
`wa-*` names the default set uses. The cat-store `acme-registry.ts` ends with:

```ts
export function defineUiElements(): void {
  for (const [tag, cls] of ACME_ELEMENTS) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }
}
```

`ACME_ELEMENTS` (`apps/cat-store/src/acme-elements.ts`) is the cat-store
equivalent of `DEFAULT_ELEMENTS` — the same nine tags, mapped to the
Material-backed classes above.

---

## 4. Mounting the agent panel

File: `apps/cat-store/src/web/index.ts` (the mount block is lines 34-93;
lines 1-22 are the import list). The snippet below is simplified. The real mount
hosts the bubble in a wrapper element and sets its properties through
`configureAgentPanel()` (`apps/cat-store/src/web/agent-panel-config.ts:360`).

The programmatic mount is identical whether you use the default element set
or a swapped Lit 3 one — the swap is invisible at this level.

```ts
import { genuiRenderers } from "@cuatoi/web-agent-lit";
import "@cuatoi/web-agent-lit";  // registers <web-agent-bubble> / <agent-chat-panel>

const agentUi = document.querySelector("[data-agent-ui]");
if (agentUi) {
  agentUi.innerHTML = "";
  const panel = document.createElement("web-agent-bubble") as any;

  // Redux store (from @reduxjs/toolkit)
  panel.store = store;

  // App context (fed to the LLM as system prompt context)
  panel.appContext = {
    appName: "Cat Store",
    appDescription: "A pet store selling organic cat food products.",
  };

  // Backend
  panel.path = "/api/anthropic";
  panel.model = "m";                          // model id, required
  panel.type = "anthropic";                   // "mock" when a mock script is set

  // UI block renderers (generative UI: forms, buttons, etc.)
  panel.renderers = [...genuiRenderers, ...chartingRenderers];

  // Data sources for the query_data tool
  panel.sources = getCatSources(() => store.getState());

  // Notification bridge → toast
  panel.notify = (msg: string) => store.dispatch(setToast(msg));

  agentUi.appendChild(panel);
}
```

The host element `<div data-agent-ui></div>` lives in the HTML template
at `apps/cat-store/src/web/index.html`.

---

## 5. Common problems

### 5a. `disabled` + click event race

Material Web's `<md-filled-button>` sets a `disabled` property, which
prevents the native click from firing. Guard the click handler with the
element's own disabled state anyway, in case a click reaches it before
Material has processed the property write:

```ts
btn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (this._disabled) { e.preventDefault(); return; }
  this.fire("press");
});
```

### 5b. Menu anchor `setTimeout` fallback

Material's `<md-menu>` expects `anchorElement` to be a resolved DOM
reference. If `document.getElementById(anchorId)` returns `null` when the
menu is created (the anchor element has not been appended yet, or it is inside
a shadow root), use a `setTimeout(…, 0)` retry that searches the menu's own
root node:

```ts
const anchor = document.getElementById(anchorId);
if (anchor) {
  menuEl.anchorElement = anchor;
} else {
  setTimeout(() => {
    const root = menuEl.getRootNode() as Document | ShadowRoot;
    const lazyAnchor = root.getElementById?.(anchorId) ?? null;
    if (lazyAnchor) menuEl.anchorElement = lazyAnchor;
  }, 0);
}
```

This covers the case where the menu role fires before the composer area
has been fully attached to the DOM.

### 5c. Icon SVGs — full set required

The default set (`src/ui/icon-svgs.ts`) ships the full icon list the chat UI
uses. It passes these names to `<wa-icon-button>`/`<wa-icon>`
(`chat-panel.ts`, `chat-panel-composer.ts`, `chat-panel-history.ts`,
`chat-panel-screens.ts`, `web-agent-vfs/src/lit/files-screen.ts`):

`add_comment`, `arrow_back`, `arrow_downward`, `arrow_upward`, `check`,
`close`, `delete`, `download`, `edit`, `expand_more`, `chevron_right`,
`folder`, `folder_open`, `history`, `lock`, `more_vert`, `send`, `stop`

It also passes each attachment provider's own `icon`
(`src/chat-ui/chat-panel-elements.ts`). The built-in image provider uses
`attach_file` (`web-agent-core/src/attachments/image-provider.ts:125`), and
the page picker from `@cuatoi/web-agent-dom` uses `ads_click`
(`web-agent-dom/src/picker-provider.ts:251`) — the same glyph
`@cuatoi/web-agent-browser`'s page-agent icon draws via `iconNode()`
directly. Cover those two as well.

If your icon set misses a requested name, `<wa-icon-button>`/`<wa-icon>` fall
back to the raw name in a text element and the click handler still fires
`press`. It is ugly, not broken.

### 5d. `checked` on `<wa-checkbox>`

`<wa-checkbox>` exposes `checked` as a real property on the host element — the
chat UI reads and writes `.checked` on the tag itself, never on an inner
Material node. Keep that property on the wrapper, not only on the inner
`<md-checkbox>`.

### 5e. `@material/web` side-effect imports must be included

Each Material component must be registered as a custom element *before* your
element classes try to create it. The side-effect imports at the top of
`acme-registry.ts` handle this. Omitting one produces a runtime error
(`"md-filled-button" is not a valid custom element`).

---

## Summary

| Step | File | What |
|------|------|------|
| 1 | `acme-elements.ts`, `acme-fields.ts` | Implement all nine `<wa-*>` tags with `@material/web` elements |
| 2 | `acme-registry.ts` | Export `defineUiElements()` registering `ACME_ELEMENTS` |
| 3 | `webpack.config.js` | Add `NormalModuleReplacementPlugin` for `ui/registry.js` |
| 4 | `index.ts` (or your mount point) | `document.createElement("agent-chat-panel")` — unchanged |
| 5 | HTML template | `<div data-agent-ui></div>` — unchanged |

No binding package modifications needed. The swap is purely a build-time
Webpack alias + a standalone element-set file.
