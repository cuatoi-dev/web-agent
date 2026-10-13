import { Router } from "express";
import { z } from "zod";
import type { DataQuery } from "@cuatoi/web-agent-core";
import type { OrdersStore } from "./orders-store.js";
import { ordersOpenApiSpec } from "./openapi.js";

const CreateOrderSchema = z.object({
  customer: z.string().optional(),
  category: z.string().optional(),
  total: z.number().optional(),
  status: z.string().optional(),
  itemCount: z.number().int().optional(),
  items: z.string().optional(),
});

function badRequest(res: import("express").Response, message: string): void {
  res.status(400).json({ error: message });
}

export function createOrdersRouter(store: OrdersStore): Router {
  const router = Router();

  // GET /api/orders/describe → SourceInfo
  router.get("/describe", (_req, res) => {
    res.json(store.describe());
  });

  // GET /api/orders/openapi.json → OpenAPI specification
  router.get("/openapi.json", (_req, res) => {
    res.json(ordersOpenApiSpec);
  });

  // GET /api/orders?q=<url-encoded JSON DataQuery> → QueryResult
  router.get("/", (req, res) => {
    const raw = req.query.q;
    let parsed: unknown = {};
    if (raw !== undefined) {
      if (typeof raw !== "string") {
        badRequest(res, "Invalid q parameter: expected a single JSON string");
        return;
      }
      try {
        parsed = JSON.parse(raw);
      } catch {
        badRequest(res, "Invalid q parameter: not valid JSON");
        return;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        badRequest(res, "Invalid q parameter: expected a JSON object");
        return;
      }
    }
    // The endpoint owns the source name; a client-supplied `source` is ignored.
    const q = { ...(parsed as object), source: "orders" } as DataQuery;
    try {
      res.json(store.query(q));
    } catch (err) {
      badRequest(res, err instanceof Error ? err.message : String(err));
    }
  });

  // POST /api/orders → 201 + the created Order
  router.post("/", (req, res) => {
    const parsed = CreateOrderSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      badRequest(
        res,
        parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
      );
      return;
    }
    res.status(201).json(store.create(parsed.data));
  });

  return router;
}
