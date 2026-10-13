---
title: OpenAPI lifecycle and failures
---

# OpenAPI lifecycle and failures

## One provider for the whole source list — and why MCP is different

`openApiToolProviders` returns **one provider for the whole source list** — a
single `ToolProvider` named `"openapi"` with `required: true`, whose `load()`
calls `connectApiSources` on the entire list and returns the collected tools.
The reason, from the function's own doc comment: a tool name claimed by one
source is refused to a later source. Enforcing that rule needs a view across
every source — a view a per-source provider cannot have.

This is the mirror image of `@cuatoi/web-agent-mcp`: `mcpToolProviders`
does `servers.map(…)` — one provider **per server** — because MCP has no
cross-server naming rule to enforce (name collisions between servers are
handled generically by core), and each server owns a connection to dispose.
The "One provider per server — and why OpenAPI is different" section of the
MCP guide states the same contrast from the MCP side; the two pages agree.

## Why the provider is `required: true`

`connectApiSources` throws only when a `required: true` **source** fails; an
optional source's failure is warned and swallowed inside it. So the
provider-level `required: true` flag never hides an optional failure — it
only means "the tool pipeline aborts when a source the host marked required
fails".

## Providers load at session start, and again for a new list

`loadToolProviders` runs the providers with
`Promise.allSettled(providers.map((p) => p.load()))`, called from
`loadConfiguredToolProviders` before the first turn. `doUpdateConfig` calls
the same function again when `toolProviders` is set to a different array, so
assigning `panel.toolProviders` after the session exists fetches the new
specs. The same array fetches nothing again.

See core's [`ToolProvider`](../../web-agent-core/docs/tool-provider.md) seam
page for the interface itself, rather than repeating it here.

## Sources load concurrently

Every source starts loading in the same tick — `connectApiSources` maps the
whole list into one `Promise.allSettled`, so a slow source never serializes a
fast one.

## `required` semantics

| Source flag | On failure |
|---|---|
| `required: false` | `console.warn` with `[api] optional source "<name>" (<specUrl>) failed to load — its tools are unavailable this session: <message>`, no tools contributed, the rest still load |
| `required: true` | an `ApiRequiredSourceError` listing **every** required failure — `Required API source(s) failed to load — "<name>" (<specUrl>): <err>; …` — thrown from `load()`, which rejects `session.initPromise` |

## What makes a source load fail

`loadApiSource` runs three stages for each source, and any stage can throw
(`src/connect-sources.ts:39-46`). The `required` rule above applies to every
one of them:

| Stage | Error message |
|---|---|
| Fetch the document — the request rejects | `Failed to fetch OpenAPI document for API source "<name>" from "<resolved URL>": <message>` |
| Fetch the document — a non-2xx response | `Failed to fetch OpenAPI document for API source "<name>" from "<resolved URL>": HTTP <status> <statusText>` |
| Fetch the document — the body is not JSON | `Failed to parse OpenAPI document JSON for API source "<name>" from "<resolved URL>": <message>` |
| Parse the whitelist | One of the parser errors in [Operations and responses](./operations-and-responses.md) |
| Build the tools | A duplicate parameter name, or a parameter named `body` next to a request body |

The three fetch messages come from `fetchOpenApiDocument`
(`src/fetch-seam.ts:31-57`). A tool-name collision, described next, also
counts as a failure of the later source.

## Tool-name collisions

- **Within the list:** `connectApiSources` tracks claims in its `claimedBy`
  map; the first source to claim a tool name keeps it, and the later colliding
  source is dropped **whole** and treated as a failure classified by its own
  `required` flag. Message: `API source "<name>" generates tool name "<name>",
  which API source "<other>" already provides. Two source names that sanitize
  to the same tool prefix cannot be used together — rename one.`
- **Across providers:** not checked here, because the other providers' tool
  lists are not visible. Core's `buildTools` resolves duplicates first-wins
  with `Tool "<name>" is already defined — skipping duplicate.`

## Edge cases that are not errors

- A source with an empty `operations` whitelist contributes no tools — that is
  not an error (the whitelist loop has nothing to iterate).
- An undefined or empty `sources` array returns `{ tools: [], failures: [] }`
  with no network call (the early return at the top of `connectApiSources`).

## There is no `dispose()`

An API source holds no open connection, so the provider needs no teardown:
`ConnectApiSourcesResult` deliberately has no `sessions` field, and the
provider returns no `dispose()`.