---
"@cuatoi/web-agent-core": minor
"@cuatoi/web-agent-mcp": minor
---

Add the async `ToolProvider` seam to core — `toolProviders` on `SessionConfig`, loaded
once at session start — and ship the new `@cuatoi/web-agent-mcp` package, which builds
one provider per remote MCP server via `mcpToolProviders()`. Core's built-in `mcpServers`
option is unchanged.
