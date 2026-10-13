// types.ts — shared shapes for the cat-store Redux store modules.

import type { GenuiDiagnostic, GenuiScreenshotResult } from "../../shared/types";
import type { GenuiConfig, ValidationResult } from "../genui/types";

// --- seed.ts ----------------------------------------------------------------

export type ProductCategory = "Food" | "Toys" | "Beds" | "Grooming" | "Health";

export interface ProductItem {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
  cost: number;
  inStock: boolean;
  emoji: string;
}

// --- promotions.ts ----------------------------------------------------------

export interface Promo {
  id: string;
  label: string;
  productIds: string[];   // qualifying product IDs
  buyQty: number;         // trigger threshold
  freeQty: number;        // free units granted per buyQty units paid
}

// --- cart-slice.ts ----------------------------------------------------------

export interface CartLineItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  freeQty: number;       // free units from active promo (0 when no promo)
  promoLabel?: string;   // e.g. "Buy 3 Get 1 Free" (undefined when freeQty === 0)
}

export interface CartState {
  items: CartLineItem[];
  subtotal: number;
  discount: number;   // total value of free units
  total: number;      // subtotal − discount
}

// --- products-slice.ts ------------------------------------------------------

export interface ProductsState {
  items: ProductItem[];
  filterCategory: string;
}

// --- ui-slice.ts ------------------------------------------------------------

export interface UiState {
  route: string;
  lastOrder: { id: string; total: number; at: number } | null;
  toast: string | null;
}

// --- genui-tool.ts ----------------------------------------------------------

/** What the tool needs from the page that owns the frame. <agent-page>
 *  satisfies this directly, so the host passes `this`. Keeping it an interface
 *  is what lets the unit tests drive the tool with a plain object and no DOM. */
export interface GenuiToolHost {
  readonly genuiConfig: GenuiConfig;
  readonly screenshotAvailable: boolean;
  // `this: void` on every method: none of them read `this`, and it lets a
  // caller reference `host.mount` etc. as a bare value (e.g. in a mock
  // assertion) without eslint's unbound-method warning.
  validateSource(this: void, source: string): Promise<ValidationResult>;
  mount(this: void, source: string): Promise<void>;
  drainDiagnostics(this: void): GenuiDiagnostic[];
  screenshot(this: void, timeoutMs?: number): Promise<GenuiScreenshotResult>;
}
