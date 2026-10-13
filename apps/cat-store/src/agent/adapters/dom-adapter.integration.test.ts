import { beforeAll, describe, it, expect, vi } from "vitest";
import { DomAdapter } from "@cuatoi/web-agent-dom";
import { OrdersStore } from "../../server/orders-store";
import type { DataQuery } from "@cuatoi/web-agent-core";

describe("DomAdapter INTEGRATION", () => {
  beforeAll(async () => {
    await import("../../web/components/app-root");
    await import("../../web/components/landing-view");
    await import("../../web/components/store-view");
    await import("../../web/components/cart-view");
    await import("../../web/components/toast-host");
    await import("../../web/components/product-card");
    await import("../../web/store");
    await import("@material/web/button/filled-button.js");
    await import("@material/web/button/outlined-button.js");
    await import("@material/web/icon/icon.js");
    await import("@material/web/iconbutton/icon-button.js");
    await import("@material/web/textfield/filled-text-field.js");
  }, 30_000);

  // -----------------------------------------------------------------------
  // INTEGRATION: real Lit cat-store components with shadow DOM
  // -----------------------------------------------------------------------
  describe("snapshot — INTEGRATION with real Lit components", () => {
    it("captures product cards, Add to cart buttons, category select, qty inputs from shadow DOM", async () => {
      const host = document.createElement("div");
      host.id = "host";
      document.body.appendChild(host);
      host.innerHTML = "<app-root></app-root>";
      await new Promise((r) => setTimeout(r, 200));

      const { navigate } = await import("../../web/router");
      navigate("/store");
      await new Promise((r) => setTimeout(r, 300));

      const a = new DomAdapter({ snapshotMaxChars: 8_000 });
      const out = await a.snapshot({});

      expect(out).toMatch(/button "Add .* to cart"/);
      expect(out).toContain("combobox");
      expect(out).toContain("options=");
      expect(out).toContain("spinbutton");
      expect(out).toMatch(/\[\d+\] button "Add .* to cart"/);
      expect(out).toMatch(/\[\d+\] spinbutton/);

      document.body.removeChild(host);
    });
  });

  describe("click", () => {
    it("INTEGRATION: clicks real cat-store Add-to-cart button and updates Redux cart", async () => {
      const adapter = new DomAdapter({});
      await import("../../web/components/app-root");
      await import("../../web/components/landing-view");
      await import("../../web/components/store-view");
      await import("../../web/components/cart-view");
      await import("../../web/components/toast-host");
      await import("../../web/components/product-card");
      const { store } = await import("../../web/store");
      const { clearCart } = await import("../../web/store/cart-slice");
      store.dispatch(clearCart());
      await import("@material/web/button/filled-button.js");
      await import("@material/web/button/outlined-button.js");
      await import("@material/web/icon/icon.js");
      await import("@material/web/iconbutton/icon-button.js");
      await import("@material/web/textfield/filled-text-field.js");

      const host = document.createElement("div");
      host.id = "host-click-integration";
      document.body.appendChild(host);
      host.innerHTML = "<app-root></app-root>";
      await new Promise((r) => setTimeout(r, 200));

      const { navigate } = await import("../../web/router");
      navigate("/store");
      await new Promise((r) => setTimeout(r, 300));

      const initialCount = store.getState().cart.items.length;

      const out = await adapter.snapshot({});
      const match = out.match(/\[(\d+)\] button "Add Salmon Pâté to cart"/);
      expect(match).not.toBeNull();
      const ref = match![1];

      const clickResult = await adapter.click(ref);
      expect(clickResult).toContain('Clicked');

      await new Promise((r) => setTimeout(r, 100));

      const finalCount = store.getState().cart.items.length;
      expect(finalCount).toBe(initialCount + 1);

      document.body.removeChild(host);
    });
  });

  describe("fill", () => {
    it("INTEGRATION: fills real cat-store cart qty input and updates Redux store", async () => {
      const adapter = new DomAdapter({});
      await import("../../web/components/app-root");
      await import("../../web/components/landing-view");
      await import("../../web/components/store-view");
      await import("../../web/components/cart-view");
      await import("../../web/components/toast-host");
      await import("../../web/components/product-card");
      const { store } = await import("../../web/store");
      const { clearCart } = await import("../../web/store/cart-slice");
      store.dispatch(clearCart());
      await import("@material/web/button/filled-button.js");
      await import("@material/web/button/outlined-button.js");
      await import("@material/web/icon/icon.js");
      await import("@material/web/iconbutton/icon-button.js");
      await import("@material/web/textfield/filled-text-field.js");

      const host = document.createElement("div");
      host.id = "host-fill-integration";
      document.body.appendChild(host);
      host.innerHTML = "<app-root></app-root>";
      await new Promise((r) => setTimeout(r, 200));

      const { navigate } = await import("../../web/router");
      const { addToCart } = await import("../../web/store/cart-slice");
      store.dispatch(addToCart({
        product: {
          id: "p01",
          name: "Salmon Pâté",
          category: "Food",
          price: 3.99,
          cost: 2.59,
          inStock: true,
          emoji: "🥫"
        },
        qty: 1
      }));

      navigate("/cart");
      await new Promise((r) => setTimeout(r, 300));

      const initialQty = store.getState().cart.items[0].qty;
      expect(initialQty).toBe(1);

      const out = await adapter.snapshot({});
      const match = out.match(/\[(\d+)\] button "Increase quantity of Salmon Pâté"/);
      expect(match).not.toBeNull();
      const incRef = match![1];

      // Click increment twice to go from qty 1 to qty 3 (2 clicks → +2 qty)
      const click1 = await adapter.click(incRef);
      expect(click1).toContain("Clicked");
      await new Promise((r) => setTimeout(r, 100));

      const click2 = await adapter.click(incRef);
      expect(click2).toContain("Clicked");
      await new Promise((r) => setTimeout(r, 100));

      const finalQty = store.getState().cart.items[0].qty;
      expect(finalQty).toBe(3);

      document.body.removeChild(host);
    });
  });

  describe("selectOption", () => {
    it("INTEGRATION: updates cat-store category filter in Redux", async () => {
      const adapter = new DomAdapter({});
      await import("../../web/components/app-root");
      const { store } = await import("../../web/store");
      const { setFilterCategory } = await import("../../web/store/products-slice");
      store.dispatch(setFilterCategory(""));

      const host = document.createElement("div");
      host.id = "host-select-integration";
      document.body.appendChild(host);
      host.innerHTML = "<app-root></app-root>";
      await new Promise((r) => setTimeout(r, 200));

      const { navigate } = await import("../../web/router");
      navigate("/store");
      await new Promise((r) => setTimeout(r, 300));

      const out = await adapter.snapshot({});
      const match = out.match(/\[(\d+)\] combobox/);
      expect(match).not.toBeNull();
      const ref = match![1];

      await adapter.selectOption(ref, "Food");
      await new Promise((r) => setTimeout(r, 100));

      expect(store.getState().products.filterCategory).toBe("Food");
      document.body.removeChild(host);
    });
  });

  describe("snapshot — orders-page shadow root", () => {
    it("INTEGRATION: lists and clicks the orders-page pagination button inside its shadow root", async () => {
      // orders-page has no Redux slice (it's local @state() + a REST backend),
      // so the observable effect here is the re-rendered pagination text —
      // the equivalent of the Redux assertion the other two components use.
      const ordersStore = new OrdersStore(200);
      vi.stubGlobal("fetch", vi.fn((url: string) => {
        if (url.startsWith("/api/orders?q=")) {
          const q = JSON.parse(decodeURIComponent(url.slice("/api/orders?q=".length))) as DataQuery;
          return Promise.resolve(
            new Response(JSON.stringify(ordersStore.query({ ...q, source: "orders" })), { status: 200 })
          );
        }
        return Promise.resolve(new Response("not found", { status: 404, statusText: "Not Found" }));
      }));

      const adapter = new DomAdapter({});
      await import("../../web/components/app-root");
      await import("../../web/components/orders-page");
      await import("@material/web/button/filled-button.js");

      const host = document.createElement("div");
      host.id = "host-orders-integration";
      document.body.appendChild(host);
      host.innerHTML = "<app-root></app-root>";
      await new Promise((r) => setTimeout(r, 200));

      const { navigate } = await import("../../web/router");
      navigate("/orders");
      await new Promise((r) => setTimeout(r, 300));

      const out = await adapter.snapshot({});
      const ordersPageEl = document.querySelector("app-root")!.shadowRoot!.querySelector("orders-page")!;
      const footerBefore = ordersPageEl.shadowRoot!.querySelector(".pagination-info")?.textContent?.trim();
      expect(footerBefore).toContain("Showing 1–20 of 200");

      const match = out.match(/\[(\d+)\] button "Next"/);
      expect(match).not.toBeNull();
      const ref = match![1];

      const clickResult = await adapter.click(ref);
      expect(clickResult).toContain("Clicked");

      await new Promise((r) => setTimeout(r, 100));

      const footerAfter = ordersPageEl.shadowRoot!.querySelector(".pagination-info")?.textContent?.trim();
      expect(footerAfter).toContain("Showing 21–40 of 200");

      vi.unstubAllGlobals();
      document.body.removeChild(host);
    });
  });

  describe("wait_for", () => {
    it("INTEGRATION: wait_for text_present Order confirmed toast", async () => {
      const adapter = new DomAdapter({});
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
        id: "ORD-1201", createdAt: new Date().toISOString(), customer: "Guest",
        category: "Food", total: 3.99, status: "placed", itemCount: 1, items: "Salmon Pâté",
      }), { status: 201 }))));

      await import("../../web/components/app-root");
      const { store } = await import("../../web/store");
      const { clearCart, addToCart } = await import("../../web/store/cart-slice");
      store.dispatch(clearCart());
      store.dispatch(addToCart({
        product: {
          id: "p01",
          name: "Salmon Pâté",
          category: "Food",
          price: 3.99,
          cost: 2.59,
          inStock: true,
          emoji: "🥫"
        },
        qty: 1
      }));

      const host = document.createElement("div");
      host.id = "host-wait-integration";
      document.body.appendChild(host);
      host.innerHTML = "<app-root></app-root>";
      await new Promise((r) => setTimeout(r, 200));

      const { navigate } = await import("../../web/router");
      navigate("/cart");
      await new Promise((r) => setTimeout(r, 300));

      const out = await adapter.snapshot({});
      const match = out.match(/\[(\d+)\] button "Place order"/i);
      expect(match).not.toBeNull();
      const ref = match![1];

      // The agent path to "Place order" is gated: the block marker sits on the
      // md-filled-button host, and the resolver now walks through the open
      // shadow root to find it. The adapter refuses, so no order is placed.
      const blocked = await adapter.click(ref);
      expect(blocked).toContain('Blocked by interaction policy ("block")');

      // A shopper's own click on the host still runs the order flow, so
      // waitForText can observe the real "Order confirmed" toast.
      const appRoot = document.querySelector("app-root")!;
      const cartView = appRoot.shadowRoot!.querySelector("cart-view")!;
      const placeBtn = cartView.shadowRoot!.querySelector(
        "md-filled-button[data-agent-permission='block']"
      ) as HTMLElement;
      expect(placeBtn).not.toBeNull();
      placeBtn.click();

      const waitPromise = adapter.waitForText("Order confirmed", 2000);
      const waitRes = await waitPromise;
      expect(waitRes).toBe(true);

      vi.unstubAllGlobals();
      document.body.removeChild(host);
    });
  });
});
