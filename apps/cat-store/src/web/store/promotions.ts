import type { Promo } from "./types";

export type { Promo } from "./types";

export const PROMOTIONS: Promo[] = [
  {
    id: "b3g1",
    label: "Buy 3 Get 1 Free",
    productIds: ["p01", "p02", "p03", "p04"],  // all Food items
    buyQty: 3,
    freeQty: 1,
  },
  {
    id: "b5g2",
    label: "Buy 5 Get 2 Free",
    productIds: ["p05", "p06", "p07", "p08"],  // all Toy items
    buyQty: 5,
    freeQty: 2,
  },
];

export function findPromoForProduct(productId: string): Promo | undefined {
  return PROMOTIONS.find((p) => p.productIds.includes(productId));
}
