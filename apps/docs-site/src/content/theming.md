---
title: Theming & Styling
---

# Theming & Styling

The agent panel can be styled at three levels, each with increasing control:

1. **web-agent design tokens** (`--wa-*`) — quick colour and spacing tweaks
2. **Beer CSS overrides** — full theme via vendored Beer CSS classes
3. **Custom UI registry** — replace every UI primitive with your own components

## Level 1: web-agent design tokens

The agent UI consumes `--wa-*` design tokens, selected via a `data-theme`
attribute on the root element (`<html>` or `:root`) or on any subtree container
for scoped theming.

Import the token stylesheet:

```ts
import "@cuatoi/web-agent-lit/themes/wa-tokens.css";
```

Supported theme attribute values:

- `wa1-dark` — WA v1 Dark theme
- `wa2-dark` — WA v2 Dark theme
- `wa2-light` — WA v2 Light theme
- `provided` — Host-provided theme (host declares custom `--wa-*` tokens;
  missing tokens inherit from an ancestor base theme or component fallbacks)

Subtree & Provided theme example:

```html
<div data-theme="wa2-light">
  <!-- Inherits all 352 base wa2-light tokens, overrides two -->
  <div data-theme="provided" style="--wa-action-color-info: #c2185b; --wa-border-color: #e0e0e0;">
    <agent-chat-panel></agent-chat-panel>
  </div>
</div>
```

> **Vendor component surfaces.** `provided` overrides recolors everything the
> UI styles through `--wa-*`. If you swap the UI registry for a vendor
> system (e.g. Material Web), primitives that paint from their own tokens need
> those too — a Material filled button fills from `--md-filled-button-container-color`,
> so declare it on the same `provided` element to recolor it (see the Cat Store
> gallery demo at `gallery.html?frame=demo-theme-showcase` `provided` card for a worked example).

Override any token by re-declaring it on `:root` or a parent element:

```css
:root {
  --wa-action-color-info: #1a73e8;
}
```

See `packages/web-agent-lit/src/themes/TOKENS.md` for the full reference of all
352 `--wa-*` design tokens.

## Level 2: Beer CSS theming

The default UI uses [Beer CSS](https://www.beercss.com) classes. The library
is vendored at `apps/docs-site/vendor/beercss/` and loaded by the docs site in
`src/engine/index.html`:

```html
<link rel="stylesheet" href="vendor/beercss/beer.min.css" />
<script type="module" src="vendor/beercss/beer.min.js"></script>
```

Beer CSS uses Material 3 design tokens. You can customize the theme by
overriding its CSS variables:

```css
:root {
  --primary: #6750A4;
  --on-primary: #ffffff;
  --secondary: #625B71;
  --surface: #fafdfc;
  --background: #fafdfc;
  --elevate-3: 0 4px 12px rgba(0,0,0,0.15);
}
```

The default element set (`src/ui/wa-elements.ts`) applies Beer CSS classes to
the vanilla DOM node each `<wa-*>` tag builds:

| Role | Default class | Beer CSS pattern |
|------|---------------|------------------|
| Button (primary) | `primary wa-btn wa-btn-primary` | `button class="primary"` |
| Button (secondary) | `border wa-btn wa-btn-secondary` | `button class="border"` |
| Button (danger) | `error wa-btn wa-btn-danger` | `button class="error"` |
| Icon button | `circle transparent wa-icon-btn` | `button class="circle transparent"` |
| Checkbox label | `checkbox wa-checkbox-label` | `label class="checkbox"` |
| Progress | `primary wa-progress` | `progress class="primary"` |

The package ships rules for these classes and the panel renders them inside
itself, so they provide vanilla CSS fallbacks when Beer CSS is not loaded — in
the light DOM and inside a shadow root alike.

## Level 3: Custom UI elements

For complete control, implement the nine `<wa-*>` tags (`<wa-button>`,
`<wa-icon-button>`, `<wa-icon>`, `<wa-checkbox>`, `<wa-menu>`,
`<wa-text-input>`, `<wa-text-area>`, `<wa-progress>`, `<wa-working-dots>`) and
swap them in via Webpack. This replaces every button, input, checkbox, menu,
and progress element with your own components — the chat UI renders these
tags directly in its templates and never imports a vendor widget itself.

### Implementing the tags

```ts
// apps/cat-store/src/acme-elements.ts (excerpt)
import { AcmeElement } from "./acme-element-base";

export class AcmeButton extends AcmeElement {
  private _label = ""; private _variant: WaButtonVariant = "primary"; private _disabled = false;
  protected build(): HTMLElement {
    const btn = document.createElement(this._variant === "secondary" ? "md-outlined-button" : "md-filled-button");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._disabled) { e.preventDefault(); return; }
      this.fire("press");
    });
    return btn;
  }
  protected sync(): void {
    // pushes label/disabled/danger colours onto the inner Material node
  }
}

export class AcmeTextInput extends AcmeElement {
  protected build(): HTMLElement {
    const field = document.createElement("md-outlined-text-field");
    field.addEventListener("input", () => this.fire("value-input", { value: field.value }));
    return field;
  }
  protected sync(): void {
    // pushes value/placeholder/disabled onto the field
  }
}

export const ACME_ELEMENTS = [
  ["wa-button", AcmeButton], ["wa-text-input", AcmeTextInput],
  // wa-icon-button, wa-checkbox, wa-menu, wa-text-area, wa-progress,
  // wa-working-dots, wa-icon — see the full files
];
```

`build()` runs once, the first time the tag connects, and returns the real
node; `sync()` runs on every property write. Each class fires a plain
`CustomEvent` (`press`, `value-input`, `checked-change`, `select`,
`request-close`) instead of taking a callback, so the chat UI's lit-html
templates bind to it with `@event=${…}` like any other DOM event.

The full cat-store element set is at `apps/cat-store/src/acme-elements.ts`
and `apps/cat-store/src/acme-fields.ts` — it translates the tag contract to
Material Web 3's API.

### Webpack alias

```js
// apps/cat-store/webpack.config.js
new webpack.NormalModuleReplacementPlugin(
  /[\\/]ui[\\/]registry\.js$/,
  path.resolve(__dirname, "src/acme-registry.ts")
),
```

The regex matches the resolved path inside the core package's source.
`acme-registry.ts` exports a `defineUiElements()` function that registers
`ACME_ELEMENTS` with `customElements.define()`; the default `registry.ts`
(a few lines, calling `customElements.define()` on `DEFAULT_ELEMENTS`) is
excluded from the build entirely.

### What this means

- The default Beer CSS bundle is **not a runtime dependency** — when aliased,
  it is tree-shaken away
- Your element set side-effect-imports only the components you need
- The panel layout (flex, scroll regions, container queries) stays the same
  since it lives in `src/ui/styles.ts` which is not aliased

## Layout without Beer CSS

If you swap the registry and do not load Beer CSS, the panel still works. The
layout CSS in `src/ui/styles.ts` provides vanilla styles:

- `.wa-panel-root` — container query, flex column
- `.wa-composer` — flex wrap input + buttons
- `.wa-scroll-region` — scrollable message area
- Responsive breakpoint at 400px via `@container`

These use `--wa-*` tokens, so set them in your theme to get proper spacing —
e.g. `--wa-padding-xs/s/m/l/xl` for padding and gap values.

## Best practices

1. **Start with `--wa-*` overrides** — often sufficient for colour/branding;
   select a base theme via `data-theme` and override individual tokens on `:root`
   (see [Level 1](#level-1-web-agent-design-tokens))
2. **If you need custom form controls**, implement the `<wa-*>` tags — write
   one class per role
3. **Keep the panel layout CSS** — do not alias `styles.ts`; the container
   query and flex layout are framework-agnostic
4. **Load Beer CSS for development** — the default element set expects Beer
   CSS classes; without it, the package's own `wa-*` rules provide a basic
   appearance
