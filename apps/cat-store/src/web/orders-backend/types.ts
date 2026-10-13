// types.ts — shared shapes for the browser-side orders backend modules.

/** Every field is optional; the server fills the rest. */
export interface CreateOrderInput {
  customer?: string;
  category?: string;
  total?: number;
  status?: string;
  itemCount?: number;
  items?: string;
}
