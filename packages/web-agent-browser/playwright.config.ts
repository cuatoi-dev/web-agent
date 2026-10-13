import { defineConfig } from "@playwright/test";

const DEMO = process.env.E2E_ENV === "demo";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  testMatch: DEMO ? "**/*.demo.spec.ts" : "**/*.mock.spec.ts",
  // Static fixture pages. A content script does not run on file:// URLs, so the
  // mock tier needs a real origin. Port 10040 — see the Dev ports table in the
  // repo-root AGENTS.md.
  webServer: {
    command: "node e2e/fixtures-server.mjs",
    url: "http://localhost:10040/plain.html",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  reporter: [["list"]],
});
