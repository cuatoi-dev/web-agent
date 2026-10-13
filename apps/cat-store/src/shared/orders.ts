// Shared orders contract. Imported by the browser tree (src/web/**) and by the
// Express server (src/server/**) — keep it free of DOM and of Node built-ins.
import type { FieldSchema } from "@cuatoi/web-agent-core";

import type { Order } from "./types.js";

export type { Order } from "./types.js";

export const ORDER_FIELDS: FieldSchema[] = [
  { name: "id", type: "string", description: "Order ID" },
  { name: "createdAt", type: "date", description: "Order creation timestamp" },
  { name: "customer", type: "string", description: "Customer name" },
  { name: "category", type: "enum", enumValues: ["Food", "Toys", "Beds", "Grooming", "Health"], description: "Product category" },
  { name: "total", type: "number", description: "Total amount in USD" },
  { name: "status", type: "enum", enumValues: ["placed", "shipped", "delivered", "cancelled"], description: "Order status" },
  { name: "itemCount", type: "number", description: "Number of items in the order" },
  { name: "items", type: "string", description: "Comma-separated list of items" }
];

function createRandom(seed: number) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function generateOrders(n = 200): Order[] {
  const rng = createRandom(12345);
  const categories = ["Food", "Toys", "Beds", "Grooming", "Health"];
  const statuses = ["placed", "shipped", "delivered", "cancelled"];
  const customers = [
    "Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Heidi", "Ivan", "Jack",
    "Karen", "Leo", "Mallory", "Niaj", "Olivia", "Peggy", "Rupert", "Sybil", "Trent", "Victor"
  ];
  const itemTemplates: Record<string, string[]> = {
    Food: ["Premium Salmon Pate", "Dry Kitten Kibble", "Tuna flakes in jelly", "Organic Cat Grass", "Chicken & Rice formula"],
    Toys: ["Laser Pointer Chaser", "Feather Wand Toy", "Catnip Mouse Set", "Squeaking Ball", "Interactive Maze Box"],
    Beds: ["Orthopedic Donut Bed", "Window Sill Hammock", "Heated Cozy Cave", "Self-Warming Mat", "Cardboard Scratching Post"],
    Grooming: ["Shedding Slicker Brush", "Gentle Cat Shampoo", "Claw Trimmer Tool", "De-shedding Glove", "Ear Cleaning Wipes"],
    Health: ["Hairball Remedy Gel", "Multi-Vitamin Drops", "Flea & Tick Collar", "Probiotic Powder", "Calming Spray"]
  };

  const baseDate = new Date("2026-06-24T00:00:00.000Z");
  const orders: Order[] = [];

  for (let i = 1; i <= n; i++) {
    const category = categories[Math.floor(rng() * categories.length)];
    const status = statuses[Math.floor(rng() * statuses.length)];
    const customer = customers[Math.floor(rng() * customers.length)];

    const itemsPool = itemTemplates[category];
    // How many times to draw. Draws that repeat an already-selected item are
    // dropped, so this is an upper bound on the item count, not the count.
    const drawCount = Math.floor(rng() * 3) + 1;
    const selectedItems: string[] = [];
    for (let j = 0; j < drawCount; j++) {
      const it = itemsPool[Math.floor(rng() * itemsPool.length)];
      if (!selectedItems.includes(it)) {
        selectedItems.push(it);
      }
    }
    const items = selectedItems.join(", ");
    // Derive the count from the list so the two can never disagree. The first
    // draw always pushes (the list starts empty), so this is at least 1.
    const itemCount = selectedItems.length;
    const total = Math.round((rng() * 245 + 5) * 100) / 100;

    // Spread dates across ~12 months (365 days)
    const offsetMinutes = rng() * 365 * 24 * 60;
    const createdAtDate = new Date(baseDate.getTime() - offsetMinutes * 60 * 1000);
    const createdAt = createdAtDate.toISOString();

    orders.push({
      id: `ORD-${1000 + i}`,
      createdAt,
      customer,
      category,
      total,
      status,
      itemCount,
      items
    });
  }

  // Sort orders by createdAt desc (newest first)
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return orders;
}
