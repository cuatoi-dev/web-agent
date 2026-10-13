import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-lit";
import { store } from "./index";
import { addToCart } from "./cart-slice";
import { SEED_PRODUCTS } from "./seed";
import { selectCartCount } from "./cart-slice";

export const addToCartTool: CustomToolDef = {
  name: "add_to_cart",
  description:
    "Add a product to the shopping cart by product ID and quantity. " +
    "Dispatches the Redux cart action directly — more reliable than clicking Add-to-cart buttons.",
  inputSchema: z.object({
    productId: z.string().describe("Product ID (e.g. p01, p02). Use query_data or snapshot_page to discover IDs."),
    qty: z.number().int().min(1).describe("Number of units to add (must be ≥ 1)."),
  }).strict(),
  promptSnippet:
    "Use add_to_cart({productId, qty}) to add items to the shopping cart. " +
    "It is always preferred over DOM clicks for cart actions.",
  renderer: (input) => {
    const { productId, qty } = input as { productId?: string; qty?: number };
    const product = SEED_PRODUCTS.find((p) => p.id === productId);
    const label = product ? `${product.emoji} ${product.name}` : (productId ?? "item");
    const n = typeof qty === "number" ? qty : 1;
    return `Added <b>${n}× ${label}</b> to your cart 🛒`;
  },
  execute: (input: Record<string, unknown>) => {
    const { productId, qty } = input as { productId: string; qty: number };
    const product = SEED_PRODUCTS.find((p) => p.id === productId);
    if (!product) {
      const valid = SEED_PRODUCTS.map((p) => `${p.id} (${p.name})`).join(", ");
      return Promise.resolve({
        content: `Unknown productId "${productId}". Valid IDs: ${valid}.`,
        isError: true,
      });
    }
    if (!product.inStock) {
      return Promise.resolve({
        content: `"${product.name}" (${productId}) is currently out of stock.`,
        isError: true,
      });
    }
    store.dispatch(addToCart({ product, qty }));
    const cartCount = selectCartCount(store.getState());
    return Promise.resolve({
      content:
        `Added ${qty}× ${product.emoji} ${product.name} to cart. ` +
        `Cart now has ${cartCount} item(s) total.`,
    });
  },
};
