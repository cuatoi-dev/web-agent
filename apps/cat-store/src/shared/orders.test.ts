import { describe, it, expect } from "vitest";
import { generateOrders, ORDER_FIELDS } from "./orders";

const ORDERS = generateOrders(200);

describe("seed", () => {
  it("generateOrders is deterministic and produces same output across calls", () => {
    const list1 = generateOrders(200);
    const list2 = generateOrders(200);
    expect(list1).toEqual(list2);
  });

  it("assigns all status and category values within their defined enums", () => {
    const statusField = ORDER_FIELDS.find(f => f.name === "status")!;
    const categoryField = ORDER_FIELDS.find(f => f.name === "category")!;

    expect(statusField.enumValues).toBeDefined();
    expect(categoryField.enumValues).toBeDefined();

    for (const order of ORDERS) {
      expect(statusField.enumValues).toContain(order.status);
      expect(categoryField.enumValues).toContain(order.category);
    }
  });

  it("creates valid ISO date strings for createdAt spanning multiple months", () => {
    let minTime = Infinity;
    let maxTime = -Infinity;

    for (const order of ORDERS) {
      expect(() => new Date(order.createdAt)).not.toThrow();
      const time = new Date(order.createdAt).getTime();
      expect(isNaN(time)).toBe(false);
      
      // Match ISO 8601 string format
      expect(order.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      if (time < minTime) minTime = time;
      if (time > maxTime) maxTime = time;
    }

    const diffMs = maxTime - minTime;
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);
    // Should span roughly 12 months, let's verify it is at least 6 months
    expect(diffMonths).toBeGreaterThan(6);
  });

  it("matches ORDER_FIELDS schemas with actual generated data types", () => {
    for (const order of ORDERS) {
      for (const field of ORDER_FIELDS) {
        const val = order[field.name];
        expect(val).toBeDefined();

        if (field.type === "string") {
          expect(typeof val).toBe("string");
        } else if (field.type === "number") {
          expect(typeof val).toBe("number");
        } else if (field.type === "date") {
          expect(typeof val).toBe("string");
          expect(isNaN(Date.parse(val as string))).toBe(false);
        } else if (field.type === "enum") {
          expect(typeof val).toBe("string");
          expect(field.enumValues).toContain(val);
        }
      }
    }
  });

  function itemCountOf(items: string): number {
    return items === "" ? 0 : items.split(", ").length;
  }

  it.each([1, 200, 2000])("itemCount equals the number of listed items for n=%i", (n) => {
    const list = generateOrders(n);
    expect(list.length).toBe(n);
    const mismatched = list.filter(o => o.itemCount !== itemCountOf(o.items));
    // Name the offenders so a failure is diagnosable, not just a count.
    expect(mismatched.map(o => `${o.id}: itemCount=${o.itemCount} items="${o.items}"`)).toEqual([]);
  });

  it("never produces an order with zero items", () => {
    for (const order of generateOrders(2000)) {
      expect(order.itemCount).toBeGreaterThanOrEqual(1);
      expect(order.items).not.toBe("");
    }
  });

  it("keeps itemCount varied across the dataset", () => {
    const counts = new Set(generateOrders(200).map(o => o.itemCount));
    expect(counts.size).toBeGreaterThanOrEqual(2);
  });
});
