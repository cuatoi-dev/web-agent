---
title: MCP server configuration
---

# MCP server configuration

## `McpServerConfig`

All four fields are required (`src/types.ts:52-61`):

| Field | Type | Required | What it does |
|---|---|---|---|
| `name` | `string` | yes | Short id. Also the tool-name prefix after sanitizing. |
| `description` | `string` | yes | Reaches the model as one `# Tool guidelines` line. |
| `url` | `string` | yes | Streamable-HTTP MCP endpoint. Absolute, or relative to the page. |
| `required` | `boolean` | yes | `true` → load failure is a hard startup error. `false` → logged and skipped. |

**`required` has no default** — every server must state its degrade intent
explicitly rather than inherit one.

## Tool-name prefixing

`sanitizeServerName(name)` replaces every character outside `[a-zA-Z0-9_]`
with `_`, strips leading and trailing underscores, and falls back to `"mcp"`
for an empty result. The final tool name is `` `${prefix}_${mcpTool.name}` ``.
Worked rows, each covered by `src/client.test.ts:13-15`:

| `name` | prefix | a tool `place_order` becomes |
|---|---|---|
| `cat-store` | `cat_store` | `cat_store_place_order` |
| `my.server!v1` | `my_server_v1` | `my_server_v1_place_order` |
| `""` | `mcp` | `mcp_place_order` |

Sources: `src/client.ts:20-22, 66-67`;
`packages/web-agent-core/src/utils/sanitize-name.ts:5-7`.

## How `url` is resolved

`resolveMcpServerUrl(url, baseUrl?)` returns a string matching
`/^https?:\/\//i` unchanged. It resolves anything else with
`new URL(url, base)`, where `base` is `baseUrl`, else `window.location.href`,
else `"http://localhost"` when there is no `window`.
Source: `packages/web-agent-core/src/utils/resolve-url.ts:2-7`; test coverage
`src/client.test.ts:20-32`.

**Note:** `connectMcpClient` calls `resolveMcpServerUrl(serverUrl)` with
**no** base argument (`src/client.ts:99`), so in a browser the page URL is
always the base. A relative `url` like `"mcp"` resolves against wherever the
page is served, not against a fixed path.

## `ConnectMcpOptions`

Quoting `src/types.ts:12-17`:

| Option | Type | Default | Effect |
|---|---|---|---|
| `clientName` | `string` | `"web-agent-client"` | Client name sent in the MCP handshake. |
| `clientVersion` | `string` | `"0.1.0"` | Client version sent in the handshake. Not the package version. |
| `fetch` | `typeof fetch` | the global `fetch` | Passed to `StreamableHTTPClientTransport`. Use it to add headers or auth. |
| `timeoutMs` | `number` | — | **Accepted by the type but not used.** `connectMcpClient` never reads it, so setting it has no effect. |

Sources for the `timeoutMs` row: `src/types.ts:15` (declared), `src/client.ts:113-123`
(every place `options` is read).

## Passing options

`mcpToolProviders(servers, options?)` forwards `options` to every server's
`connectMcpClient` call (`src/tool-providers.ts:34`), so the options are
per-call-site, not per-server. `options.connect` is a test seam that replaces
the network call. It defaults to `connectMcpClient`, and it lets tests supply a
mock without a real MCP server (`src/tool-providers.ts:22-27`).
