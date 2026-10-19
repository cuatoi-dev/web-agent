---
title: Porting the binding to acme-* components
---

# Porting the binding to acme-* components

This page is a complete guide to rebuilding an equivalent of this package's UI
binding on an internal component set whose elements are prefixed `acme-*`.
It is written for an agent with no prior context on this package.

Before you read further, decide which route you need:

- **Extend** — keep `@cuatoi/web-agent-lit` as a dependency and replace one
  module (`ui/registry.js`) at build time. That is a fraction of the work and
  is the right choice for most hosts. See
  [extending-with-acme-components.md](./extending-with-acme-components.md).
- **Port** — rebuild the binding from scratch so your host does not depend on
  this package at all. That is this page.

Most readers want the other page. This page is for the from-scratch case: your
host cannot or will not take `@cuatoi/web-agent-lit` as a dependency, and
needs an equivalent package of its own.

---

## 1. What the binding is

`@cuatoi/web-agent-core` is framework-agnostic: it implements the agent
loop — tools, skills, session storage — and renders nothing. The UI is supplied
by a *binding* package, of which `@cuatoi/web-agent-lit` is the **sample**:
it contributes the chat panel, the message view, the embeddable bubble, the
UI-block renderers, and the `<wa-*>` tag contract that maps UI primitives onto
a component set.

The dependency arrow points **into** core and never back out: the binding
depends on core (`@cuatoi/web-agent-core` is a dependency of
`@cuatoi/web-agent-lit`), and core does not know that a binding exists. A
`acme-*` port must preserve that direction — it depends on core, core does
not depend on it.

What the binding actually owns, from this package's `src/`:

| Area | Files |
|---|---|
| Chat UI | `src/chat-ui/chat-panel.ts` and the `src/chat-ui/chat-panel-*.ts` files it is built from, `src/chat-ui/message-view.ts`, `src/chat-ui/slash-menu.ts`, `src/chat-ui/context-gauge.ts`, `src/chat-ui/schedule-clock.ts`, `src/chat-ui/todo-indicator.ts`, `src/chat-ui/confirm-scrim.ts` |
| Embeddable bubble | `src/embed/web-agent-embed.ts`, `src/embed/bubble-shadow-template.ts` |
| UI-block renderers | `src/ui-blocks/renderer/*.ts` |
| UI primitives seam | `src/ui/registry.ts`, `src/ui/wa-elements.ts`, `src/ui/wa-element-base.ts`, `src/ui/wa-text-fields.ts`, `src/ui/wa-menu.ts`, `src/ui/types.ts` |
| Template seam | `src/ui/template.ts` |
| Base component | `src/ui/component.ts` |

A `acme-*` port reimplements the last four rows in its own package and
consumes core directly.

---

## 2. The `<wa-*>` tag contract in full

The seam is nine plain custom element tags. The chat UI renders them directly
in its lit-html templates and never imports a vendor widget (`md-*` or
similar) by name. Each tag is a light-DOM wrapper: it builds its real node once
in `connectedCallback()` and keeps that same node across every re-render, so
typing in a `<wa-text-area>` or an open `<wa-menu>` survives the surrounding
template re-rendering for an unrelated reason.

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

A registry — the class each tag resolves to — is a `WaElementEntry[]`: a
`[tag, class]` pair per tag (`src/ui/types.ts`). `defineUiElements()`
(`src/ui/registry.ts`) registers a registry's tag list with
`customElements.define()`, guarded so it is safe to call more than once.

### 2.1 `WaElement` — the base every tag class extends

```ts
export abstract class WaElement extends HTMLElement {
  protected _inner: HTMLElement | null = null;
  connectedCallback(): void {
    if (!this._inner) { this._inner = this.build(); this.append(this._inner); }
    this.sync();
  }
  protected abstract build(): HTMLElement;   // runs once, on first connect
  protected abstract sync(): void;           // runs on every property write
  protected fire(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}
```

(`src/ui/wa-element-base.ts`, verbatim.) `build()` returns the real node —
your `acme-*` element, or several nodes wrapped in a container — appended
once as the tag's only light-DOM child. `sync()` pushes every current property
value onto that node; it runs after `build()` and again on every setter call.
Properties are plain getter/setters that call `sync()` only once `_inner`
exists, so a property set before the element connects is picked up by the
first `sync()` call instead of throwing.

### 2.2 `<wa-button>`

| Property | Type | Meaning |
|---|---|---|
| `label` | `string` | The button's visible text |
| `variant` | `"primary" \| "secondary" \| "danger"` (default `"primary"`) | Visual emphasis |
| `disabled` | `boolean` | If true, clicks must not fire `press` |

Fires `press` on click, unless disabled. The sample's `sync()` sets the inner
`<button>`'s class from `variant` (`primary wa-btn wa-btn-primary` /
`border wa-btn wa-btn-secondary` / `error wa-btn wa-btn-danger`) and the
`disabled` property; the click handler guards `disabled` itself rather than
relying on the native disabled behaviour, because a custom element's inner
node may not be a real form control.

### 2.3 `<wa-icon-button>`

| Property | Type | Meaning |
|---|---|---|
| `icon` | `string` | An icon name from the map below |
| `label` | `string` | Accessible name (`aria-label`) |
| `disabled` | `boolean` | If true, clicks must not fire `press` |

Fires `press` on click. The sample renders an inline SVG for a known icon and
falls back to a text `<i>` holding the raw name for an unknown one — ugly, but
still clickable.

### 2.4 `<wa-icon>`

| Property | Type | Meaning |
|---|---|---|
| `name` | `string` | An icon name |
| `label` | `string` | If set, the icon becomes `role="img"` with that `aria-label`; if empty, it is `aria-hidden` |

No events. A static glyph — used by, for example, the vfs file tree.

### 2.5 `<wa-checkbox>`

| Property | Type | Meaning |
|---|---|---|
| `checked` | `boolean` | Checked state |
| `label` | `string` | Text label |
| `disabled` | `boolean` | Disables the control |

Fires `checked-change` with `detail.checked` on change. The sample wraps a
real `<input type="checkbox">` and a `<span>` label inside a `<label>`, so the
label text also toggles the box.

### 2.6 `<wa-menu>`

| Property | Type | Meaning |
|---|---|---|
| `open` | `boolean` | Whether the menu is shown |
| `items` | `WaMenuItem[]` (`{ id, label, disabled?, icon?, checked? }`) | Menu items, in order |
| `anchor-id` (attribute) | `string` | `id` of the element the menu anchors to |

Fires `select` with `detail.id` when an item is picked, and `request-close`
when the menu asks to close (Escape, outside click). `icon` is optional SVG
markup that the default renderer draws before the label. `checked` is optional
state that a host renderer can show. The default renderer keeps the check mark
in the label text, so an item can carry both fields. A custom menu can keep
rendering labels only. The sample hand-rolls
positioning: fixed placement with viewport-edge flipping (leftward when
overflowing right, upward when overflowing bottom), outside-click and Escape
listeners attached while open, and listener teardown on close
(`src/ui/wa-menu.ts`). A `acme-menu` that owns its own positioning replaces
all of that — but it must still fire `request-close` on Escape and outside
click, and it must still flip at the viewport edges.

### 2.7 `<wa-text-input>`

| Property | Type | Meaning |
|---|---|---|
| `value` | `string` | Current value |
| `placeholder` | `string` | Placeholder text |
| `type` | `string` (`"text"` \| `"number"` \| `"date"`) | Input type |
| `min`, `max` | `string \| number \| undefined` | Forwarded to the inner control; `undefined` removes the constraint |
| `required` | `boolean` | Forwarded to the inner control |
| `name` | `string` | Forwarded to the inner control (so `form.checkValidity()` sees it) |
| `disabled` | `boolean` | Disables the control |

Fires `value-input` with `detail.value` on every input event.

### 2.8 `<wa-text-area>` — the composer

| Property | Type | Meaning |
|---|---|---|
| `value` | `string` | Current value |
| `placeholder` | `string` | Placeholder text |
| `disabled` | `boolean` | Disables the control |
| `resetHeight()` | method | Clears the value and collapses back to one row |

Fires `value-input` with `detail.value` on every input event.

Take extra care with this tag. The chat panel calls
`composerEl.resetHeight()` after every send
(`src/chat-ui/chat-panel-composer.ts`, `querySelector("#input")` on the
`resetHeight`-carrying shape). A port that omits `resetHeight()` breaks the
composer at runtime — nothing fails to compile, because the call site is
typed through a local structural cast, not the tag contract's own type, so
missing the method is a silent regression, not a build error.

The sample's default implementation:
- grows with content, capped at `maxPx = panelHeight * 0.5`; above the cap it
  sets `height = maxPx` and `overflowY = "auto"`, below it `height =
  scrollHeight` and `overflowY = "hidden"` (`src/ui/wa-text-fields.ts`,
  `WaTextArea.adjustHeight()`);
- `resetHeight()` clears `value`, sets `height = "auto"` and `overflowY =
  "hidden"`.

#### Runtime contracts for a custom `<wa-text-area>`

Two runtime contracts govern how the chat panel interacts with the composer
tag, beyond `resetHeight()`:

1. **Slash-command menu caret contract**: `_slashComposerHost()`
   (`src/chat-ui/chat-panel-composer.ts`) looks for a light-DOM
   `<textarea>`/`<input>` inside the `#input` element, then falls back to the
   element's own first child, then to `#input` itself. The panel uses this
   element to attach `aria-activedescendant` during menu navigation and to
   place the caret (`setSelectionRange`) after a command is picked. If your
   tag hides its real input inside shadow DOM, its **first light-DOM child**
   must implement `focus()`/`setSelectionRange()` itself (delegating
   internally to the shadow input) — the same shape Material Web's
   `md-outlined-text-field` uses, and the same fallback the title-edit
   `<wa-text-input>` focus logic relies on
   (`src/chat-ui/chat-panel-screens.ts`, `_handleTitleEditOpen()`).
2. **Keystrokes stay light**: the panel does not re-render the whole template
   on every keystroke, because a re-render would tear down active DOM
   components and charts elsewhere in the transcript. `<wa-text-area>` fires
   `value-input` on every keystroke; the panel's handler updates its own
   `_composerValue` field directly (so a later, unrelated render never
   clobbers what was typed) and calls `requestUpdate()` only when the Stop/
   Send choice or the Send button's enabled state actually changes.

### 2.9 `<wa-progress>`

| Property | Type | Meaning |
|---|---|---|
| `indeterminate` | `boolean` | Indeterminate (no `value`) vs determinate |

No events.

### 2.10 `<wa-working-dots>`

No properties, no events — a static "the agent is working" indicator. The
panel renders it directly in the message stream while a turn is in progress,
and again as the loader at the top of the list while older messages load. Both
call sites are independent element instances (the tag can appear more than
once at a time), so it must not carry state shared across instances.

---

## 3. The default set builds vanilla DOM, styled by `wa-*` classes

The sample's default set (`src/ui/wa-elements.ts`, `src/ui/wa-text-fields.ts`,
`src/ui/wa-menu.ts`) builds **plain DOM** — no custom elements from a vendor
library, no Lit — with Beer CSS class names (`primary`, `circle`,
`transparent`, `flat`, `border`, `error`) plus a `wa-*` stylesheet
(`REGISTRY_STYLES`, `src/ui/registry-styles.ts`). The panel renders that
stylesheet as a `<style>` element inside itself
(`src/chat-ui/chat-panel-elements.ts`), so the rules reach the panel in the
light DOM and inside a host's shadow root; nothing is written to
`document.head`.

Before/after for the three least mechanical tags — sample DOM on the left, a
`acme-*` element on the right:

### 3.1 `<wa-button>`

```ts
// sample WaButton.build()/sync() (src/ui/wa-elements.ts)
protected build(): HTMLElement {
  const b = document.createElement("button");
  b.addEventListener("click", (e) => {
    if (this._disabled) { e.preventDefault(); e.stopPropagation(); return; }
    this.fire("press");
  });
  return b;
}
protected sync(): void {
  const b = this._inner as HTMLButtonElement;
  b.className = this._variant === "secondary" ? "border wa-btn wa-btn-secondary"
    : this._variant === "danger" ? "error wa-btn wa-btn-danger"
    : "primary wa-btn wa-btn-primary";
  b.textContent = this._label;
  b.disabled = this._disabled;
}

// acme-*
export class AcmeButton extends WaElement {
  private _label = ""; private _variant: WaButtonVariant = "primary"; private _disabled = false;
  get label() { return this._label; }
  set label(v: string) { this._label = v; if (this._inner) this.sync(); }
  // ...variant, disabled getters/setters the same shape
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
```

The contract to preserve: `disabled` must suppress `press`. Do not rely on a
custom element's native disabled handling — most vendor custom elements
implement their own, but guard it anyway so a stray event before the property
write settles never reaches your `fire("press")`.

### 3.2 `<wa-icon-button>`

The default set's icon-button `build()`/`sync()` is the same shape as
`<wa-button>`, plus icon drawing:

```ts
// sample (src/ui/wa-elements.ts, WaIconButton)
protected sync(): void {
  const b = this._inner as HTMLElement & { disabled: boolean };
  b.disabled = this._disabled;
  b.setAttribute("aria-label", this._label);
  if (this._drawnIcon !== this._icon) {
    b.replaceChildren(iconNode(this._icon));
    this._drawnIcon = this._icon;   // redraw only when the icon name actually changed
  }
}
```

The 26 icon names the sample ships (`src/ui/icon-svgs.ts`) are: `more_vert`,
`send`, `arrow_upward`, `arrow_downward`, `close`, `check`, `attach_file`,
`chat`, `stop`, `history`, `delete`, `edit`, `add_comment`, `settings`,
`arrow_back`, `bug_report`, `ads_click`, `fiber_manual_record`, `folder`,
`folder_open`, `description`, `image`, `download`, `lock`, `chevron_right`,
`expand_more`. Names the chat UI, the vfs file tree and the attachment
providers actually request: `add_comment`, `arrow_back`, `arrow_downward`,
`arrow_upward`, `check`, `close`, `delete`, `download`, `edit`,
`expand_more`, `chevron_right`, `folder`, `folder_open`, `history`, `lock`,
`more_vert`, `send`, `stop`, plus `attach_file`
(`web-agent-core/src/attachments/image-provider.ts`) and `ads_click`
(`web-agent-dom/src/picker-provider.ts`, and `web-agent-browser`'s
page-agent icon via `iconNode()` directly). A port's icon set must at least
cover those. If your set misses a requested name, `<wa-icon-button>`/`<wa-icon>`
should fall back to the raw name in a text element and keep firing `press` —
ugly, not broken.

### 3.3 `<wa-menu>`

```ts
// sample (src/ui/wa-menu.ts): a <div role="menu"> with inline styles,
// positioned in _position() on open and on scroll/resize. Hand-rolled:
//   - outside-pointerdown and Escape listeners (attached only while open)
//   - viewport-edge flip (leftward when overflowing right, upward when overflowing bottom)
//   - listener teardown in detach()

// acme-*
const menuEl = document.createElement("acme-menu") as HTMLElement & { open: boolean };
menuEl.open = open;
menuEl.setAttribute("anchor", anchorId);
for (const item of items) {
  const mi = document.createElement("acme-menu-item") as HTMLElement & { disabled: boolean };
  mi.textContent = item.label;
  mi.disabled = !!item.disabled;
  if (!item.disabled) mi.addEventListener("click", () => this.fire("select", { id: item.id }));
  menuEl.appendChild(mi);
}
menuEl.addEventListener("closed", () => this.fire("request-close"));
```

A `acme-menu` that owns its own positioning, outside-click handling and
Escape handling replaces the sample's `_position`, `_onKey`, `_onOutside` and
teardown entirely — but it **must still fire `request-close`** (Escape,
outside click, item selection if your design closes on selection) and must
flip at the viewport edges the same way.

---

## 4. The tag contract is the only place vendor elements may appear

The rule that makes a port possible: the `<wa-*>` tags are the **only** place
UI primitives are produced, so they are the only place a vendor component set
may appear. Everything upstream — chat panel, templates, embed element,
UI-block renderers — renders a `<wa-*>` tag and never imports a vendor widget
by name.

The checkable form of the rule, for this package today:

```bash
grep -rn '@material/web' packages/web-agent-lit/src   # nothing — @material/web only appears in apps/cat-store
```

For a `acme-*` port, the equivalent check is:

```bash
grep -rn 'acme-' packages/web-agent-lit/src/chat-ui/  # must find nothing
```

If a `acme-*` element name appears anywhere outside your registry module,
the seam has been violated and the port is no longer swappable.

---

## 5. How the registry is swapped

The swap is a **build-time module replacement**, not a resolve alias. The
working snippet, verbatim from `apps/cat-store/webpack.config.js`:

```js
new webpack.NormalModuleReplacementPlugin(
  /[\\/]ui[\\/]registry\.js$/,
  path.resolve(__dirname, "src/acme-registry.ts")
),
```

The regex matches the *resolved path* `…/ui/registry.js` inside the package.
It has to be a regex on the resolved path rather than a bare alias key because
the package imports `defineUiElements` by several relative specifiers:
`"./registry.js"`, `"../ui/registry.js"`, `"../../ui/registry.js"` (import
sites: `src/index.ts` re-export, `src/chat-ui/chat-panel.ts`,
`src/chat-ui/chat-panel-composer.ts`, `src/chat-ui/chat-panel-history.ts`,
`src/chat-ui/chat-panel-screens.ts`, `src/chat-ui/confirm-scrim.ts`,
`src/ui-blocks/renderer/form-block.ts`,
`src/ui-blocks/renderer/buttons-block.ts`).

Your replacement module must export exactly:

```ts
export function defineUiElements(): void {
  for (const [tag, cls] of YOUR_ELEMENTS) {
    if (!customElements.get(tag)) customElements.define(tag, cls);
  }
}
```

`YOUR_ELEMENTS` is a `WaElementEntry[]` — the same nine `wa-*` tag names the
default set uses, mapped to your classes. `WaElementEntry` is exported from
the package entry, so a replacement can import the type:

```ts
import type { WaElementEntry } from "@cuatoi/web-agent-lit";
```

---

## 6. `lit-html` is a peer dependency

The binding renders templates with `lit-html`, which is a **peer dependency**:
`"^1 || ^2 || ^3"`, `optional: false` (`package.json`). The host must supply
it; without it, module resolution fails at build time. There is no vendored
copy.

Two files define the template layer, and a port either reuses them or
reimplements them:

- **`src/ui/template.ts`** — the seam every UI module imports through. It
  re-exports `html`, `svg`, `render`, `nothing` from `lit-html`, and
  `unsafeHTML` from `lit-html/directives/unsafe-html.js`.
- **`src/ui/component.ts`** — a minimal `Component` base class:
  - `Component` is `abstract`, extends `HTMLElement`; subclasses implement
    `template()`; updates are batched through `requestUpdate()` →
    `queueMicrotask` → `render(t, this)`, with `updated()` called after render
    and an `updateComplete: Promise<boolean>` and `renderRoot` getter (which
    returns `this` — there is no shadow root).
  - There is no style-injection helper. A component that needs CSS renders a
    `<style>` element from its own `template()`, so the rules live in the tree
    the component is mounted in. See `ui-blocks/renderer/form-block.ts`.

---

## 7. Assets are host-owned

The package ships **no** CSS framework and no fonts. Beer CSS and Public Sans
live in the host app's `vendor/` folder:

- `apps/docs-site/vendor/beercss`
- `apps/docs-site/vendor/public-sans`
- `apps/cat-store/vendor/public-sans`

A `acme-*` port ships none either. The host must provide:

1. the `acme-*` component library itself,
2. its stylesheet,
3. its fonts,
4. the `--wa-*` token sheet, if it is not already loaded.

All default-set colours resolve from tokens: `--wa-border-color`,
`--wa-action-color-info`, `--wa-action-text-color-info`,
`--wa-action-color-error`, `--wa-action-text-color-error`,
`--wa-action-color-info-10opc`, `--wa-input-background-color`,
`--wa-input-placeholder-color`, `--wa-background-color-500`,
`--wa-text-color` and the `--wa-dropdown-*` family — used in
`src/ui/registry-styles.ts` (`REGISTRY_STYLES`) and set inline in
`src/ui/wa-menu.ts`.

One token that belongs to the sheet but is **not** consumed by the default
set is `--wa-text-color-disabled` — it is defined in
`src/themes/TOKENS.md` and used by the charting package's empty-state text
(`web-agent-charting/src/lit/chart-block-styles.ts`). cat-store's Acme set
does **not** use it either: its working-dots paint from `--wa-text-color`,
because `--wa-text-color-disabled` measures 2.26:1 against the surface in
`wa2-light` and fails WCAG AA (`apps/cat-store/src/acme-elements.ts`).

---

## 8. How to prove the port is correct

The package's own conformance suite, `src/ui/wa-elements.test.ts`, asserts the
default set's behaviour **and** its exact DOM shape. A `acme-*` port
**cannot run this file unchanged** — it asserts
tag names (`BUTTON`, `LABEL`, `DIV`), Beer CSS classes (`primary`, `border`,
`error`, `circle`, `transparent`), `wa-*` classes, and the exact token list.
Split the assertions in two when adapting them, the same way
`apps/cat-store/src/acme-elements.test.ts` does against the Acme set:

**Behavioural — any port must satisfy these:**

| Tag | What is asserted |
|---|---|
| `<wa-button>` | `label` becomes visible text; a click fires `press` exactly once; `disabled: true` suppresses it |
| `<wa-button>` | `variant` → visual mapping exists (your classes will differ, the mapping must not) |
| `<wa-icon-button>` | a known icon renders an icon (not text); `aria-label` is the label; a click fires `press` once; `disabled: true` suppresses it |
| `<wa-text-input>` | the inner control reflects `value`/`placeholder`/`type`/`min`/`max`/`required`/`name`; an input event fires `value-input` with the new value |
| `<wa-checkbox>` | the inner control reflects `checked`; a change fires `checked-change` with the new state |
| `<wa-menu>` | shown when `open`; one item per entry; disabled items do **not** fire `select`; enabled items do; Escape and an outside click fire `request-close` |
| `<wa-progress>` | indeterminate → no determinate value shown; determinate → a value is shown |
| `<wa-text-area>` | an input event fires `value-input`; growth caps at 50% of the containing panel height, then scrolls internally; a 10,000+ character paste is stored whole; `resetHeight()` clears the value and collapses to one row |
| `<wa-working-dots>` | present when defined; renders some visible indicator |
| styles | your stylesheet references the `--wa-*` tokens (your token names may differ; the "no literal colours" rule must not) |

**Implementation-specific — a port must rewrite these:**

- `tagName` values (`BUTTON`, `LABEL`, `DIV`, `INPUT`, `PROGRESS`)
- `className` values (`primary`, `border`, `error`, `circle`, `transparent`,
  `wa-btn`, `wa-icon-btn`, `wa-checkbox-label`)
- the exact `--wa-*` token list
- the `styles` export's `container-type` / `@container` assertions

---

## 9. Checklist

A `acme-*` binding, in order:

1. **Scaffold the package** — `@your-org/web-agent-acme` or similar, with
   `@cuatoi/web-agent-core` as a dependency.
2. **Declare the `lit-html` peer dependency** — `"^1 || ^2 || ^3"`, not
   optional (`package.json` `peerDependencies` + `peerDependenciesMeta`).
3. **Copy or reimplement `ui/template.ts` and `ui/component.ts`** — the
   template seam and the `Component` base.
4. **Implement `WaElement` (or your own equivalent base) and the nine tags**,
   in this order: `wa-button`, `wa-icon-button`, `wa-icon`, `wa-checkbox`,
   `wa-menu`, `wa-progress`, `wa-working-dots`, `wa-text-input`,
   `wa-text-area`.
5. **After each tag, run that tag's adapted test** (the behavioural set from
   §8, against your element).
6. **Wire the build-time alias** — the `NormalModuleReplacementPlugin` entry
   from §5, pointing at your registry module.
7. **Run `pnpm build` and `pnpm test`** — the full package suite must pass.
8. **Mount the panel in a host page** and check the composer: it grows as you
   type, caps at half the panel height, and collapses via `resetHeight()`
   after send.

---

## See also

- [extending-with-acme-components.md](./extending-with-acme-components.md) —
  the cheaper route: keep this package, alias only `ui/registry.js`.
- [lit3-registry.md](./lit3-registry.md) — the same seam against Material Web
  components, as a worked reference.
