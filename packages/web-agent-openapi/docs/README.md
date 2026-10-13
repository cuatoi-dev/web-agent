---
title: OpenAPI package docs
---

# @cuatoi/web-agent-openapi — documentation

Turns an OpenAPI 3.x document plus a whitelist of `operationId`s into concrete
agent tools, with method and URL fixed by the spec. It plugs into
`@cuatoi/web-agent-core` through the `ToolProvider` seam and renders nothing.

## Guides

| Page | What it covers |
|---|---|
| [Getting started](./getting-started.md) | Install, wiring `openApiToolProviders`, a worked example, what the agent sees |
| [Source configuration](./source-config.md) | `ApiSourceConfig` field by field, `credentials`, the `fetch` hook, response caps, CORS |
| [Operations and responses](./operations-and-responses.md) | What the parser accepts, tool names, descriptions and input schemas, URL and request binding, errors the agent sees, response shaping |
| [Lifecycle and failures](./lifecycle-and-failures.md) | One provider for the whole list and why, load-once, `required`, what makes a source load fail, collisions |
| [Airgap and bundling](./airgap.md) | The first-party resolver and why it cannot reach the network, external `$ref` behavior, the zero-fetch guard |
| [API reference](./api-reference.md) | Every export, its signature and its behavior |

## Related packages

- `@cuatoi/web-agent-core` — the agent loop, tools, skills and session storage
- `@cuatoi/web-agent-mcp` — remote MCP servers as tool providers
- `@cuatoi/web-agent-dom` — DOM and state tools
- `@cuatoi/web-agent-lit` — the sample Lit chat UI binding
- `@cuatoi/web-agent-charting` — the `show_chart` tool and Chart.js renderer