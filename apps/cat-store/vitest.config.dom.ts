import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// ---------------------------------------------------------------------------
// The DOM test tier.
//
// These specs mount real custom elements and `await element.updateComplete` to
// wait for Lit to settle the DOM. That await is what makes them fragile in a
// headless CI container: when a dependency the component reaches for is not
// working there, the promise never resolves and the spec HANGS rather than
// failing, taking the whole run with it.
//
// They are split out so a CI pipeline can run them on their own — a different
// container, a longer timeout, its own retry policy, or not at all — without
// touching the fast tier. `vitest.config.ts` excludes `test-dom/`, so
// `pnpm test` never picks these up.
//
// Split on 2026-09-06 at the user's instruction. The discriminator is
// `await ...updateComplete`, nothing looser.
// ---------------------------------------------------------------------------
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["test-dom/**/*.test.ts"],
    exclude: ["test-dom/**/*.lit1-compat.test.ts"],
  },
});
