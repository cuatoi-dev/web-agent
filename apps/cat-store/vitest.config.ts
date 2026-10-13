import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    // DOM specs live in test-dom/ and run via `pnpm test:dom`. They mount real
    // elements and await updateComplete, which hangs rather than fails in a
    // headless container, so they are kept out of the fast tier.
    exclude: ["test-dom/**"],
  },
});
