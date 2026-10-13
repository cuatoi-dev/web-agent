import { SourceEntry, SourceInfo, QueryResult, DataQuery, FieldSchema, FieldAllowEntry } from "@cuatoi/web-agent-lit";
import { describeOrders, queryOrders } from "./backend";
import { runQuery } from "@cuatoi/web-agent-lit";
import { createEsOrdersSource } from "./es-source";
import type { RootState } from "../store";

export const PRODUCT_FIELDS: FieldSchema[] = [
  { name: "id", type: "string" },
  { name: "name", type: "string" },
  { name: "category", type: "enum", enumValues: ["Food", "Toys", "Beds", "Grooming", "Health"] },
  { name: "price", type: "number" },
  { name: "cost", type: "number" },
  { name: "inStock", type: "boolean" },
];

/** What the agent may see on the products source, and what it calls each field.
 *  Every field is exposed: the agent needs `cost` for margin and `inStock` for
 *  restock advice. */
export const PRODUCT_ALLOW_FIELDS: FieldAllowEntry[] = [
  { name: "id", label: "Product code" },
  { name: "name", label: "Product name" },
  { name: "category", label: "Product type" },
  { name: "price", label: "Shelf price" },
  { name: "cost", label: "Unit cost" },
  { name: "inStock", label: "In stock" },
];

export const CART_FIELDS: FieldSchema[] = [
  { name: "productId", type: "string" },
  { name: "name", type: "string" },
  { name: "price", type: "number" },
  { name: "qty", type: "number" },
  { name: "lineTotal", type: "number" },
];

/** Test-only wide schema for the orders source, activated with ?wideOrders=1.
 *  50 fields exceeds the default wide-source threshold of 40, so a row query
 *  with no column selection trips the selectRequiredForWideSource guardrail.
 *  This lets a natural question demonstrate the guardrail's recovery path
 *  without changing any shipped prompt or core behaviour. */
export const WIDE_ORDERS_FIELDS: FieldSchema[] = [
  { name: "orderId", type: "string" },
  { name: "customerName", type: "string" },
  { name: "customerEmail", type: "string" },
  { name: "customerPhone", type: "string" },
  { name: "status", type: "enum", enumValues: ["placed", "shipped", "delivered", "cancelled"] },
  { name: "total", type: "number" },
  { name: "currency", type: "string" },
  { name: "subtotal", type: "number" },
  { name: "tax", type: "number" },
  { name: "shippingCost", type: "number" },
  { name: "discountCode", type: "string" },
  { name: "discountAmount", type: "number" },
  { name: "paymentMethod", type: "string" },
  { name: "paymentStatus", type: "string" },
  { name: "billingAddress", type: "string" },
  { name: "billingCity", type: "string" },
  { name: "billingState", type: "string" },
  { name: "billingZip", type: "string" },
  { name: "billingCountry", type: "string" },
  { name: "shippingAddress", type: "string" },
  { name: "shippingCity", type: "string" },
  { name: "shippingState", type: "string" },
  { name: "shippingZip", type: "string" },
  { name: "shippingCountry", type: "string" },
  { name: "shippingCarrier", type: "string" },
  { name: "trackingNumber", type: "string" },
  { name: "estimatedDelivery", type: "string" },
  { name: "actualDelivery", type: "string" },
  { name: "itemCount", type: "number" },
  { name: "weightKg", type: "number" },
  { name: "notes", type: "string" },
  { name: "priority", type: "string" },
  { name: "channel", type: "string" },
  { name: "sourceApp", type: "string" },
  { name: "referrer", type: "string" },
  { name: "ipAddress", type: "string" },
  { name: "userAgent", type: "string" },
  { name: "deviceType", type: "string" },
  { name: "createdAt", type: "string" },
  { name: "updatedAt", type: "string" },
  { name: "cancelledAt", type: "string" },
  { name: "refundedAmount", type: "number" },
  { name: "loyaltyPointsEarned", type: "number" },
  { name: "loyaltyPointsUsed", type: "number" },
  { name: "giftWrap", type: "boolean" },
  { name: "giftMessage", type: "string" },
  { name: "couponApplied", type: "boolean" },
  { name: "salesRep", type: "string" },
  { name: "warehouseId", type: "string" },
  { name: "tags", type: "string" },
];

export function createSampleWideOrders(count: number = 20): Record<string, unknown>[] {
  const statuses = ["placed", "shipped", "delivered", "cancelled"];
  const customers = ["Alice Smith", "Bob Jones", "Charlie Brown", "Diana Prince", "Evan Wright"];
  return Array.from({ length: count }, (_, i) => ({
    orderId: `ord-${1000 + i}`,
    customerName: customers[i % customers.length],
    customerEmail: `customer${i + 1}@example.com`,
    customerPhone: `+1-555-010${i % 10}`,
    status: statuses[i % statuses.length],
    total: Math.round((25.5 + i * 14.75) * 100) / 100,
    currency: "USD",
    subtotal: Math.round((20.0 + i * 12.5) * 100) / 100,
    tax: Math.round((2.5 + i * 1.25) * 100) / 100,
    shippingCost: 5.0,
    discountCode: i % 3 === 0 ? "SAVE10" : "",
    discountAmount: i % 3 === 0 ? 10.0 : 0.0,
    paymentMethod: "Credit Card",
    paymentStatus: "completed",
    billingAddress: `${100 + i} Main Street`,
    billingCity: "Metropolis",
    billingState: "NY",
    billingZip: "10001",
    billingCountry: "US",
    shippingAddress: `${100 + i} Main Street`,
    shippingCity: "Metropolis",
    shippingState: "NY",
    shippingZip: "10001",
    shippingCountry: "US",
    shippingCarrier: "FastPost",
    trackingNumber: `TRK${90000 + i}`,
    estimatedDelivery: "2026-08-30",
    actualDelivery: i % 2 === 0 ? "2026-08-29" : "",
    itemCount: 1 + (i % 5),
    weightKg: 0.5 + (i % 3) * 0.4,
    notes: "Leave at front door",
    priority: i % 4 === 0 ? "high" : "normal",
    channel: "web",
    sourceApp: "cat-store-spa",
    referrer: "direct",
    ipAddress: `192.168.1.${10 + i}`,
    userAgent: "Mozilla/5.0",
    deviceType: "desktop",
    createdAt: `2026-08-${String(10 + (i % 15)).padStart(2, "0")}T10:00:00Z`,
    updatedAt: `2026-08-${String(10 + (i % 15)).padStart(2, "0")}T12:00:00Z`,
    cancelledAt: "",
    refundedAmount: 0,
    loyaltyPointsEarned: 10 + i * 2,
    loyaltyPointsUsed: 0,
    giftWrap: i % 5 === 0,
    giftMessage: i % 5 === 0 ? "Happy Birthday!" : "",
    couponApplied: i % 3 === 0,
    salesRep: "Self-service",
    warehouseId: "WH-01",
    tags: "retail,organic",
  }));
}

/** In-memory orders source backed by the 50-field wide schema. */
export function createWideOrdersSource(sampleCount: number = 20): SourceEntry {
  const items = createSampleWideOrders(sampleCount);
  return {
    describe(): SourceInfo {
      return {
        name: "orders",
        description: "Cat store customer orders (wide format)",
        fields: WIDE_ORDERS_FIELDS,
        rowCount: items.length,
      };
    },
    query(q: DataQuery): Promise<QueryResult> {
      return Promise.resolve(runQuery(items, WIDE_ORDERS_FIELDS, q));
    },
  };
}

export function getCatSources(getState: () => RootState): SourceEntry[] {
  // ?wideOrders=1 swaps the standard 8-field orders backend for the test-only
  // 50-field in-memory source, following the ?esIndex= override pattern.
  const isWide =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("wideOrders") === "1";

  const ordersSource: SourceEntry = isWide
    ? createWideOrdersSource()
    : {
        describe: describeOrders,
        query: queryOrders,
      };

  const productsSource: SourceEntry = {
    allowFields: PRODUCT_ALLOW_FIELDS,
    describe(): SourceInfo {
      const state = getState();
      const items = state?.products?.items ?? [];
      return { name: "products", description: "Live product catalog", fields: PRODUCT_FIELDS, rowCount: items.length };
    },
    query(q: DataQuery): Promise<QueryResult> {
      const state = getState();
      const items: Record<string, unknown>[] = (state?.products?.items ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        cost: p.cost,
        inStock: p.inStock,
      }));
      return Promise.resolve(runQuery(items, PRODUCT_FIELDS, q));
    },
  };

  const cartSource: SourceEntry = {
    describe(): SourceInfo {
      const state = getState();
      const items = state?.cart?.items ?? [];
      return { name: "cart", description: "Current shopping cart contents", fields: CART_FIELDS, rowCount: items.length };
    },
    query(q: DataQuery): Promise<QueryResult> {
      const state = getState();
      const rawItems = state?.cart?.items ?? [];
      const items: Record<string, unknown>[] = rawItems.map((item) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        qty: item.qty,
        lineTotal: item.price * item.qty,
      }));
      return Promise.resolve(runQuery(items, CART_FIELDS, q));
    },
  };

  // Fourth source: Elasticsearch, read through the credential-attaching proxy.
  // If Elasticsearch is down, createDataSourceProvider's try/catch skips it and
  // the other three carry on (provider.ts:24-32).
  return [ordersSource, productsSource, cartSource, createEsOrdersSource()];
}
