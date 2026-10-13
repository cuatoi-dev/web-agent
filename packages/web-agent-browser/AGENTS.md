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
