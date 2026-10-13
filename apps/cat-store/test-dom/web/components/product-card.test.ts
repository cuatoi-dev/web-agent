import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

import "../../../src/web/components/product-card";
import type { ProductCard } from "../../../src/web/components/product-card";
import { clearCart, selectCart } from "../../../src/web/store/cart-slice";
import { SEED_PRODUCTS } from "../../../src/web/store/seed";
import { store } from "../../../src/web/store";

describe("ProductCard", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    store.dispatch(clearCart());
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  async function mountCard(): Promise<ProductCard> {
    const card = document.createElement("product-card") as ProductCard;
    card.product = SEED_PRODUCTS[0];
    container.appendChild(card);
    await card.updateComplete;
    return card;
  }

  it("renders a native number input with initial value 1", async () => {
    const card = await mountCard();
    const input = card.shadowRoot?.querySelector("input") as HTMLInputElement;

    expect(input.type).toBe("number");
    expect(input.value).toBe("1");
  });

  it("rewrites a zero quantity to 1 when the input changes", async () => {
    const card = await mountCard();
    const input = card.shadowRoot?.querySelector("input") as HTMLInputElement;

    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await card.updateComplete;
    expect(input.value).toBe("0");

    input.dispatchEvent(new Event("change", { bubbles: true }));
    await card.updateComplete;
    expect(input.value).toBe("1");
  });

  it("adds the typed quantity to the cart and resets the input", async () => {
    const card = await mountCard();
    const input = card.shadowRoot?.querySelector("input") as HTMLInputElement;
    const button = card.shadowRoot?.querySelector("md-filled-button") as HTMLElement;

    input.value = "3";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await card.updateComplete;
    button.click();
    await card.updateComplete;

    const line = selectCart(store.getState()).items.find((item) => item.productId === card.product.id);
    expect(line?.qty).toBe(3);
    expect(input.value).toBe("1");
  });
});
