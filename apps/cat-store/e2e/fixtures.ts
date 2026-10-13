import { test as base, expect } from '@playwright/test';

/**
 * Known-benign console error substrings — keep this list minimal.
 * Prefer fixing real errors rather than suppressing them.
 *
 * Rule: each entry needs a comment explaining WHY it is allowed.
 */
const CONSOLE_ERROR_ALLOWLIST: readonly string[] = [
  // Lit ships a dev-mode warning as console.error when built without
  // `NODE_ENV=production`. Fires only in local dev (pnpm dev), never on the
  // deployed public endpoint. Included defensively so local runs stay green.
  'Lit is in dev mode.',
  // The cloud LLM backend intermittently
  // returns 5xx under load — a transient backend hiccup, not a code
  // regression. The real regression we guard (MissingToolResultsError) is
  // caught by the per-turn and final text assertions in each spec.
  'Failed to load resource',
];

/**
 * Known-benign page (uncaught exception) error substrings.
 * Empty by default — add entries only with a documented reason.
 */
const PAGE_ERROR_ALLOWLIST: readonly string[] = [];

/**
 * requestfailed: NOT asserted by default.
 *
 * Tests run against the live public endpoint; transient DNS/TCP blips would
 * cause false positives on every retry. Wire it for visibility only (log to
 * stderr) so real failures are visible in the test output without blocking CI.
 * If a specific spec needs strict request-failure assertions, it can add its
 * own listener on top of this fixture.
 */

type GuardFixtures = {
  // shadows the built-in `page` fixture — existing tests need no change
  // other than the single import-line swap
  page: import('@playwright/test').Page;
  /**
   * Per-test extra console-error allowlist entries.
   * Pass via `test.use({ consoleErrorExtraAllowlist: ['…'] })`.
   */
  consoleErrorExtraAllowlist: string[];
  /**
   * Per-test extra page-error (uncaught exception) allowlist entries.
   * Pass via `test.use({ pageErrorExtraAllowlist: ['…'] })`.
   * Needed by specs that make the page throw on purpose.
   */
  pageErrorExtraAllowlist: string[];
};

export const test = base.extend<GuardFixtures>({
  consoleErrorExtraAllowlist: [[], { option: true }],
  pageErrorExtraAllowlist: [[], { option: true }],
  page: async ({ page, consoleErrorExtraAllowlist, pageErrorExtraAllowlist }, use, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const allowlist = [...CONSOLE_ERROR_ALLOWLIST, ...consoleErrorExtraAllowlist];
    const pageAllowlist = [...PAGE_ERROR_ALLOWLIST, ...pageErrorExtraAllowlist];

    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (allowlist.some(s => text.includes(s))) return;
      consoleErrors.push(text);
    });

    page.on('pageerror', err => {
      const text = err.message;
      if (pageAllowlist.some(s => text.includes(s))) return;
      // Keep the stack: without it a crash is reported with no location, which
      // makes an uncaught page error effectively undiagnosable from the log.
      pageErrors.push(err.stack ? `${text}\n${err.stack}` : text);
    });

    // Log failed requests to stderr for visibility, but do not hard-fail.
    page.on('requestfailed', req => {
      const url = req.url();
      const reason = req.failure()?.errorText ?? 'unknown';
      process.stderr.write(`[e2e requestfailed] ${reason} ${url}\n`);
    });

    await use(page);

    // --- Teardown assertions ---
    // Run after the test body; any error here marks the test failed.
    if (consoleErrors.length > 0) {
      throw new Error(
        `[console-guard] ${consoleErrors.length} console error(s) in "${testInfo.title}":\n` +
        consoleErrors.map((e, i) => `  ${i + 1}. ${e}`).join('\n'),
      );
    }
    if (pageErrors.length > 0) {
      throw new Error(
        `[console-guard] ${pageErrors.length} uncaught page error(s) in "${testInfo.title}":\n` +
        pageErrors.map((e, i) => `  ${i + 1}. ${e}`).join('\n'),
      );
    }
  },
});

export { expect };
