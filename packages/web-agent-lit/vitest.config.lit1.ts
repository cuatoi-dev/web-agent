import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@cuatoi/web-agent-core": path.resolve(__dirname, "../web-agent-core/src"),
      "@cuatoi/web-agent-lit": path.resolve(__dirname, "./src"),
      "lit-html": path.resolve(__dirname, "./node_modules/lit-html-v1"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test-dom/**/*.lit1-compat.test.ts"],
  },
});
