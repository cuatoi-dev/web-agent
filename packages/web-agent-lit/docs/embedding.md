---
title: Embedding & integration
---

# Embedding & integration

There are two ways to embed the agent: the **floating bubble** (pre-bundled
`<web-agent-bubble>`) or **programmatic `<agent-chat-panel>`** mount. Both
work unchanged inside your own shadow root. For the shadow-root case, see
"Hosting the agent inside your own shadow root" later in this page. The
snippets below are minimal examples drawn loosely from the two reference apps
(cat-store and docs-site); the full cat-store mount is ~150 lines and is not
inlined here.

## If the agent renders unstyled inside your own element

You put the agent inside your own component. Your `--wa-*` tokens are
loaded. The agent renders with no styling at all — not miscolored, but
unstyled. It looks like a theming problem. It is not.

The cause is how CSS crosses a shadow boundary. Custom properties are
inherited properties, so they cross the boundary and reach the component.
CSS rules are tree-scoped, so a rule in `document.head` never applies inside
a shadow root. The values arrive, and nothing applies them.

This table is a measurement taken in the browser on 2026-08-11. It describes
the code as it was **before** this behaviour was fixed. The second row no
longer reproduces, because the rule it names now ships inside the overlay's
own subtree (`packages/web-agent-dom/src/picker-provider.ts:45, 113`).

| Probe | Light DOM | Inside a shadow root |
|---|---|---|
| `--wa-action-color-info` resolved | `hsl(257deg 100% 66%)` | `rgb(131, 82, 255)` — crossed |
| `.wa-dom-picker-strip` rule from `document.head` | `display: flex` | `display: block` — never applied |

What this means for you now: the package writes nothing to `document.head`
any more. Every component renders its own rules into the tree it is placed
in. There is no exported adoptable stylesheet and no host opt-in, so there
is nothing to configure. If your agent still renders unstyled inside your
element, the cause is your own wrapper. See "Hosting the agent inside your
own shadow root" later in this page.

## Pattern 1: floating bubble (docs-site)

This pattern needs the least setup. The embed bundle registers
`<web-agent-bubble>` as a custom element that renders a floating chat button
and a panel sized `var(--web-agent-panel-width, 480px)` by
`var(--web-agent-panel-height, 660px)`, capped at `max-height: 80vh`. The panel fills
that box.

### What the bubble sets

The bubble's `toggle()` method (`src/embed/web-agent-embed.ts:342-419`)
creates an `<agent-chat-panel>` on first open. What it sets:

- **A store only if you did not set one.** The mock is a fallback: a
  host-supplied store wins. Without one, the panel gets
  `{ getState: () => ({ ui: { route: window.location.pathname } }), subscribe: () => () => {}, dispatch: () => {} }`.
- An `appContext` for the docs site (`appName`, `appDescription`), only if you
  did not set one.
- Default backend path/type (`/api/openai/v1`, `openai`), only if you did not set
  them. The panel's `type` property accepts `"openai"`, `"anthropic"`,
  `"gemini"`, or `"mock"` (`src/chat-ui/chat-panel-props.ts:142-148`). The
  bubble's own `type` setter is typed as `"openai" | "anthropic" | "gemini"`
  (`src/embed/web-agent-embed.ts:96-105`).
  There is no default model — the host must set `model` on the bubble, otherwise
  the session throws at start.
- `fetch`: A custom fetch implementation can be set directly on `bubble.fetch = customFetch`
  (`src/embed/web-agent-embed.ts:107-116`, forwarded at `:395`), allowing the host to inject auth headers.
- A `config` with an `appendSystemPrompt` specific to the docs site, only if you
  did not set `config`.

### Sizing and placement

The panel never places or sizes itself — it fills whatever box contains it.

A bubble host resizes that box by setting two custom properties on any
ancestor element (`web-agent-bubble`, `body`, `:root`):

```css
web-agent-bubble {
  --web-agent-panel-width: 600px;
  --web-agent-panel-height: 500px;
}
```

A programmatic host (Pattern 2) gives the panel a container of its own size
and needs no inline styles on the panel at all.

`#panel-container` lives in the bubble's shadow root, so a light-DOM rule
cannot reach it. To restyle the box or the launcher, use the exposed parts:

```css
web-agent-bubble::part(launcher) { background: rebeccapurple; }
web-agent-bubble::part(panel-container) { border-radius: 0; }
```

The bubble exposes four parts: `launcher`
(`src/embed/bubble-shadow-template.ts:105`), `launcher-icon` (`:106`), `stop-run`
(`:108`) and `panel-container` (`:111`). `stop-run` is the Stop button that
appears above the launcher while a run is in flight and the panel is closed —
a wrapper that forwards only the first three cannot reach it.

### In plain HTML

```html
<script type="module" src="/web-agent-embed.js"></script>
<web-agent-bubble></web-agent-bubble>
```

The bubble needs no host stylesheet. It has a shadow root and paints its
launcher and panel box from `--wa-*` tokens, which are custom properties
and cross the shadow boundary. If you set `launcherIcon` to an **icon-font
ligature** rather than a plain glyph, supply the font through the part, because
a global `i { font-family: … }` rule is tree-scoped and stops at the boundary:

```css
web-agent-bubble::part(launcher-icon) { font-family: "Material Symbols Outlined"; }
```

The boundary cuts both ways. The rules above are tree-scoped wherever the
bubble lives, including inside a shadow root of your own. See "Hosting the
agent inside your own shadow root" later in this page.

### Driving the bubble from the host page

`<web-agent-bubble>` provides public methods and properties so page scripts can drive the agent without accessing its shadow root:

- **`bubble.send(input, opts?)`**: `(input: string | { text: string; images?: { dataUrl: string; mediaType: string }[] }, opts?: { userDisplayText?: string }) => Promise<SendOutcome>`
  (`src/embed/web-agent-embed.ts:255-264`). Sends a user message from the host page. If the bubble is currently closed, `send()` calls `toggle()` first so the user sees the panel open and the turn run. The text goes through the same slash-command parser the composer uses, so `send("/compact")` compacts the conversation and `send("/new")` (or `/clear`) starts a fresh session, instead of posting that text to the model. Any other text, including text that starts with a slash but matches no command, is sent as an ordinary user message. The promise resolves to what happened: `{ ran: "command", command }` when a command ran, `{ ran: "message" }` when the text went to the model, or `{ ran: "none" }` when the bubble is not connected yet and has nowhere to send (`src/chat-ui/types.ts:167-170`). `SendOutcome` is exported from the package entry.
- **`bubble.messages`**: `SessionMessage[]` (getter, `src/embed/web-agent-embed.ts:269-271`). Returns the active session's message array, forwarded from the inner panel. Returns an empty array if the bubble has not yet opened.
- **`bubble.running`**: `boolean` (getter, `src/embed/web-agent-embed.ts:277-279`). True while an agent turn is actively executing.
- **`bubble.toggle()`**: `() => void` (`src/embed/web-agent-embed.ts:342`). Opens or collapses the bubble launcher and panel container.
- **Part `stop-run`**: (`src/embed/bubble-shadow-template.ts:108`). The Stop button exposed on the collapsed launcher when a turn is running, allowing users to stop execution even with the panel closed.

```ts
// Example: programmatic driving from page code
const bubble = document.querySelector("web-agent-bubble") as any;
const outcome = await bubble.send("Summarise recent activity");
console.log("Outcome:", outcome.ran, "Running:", bubble.running);
console.log("Current messages:", bubble.messages);
```

## Pattern 2: programmatic mount (cat-store)

The cat-store app mounts `<agent-chat-panel>` directly on a `[data-agent-ui]`
element with full configuration.

### In a Lit/React/vanilla app

```ts
// apps/cat-store/src/web/index.ts mounts the panel;
// apps/cat-store/src/web/agent-panel-config.ts:360 configures it
import { genuiRenderers } from "@cuatoi/web-agent-lit";
import "@cuatoi/web-agent-lit";  // registers <web-agent-bubble> etc.

const agentUi = document.querySelector("[data-agent-ui]");
if (agentUi) {
  agentUi.innerHTML = "";
  const panel = document.createElement("agent-chat-panel");

  // Required: store
  panel.store = myReduxStore;  // { getState, subscribe, dispatch }

  // Required: app context (fed to the LLM)
  panel.appContext = {
    appName: "Cat Store",
    appDescription: "A pet store selling organic cat food products.",
  };

  // Backend configuration
  panel.path = "/api/anthropic";
  panel.model = "sonnet";       // model id — always required
  panel.type = "anthropic";     // "openai" | "anthropic" | "gemini" (or "mock" for e2e)

  // UI block renderers
  panel.renderers = [...genuiRenderers, ...chartingRenderers];

  // Data sources (for query_data / list_data_sources tools)
  panel.sources = getCatSources(() => store.getState());

  // Notification bridge (e.g. toast messages)
  panel.notify = (msg, type) => store.dispatch(setToast(msg, type));  // type: "error" | "info"

  agentUi.appendChild(panel);
}
```

To hide the built-in header and drive the panel from a header of your own, see
[Custom header & panel API](./custom-header-and-public-api.md).

### Keyboard event isolation

`<agent-chat-panel>` registers event listeners on its root element for `keydown`, `keyup`, and `keypress` that call `stopPropagation()` (`src/chat-ui/chat-panel.ts:63-65`).

**Consequence for hosts**: Host-global keyboard shortcuts (e.g. a global `Ctrl+K` command palette or navigation hotkeys) will NOT fire while user focus is inside the panel. This prevents composer typing from accidentally triggering application shortcuts. If a host application requires hotkeys to fire regardless of panel focus, it must register listeners on the `window` during the **capture phase** (`window.addEventListener("keydown", handler, true)`).

### Store contract

The panel and core only call `getState()` on the store. The type the panel
accepts is `HostStore` (`src/chat-ui/types.ts:100-103`):

```ts
interface HostStore {
  getState?: () => unknown;
  [key: string]: unknown;   // other members, such as subscribe and dispatch, are allowed and ignored
}
```

A Redux store works directly. For non-Redux state, provide an object with a
`getState` method. Core reads `getState().ui.route` as the current route and
uses `"/"` when it is missing. The embed bubble's fallback store returns
`{ ui: { route } }`.

### Data sources

The `sources` property accepts an array of `SourceEntry`. See the
`@cuatoi/web-agent-core` package docs, `docs/tools.md`, for a worked
example.

## Hosting the agent inside your own shadow root

This is not a third pattern. It is where you put either of the two patterns
above. A host that mounts the agent inside its own component, with its own
shadow root, wraps `<web-agent-bubble>` in that tree.

### What the nesting looks like

Both reference apps host `<web-agent-bubble>` inside a wrapper element that
has its own shadow root. The nesting is:

```text
<my-agent-widget>  (shadow root)
  └─ <web-agent-bubble>  (open shadow root)
       └─ <agent-chat-panel>
```

The two working references are
`apps/cat-store/src/web/components/cat-agent-widget.ts` and
`apps/docs-site/src/docs-agent-widget.ts`. The wrapper only needs a shadow
root. Both reference apps write it as a `LitElement` because both apps
already use Lit; the pattern does not require Lit.

### The wrapper element

```ts
import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
// Registers <web-agent-bubble> and imports chat-panel, which registers <agent-chat-panel>.
import "@cuatoi/web-agent-lit/embed/web-agent-embed";

@customElement("my-agent-widget")
export class MyAgentWidget extends LitElement {
  // display: contents keeps this element out of layout. Never add transform,
  // filter, backdrop-filter, perspective, will-change or contain: paint here —
  // see "Do not create a containing block" below.
  static styles = css`
    :host { display: contents; }
    .agent-host { display: contents; }
  `;

  private readonly _bubble = document.createElement("web-agent-bubble");

  /** The hosted bubble, live from the moment this element connects. */
  get bubble(): HTMLElement {
    return this._bubble;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Lit schedules its first update on a microtask. Render now, so the host
    // can configure the bubble in the same task as the append.
    this.performUpdate();
  }

  render() {
    return html`<div class="agent-host">${this._bubble}</div>`;
  }
}
```

There is deliberately no `createRenderRoot()` override. Returning `this`
renders into the light DOM, which is the pattern this section exists to
replace.

### Wiring the bubble

```ts
const host = document.querySelector("[data-agent-ui]");
if (host) {
  host.innerHTML = "";
  const widget = new MyAgentWidget();
  host.appendChild(widget);

  // The widget renders synchronously on connect, so `bubble` is already
  // connected here and its own shadow root is live.
  const bubble = widget.bubble as any;
  bubble.store = myStore;
  bubble.appContext = { appName: "My App", appDescription: "…" };
  bubble.path = "/api/anthropic";
  bubble.model = "sonnet";   // required — there is no default model
  bubble.type = "anthropic";
}
```

### Do not create a containing block

`#panel-container`, `#launcher` and the resize grip are all `position: fixed`
(`packages/web-agent-lit/src/embed/bubble-shadow-template.ts:9`, `:27`,
`apps/cat-store/src/web/panel-resize.ts:68`). A fixed descendant resolves
against the nearest ancestor that establishes a containing block.

Never set `transform`, `filter`, `backdrop-filter`, `perspective`,
`will-change` or `contain: paint` on the wrapper. Any of them establishes a
containing block. It traps the launcher, the panel and the grip inside the
wrapper's box instead of the viewport.

Both shipped wrappers use `display: contents` for this reason, and neither
overrides `createRenderRoot`
(`apps/cat-store/src/web/components/cat-agent-widget.ts:28-35`,
`apps/docs-site/src/docs-agent-widget.ts:28-35`).

### Forward the parts

`::part()` pierces exactly one shadow root. Host CSS that used to reach
`web-agent-bubble::part(launcher)` stops working once the bubble sits one
boundary further out. The wrapper re-exports the parts:

```ts
// In the wrapper's constructor:
this._bubble.setAttribute("exportparts", "launcher, launcher-icon, stop-run, panel-container");
```

```css
/* Host stylesheet — now targets the wrapper, not the bubble. */
my-agent-widget::part(launcher-icon) { font-family: "Material Symbols Outlined"; }
```

Sources: `apps/docs-site/src/docs-agent-widget.ts:39-47` and
`apps/docs-site/src/engine/styles.css:178-190`. docs-site forwards only
`launcher, launcher-icon, panel-container`, so its host CSS cannot reach
`stop-run`. The snippet above adds `stop-run`.
`apps/cat-store/src/web/components/cat-agent-widget.ts` sets no
`exportparts`, because cat-store styles no part from outside. A host that
uses no `::part()` rule needs no `exportparts`.

### Styling UI primitives: the registry seam

Buttons, inputs, checkboxes, menus and progress bars come from the UI
registry (`packages/web-agent-lit/src/ui/registry.ts`), swapped at build
time. See the [Lit 3 support & UI registry seam](./lit3-registry.md) page.

A registry returns vendor custom elements. Each of those carries its own
shadow styles, so they style themselves wherever the panel is mounted. No
global sheet is needed. For a working reference in this repository,
`apps/cat-store/src/acme-registry.ts` swaps in Material Web
(`@material/web/*`).

The default registry needs no host action either. Its `.wa-*` rules ship
inside the panel, from `packages/web-agent-lit/src/ui/registry-styles.ts`,
built in `packages/web-agent-lit/src/chat-ui/chat-panel-elements.ts:21-22` and
rendered by `packages/web-agent-lit/src/chat-ui/chat-panel.ts:299`.

**The one thing you own.** If your registry's components need a mapping
sheet (rules that set the vendor's own custom properties from `--wa-*`
tokens), that sheet is a CSS rule set, so it is tree-scoped like any other.
Put a copy in the tree the panel lives in. cat-store appends one into the
bubble's shadow root:

```ts
const sheet = document.createElement("style");
sheet.textContent = ACME_PANEL_MD_STYLES;   // your own vendor-to-token rules
bubble.shadowRoot.appendChild(sheet);       // the bubble's root is open
```

Source: `apps/cat-store/src/web/index.ts:69-71`, with the exported
constant at `apps/cat-store/src/acme-registry.ts:16`. The append works
because the bubble's shadow root is open
(`packages/web-agent-lit/src/embed/web-agent-embed.ts:301`).

### If your build pins lit-html 1

`lit` v3 imports `lit-html/is-server.js`, which `lit-html` v1 does not have.
A global `lit-html` alias pointing at v1 therefore breaks the wrapper with
"Module not found". This hits any host that pins `lit-html` to v1 for its
own legacy modules, the moment the wrapper imports the `lit` package.

Scope the alias by issuer instead of aliasing globally. Only the modules
written against the v1 API get v1. docs-site does exactly this
(`apps/docs-site/webpack.config.cjs:57-66`):

```js
// webpack.config.js — v1 only for the modules that need it.
{ issuer: (value) => !!value && (value.startsWith(litSrc) || value === appEntry),
  resolve: { alias: { "lit-html": litHtmlV1 } } },
```

A host with no v1 pin needs nothing here.

## Comparison

| Aspect | Bubble (`<web-agent-bubble>`) | Programmatic (`<agent-chat-panel>`) |
|--------|-------------------------------|-------------------------------------|
| Setup | One script + one tag | Import + create + configure |
| Store | Your store if you set one; otherwise a read-only route stub | Your app's store, required |
| Backend | `/api/openai/v1` + `openai` unless you set `path`/`type`; `model` is always required | You set every field |
| Data sources | Forwarded when you set `sources` | Set directly |
| Notifications | Forwarded when you set `notify` | Set directly |
| UI registry | Default Beer CSS | Any (via Webpack alias) |

The bubble is a thin wrapper — it forwards `store`, `path`, `model`,
`models`, `selectedModel`, `type`, `imageInput`, `renderers`, `cues`,
`onCuesChange`, `tools`, `skills`, `skillRegistry`, `agentName`,
`agentShortName`, `userAvatar`, `agentAvatar`, `debug`, `sources`,
`toolProviders`, `screens`, `fetch`, `notify`, `hooks` and `config` to the
panel it creates (`src/embed/web-agent-embed.ts:361-403`). It also forwards
`confirmInteraction` and `send`, and reads `messages` and `running` from the
panel.
What differs is the defaults, not the capability.

Both patterns work unchanged inside your own shadow root. See "Hosting the
agent inside your own shadow root" later in this page.

## Custom UI registry integration

When using a custom registry (see the
[Lit 3 support & UI registry seam](./lit3-registry.md) page), the swap happens
at build time via Webpack `NormalModuleReplacementPlugin`. The panel
instantiation code stays exactly the same — `document.createElement("agent-chat-panel")`
— but every internal button, input, and menu renders through your registry
instead of the default Beer CSS one.

```js
// webpack.config.js
new webpack.NormalModuleReplacementPlugin(
  /[\\/]ui[\\/]registry\.js$/,
  path.resolve(__dirname, "src/acme-registry.ts")
),
```
## Choose a model from the host

A host can take over the model switch in the kebab menu. Set `models` to two or
more options. Each option has an `id`, an optional `label` and an optional
`icon`. The `icon` value is SVG markup that carries your own artwork. The
default menu draws it before the label in the text colour (`currentColor`).

When the user picks a model, the panel fires a cancelable `agent-model-select`
event. The event bubbles and crosses shadow roots, so a listener on the panel or
on `<web-agent-bubble>` receives it. The details:

- `detail.id` is the option id, not the API model name. Two options can share
  one API model name on different routes.
- The event dispatches synchronously. If your listener calls `preventDefault()`,
  the panel does not change the session model.
- Without cancellation, the panel calls `setModel(optionId)` and keeps the
  conversation. That switch changes only the model id. It does not change the
  endpoint, the format or the authentication.
- `selectedModel` sets which option shows the check mark. It changes no session
  state. Set it to the option id after a canceled switch so the check mark
  follows your route. An id that matches no option checks nothing. Set it to
  `undefined` to check the session model again.

```ts
import type { AgentChatPanel } from "@cuatoi/web-agent-lit";

type Route = {
  id: string;
  apiModel: string;
  path: string;
  type: "anthropic" | "openai";
  icon: string;
};

const routes: Route[] = [
  {
    id: "fast",
    apiModel: "small-model",
    path: "/api/provider-fast",
    type: "anthropic",
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>',
  },
  {
    id: "deep",
    apiModel: "large-model",
    path: "/api/provider-deep",
    type: "anthropic",
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l10 20H2z"/></svg>',
  },
];

const panel = document.querySelector<AgentChatPanel>("agent-chat-panel")!;
panel.models = routes.map((r) => ({ id: r.id, label: r.id, icon: r.icon }));

panel.addEventListener("agent-model-select", (event) => {
  const { id } = (event as CustomEvent<{ id: string }>).detail;
  const route = routes.find((r) => r.id === id);
  if (!route) return;
  event.preventDefault();
  panel.path = route.path;
  panel.type = route.type;
  panel.model = route.apiModel;
  panel.fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...init?.headers, "X-Host-Auth": "…" } });
  panel.selectedModel = route.id;
});
```

The same listener works on `<web-agent-bubble>`, which forwards `selectedModel`
to its panel. Your host supplies the authentication. The example `fetch`
wrapper adds a header and passes every other argument through.

`path`, `type`, `model` and `fetch` go through `updateConfig`, which keeps the
conversation. A model switch that only uses the default behaviour keeps the
endpoint and the history as well.
