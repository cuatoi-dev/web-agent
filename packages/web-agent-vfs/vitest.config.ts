import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@cuatoi/web-agent-core": path.resolve(__dirname, "../web-agent-core/src"),
      "@cuatoi/web-agent-lit": path.resolve(__dirname, "../web-agent-lit/src"),
    },
  },
  test: { environment: "jsdom", globals: true, include: ["src/**/*.test.ts"], exclude: ["test-dom/**"] },
});
