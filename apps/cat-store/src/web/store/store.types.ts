// store.types.ts — the two shapes derived from the configured store.
//
// Kept out of `types.ts` on purpose: both read `typeof store`, and `types.ts`
// is imported by the slice modules that `store.ts` itself imports. Declaring
// them there would close a cycle (types.ts -> store.ts -> cart-slice.ts ->
// types.ts). Only `index.ts` imports this file.
import type { store } from "./store";

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
