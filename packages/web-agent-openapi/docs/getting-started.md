---
title: Getting started with OpenAPI sources
---

# Getting started with OpenAPI sources

## What this package does

`@cuatoi/web-agent-openapi` lets a host declare its backend API by giving
the package a URL to an OpenAPI 3.x document plus a whitelist of
`operationId`s. It generates **one concrete tool per whitelisted operation**,
with method and URL fixed by the spec. The agent supplies only typed
parameters — it never sees or chooses a URL, and there is no generic `fetch`
tool in this design.

Three details back that up. `parseOpenApiOperations` returns one descriptor
per whitelisted operation and iterates only `source.operations`. Inside the
loop it looks each `operationId` up in the operation index and throws if it is
missing, so a whitelist smaller than the document never turns unlisted
operations into descriptors. The method and path live in the descriptor, not
in the agent's input: `operationToToolDef` copies `descriptor.method` and
`descriptor.path` straight into the tool. And `src/index.ts` exports no tool
of its own — only a provider factory plus parsing, URL-building and fetching
helpers.

## Install

```bash
pnpm add @cuatoi/web-agent-openapi
```

`@cuatoi/web-agent-core` comes along as the only dependency (the
`dependencies` block of `package.json`), so there is nothing else to add.

## Wire it into a Lit host

This is the one wiring that exists in this repo today — the
`openApiToolProviders([...])` entry inside the `panel.toolProviders = [ … ]`
assignment in `apps/cat-store/src/web/agent-panel-config.ts:276-285` (OpenAPI
there, next to MCP and DOM tools):

```ts
import { openApiToolProviders } from "@cuatoi/web-agent-openapi";

panel.toolProviders = [
  ...openApiToolProviders([
    {
      name: "ordersApi",
      description: "Cat Store Orders REST API",
      specUrl: "/api/orders/openapi.json",
      operations: ["describeOrders", "queryOrders"],
      credentials: "same-origin",
      required: true,
    },
  ]),
];
```

`openApiToolProviders` returns an **array**. Its single element is the one
provider for the whole list, so the spread concatenates with any other
providers — DOM tools, MCP servers — instead of replacing them. For MCP, see
[`@cuatoi/web-agent-mcp`](../../web-agent-mcp/docs/README.md).

## Wire it into a core-only host

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";
import { openApiToolProviders } from "@cuatoi/web-agent-openapi";

const session = createAgentSession({
  // …the rest of your SessionConfig…
  toolProviders: openApiToolProviders([
    {
      name: "cat-store",
      description: "Cat Store REST API",
      specUrl: "/cat-store/openapi.json",
      operations: ["listCats", "getCat"],
      credentials: "same-origin",
      required: true,
    },
  ]),
});
await session.initPromise; // rejects if a required source fails
```

`createAgentSession` and `session.initPromise` are the two handles core
exposes; awaiting `initPromise` is what surfaces a required-source failure.

## What the agent sees

A source named `ordersApi` whose document defines `describeOrders` becomes
the tool `ordersApi_describeOrders`. `operationToToolDef` concatenates
`sanitizeName(source.name, "api")` and
`sanitizeName(descriptor.operationId, "op")` with an underscore
(`src/operation-to-tool-def.ts:24-26`). Core's `sanitizeName` keeps case and
turns every other character into `_`, then strips leading and trailing
underscores; when nothing is left it returns the fallback it was given
(`packages/web-agent-core/src/utils/sanitize-name.ts:5-7`). So a source named
`_orders_` gives the prefix `orders`, and a source named `***` gives `api`,
while an `operationId` of `***` gives `op`.
Every source also gets exactly one `# Tool guidelines` line, reading
`- ordersApi (API source) — Cat Store Orders REST API`. The snippet string
`${source.name} (API source) — ${source.description}` is stamped onto every
tool of that source, and core's `buildSystemPromptParts` de-duplicates
identical snippets.

## Set `toolProviders` before the session starts

Set `toolProviders` before the session starts, so the first turn already has
the tools. Assigning a new list later also works: core disposes the old
providers and fetches the new specs, and the conversation is kept. See
[Lifecycle and failures](./lifecycle-and-failures.md) for the full proof.

## Airgap note

Nothing is fetched at install or at build. The only requests this package
ever makes are to the host's own `specUrl` and the operation URLs derived from
it. `$ref` resolution is a first-party module of this package,
`src/resolve-local-refs.ts`, which follows a `$ref` only when it starts with
`#`. That module contains no `fetch`, no `import()` and no file API, so an
external `$ref` is left in place and never fetched. There is no plugin system
and nothing to configure. See
[Airgap and bundling](./airgap.md) for the mechanism and the test that guards
it.