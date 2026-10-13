---
"@cuatoi/web-agent-openapi": minor
---

Add `@cuatoi/web-agent-openapi`, which moves the declarative OpenAPI API-call tools out of
core. `openApiToolProviders(sources, options?)` returns a single `ToolProvider` for
`SessionConfig.toolProviders`, covering the whole source list so cross-source tool-name
collisions are still detected. Core's built-in `apiSources` option is unchanged.
