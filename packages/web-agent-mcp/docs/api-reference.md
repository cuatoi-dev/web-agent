---
title: MCP API reference
---

# MCP API reference

This page lists every export in `src/index.ts:1-18` — six functions and six
types.

## Functions

| Export | Signature | Source |
|---|---|---|
| `mcpToolProviders` | `(servers: McpServerConfig[], options?: ConnectMcpOptions & { connect?: typeof connectMcpClient }) => ToolProvider[]` | `src/tool-providers.ts:20-26` |
| `connectMcpClient` | `(serverName: string, serverUrl: string, options?: ConnectMcpOptions) => Promise<McpClientSession>` | `src/client.ts:94-98` |
| `mapMcpToolToCustomToolDef` | `(serverName: string, mcpTool: McpToolInfo, callToolFn: (args: Record<string, unknown>) => Promise<McpCallToolResult>) => CustomToolDef` | `src/client.ts:61-65` |
| `resolveMcpServerUrl` | `(url: string, baseUrl?: string) => string` | `src/client.ts:25-27` |
| `formatMcpContent` | `(content: McpContentBlock[] \| undefined) => { text: string; images: ToolImage[] }` | `src/client.ts:30-58` |
| `sanitizeServerName` | `(name: string) => string` | `src/client.ts:20-22` |

`mcpToolProviders` builds one `ToolProvider` per server. See
[Getting started](./getting-started.md) for wiring and
[Lifecycle and failures](./lifecycle-and-failures.md) for the `required`
degrade rule.

`connectMcpClient` opens the Streamable-HTTP connection and returns an
`McpClientSession`. You call it directly only for a custom `connect` test seam.
Normal hosts call it through `mcpToolProviders`.

`mapMcpToolToCustomToolDef` wraps one MCP tool as a `CustomToolDef`. It prefixes
the name with the sanitized server name, and its `execute` catches a thrown
error into `{ content, isError: true }` (`src/client.ts:74-88`).

`resolveMcpServerUrl` and `sanitizeServerName` are the two small pure helpers
that `connectMcpClient` and `mapMcpToolToCustomToolDef` build on. See
[Server configuration](./server-config.md) for their exact rules.

`formatMcpContent` extracts `text` blocks into a single trimmed string and
converts valid `image` blocks into `ToolImage` items (`{ dataUrl, mediaType }`).
It drops invalid images and other block types (resource, audio) silently
(`src/client.ts:30-58`).

## Types

Every type is declared in `src/types.ts`. `src/client.ts:11-17` and
`src/tool-providers.ts:9` re-export them, and `src/index.ts:2, 12-18`
re-exports them from those two files. You import every type from
`@cuatoi/web-agent-mcp`.

### `McpServerConfig` — `src/types.ts:52-61`

| Field | Type |
|---|---|
| `name` | `string` |
| `description` | `string` |
| `url` | `string` |
| `required` | `boolean` |

All four are required — see [Server configuration](./server-config.md).

### `McpClientSession` — `src/types.ts:3-10`

| Field | Type |
|---|---|
| `serverName` | `string` |
| `serverUrl` | `string` |
| `tools` | `CustomToolDef[]` |
| `client` | `unknown` |
| `transport` | `unknown` |
| `close` | `() => Promise<void>` |

`client` and `transport` are typed `unknown` on purpose — no MCP SDK type
reaches this package's public surface. `close()` is the supported handle for
tearing the connection down.

### `ConnectMcpOptions` — `src/types.ts:12-17`

| Field | Type |
|---|---|
| `clientName` | `string \| undefined` |
| `clientVersion` | `string \| undefined` |
| `timeoutMs` | `number \| undefined` |
| `fetch` | `typeof fetch \| undefined` |

`timeoutMs` is accepted but never read — see
[Server configuration](./server-config.md).

### `McpToolInfo` — `src/types.ts:19-23`

| Field | Type |
|---|---|
| `name` | `string` |
| `description` | `string \| undefined` |
| `inputSchema` | `Record<string, unknown> \| undefined` |

A missing `description` falls back to `` `MCP tool ${name} from ${serverName}` ``;
a missing `inputSchema` falls back to `{ type: "object", properties: {} }`
(`src/client.ts:68, 72`).

### `McpContentBlock` — `src/types.ts:25-31`

| Field | Type |
|---|---|
| `type` | `string` |
| `text` | `string \| undefined` |
| `data` | `string \| undefined` |
| `mimeType` | `string \| undefined` |
| `[key: string]` | `unknown` |

### `McpCallToolResult` — `src/types.ts:33-37`

| Field | Type |
|---|---|
| `content` | `McpContentBlock[] \| undefined` |
| `isError` | `boolean \| undefined` |
| `[key: string]` | `unknown` |

## SDK version

The pinned SDK is `@modelcontextprotocol/sdk` **1.27.0** (`package.json:40`),
which advertises MCP protocol revision **2025-11-25**.
