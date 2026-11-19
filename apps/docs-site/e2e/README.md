# docs-site e2e

Playwright end-to-end tests for the docs-site host app. Self-contained: helpers and
config live in this folder (`helpers.ts`, `../playwright.config.ts`).

## Suites
- `smoke.mock.spec.ts` — bubble opens, basic chat reply.
- `functional.mock.spec.ts` — docs chat, summarize current page, markdown / UI-block rendering.
- `nonvision.mock.spec.ts` — asserts vision is **OFF** on docs: no attach button, paste/drag
  adds no thumbnail, a visual ask is handled via text (no `see` tool, no 400).
- Additional `*.mock.spec.ts` files cover routing, search, sessions, resize, showcase, and shadow-root styles.

## Running
```bash
# Mock tier (default) — runs all mock e2e specs against local dev server.
pnpm --filter @web-agent/docs-site test:e2e

# Gallery capture — captures theme gallery screenshots on local dev server.
pnpm --filter @web-agent/docs-site test:e2e:gallery
```
Env switch: `E2E_ENV` (default `mock`; `local` uses `http://localhost:10031/public/web-agent-docs/`).

## Notes
- docs is **non-vision** (image input + the `see` tool are disabled via the host
  `imageInput` toggle) — these tests assert that.
- The agent is a floating **bubble**; `openBubble` clicks `web-agent-bubble button#launcher`.
- The composer is **vanilla light-DOM** — `sendChat` uses the native `.wa-input`
  (`fill` + press Enter), not the cat-store shadow-DOM dance. Replies are read from
  `.message-container.assistant .content`.
- `pnpm dev` runs `webpack serve --mode development` on port `10031` (`../webpack.config.cjs`).
  Ensure no stale dev server lingers on `:10031` before a local run.
- Playwright runs **serial** (`workers: 1`) with `retries: 0` (`../playwright.config.ts`).
