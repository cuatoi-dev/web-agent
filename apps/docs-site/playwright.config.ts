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
      ? 'http://localhost:10031/public/web-agent-docs/'
      : 'http://localhost:28780/public/web-agent-docs/',
  },
  webServer: USE_LOCAL_SERVER
    ? {
        command: 'pnpm dev',
        url: 'http://localhost:10031/public/web-agent-docs/',
        reuseExistingServer: true,
        timeout: 30_000,
        ignoreHTTPSErrors: true,
      }
    : undefined,
  reporter: [['list']],
});
