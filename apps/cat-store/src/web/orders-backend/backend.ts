import { DataQuery, QueryResult, SourceInfo } from "@cuatoi/web-agent-lit";
import type { Order } from "../../shared/orders";
import type { CreateOrderInput } from "./types";

export type { CreateOrderInput } from "./types";

/** Root-absolute so it works behind the webpack dev proxy (:10030 → :20030),
 *  when Express serves the SPA itself, and behind a reverse proxy. */
const ORDERS_API = "/api/orders";

/** Turns a non-2xx response into an Error carrying the server's message. */
async function failed(res: Response): Promise<Error> {
  let detail = "";
  try {
    const body: unknown = await res.json();
    if (body && typeof (body as { error?: unknown }).error === "string") {
      detail = `: ${(body as { error: string }).error}`;
    }
  } catch {
    // non-JSON body — fall through to the status line
  }
  return new Error(`HTTP ${res.status} ${res.statusText}${detail}`);
}

export async function queryOrders(q: DataQuery): Promise<QueryResult> {
  const res = await fetch(`${ORDERS_API}?q=${encodeURIComponent(JSON.stringify(q))}`);
  if (!res.ok) throw await failed(res);
  return (await res.json()) as QueryResult;
}

export async function describeOrders(): Promise<SourceInfo> {
  const res = await fetch(`${ORDERS_API}/describe`);
  if (!res.ok) throw await failed(res);
  return (await res.json()) as SourceInfo;
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const res = await fetch(ORDERS_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await failed(res);
  return (await res.json()) as Order;
}
