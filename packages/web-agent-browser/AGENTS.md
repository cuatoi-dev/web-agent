# web-agent-browser — agent instructions

## Run the e2e tiers through the package scripts

| Tier | Command | What it runs |
|---|---|---|
| Mock | `pnpm test:e2e:mock` | Headless, with a mocked model |
| Demo | `pnpm test:e2e:demo` | Headless, against the real model, inside `xvfb-run` with a 1280x800 screen |

Do not call `playwright test` directly. The scripts set `E2E_ENV`, which
selects the tier.

Both tiers load the extension with `chromium.launchPersistentContext` and
`channel: "chromium"` (`e2e/extension.fixture.ts`, `e2e/demo-helpers.ts`).
That channel is what lets the extension run headless, so do not switch it.

## How the extension injects

`content.js` runs on every page at `document_start` in the `MAIN` world
(`manifest.template.json`). It registers no custom element at import time. The
elements load inside `mount()`, only after the page is allowed to have the
bubble.

`mount()` loads them with literal dynamic `import()` calls:
`@cuatoi/web-agent-lit/embed/web-agent-embed` (defines `web-agent-bubble`),
`@cuatoi/web-agent-lit` (defines `agent-chat-panel` and the `wa-*` tags) and
`@cuatoi/web-agent-vfs/lit` (defines `agent-files-screen`).

`webpack.config.cjs` sets `parser.javascript.dynamicImportMode: "eager"`, so
webpack inlines every `import()` and `content.js` stays one file. A content
script cannot load a chunk.

Do not add a top-level value import of a module that defines elements. It
brings back the element clash: the extension would register its tags on every
page, before the page can define its own.
