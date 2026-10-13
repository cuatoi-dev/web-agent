---
title: Lit binding package docs
---

# @cuatoi/web-agent-lit — documentation

The **sample** framework binding for the web-agent in-app browser agent. It
supplies the chat UI, the embeddable bubble, the UI-block renderers, and the
`<wa-*>` tag contract that maps UI primitives onto a host's component set. The
agent loop itself lives in `@cuatoi/web-agent-core` and renders nothing.

This is one binding, not the only one — `web-agent-react` and
`web-agent-angular` are expected to follow the same shape.

## Guides

| Page | What it covers |
|---|---|
| [Lit 3 support & the UI element seam](./lit3-registry.md) | The `<wa-*>` tag contract and a worked Material Web implementation |
| [lit-html binding](./lit-html-binding.md) | The `lit-html` peer dependency, the `ui/template.ts` seam, and per-major host wiring |
| [Embedding & integration](./embedding.md) | `<web-agent-bubble>` and programmatic `<agent-chat-panel>` mounting |
| [Custom header & panel API](./custom-header-and-public-api.md) | Hiding the built-in header, panel container sizing, the slash-command menu, and public panel methods |
| [Built-in chat panel features](./chat-panel-features.md) | The header controls, message window, scroll-to-bottom button, status notices, panel events, composer indicators, and tool step rows |
| [Porting to acme-* components](./porting-to-acme-components.md) | Rebuilding an equivalent binding on an internal `acme-*` component set |
| [Extending with acme-* components](./extending-with-acme-components.md) | The cheaper route — keep this package, alias only `ui/registry.js` |

## Related packages

- `@cuatoi/web-agent-core` — the agent loop, tools, skills and session storage
- `@cuatoi/web-agent-dom` — DOM and state tools
- `@cuatoi/web-agent-mcp` — MCP servers as tool providers
- `@cuatoi/web-agent-openapi` — OpenAPI documents as tool providers
- `@cuatoi/web-agent-charting` — the `show_chart` tool and Chart.js renderer
- `@cuatoi/web-agent-browser` — the browser extension host and its token sheet