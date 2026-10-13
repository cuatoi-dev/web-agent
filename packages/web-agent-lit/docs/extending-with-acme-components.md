---
title: Extending with acme-* components
---

# Extending with acme-* components

This page is the **cheaper route** for adopting an internal component set
prefixed `acme-*`: keep `@cuatoi/web-agent-lit` as a normal dependency
and replace exactly one module at build time. For a from-scratch rebuild, see
[porting-to-acme-components.md](./porting-to-acme-components.md).

## 1. Which route to pick

| | Extend (this page) | Port (the other page) |
|---|---|---|
| Dependency on `@cuatoi/web-agent-lit` | Kept — installed from npm or your registry | Dropped |
| What you write | One module: your `defineUiElements()` | A whole binding package |
| Reused unchanged | Chat UI, templates, embed element, UI-block renderers | Nothing — rebuilt |
| Risk | Low — one seam replaced | High — everything reimplemented |
| Best when | The package installs cleanly on your target | The package cannot be a dependency at all |

Recommendation: use this route unless you cannot depend on the package at all.

## 2. What you replace

Exactly one module: **`ui/registry.js`**. Your replacement exports a
`defineUiElements()` function that registers the same nine `<wa-*>` tags
(`wa-button`, `wa-icon-button`, `wa-icon`, `wa-checkbox`, `wa-menu`,
`wa-text-input`, `wa-text-area`, `wa-progress`, `wa-working-dots`) with
`customElements.define()`, each mapped to a class you write. The chat UI,
templates, embed element, UI-block renderers and everything else come from the
published package, unchanged — they only ever render `<wa-*>` tags, never a
vendor element by name.

## 3. How the swap happens

A build-time module replacement in your Webpack config, adapted from
`apps/cat-store/webpack.config.js` (cat-store points it at
`src/acme-registry.ts`):

```js
new webpack.NormalModuleReplacementPlugin(
  /[\\/]ui[\\/]registry\.js$/,
  path.resolve(__dirname, "src/acme-registry.ts")
),
```

The regex matches the *resolved path* `…/ui/registry.js` inside the package. It
must be a regex rather than a bare `resolve.alias` key because the package
imports `defineUiElements` by several relative specifiers — `"./registry.js"`,
`"../ui/registry.js"`, `"../../ui/registry.js"` — none of which a
`'./registry'` alias key matches. Your replacement must export:

```ts
export function defineUiElements(): void {
  for (const [tag, cls] of ACME_ELEMENTS) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }
}
```

## 4. There is no runtime override

There is **no** `setRegistry()`, no config option, no dependency injection.
`defineUiElements` is a function exported from `src/ui/registry.ts`, and eight
modules inside the package import it directly:

- `src/index.ts` (re-export from the package entry)
- `src/chat-ui/chat-panel.ts`
- `src/chat-ui/chat-panel-composer.ts`
- `src/chat-ui/chat-panel-history.ts`
- `src/chat-ui/chat-panel-screens.ts`
- `src/chat-ui/confirm-scrim.ts`
- `src/ui-blocks/renderer/form-block.ts`
- `src/ui-blocks/renderer/buttons-block.ts`

Because those imports are static, nothing can swap the tag classes at runtime
after the module graph has loaded. The **build-time alias is the supported
mechanism**. No runtime API exists.

## 5. What your module must export

A `defineUiElements()` function that registers **all nine** tags against your
own classes — your replacement module owns the whole tag list, not just the
tags you want to change. The full contract — every tag's properties, events
and DOM shape — is spelled out tag by tag in the
[porting guide](./porting-to-acme-components.md#2-the-wa--tag-contract-in-full).
Two rules carry over verbatim:

- every tag class follows the shape `WaElement` defines — `build()` runs once
  and returns the real node, `sync()` runs on every property write — but the
  package exports only `WaElementEntry` (the `[tag, class]` pair type) and
  `iconNode()` (the default icon set) from its entry today, not the `WaElement`
  base or the default tag classes themselves. Your classes extend
  `HTMLElement` directly; the shape is a convention to follow, not a base
  class you can currently import.
- `<wa-text-area>` needs one thing beyond the others: its class must also
  expose `resetHeight()`, because the chat panel calls it after every send
  (`src/chat-ui/chat-panel-composer.ts`).

## 6. A minimal worked example

Replace `<wa-button>` and `<wa-icon-button>` with `acme-*` elements. Because
the default tag classes are not exported, the other seven tags need their own
plain-DOM implementation too — copy the small `build()`/`sync()` bodies from
`src/ui/wa-elements.ts`, `src/ui/wa-text-fields.ts` and `src/ui/wa-menu.ts`
into your module (each is 10-30 lines) and leave their look and behaviour
unchanged, or restyle them at the same time if you prefer:

```ts
// src/acme-registry.ts
import type { WaButtonVariant, WaElementEntry } from "@cuatoi/web-agent-lit";

abstract class WaElement extends HTMLElement {
  protected _inner: HTMLElement | null = null;
  connectedCallback(): void {
    if (!this._inner) { this._inner = this.build(); this.append(this._inner); }
    this.sync();
  }
  protected abstract build(): HTMLElement;
  protected abstract sync(): void;
  protected fire(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

class AcmeButton extends WaElement {
  private _label = ""; private _variant: WaButtonVariant = "primary"; private _disabled = false;
  get label() { return this._label; }
  set label(v: string) { this._label = v; if (this._inner) this.sync(); }
  get variant() { return this._variant; }
  set variant(v: WaButtonVariant) { this._variant = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const b = document.createElement("acme-button") as HTMLElement & { disabled: boolean };
    b.addEventListener("press", () => { if (!b.disabled) this.fire("press"); });
    return b;
  }
  protected sync(): void {
    const b = this._inner as HTMLElement & { label: string; variant: string; disabled: boolean };
    b.label = this._label; b.variant = this._variant; b.disabled = this._disabled;
  }
}

class AcmeIconButton extends WaElement {
  private _icon = ""; private _label = ""; private _disabled = false;
  get icon() { return this._icon; }
  set icon(v: string) { this._icon = v; if (this._inner) this.sync(); }
  get label() { return this._label; }
  set label(v: string) { this._label = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const b = document.createElement("acme-icon-button") as HTMLElement & { disabled: boolean };
    b.addEventListener("press", () => { if (!b.disabled) this.fire("press"); });
    return b;
  }
  protected sync(): void {
    const b = this._inner as HTMLElement & { icon: string; label: string; disabled: boolean };
    b.icon = this._icon; b.label = this._label; b.disabled = this._disabled;
  }
}

// WaIcon, WaCheckbox, WaMenu, WaTextInput, WaTextArea, WaProgress and
// WaWorkingDots go here too — copied from src/ui/wa-elements.ts,
// src/ui/wa-text-fields.ts and src/ui/wa-menu.ts, unchanged or restyled.

const ACME_ELEMENTS: readonly WaElementEntry[] = [
  ["wa-button", AcmeButton],
  ["wa-icon-button", AcmeIconButton],
  ["wa-icon", WaIcon],
  ["wa-checkbox", WaCheckbox],
  ["wa-menu", WaMenu],
  ["wa-text-input", WaTextInput],
  ["wa-text-area", WaTextArea],
  ["wa-progress", WaProgress],
  ["wa-working-dots", WaWorkingDots],
];

export function defineUiElements(): void {
  for (const [tag, cls] of ACME_ELEMENTS) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }
}
```

**One caveat:** the alias replaces the module the *package's own* modules
see — the `chat-panel*.ts` files, `confirm-scrim.ts`, `form-block.ts` and
`buttons-block.ts` import `defineUiElements` from `../ui/registry.js` (or a
relative equivalent), and that import resolves to your file. Any type you do
import from the package (`WaElementEntry`, `WaButtonVariant`, `iconNode`) must
come from the package entry (`@cuatoi/web-agent-lit`), **never** from the
aliased `./registry.js` path — importing the aliased path from inside your
replacement would self-reference.

## 7. What you still own

- `lit-html` — a peer dependency (`"^1 || ^2 || ^3"`, `optional: false`). The
  host supplies it; without it the build fails to resolve module imports. No
  vendored copy ships in the package.
- Any CSS and fonts. The package ships **no** CSS framework and no fonts — Beer
  CSS and Public Sans are host-app assets (`apps/docs-site/vendor/beercss`,
  `apps/docs-site/vendor/public-sans`, `apps/cat-store/vendor/public-sans`).

## 8. How to verify

Adapt `src/ui/wa-elements.test.ts` against your tag classes — with the same
split as the porting guide describes:

- **behavioural** assertions any tag set must satisfy (`press`/`value-input`/
  `checked-change`/`select`/`request-close` events fire, `disabled` suppresses
  a click, `.value`/`.checked` reflect both ways, `resetHeight()` collapses
  the composer, growth caps at half the panel height);
- **implementation-specific** assertions you must rewrite (`tagName`,
  `className`, the exact token list).

Then check the running app:

- the composer grows as you type and caps at half the panel height;
- `resetHeight()` collapses it after send;
- the kebab menu opens and closes on Escape and on outside click;
- a disabled button does not fire `press`.

## 9. Links

- [porting-to-acme-components.md](./porting-to-acme-components.md) — the
  full contract, tag by tag, plus the from-scratch route.
- [lit3-registry.md](./lit3-registry.md) — the same seam against Material Web
  components.
