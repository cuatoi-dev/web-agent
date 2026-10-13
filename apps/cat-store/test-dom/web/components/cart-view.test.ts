import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";

// Polyfill ElementInternals for jsdom before importing material components
if (typeof window !== "undefined") {
  if (!window.ElementInternals) {
    window.ElementInternals = class {} as unknown as typeof ElementInternals;
  }
  const internalsProto = window.ElementInternals.prototype;
  if (!internalsProto.setFormValue) internalsProto.setFormValue = () => {};
  if (!internalsProto.setValidity) internalsProto.setValidity = () => {};
  if (!internalsProto.checkValidity) internalsProto.checkValidity = () => true;
  if (!internalsProto.reportValidity) internalsProto.reportValidity = () => true;
}

import { store } from "../../../src/web/store";
import { addToCart } from "../../../src/web/store/cart-slice";
import { CartView } from "../../../src/web/components/cart-view";

if (!customElements.get("cart-view")) {
  customElements.define("cart-view", CartView);
}

// Products needed for addToCart
const CAT_A = { id: "p1", name: "Cat A", price: 10, cost: 6, category: "Food" as const, inStock: true, emoji: "🐱" };
const CAT_B = { id: "p2", name: "Cat B", price: 20, cost: 12, category: "Food" as const, inStock: true, emoji: "🐱" };

describe("CartView permission attributes", () => {
  beforeEach(() => {
    // Reset cart state — dispatch clearCart to empty it
    store.dispatch({ type: "cart/clearCart" });
    document.body.innerHTML = "";
  });

  async function mountWithItems(qtyA: number, qtyB: number): Promise<ShadowRoot> {
    store.dispatch(addToCart({ product: CAT_A, qty: qtyA }));
    store.dispatch(addToCart({ product: CAT_B, qty: qtyB }));
    const el = document.createElement("cart-view") as CartView;
    document.body.appendChild(el);
    await el.updateComplete;
    return el.shadowRoot!;
  }

  it('Place order button has data-agent-permission="block"', async () => {
    const shadow = await mountWithItems(1, 2);
    const btn = shadow.querySelector("md-filled-button[data-agent-permission='block']");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("data-agent-permission-reason")).toBeTruthy();
  });

  it('Remove buttons have data-agent-permission="ask"', async () => {
    const shadow = await mountWithItems(1, 2);
    const removeBtns = shadow.querySelectorAll("md-icon-button[data-agent-permission='ask']");
    expect(removeBtns.length).toBe(2); // one per cart item
    removeBtns.forEach((btn) => {
      expect(btn.getAttribute("data-agent-permission-reason")).toBeTruthy();
    });
  });

  it('decrement button has data-agent-permission="ask" when qty===1', async () => {
    const shadow = await mountWithItems(1, 2);
    const decBtns = shadow.querySelectorAll(".qty-dec");
    // Find the one for CAT_A (qty=1) — first row
    const decA = decBtns[0];
    expect(decA.getAttribute("data-agent-permission")).toBe("ask");
    expect(decA.getAttribute("data-agent-permission-reason")).toBeTruthy();
  });

  it("decrement button has no data-agent-permission attribute when qty>=2", async () => {
    const shadow = await mountWithItems(1, 2);
    const decBtns = shadow.querySelectorAll(".qty-dec");
    // Second row (CAT_B, qty=2) — no permission gate
    const decB = decBtns[1];
    expect(decB.getAttribute("data-agent-permission")).toBeNull();
  });

  it("increment buttons are unmarked (allow)", async () => {
    const shadow = await mountWithItems(1, 2);
    const incBtns = shadow.querySelectorAll(".qty-inc");
    incBtns.forEach((btn) => {
      expect(btn.getAttribute("data-agent-permission")).toBeNull();
    });
  });

  it("decrement button becomes unmarked after qty increases from 1 to 2", async () => {
    store.dispatch(addToCart({ product: CAT_A, qty: 1 }));
    const el = document.createElement("cart-view") as CartView;
    document.body.appendChild(el);
    await el.updateComplete;

    // Confirm initially gated
    let decBtn = el.shadowRoot!.querySelector(".qty-dec")!;
    expect(decBtn.getAttribute("data-agent-permission")).toBe("ask");

    // Increase qty to 2 in the store
    store.dispatch({ type: "cart/setQty", payload: { productId: CAT_A.id, qty: 2 } });
    await el.updateComplete;

    // Now decrement should be ungated
    decBtn = el.shadowRoot!.querySelector(".qty-dec")!;
    expect(decBtn.getAttribute("data-agent-permission")).toBeNull();
  });
});

/** The exact shape `_placeOrder` passes as the second `fetch` argument — a
 *  plain object literal, never a `Headers`/`Request` instance. */
type FetchInit = { method: string; headers: Record<string, string>; body: string };

describe("CartView place order", () => {
  let fetchMock: Mock<[string, FetchInit?], Promise<Response>>;

  beforeEach(() => {
    store.dispatch({ type: "cart/clearCart" });
    store.dispatch({ type: "ui/setToast", payload: null });
    store.dispatch({ type: "ui/clearLastOrder" });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the cart and sets lastOrder from the server-assigned id", async () => {
    store.dispatch(addToCart({ product: CAT_A, qty: 1 }));
    store.dispatch(addToCart({ product: CAT_B, qty: 2 }));
    const el = document.createElement("cart-view") as CartView;
    document.body.appendChild(el);
    await el.updateComplete;

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "ORD-1201",
          createdAt: new Date().toISOString(),
          customer: "Guest",
          category: "Food",
          total: 50,
          status: "placed",
          itemCount: 3,
          items: "Cat A, Cat B",
        }),
        { status: 201 }
      )
    );

    const btn = el.shadowRoot!.querySelector("md-filled-button[data-agent-permission='block']") as HTMLElement;
    btn.click();

    // Flush promises so _placeOrder async handler runs
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/orders");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body)).toEqual({
      total: 50,
      itemCount: 3,
      items: "Cat A, Cat B",
    });

    expect(store.getState().ui.lastOrder?.id).toBe("ORD-1201");
    expect(store.getState().cart.items).toHaveLength(0);
  });

  it('shows "Order failed" and keeps the cart when the POST fails', async () => {
    store.dispatch(addToCart({ product: CAT_A, qty: 1 }));
    store.dispatch(addToCart({ product: CAT_B, qty: 1 }));
    const el = document.createElement("cart-view") as CartView;
    document.body.appendChild(el);
    await el.updateComplete;

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, statusText: "Server Error" })
    );

    const btn = el.shadowRoot!.querySelector("md-filled-button[data-agent-permission='block']") as HTMLElement;
    btn.click();

    await new Promise((r) => setTimeout(r, 50));

    expect(store.getState().ui.toast).toBe("Order failed");
    expect(store.getState().ui.lastOrder).toBeNull();
    expect(store.getState().cart.items).toHaveLength(2);
  });
});

describe("CartView styles", () => {
  it("lets native form controls inherit the Public Sans base font", () => {
    const css = (CartView.styles as { cssText: string }).cssText;
    expect(css).toContain("font-family: inherit");
  });
});
