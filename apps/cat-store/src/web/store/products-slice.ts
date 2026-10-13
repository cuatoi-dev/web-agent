import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { SEED_PRODUCTS, ProductItem, ProductCategory, CATEGORIES } from "./seed";
import type { ProductsState } from "./types";

const initialState: ProductsState = {
  items: SEED_PRODUCTS,
  filterCategory: "",
};

const productsSlice = createSlice({
  name: "products",
  initialState,
  reducers: {
    setFilterCategory(state, action: PayloadAction<string>) {
      state.filterCategory = action.payload;
    },
  },
});

export const { setFilterCategory } = productsSlice.actions;
export default productsSlice.reducer;

export const selectVisibleProducts = (state: {
  products: ProductsState;
}): ProductItem[] => {
  const { items, filterCategory } = state.products;
  if (!filterCategory) return items;
  return items.filter((p) => p.category === filterCategory);
};

export const selectCategories = (state: {
  products: ProductsState;
}): ProductCategory[] => {
  const set = new Set(state.products.items.map((p) => p.category));
  return CATEGORIES.filter((c) => set.has(c));
};
