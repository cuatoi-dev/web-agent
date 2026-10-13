# cat-store e2e

Playwright end-to-end tests for the cat-store host app. Self-contained: helpers,
fixtures, and config live in this folder (`helpers.ts`, `fixtures/`, `../playwright.config.ts`).

## Suites
- `smoke.spec.ts` — panel opens, basic chat reply.
- `functional.spec.ts` — chat, agent tool-loop (snapshot/navigate/click/fill/select/wait_for),
  query_data/state, UI blocks + chart, add-to-cart + cart badge, mobile viewport.
- `image.spec.ts` — **vision**: attach/paste/drag, downscale-hint toast, the model
  describing a real image, transcript thumbnail, panel image overlay, reload behavior, the `see` tool.

## Running
```bash
# Mock tier (default) — runs all mock e2e specs against local dev server.
pnpm --filter cat-store test:e2e

# Gallery capture — captures theme gallery screenshots on local dev server.
pnpm --filter cat-store test:e2e:gallery
```
Env switch: `E2E_ENV` (default `mock`; `local` uses `http://localhost:10030/`).

## Notes
- Live-model tests run **serial** (`workers:1`) with `retries:2` to avoid the model
  worker-concurrency cap and absorb throttle flakes.
- The composer is a **Material Web `<md-outlined-text-field>` (shadow DOM)** — the
  `sendChat` helper focuses the host and uses `keyboard.type` (not `.fill()`) so the
  Send button enables. Assistant replies are read from `.message-container.assistant .content`.
- Vision model: `minimax-m3:cloud`.

## Prompt-cache smoke (non-gating)

Anthropic prompt caching (system breakpoints A/B + one rolling history
breakpoint) is verified deterministically by the core unit suite
(`anthropic-provider.test.ts` — `cache_control` placement on the system blocks
and on the last message). The **live** cache-hit magnitude is checked by hand
and is **non-gating** (the Anthropic-format traffic routes through a translating
gateway that may strip `cache_control`):

1. Open the deployed cat-store panel; start ONE persisted session.
2. Send a multi-turn conversation that triggers at least one tool call
   (e.g. "how many cats are in the catalog?" then a follow-up), so the agent's
   tool loop makes 2+ model calls within the session.
3. Inspect usage on the **2nd+** request (network panel / usage readout).
   - **Expected (best case):** `cache_read_input_tokens > 0` on call 2 — cache
     hit on the reused system + history prefix.
   - **Caveat (not a defect):** if the upstream gateway ignores/strips
     `cache_control`, `cache_read_input_tokens` stays `0`. That is an
     **upstream-support finding**, not a code bug — placement is already proven
     by the gating unit tests. Do NOT convert this into a gating e2e assertion.
