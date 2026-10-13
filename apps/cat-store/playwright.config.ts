import { defineConfig } from '@playwright/test';

const ENV = process.env.E2E_ENV ?? 'mock';
const LOCAL = ENV === 'local';
const MOCK = ENV === 'mock';
const DEMO = ENV === 'demo';
const USE_LOCAL_SERVER = LOCAL || MOCK;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  fullyParallel: false,
  testMatch: DEMO ? '**/*.demo.spec.ts' : LOCAL ? '**/gallery-capture.mock.spec.ts' : '**/*.mock.spec.ts',
  testIgnore: undefined,
  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    baseURL: USE_LOCAL_SERVER
      ? 'http://localhost:10030/'
      : 'http://localhost:28780/cat-store/',
  },
  // Two processes for the local/mock tiers. Playwright registers one plugin per
  // array entry and awaits each `setup` in order (playwright 1.58.2:
  // lib/runner/tasks.js), so the orders API is proven reachable BEFORE the
  // webpack dev server is started/awaited — the dev server proxies /api/orders
  // to :20030 and must never be the first thing to discover the API is down.
  // `reuseExistingServer: true` on both: the deployed pm2 `cat-store` service
  // already owns :20030 on the dev host, and a dev server may already be
  // running on :10030. Playwright probes the readiness URL first and skips the
  // spawn when it answers — and, because it never launched that process, it
  // does not kill it on teardown either.
  webServer: USE_LOCAL_SERVER
    ? [
        {
          name: 'orders-api',
          // build:server keeps dist/node in step on a clean checkout; it is a
          // no-op-cheap tsc run and never executes when :20030 already answers.
          command: 'pnpm build:server && pnpm start:server',
          url: 'http://localhost:20030/api/orders/describe',
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          name: 'web',
          command: 'pnpm dev',
          url: 'http://localhost:10030/',
          reuseExistingServer: true,
          timeout: 120_000,
          ignoreHTTPSErrors: true,
        },
      ]
    : undefined,
  reporter: [['list']],
});
