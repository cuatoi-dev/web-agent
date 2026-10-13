import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@cuatoi/web-agent-core": path.resolve(__dirname, "../web-agent-core/src"),
      // The generic lit alias maps a subpath to its source folder, but there is
      // no src/themes.ts, so the themes subpath needs its own entry first.
      "@cuatoi/web-agent-lit/themes": path.resolve(__dirname, "../web-agent-lit/src/themes/registry.ts"),
      "@cuatoi/web-agent-lit": path.resolve(__dirname, "../web-agent-lit/src"),
    },
  },
  test: { environment: "jsdom", globals: true, include: ["src/**/*.test.ts"] },
});
