---
"@cuatoi/web-agent-core": major
"@cuatoi/web-agent-lit": major
---

Removed built-in MCP server support and `@modelcontextprotocol/sdk` dependency from `@cuatoi/web-agent-core`. Hosts using MCP servers should install `@cuatoi/web-agent-mcp` and pass `toolProviders: mcpToolProviders(servers)` to SessionConfig or `<agent-chat-panel>`.
