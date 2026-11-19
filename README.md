# web-agent

A browser-native chat agent for web applications. It runs inside your page: the
agent loop, the tools and the chat UI are all browser code, and the page calls
your own model endpoint. It ships as the `@cuatoi/web-agent-*` npm packages.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![npm version](https://img.shields.io/npm/v/@cuatoi/web-agent-core.svg)](https://www.npmjs.com/package/@cuatoi/web-agent-core)

## Features

- **The agent loop runs in the browser.** `createAgentSession()` runs the turns,
  the tool calls and the history in the page. No server-side agent is involved.
- **Tools are pluggable.** Core ships the loop, the generic tools and a
  data-source query engine. DOM interaction, a virtual file system, MCP servers,
  OpenAPI operations and Chart.js charts come from their own packages.
- **Generative UI.** The agent replies with JSON blocks, and the host renders
  them as charts, forms and buttons.
- **Multi-session history.** Core keeps several sessions per host and ships
  `IdbSessionStore`, which persists them in IndexedDB so a reload keeps the
  conversation.
- **Skills.** The agent finds a skill with `search_skills` and loads its full
  text with `load_skill`, so a skill costs no prompt tokens until it is used.
- **Your design system.** Every colour, font and spacing value is a `--wa-*`
  theme token, and the set of UI primitives is a build-time seam.
- **A Chrome extension toolkit.** `@cuatoi/web-agent-browser` builds a brand
  folder into a loadable Manifest V3 extension.

## Packages

| Package | What it does |
|---|---|
| [`@cuatoi/web-agent-core`](packages/web-agent-core/README.md) | The agent loop, the tool and skill framework, the data-source engine and the model transports. |
| [`@cuatoi/web-agent-lit`](packages/web-agent-lit/README.md) | The sample Lit binding: chat panel, embeddable bubble, UI-block renderers and the `--wa-*` theme tokens. |
| [`@cuatoi/web-agent-dom`](packages/web-agent-dom/README.md) | DOM and state tools: `snapshot_page`, `query_state`, `click`, `fill`, `select_option`, `wait_for` and `see`. |
| [`@cuatoi/web-agent-vfs`](packages/web-agent-vfs/README.md) | Virtual file tools on browser storage: `read_file`, `write_file`, `edit_file`, `glob_files`, `search_files`, `json_get`, `json_edit` and others. |
| [`@cuatoi/web-agent-mcp`](packages/web-agent-mcp/README.md) | Tools from remote Model Context Protocol (MCP) servers, loaded through the `ToolProvider` seam. |
| [`@cuatoi/web-agent-openapi`](packages/web-agent-openapi/README.md) | API-call tools generated from an OpenAPI 3.x document, limited to the operations you list. |
| [`@cuatoi/web-agent-charting`](packages/web-agent-charting/README.md) | Chart.js tools, a chart skill and lit-html chart blocks. |
| [`@cuatoi/web-agent-browser`](packages/web-agent-browser/README.md) | A Chrome Manifest V3 extension toolkit: a brand folder becomes a loadable extension. |

## Install

```bash
npm install @cuatoi/web-agent-core @cuatoi/web-agent-lit lit-html
```

`lit-html` is a peer dependency of `@cuatoi/web-agent-lit` and accepts `^1`,
`^2` or `^3`. Install the major your host already uses.

## Quick start

The packages are ES modules with bare import specifiers, so bundle the page with
a bundler. These steps use [esbuild](https://esbuild.github.io/).

Create `quickstart.ts`:

```ts
import "@cuatoi/web-agent-lit/themes/wa-tokens.css";
import { genuiRenderers } from "@cuatoi/web-agent-lit";

const panel = document.createElement("agent-chat-panel");
panel.appContext = { appName: "Quick start", appDescription: "A demo host page." };
panel.type = "openai";
panel.path = "/api/openai/v1";
panel.model = "your-model-id";
panel.renderers = genuiRenderers;

document.querySelector("#agent")!.appendChild(panel);
```

Create `index.html`:

```html
<!doctype html>
<html lang="en" data-theme="wa2-light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; height: 100%; }
      #agent { height: 100%; }
    </style>
  </head>
  <body>
    <div id="agent"></div>
    <script type="module" src="./quickstart.js"></script>
  </body>
</html>
```

Bundle it:

```bash
npx esbuild quickstart.ts --bundle --format=esm --outfile=quickstart.js
```

Serve the folder, open `index.html`, and send a message. The panel creates the
session when it connects, so this page is the whole embed.

`panel.path`, `panel.type` and `panel.model` must match your model endpoint. The
example expects an OpenAI-compatible endpoint at `/api/openai/v1` on the page's
origin. Replace `your-model-id` with a model your endpoint serves. On the OpenAI and Anthropic transports, core
sends `stream: false` on every request.

The `themes/wa-tokens.css` import supplies the design tokens. The `data-theme`
attribute on `<html>` selects a theme: `wa1-dark`, `wa2-dark` or `wa2-light`.
The panel fills its container, so the container needs a height.

## Examples

Two sample host apps live in this repository:

| App | What it is | Start |
|---|---|---|
| [`apps/cat-store`](apps/cat-store/README.md) | A full-stack pet store: Lit 3 single-page app, Express orders API and a remote MCP endpoint. It mounts the panel with the DOM, MCP, OpenAPI, charting and file tools. | `pnpm --filter @web-agent/cat-store dev` |
| `apps/docs-site` | The documentation site and the component gallery. | `pnpm --filter @web-agent/docs-site dev` |

cat-store serves `http://localhost:10030/` and docs-site serves
`http://localhost:10031/public/web-agent-docs/`. cat-store also needs its orders
API, which you build and start once in another terminal:

```bash
pnpm --filter @web-agent/cat-store build:server
pnpm --filter @web-agent/cat-store start:server
```

Both dev servers forward the model routes (`/api/openai`, `/api/anthropic`,
`/api/gemini`) to a gateway on port 30000. The cat-store README describes that
proxy.

## Documentation

Every package ships its guides in `docs/`:

- [`@cuatoi/web-agent-core`](packages/web-agent-core/docs/README.md) — the loop, tools, skills, hooks, providers, sessions and compaction.
- [`@cuatoi/web-agent-lit`](packages/web-agent-lit/docs/README.md) — embedding, the lit-html binding, themes and the UI registry seam.
- [`@cuatoi/web-agent-dom`](packages/web-agent-dom/docs/README.md) — the DOM tools, permissions and the element picker.
- [`@cuatoi/web-agent-mcp`](packages/web-agent-mcp/docs/README.md) — server configuration, the lifecycle and failure handling.
- [`@cuatoi/web-agent-openapi`](packages/web-agent-openapi/docs/README.md) — sources, operations and responses.
- [`@cuatoi/web-agent-charting`](packages/web-agent-charting/docs/README.md) — charts, import paths and the data source.
- [`@cuatoi/web-agent-browser`](packages/web-agent-browser/docs/README.md) — the brand toolkit, the extension agents and the page tools.
- `@cuatoi/web-agent-vfs` — [the package README](packages/web-agent-vfs/README.md) is the reference: the tools, the file tree, memory files and the backend interface. The package has no `docs/` folder.

## Development

Prerequisites: Node.js 24 and pnpm 10.33.0. The pnpm version is pinned in
`packageManager` in `package.json`.

```bash
pnpm install          # install dependencies
pnpm build            # typecheck and build every package and app
pnpm test             # fast unit tests
pnpm test:dom         # unit tests that mount DOM elements
pnpm lint
pnpm test:e2e:mock    # end-to-end tests with a scripted model, no network
```

`pnpm test` never picks up a spec that awaits a DOM update. Those specs live in
each unit's `test-dom/` folder and run under `pnpm test:dom`.

Enable the secret scan once per clone. It runs on the staged change and blocks a
commit that contains a secret:

```bash
git config core.hooksPath .githooks
```

The end-to-end tests drive a real Chrome. Install it once:

```bash
npx playwright install chromium
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) to set up the repository, run the
checks and open a pull request.

## Code of conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).

## License

Apache-2.0 — see [LICENSE](LICENSE).
