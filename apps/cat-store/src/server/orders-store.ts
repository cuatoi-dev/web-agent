import { runQuery } from "@cuatoi/web-agent-core";
import type { DataQuery, QueryResult, SourceInfo } from "@cuatoi/web-agent-core";
import { ORDER_FIELDS, generateOrders, type Order } from "../shared/orders.js";

import type { CreateOrderInput } from "./types.js";

export type { CreateOrderInput } from "./types.js";

export class OrdersStore {
  private readonly orders: Order[];
  private counter: number;

  constructor(seedCount = 200) {
    this.orders = generateOrders(seedCount);
    this.counter = this.orders.length;
  }

  get size(): number {
    return this.orders.length;
  }

  // `search` is part of DataQuery since task 002, and runQuery applies it over
  // every string and enum field before filtering (query-engine.ts:23-28). The
  // store no longer prefilters.
  query(q: DataQuery): QueryResult {
    return runQuery([...this.orders], ORDER_FIELDS, q);
  }

  describe(): SourceInfo {
    return {
      name: "orders",
      description: "Historical customer orders",
      fields: ORDER_FIELDS,
      rowCount: this.orders.length,
    };
  }

  create(input: CreateOrderInput = {}): Order {
    this.counter++;
    const order: Order = {
      id: `ORD-${1000 + this.counter}`,
      createdAt: new Date().toISOString(),
      customer: input.customer ?? "Guest",
      category: input.category ?? "Food",
      total: input.total ?? 0,
      status: input.status ?? "placed",
      itemCount: input.itemCount ?? 1,
      items: input.items ?? "",
    };
    this.orders.unshift(order);
    return order;
  }
}
