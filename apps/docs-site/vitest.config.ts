import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@cuatoi\/web-agent-lit\/themes$/, replacement: path.resolve(__dirname, "../../packages/web-agent-lit/src/themes/registry.ts") },
      { find: "@cuatoi/web-agent-core", replacement: path.resolve(__dirname, "../../packages/web-agent-core/src") },
      { find: "@cuatoi/web-agent-lit", replacement: path.resolve(__dirname, "../../packages/web-agent-lit/src") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts"],
  },
});
