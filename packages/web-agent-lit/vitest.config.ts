import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@cuatoi/web-agent-core": path.resolve(__dirname, "../web-agent-core/src"),
      "@cuatoi/web-agent-lit": path.resolve(__dirname, "./src"),
    },
  },
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
