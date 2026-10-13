import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@cuatoi/web-agent-core": path.resolve(__dirname, "../web-agent-core/src"),
      "@cuatoi/web-agent-lit": path.resolve(__dirname, "../web-agent-lit/src"),
      "@cuatoi/web-agent-vfs/lit": path.resolve(__dirname, "./src/lit"),
      "@cuatoi/web-agent-vfs": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test-dom/**/*.test.ts"],
    exclude: [],
  },
});
