import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import { OrdersStore } from "./orders-store.js";
import { createOrdersRouter } from "./orders-routes.js";
import { readEsConfig } from "./es-config.js";
import { createEsProxyRouter, createEsNotConfiguredRouter } from "./es-proxy-routes.js";
import { createMcpHandler, mcpCors, mcpMethodNotAllowed } from "./mcp.js";
import { createGenuiRouter } from "./genui-routes.js";

/** Builds the Express app. Takes the store and optional static assets dir. */
export function createApp(
  store: OrdersStore = new OrdersStore(),
  staticDir: string = path.resolve(process.cwd(), "dist/web")
): Express {
  const app = express();
  app.use(express.json());

  // 1. Backend API routes take precedence
  app.use("/api/orders", createOrdersRouter(store));

  // 1a. The Elasticsearch proxy. It attaches the credentials and forwards;
  //     the browser builds the query. /api/orders above is untouched.
  const es = readEsConfig();
  app.use(
    "/api/es-orders",
    es.ok ? createEsProxyRouter(es.config) : createEsNotConfiguredRouter(es.missing),
  );

  // 1b. Remote MCP endpoint (stateless Streamable HTTP), wildcard CORS.
  //     Registered here — above the trailing-slash redirect and the static
  //     handler — so /mcp is never served index.html. POST handles JSON-RPC
  //     messages; GET with text/event-stream handles the client's optional
  //     SSE stream without logging a 405 error in the browser console.
  //     Non-matching requests get 405.
  app.use("/mcp", mcpCors);
  app.post("/mcp", createMcpHandler(store));
  app.get("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.accept?.includes("text/event-stream")) {
      createMcpHandler(store)(req, res, next);
      return;
    }
    mcpMethodNotAllowed(req, res, next);
  });
  app.all("/mcp", mcpMethodNotAllowed);

  // 1c. Generative UI frame delivery and static assets
  app.use("/genui", createGenuiRouter(staticDir));

  // 2. Trailing slash normalization for client paths (e.g. /orders/ -> /orders)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" && req.path.length > 1 && req.path.endsWith("/")) {
      const target = req.path.slice(0, -1) + req.url.slice(req.path.length);
      res.redirect(301, target);
      return;
    }
    next();
  });

  // 3. Serve real static files from dist/web
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
  }

  return app;
}
