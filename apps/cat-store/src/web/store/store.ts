import { configureStore } from "@reduxjs/toolkit";
import productsReducer from "./products-slice";
import cartReducer from "./cart-slice";
import uiReducer from "./ui-slice";

export const store = configureStore({
  reducer: {
    products: productsReducer,
    cart: cartReducer,
    ui: uiReducer,
  },
});

if (typeof window !== "undefined") {
  (window as Window & { __APP_STORE__?: typeof store }).__APP_STORE__ = store;
}
