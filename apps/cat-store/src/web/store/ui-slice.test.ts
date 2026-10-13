import { describe, it, expect } from "vitest";
import uiReducer, { setRoute, placeOrder, setToast } from "./ui-slice";

describe("ui-slice", () => {
  it("setRoute updates route", () => {
    const state = uiReducer(undefined, setRoute("/store"));
    expect(state.route).toBe("/store");
  });

  it("placeOrder sets lastOrder", () => {
    const state = uiReducer(undefined, placeOrder({ id: "ORD-1201", total: 25.99 }));
    expect(state.lastOrder).not.toBeNull();
    expect(state.lastOrder!.total).toBe(25.99);
    expect(state.lastOrder!.id).toBe("ORD-1201");
  });

  it("setToast sets message", () => {
    const state = uiReducer(undefined, setToast("Order confirmed"));
    expect(state.toast).toBe("Order confirmed");
  });

  it("setToast null clears message", () => {
    const s1 = uiReducer(undefined, setToast("hi"));
    const s2 = uiReducer(s1, setToast(null));
    expect(s2.toast).toBeNull();
  });
});
