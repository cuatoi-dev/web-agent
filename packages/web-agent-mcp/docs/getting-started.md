---
title: Getting started with MCP
---

# Getting started with MCP

## What this package does

`@cuatoi/web-agent-mcp` is a Streamable-HTTP MCP client. It connects to one
or more remote MCP servers, discovers their tools, and turns each one into a
`CustomToolDef` the agent can call. It prefixes each tool name with a sanitized
form of the server's `name`, so tools from different servers never collide by
accident.

## Install

```bash
pnpm add @cuatoi/web-agent-mcp
```

`@cuatoi/web-agent-core` and `@modelcontextprotocol/sdk` install as
dependencies (`package.json:38-41`), so you do not need to add anything else.

## Wire it into a Lit host

This is the one wiring that exists in this repo today. The excerpt below
leaves out the DOM and OpenAPI providers that the same array also holds
(`apps/cat-store/src/web/agent-panel-config.ts:236-265`):

```ts
import { mcpToolProviders } from "@cuatoi/web-agent-mcp";

const extraMcpServers = window.__WA_EXTRA_MCP_SERVERS__ ?? [];
panel.toolProviders = [
  // …domTools(…) providers…
  ...mcpToolProviders([
    {
      name: "demomcp",
      description: "Cat Store remote MCP endpoint",
      url: "mcp",
      required: true,
    },
    ...extraMcpServers,
  ]),
  // …openApiToolProviders(…) providers…
];
```

`mcpToolProviders` returns an **array** of providers, so the spread
concatenates with any other providers (DOM tools, OpenAPI tools, …) instead of
replacing them.

`window.__WA_EXTRA_MCP_SERVERS__` is a cat-store test seam, not part of this
package. The cat-store e2e spec uses it to add an unreachable optional server
at test time (`apps/cat-store/e2e/mcp-remote-tool.mock.spec.ts:57-64`). A
normal host lists its servers directly.

## Wire it into a core-only host

A host without the Lit panel passes the providers straight to
`createAgentSession`:

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";
import { mcpToolProviders } from "@cuatoi/web-agent-mcp";

const session = createAgentSession({
  // …the rest of your SessionConfig…
  toolProviders: mcpToolProviders([
    { name: "orders", description: "Order tools", url: "/mcp", required: true },
  ]),
});
await session.initPromise; // rejects if a required server fails
```

`createAgentSession` — `packages/web-agent-core/src/controller.ts:56`.
`initPromise` — `packages/web-agent-core/src/controller.ts:171-191, 256`.

Core marks a rejected `initPromise` as handled
(`packages/web-agent-core/src/controller.ts:189-191`). A host that never awaits
it gets no unhandled-rejection warning, but it also does not learn that a
required server failed. Await it, or read `state.error` (see
[Lifecycle and failures](./lifecycle-and-failures.md)).

## What the agent sees

On a server named `demomcp`, a tool called `place_order` becomes the tool
`demomcp_place_order` (`src/client.ts:46-47`; e2e coverage at
`apps/cat-store/e2e/mcp-remote-tool.mock.spec.ts:15, 33`). The server also adds
exactly one `# Tool guidelines` line, reading
`- demomcp (MCP server) — Cat Store remote MCP endpoint`
(`src/tool-providers.ts:39`; `packages/web-agent-core/src/prompt/system-prompt.ts:113, 186`).

## Set `toolProviders` before the session starts

Set `toolProviders` before the session starts, so the first turn already has
the tools. Assigning a new list later also works: core disposes the old
providers and loads the new ones, and the conversation is kept. See
[Lifecycle and failures](./lifecycle-and-failures.md) for the details.

## Airgap note

This package fetches nothing at install or at build. The only network call it
ever makes is to the MCP endpoint the host already runs. Prefer a relative
`url` (like `"mcp"` above) so the request is same-origin and CORS does not
apply (`src/types.ts:43-44`).
