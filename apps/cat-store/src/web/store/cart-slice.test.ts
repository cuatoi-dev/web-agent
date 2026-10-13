import { describe, it, expect } from "vitest";
import cartReducer, {
  addToCart,
  setQty,
  removeFromCart,
  clearCart,
  selectCartCount,
} from "./cart-slice";
import type { ProductItem } from "./seed";

const product: ProductItem = {
  id: "p01",
  name: "Salmon Pâté",
  category: "Food",
  price: 3.99,
  cost: 2.59,
  inStock: true,
  emoji: "🥫",
};

const product2: ProductItem = {
  id: "p02",
  name: "Tuna Crunchies",
  category: "Food",
  price: 4.49,
  cost: 2.92,
  inStock: true,
  emoji: "🐟",
};

const toyProduct: ProductItem = {
  id: "p05",
  name: "Feather Wand",
  category: "Toys",
  price: 8.99,
  cost: 3.60,
  inStock: true,
  emoji: "🪶",
};

const bedProduct: ProductItem = {
  id: "p09",
  name: "Donut Cat Bed",
  category: "Beds",
  price: 29.99,
  cost: 12.60,
  inStock: true,
  emoji: "🛏️",
};

describe("cart-slice", () => {
  it("addToCart adds a line item", () => {
    const state = cartReducer(undefined, addToCart({ product, qty: 2 }));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].productId).toBe("p01");
    expect(state.items[0].qty).toBe(2);
    expect(state.subtotal).toBe(7.98);
    expect(state.total).toBe(7.98);
  });

  it("addToCart merges same product", () => {
    const s1 = cartReducer(undefined, addToCart({ product, qty: 1 }));
    const s2 = cartReducer(s1, addToCart({ product, qty: 2 }));
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0].qty).toBe(3);
    expect(s2.subtotal).toBe(11.97);
  });

  it("addToCart handles multiple products", () => {
    const s1 = cartReducer(undefined, addToCart({ product, qty: 1 }));
    const s2 = cartReducer(s1, addToCart({ product: product2, qty: 3 }));
    expect(s2.items).toHaveLength(2);
    expect(s2.subtotal).toBe(3.99 + 4.49 * 3);
  });

  it("setQty updates quantity and totals", () => {
    const s1 = cartReducer(undefined, addToCart({ product, qty: 1 }));
    const s2 = cartReducer(s1, setQty({ productId: "p01", qty: 5 }));
    expect(s2.items[0].qty).toBe(5);
    expect(s2.subtotal).toBe(19.95);
    // B3G1 promo: 5 units → 1 free, discount = $3.99
    expect(s2.discount).toBe(3.99);
    expect(s2.total).toBe(15.96);
  });

  it("removeFromCart removes item", () => {
    const s1 = cartReducer(undefined, addToCart({ product, qty: 1 }));
    const s2 = cartReducer(s1, addToCart({ product: product2, qty: 1 }));
    const s3 = cartReducer(s2, removeFromCart({ productId: "p01" }));
    expect(s3.items).toHaveLength(1);
    expect(s3.items[0].productId).toBe("p02");
  });

  it("clearCart empties state", () => {
    const s1 = cartReducer(undefined, addToCart({ product, qty: 2 }));
    const s2 = cartReducer(s1, clearCart());
    expect(s2.items).toHaveLength(0);
    expect(s2.subtotal).toBe(0);
    expect(s2.total).toBe(0);
  });

  it("selectCartCount sums quantities", () => {
    const s1 = cartReducer(undefined, addToCart({ product, qty: 2 }));
    const s2 = cartReducer(s1, addToCart({ product: product2, qty: 3 }));
    const count = selectCartCount({ cart: s2 });
    expect(count).toBe(5);
  });

  describe("promo logic", () => {
    it("B3G1 no free below threshold", () => {
      const state = cartReducer(undefined, addToCart({ product, qty: 2 }));
      expect(state.items[0].freeQty).toBe(0);
      expect(state.discount).toBe(0);
      expect(state.total).toBe(state.subtotal);
    });

    it("B3G1 exact threshold — 1 free", () => {
      const state = cartReducer(undefined, addToCart({ product, qty: 3 }));
      expect(state.items[0].freeQty).toBe(1);
      expect(state.discount).toBe(3.99);
      expect(Number(state.total.toFixed(2))).toBe(7.98);
      expect(state.items[0].promoLabel).toBe("Buy 3 Get 1 Free");
    });

    it("B3G1 double threshold — 2 free", () => {
      const state = cartReducer(undefined, addToCart({ product, qty: 6 }));
      expect(state.items[0].freeQty).toBe(2);
      expect(state.discount).toBe(7.98);
      expect(Number(state.total.toFixed(2))).toBe(15.96);
    });

    it("B5G2 exact threshold — 2 free", () => {
      const state = cartReducer(undefined, addToCart({ product: toyProduct, qty: 5 }));
      expect(state.items[0].freeQty).toBe(2);
      expect(state.discount).toBe(17.98);
      expect(Number(state.total.toFixed(2))).toBe(26.97);
    });

    it("no promo on non-qualifying product", () => {
      const state = cartReducer(undefined, addToCart({ product: bedProduct, qty: 3 }));
      expect(state.items[0].freeQty).toBe(0);
      expect(state.discount).toBe(0);
    });

    it("promoLabel undefined below threshold", () => {
      const state = cartReducer(undefined, addToCart({ product, qty: 2 }));
      expect(state.items[0].promoLabel).toBeUndefined();
    });

    it("freeQty recomputed on setQty", () => {
      let state = cartReducer(undefined, addToCart({ product, qty: 1 }));
      expect(state.items[0].freeQty).toBe(0);
      state = cartReducer(state, setQty({ productId: "p01", qty: 3 }));
      expect(state.items[0].freeQty).toBe(1);
    });
  });
});
