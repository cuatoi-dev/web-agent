import cors from "cors";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandler } from "express";
import type { OrdersStore } from "./orders-store.js";
import { bigJsonReport, bigTextLog } from "./dev-big-tool-results.js";
import { devTwoCharts } from "./dev-two-charts.js";

/** Mirrors `CreateOrderInput` — every field optional; the store fills defaults. */
const placeOrderInputSchema = {
  customer: z.string().optional(),
  category: z.string().optional(),
  total: z.number().optional(),
  status: z.string().optional(),
  itemCount: z.number().int().optional(),
  items: z.string().optional(),
};

/** Wildcard CORS for the MCP route, so any browser-based MCP client can reach it. */
export const mcpCors: RequestHandler = cors({ origin: "*" });

/**
 * A fresh MCP server per connection. One `McpServer` cannot serve two
 * connections — a second `connect()` throws `Already connected to a transport`.
 */
export function buildMcpServer(store: OrdersStore): McpServer {
  const server = new McpServer({ name: "cat-store", version: "0.0.1" });
  server.registerTool(
    "place_order",
    {
      title: "Place order",
      description:
        "Place a new cat-store order. Every field is optional; omitted fields " +
        "default to customer=Guest, category=Food, total=0, status=placed, " +
        "itemCount=1, items=\"\". Returns the created order as JSON.",
      inputSchema: placeOrderInputSchema,
    },
    (input) => {
      const order = store.create(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(order) }] };
    }
  );
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    server.registerTool(
      "dev_big_json_report",
      {
        description: "Return a large JSON report for development verification.",
        inputSchema: {},
      },
      () => ({ content: [{ type: "text" as const, text: bigJsonReport() }] })
    );
    server.registerTool(
      "dev_big_text_log",
      {
        description: "Return a large text log for development verification.",
        inputSchema: {},
      },
      () => ({ content: [{ type: "text" as const, text: bigTextLog() }] })
    );
    server.registerTool(
      "dev_two_charts",
      {
        description: "Return two charts (red bar chart, green line chart) for development verification.",
        inputSchema: {},
      },
      () => devTwoCharts()
    );
  }
  return server;
}

/**
 * Stateless Streamable-HTTP handler: a fresh server + transport per request,
 * torn down when the response closes. No session registry, no eviction policy.
 */
export function createMcpHandler(store: OrdersStore): RequestHandler {
  return async (req, res) => {
    const server = buildMcpServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}

/**
 * Non-POST on /mcp. A stateless server has no standalone notification stream to
 * offer, so it says so rather than letting a later handler answer with
 * index.html — which makes MCP clients reconnect in a loop.
 */
export const mcpMethodNotAllowed: RequestHandler = (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
};
