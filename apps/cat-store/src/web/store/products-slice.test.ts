import { describe, it, expect } from "vitest";
import { SEED_PRODUCTS } from "./seed";
import productsReducer, {
  setFilterCategory,
  selectVisibleProducts,
  selectCategories,
} from "./products-slice";

describe("products-slice", () => {
  const state = { products: productsReducer(undefined, { type: "@@init" }) };

  it("has ≥16 seeded products", () => {
    expect(state.products.items.length).toBeGreaterThanOrEqual(16);
  });

  it("selectVisibleProducts returns all when filter empty", () => {
    const visible = selectVisibleProducts(state);
    expect(visible.length).toBe(state.products.items.length);
  });

  it("selectVisibleProducts filters by category", () => {
    const filtered = selectVisibleProducts({
      products: { items: state.products.items, filterCategory: "Toys" },
    });
    expect(filtered.every((p) => p.category === "Toys")).toBe(true);
  });

  it("setFilterCategory updates filter", () => {
    const next = productsReducer(state.products, setFilterCategory("Food"));
    expect(next.filterCategory).toBe("Food");
  });

  it("selectCategories returns distinct list", () => {
    const cats = selectCategories(state);
    expect(cats).toContain("Food");
    expect(cats).toContain("Toys");
    expect(cats).toContain("Beds");
    expect(cats).toContain("Grooming");
    expect(cats).toContain("Health");
  });

  it("seed data has all expected categories", () => {
    const cats = new Set(SEED_PRODUCTS.map((p) => p.category));
    expect(cats.has("Food")).toBe(true);
    expect(cats.has("Toys")).toBe(true);
    expect(cats.has("Beds")).toBe(true);
    expect(cats.has("Grooming")).toBe(true);
    expect(cats.has("Health")).toBe(true);
  });

  it("every seeded product has a cost below its price", () => {
    for (const p of SEED_PRODUCTS) {
      expect(typeof p.cost).toBe("number");
      expect(p.cost).toBeGreaterThan(0);
      expect(p.cost).toBeLessThan(p.price);
    }
    expect(SEED_PRODUCTS.length).toBeGreaterThan(0);
  });

  it("Toys and Beds carry a fatter margin than Food and Grooming", () => {
    const margin = (c: string) => {
      const rows = SEED_PRODUCTS.filter(p => p.category === c);
      return rows.reduce((s, p) => s + (p.price - p.cost) / p.price, 0) / rows.length;
    };
    expect(Math.min(margin("Toys"), margin("Beds")))
      .toBeGreaterThan(Math.max(margin("Food"), margin("Grooming")));
  });
});
