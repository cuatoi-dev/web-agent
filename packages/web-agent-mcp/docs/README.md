---
title: MCP package docs
---

# @cuatoi/web-agent-mcp — documentation

This package connects the web-agent to remote MCP (Model Context Protocol)
servers over Streamable HTTP and exposes each server's tools to the agent. It
plugs into `@cuatoi/web-agent-core` through the `ToolProvider` seam and
renders nothing.

## Guides

| Page | What it covers |
|---|---|
| [Getting started](./getting-started.md) | Install, wiring `mcpToolProviders` into `toolProviders`, and a complete worked example |
| [Server configuration](./server-config.md) | `McpServerConfig`, `ConnectMcpOptions`, URL resolution and tool-name prefixing |
| [Lifecycle and failures](./lifecycle-and-failures.md) | Load-once, `required` semantics, `dispose()`, collisions and bundling |
| [API reference](./api-reference.md) | Every export, its signature and its behavior |

## Related packages

- `@cuatoi/web-agent-core` — the agent loop, tools, skills and session storage
- `@cuatoi/web-agent-openapi` — OpenAPI documents as tool providers
- `@cuatoi/web-agent-dom` — DOM and state tools
- `@cuatoi/web-agent-lit` — the sample Lit chat UI binding
- `@cuatoi/web-agent-charting` — the `show_chart` tool and Chart.js renderer
