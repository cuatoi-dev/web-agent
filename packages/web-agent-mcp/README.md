# @cuatoi/web-agent-mcp

Remote MCP (Model Context Protocol) client tools for the web-agent in-app browser
agent. It connects to Streamable-HTTP MCP servers and exposes their tools to the
agent through `@cuatoi/web-agent-core`'s `ToolProvider` seam.

## Install

```bash
pnpm add @cuatoi/web-agent-mcp
```

## Usage

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";
import { mcpToolProviders } from "@cuatoi/web-agent-mcp";

const session = createAgentSession({
  // …the rest of your SessionConfig…
  toolProviders: mcpToolProviders([
    {
      name: "orders",
      description: "Order tools from the store's MCP endpoint",
      url: "/mcp",          // relative — resolved against the page, so same-origin
      required: true,       // no default: every server states its own intent
    },
  ]),
});

await session.initPromise;  // rejects if a required server fails to load
```

`mcpToolProviders` returns **one provider per server**. Providers load at
session start, and again when a new `toolProviders` list is assigned. All of
them load concurrently. A `required: true` server that
fails to connect is a hard startup error. A `required: false` server that fails
is logged and skipped.

## Documentation

See [`docs/README.md`](./docs/README.md) — getting started, server configuration,
lifecycle and failures, and the full API reference.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
