import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

const initialState: UiState = {
  route: "/",
  lastOrder: null,
  toast: null,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setRoute(state, action: PayloadAction<string>) {
      state.route = action.payload;
    },
    placeOrder(state, action: PayloadAction<{ id: string; total: number }>) {
      state.lastOrder = {
        id: action.payload.id,
        total: action.payload.total,
        at: Date.now(),
      };
    },
    clearLastOrder(state) {
      state.lastOrder = null;
    },
    setToast(state, action: PayloadAction<string | null>) {
      state.toast = action.payload;
    },
  },
});

export const { setRoute, placeOrder, clearLastOrder, setToast } = uiSlice.actions;
export default uiSlice.reducer;
