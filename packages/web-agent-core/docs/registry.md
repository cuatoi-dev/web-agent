---
title: UI element seam concept
---

# UI element seam (ADR 001)

The chat UI renders its primitives — buttons, inputs, menus, progress —
as **`<wa-*>` custom element tags** in its lit-html templates, so a host can
swap the classes those tags resolve to for its own components at build time.
**The seam does not live in core.** Core renders nothing; the tag contract is
owned by the framework binding, and the sample Lit binding defines it at
`packages/web-agent-lit/src/ui/types.ts` and `wa-elements.ts`.

For the tag contract itself — all nine roles, their properties and events, and
a worked `@material/web` implementation — see
[Lit 3 support & the UI element seam](../../web-agent-lit/docs/lit3-registry.md).

## Why the seam exists

When you deploy Web Agent into an enterprise environment, the host application
may use its own custom elements, such as Lit-based `<acme-button>` and
`<acme-text-field>`. Those libraries are not available during development, so
the agent cannot import them.

The framework binding uses a **build-time Webpack alias** to replace the
default element classes with the host's own. The agent's component logic —
its lit-html templates — does not change; only which class each `<wa-*>` tag
resolves to changes.

## Key principles

1. **Vanilla DOM, no Lit dependency in the elements themselves**: each `<wa-*>` class builds a standard DOM node (`HTMLElement`) once, in `connectedCallback()`, and updates it in place on every property write.
2. **Semantic properties and plain DOM events**: elements expose semantic properties (`label`, `variant`, `disabled`) and fire plain `CustomEvent`s (`press`, `value-input`, `checked-change`) rather than taking framework-specific callbacks. The chat UI's lit-html templates bind to these with `.property=` and `@event=` like any other DOM element.
3. **No direct widget imports**: component logic never imports `<md-*>` or `<acme-*>` directly. It renders `<wa-*>` tags and lets the currently registered classes handle instantiation.
4. **Build-time swapping**: Webpack aliases `./registry` to `acme-registry.ts` during the packaging process in the host repo, within the framework binding. The alias target exports `defineUiElements()`, which registers the host's classes under the same `wa-*` tag names.

## Styling & theme contract

- The default implementation uses **Beer CSS** classes (e.g. `wa-btn`, `wa-input`) and consumes the `--wa-*` design tokens for theming.
- The host styling is aligned via token mappings such as:
  ```css
  background-color: var(--internal-primary, var(--wa-action-color-info, #1a73e8));
  ```
