---
title: Charting package docs
---

# @cuatoi/web-agent-charting — documentation

This package adds the `show_chart` and `show_live_chart` tools, the `chart`
skill and the Chart.js config schema to `@cuatoi/web-agent-core`. It provides three entry points:
the framework-agnostic `.` entry, the `./datasource` Elasticsearch translator
and source entry, and the `./lit` custom-element binding. The `.` and
`./datasource` entries pull no framework.

## Guides

| Page | What it covers |
|---|---|
| [Chart (Chart.js integration)](./chart.md) | The `show_chart` and `show_live_chart` tools, config shape, per-type data rules, normalization and validation errors, the chart skill, the chart element and its error messages |
| [Import paths and dependencies](./import-paths.md) | The `.`, `/datasource` and `/lit` entries, how the Elasticsearch source discovers, queries and fails, the optional `web-agent-lit` peer, why the binding lives here |
| [Refresh and datasource charts](./refresh-and-datasource.md) | `ChartBlock` fields, refresh modes, intervals and controls, how an `encoding` becomes a Chart.js config, friendly labels, Elasticsearch source wiring |
| [API reference](./api-reference.md) | Every export of `.`, `/datasource` and `./lit`, with its signature and behavior |

## Related packages

- `@cuatoi/web-agent-core` — the agent loop, tools, skills and session storage
- `@cuatoi/web-agent-lit` — the sample Lit chat UI binding, required only for `@cuatoi/web-agent-charting/lit`
- `@cuatoi/web-agent-mcp` — remote MCP servers as tool providers
- `@cuatoi/web-agent-openapi` — OpenAPI operations as tools