---
title: DOM package docs
---

# @cuatoi/web-agent-dom — documentation

This package adds the seven DOM and state tools, the point-at-elements
picker, the `data-agent-permission` interaction gate, and the
`multi_step_ui` skill to `@cuatoi/web-agent-core`. It plugs in through
`SessionConfig.toolProviders` and `skills:`.

## Guides

| Page | What it covers |
|---|---|
| [Getting started](./getting-started.md) | Install, wiring `domTools()` into a host, what you get |
| [Tools](./tools.md) | The seven tools, the snapshot/ref model, the breadth-first snapshot budget, the `include_text` filter, result lifetime, and error messages |
| [Options and defaults](./options.md) | Every `DomToolsOptions` field with its real default |
| [Permissions and confirmation](./permissions.md) | `data-agent-permission` tiers and the `confirmInteraction` gate |
| [Point at elements](./picker.md) | The picker attachment provider |
| [Moving from core](./migrating-from-core.md) | Why these tools left core and what a host must now add |
| [API reference](./api-reference.md) | Every export of the package entry point |

## Related packages

- `@cuatoi/web-agent-core` — the agent loop, tool schemas, skills and session storage
- `@cuatoi/web-agent-lit` — the sample Lit chat UI binding (supplies the confirm dialog)
- `@cuatoi/web-agent-mcp` — remote MCP servers as tool providers
- `@cuatoi/web-agent-openapi` — OpenAPI operations as tools
