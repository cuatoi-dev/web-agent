# @web-agent/cat-store

Full-stack demo cat-store host application for the `@cuatoi/web-agent-*` packages: a Lit 3
single-page application (SPA), an Express 5 backend orders API, and a remote
Model Context Protocol (MCP) tool endpoint that shares the same `OrdersStore`.

## Running locally

This app is private and is not published on npm. Run it from the workspace root:

```bash
pnpm install
# Terminal 1: build and start the Express orders and MCP server (port 20030)
pnpm --filter @web-agent/cat-store build:server
pnpm --filter @web-agent/cat-store start:server
# Terminal 2: start the Webpack dev server (http://localhost:10030/)
pnpm --filter @web-agent/cat-store dev
```

The Webpack dev server proxies `/api/orders` and `/mcp` to `http://localhost:20030`.

## Architecture

- **SPA**: Lit 3 web components (`src/web`)
- **Backend API**: Express 5 REST order endpoints (`src/server/orders-routes.ts`)
- **Remote MCP Endpoint**: stateless Streamable HTTP MCP server (`src/server/mcp.ts`)

### Deployment

The app runs as a Node.js service on port `20030`, for example under pm2. A
reverse proxy (Apache, nginx, Caddy or Traefik)
serves it at the `/cat-store/` path and strips that prefix, so the app itself
serves the REST API at `/api/orders` and MCP at `/mcp`. The same proxy serves
the LLM routes described in [providers.md](../../packages/web-agent-core/docs/providers.md).

- Local dev server: `http://localhost:10030/`
- Backend server (direct): `http://localhost:20030/`

## REST orders API

- `GET /api/orders` — query orders (JSON `q` param, DataQuery-style); returns
  rows plus `page.total`
- `GET /api/orders/describe` — source metadata
- `GET /api/orders/openapi.json` — OpenAPI specification
- `POST /api/orders` — create an order (`201`); body mirrors `CreateOrderInput`
  (all fields optional)

Orders live in an in-memory `OrdersStore` and reset on restart.

## Remote MCP endpoint

The cat-store exposes a remote, stateless Model Context Protocol (MCP) server
using the Streamable HTTP transport over JSON-RPC 2.0. Each request gets a fresh
server + transport (no session registry), so any number of clients can connect
without state collisions.

- **Endpoint Path**: `/mcp` (served at `/cat-store/mcp` behind the reverse proxy)
- **Local URL**: `http://localhost:20030/mcp` (or `http://localhost:10030/mcp` through the dev server proxy)
- **Protocol Version**: `2025-11-25`
- **Authentication**: unauthenticated (public)
- **CORS**: wildcard (`Access-Control-Allow-Origin: *`), survives the reverse proxy hop
- **Non-POST requests**: HTTP `405 Method Not Allowed` with a JSON body

### Exposed tools

#### `place_order`

Places a new order into the shared `OrdersStore` and returns the created order
as JSON text.

**Input schema** — every field is optional; omitted fields default to:

| Field | Type | Default |
|---|---|---|
| `customer` | string | `"Guest"` |
| `category` | string | `"Food"` |
| `total` | number | `0` |
| `status` | string | `"placed"` |
| `itemCount` | integer | `1` |
| `items` | string | `""` |

### Example MCP client usage (TypeScript / Node.js)

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:20030/mcp")
  );

  const client = new Client(
    { name: "cat-store-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // List available tools
  const tools = await client.listTools();
  console.log("Tools:", tools);

  // Call the place_order tool
  const result = await client.callTool({
    name: "place_order",
    arguments: {
      customer: "Alice",
      category: "Toys",
      total: 49.99,
      items: "Cat Wand, Feather Mouse"
    }
  });

  console.log("Order Result:", result);
  await client.close();
}

main().catch(console.error);
```
