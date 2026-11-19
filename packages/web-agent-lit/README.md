# @cuatoi/web-agent-lit

The sample Lit binding for the web-agent in-app browser agent: chat panel,
embeddable bubble, UI-block renderers and the `<wa-*>` tag contract. The agent
loop lives in `@cuatoi/web-agent-core`.

## Install

```bash
pnpm add @cuatoi/web-agent-lit lit-html
# or
npm install @cuatoi/web-agent-lit lit-html
```

`lit-html` is a required peer dependency (`^1 || ^2 || ^3`) supplied by the host
application, so the agent UI binds to whichever major the host already ships.

## Usage

```ts
import "@cuatoi/web-agent-lit/themes/wa-tokens.css";
import "@cuatoi/web-agent-lit";              // registers <agent-chat-panel>
import { genuiRenderers } from "@cuatoi/web-agent-lit";

const panel = document.createElement("agent-chat-panel");
panel.store = myStore;                           // any object with getState(), e.g. a Redux store
panel.appContext = { appName: "My App", appDescription: "…" };
panel.path = "/api/openai/v1";
panel.type = "openai";                           // "openai" | "anthropic" | "gemini" | "mock"
panel.model = "your-model-id";                   // required — there is no default
panel.renderers = genuiRenderers;
document.querySelector("[data-agent-ui]").appendChild(panel);
```

## Entry points

| Import | Contents |
| --- | --- |
| `@cuatoi/web-agent-lit` | chat panel and public API |
| `@cuatoi/web-agent-lit/themes/*` | design tokens CSS (`themes/wa-tokens.css`) |
| `@cuatoi/web-agent-lit/themes` | theme registry: `registerTheme`, `applyTheme`, `listThemes`, `getTheme`, `defaultTheme` |
| `@cuatoi/web-agent-lit/embed/*` | drop-in embeddable widget, e.g. `embed/web-agent-embed` |
| `@cuatoi/web-agent-lit/chat-ui/*` | individual chat UI components |
| `@cuatoi/web-agent-lit/ui/*` | the UI registry seam (`ui/registry`, `ui/types`) |
| `@cuatoi/web-agent-lit/ui-blocks/*` | UI-block renderers |

```ts
import "@cuatoi/web-agent-lit/embed/web-agent-embed";
```

## Theming

Import the tokens stylesheet and set `data-theme` on the root `<html>`
element (`wa1-dark`, `wa2-dark`, `wa2-light`). See the docs-site theming
page for the full list of overridable tokens.

To add your own theme, see "Add a theme" in `src/themes/TOKENS.md`. The
package ships a checker for theme files, `bin/web-agent-theme-check.mjs`
(command name `web-agent-theme-check`).

## UI registry

UI primitives (**`<wa-button>`, `<wa-icon-button>`, `<wa-icon>`,
`<wa-checkbox>`, `<wa-menu>`, `<wa-text-input>`, `<wa-text-area>`,
`<wa-progress>`, and `<wa-working-dots>`**) render through the registry seam in
`ui/registry` and `ui/types` rather than importing vendor widgets directly, so a host
can swap in its own component library via a build-time alias. The default
implementation is `ui/registry.ts`, which builds plain DOM with Beer CSS class
names. Its `wa-*` stylesheet lives in `ui/registry-styles.ts` and the panel
renders it inside itself. Every other stylesheet in the package works the same
way — each element renders its own `<style>` — so the package writes nothing to
`document.head` at all.

## Documentation

Full guides live in [`docs/`](./docs/README.md) — the registry seam, the
lit-html binding, embedding, the custom header and panel API, the
[built-in chat panel features](./docs/chat-panel-features.md), and two routes
for adopting an internal component set.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
