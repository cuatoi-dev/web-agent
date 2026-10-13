import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { ProductItem } from "./seed";
import { findPromoForProduct } from "./promotions";
import type { CartLineItem, CartState } from "./types";

export type { CartLineItem } from "./types";

const initialState: CartState = {
  items: [],
  subtotal: 0,
  discount: 0,
  total: 0,
};

const recalc = (
  items: CartLineItem[],
): { items: CartLineItem[]; subtotal: number; discount: number; total: number } => {
  let subtotal = 0;
  let discount = 0;
  const enriched: CartLineItem[] = items.map((item) => {
    const promo = findPromoForProduct(item.productId);
    const freeQty = promo ? Math.floor(item.qty / promo.buyQty) * promo.freeQty : 0;
    const promoLabel = freeQty > 0 ? promo!.label : undefined;
    subtotal += item.price * item.qty;
    discount += item.price * freeQty;
    return { ...item, freeQty, promoLabel };
  });
  return {
    items: enriched,
    subtotal: Number(subtotal.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    total: Number((subtotal - discount).toFixed(2)),
  };
};

const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    addToCart(state, action: PayloadAction<{ product: ProductItem; qty: number }>) {
      const { product, qty } = action.payload;
      const existing = state.items.find((i) => i.productId === product.id);
      if (existing) {
        existing.qty += qty;
      } else {
        state.items.push({ productId: product.id, name: product.name, price: product.price, qty, freeQty: 0 });
      }
      const calc = recalc(state.items);
      state.items = calc.items;
      state.subtotal = calc.subtotal;
      state.discount = calc.discount;
      state.total = calc.total;
    },
    setQty(state, action: PayloadAction<{ productId: string; qty: number }>) {
      const item = state.items.find((i) => i.productId === action.payload.productId);
      if (item) {
        item.qty = action.payload.qty;
      }
      const calc = recalc(state.items);
      state.items = calc.items;
      state.subtotal = calc.subtotal;
      state.discount = calc.discount;
      state.total = calc.total;
    },
    removeFromCart(state, action: PayloadAction<{ productId: string }>) {
      state.items = state.items.filter((i) => i.productId !== action.payload.productId);
      const calc = recalc(state.items);
      state.items = calc.items;
      state.subtotal = calc.subtotal;
      state.discount = calc.discount;
      state.total = calc.total;
    },
    clearCart() {
      return initialState;
    },
  },
});

export const { addToCart, setQty, removeFromCart, clearCart } = cartSlice.actions;
export default cartSlice.reducer;

export const selectCartCount = (state: { cart: CartState }): number =>
  state.cart.items.reduce((s, i) => s + i.qty, 0);

export const selectCartDiscount = (state: { cart: CartState }): number =>
  state.cart.discount;

export const selectCart = (state: { cart: CartState }): CartState => state.cart;
