/**
 * Deterministic gate spec for the agent cursor on the docs-site (Lit-1 embed).
 *
 * Asserts the cursor becomes visible, a pulse appears (click cue), a flash appears
 * (fill/see cue), then everything clears — with NO LLM involvement. The docs-site
 * embed renders the cursor layer into light DOM, so we query document directly.
 *
 * Screenshots saved to apps/docs-site/e2e-screenshots/.
 */
import { test, expect } from './fixtures';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEMO_URL = 'gallery.html?frame=demo-cues'; // baseURL supplied by playwright.config.ts
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'e2e-screenshots');

test('cues-lifecycle: cursor travels, pulses on click, flashes on fill, then clears', async ({ page }) => {
  test.setTimeout(30_000);

  await page.goto(DEMO_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.locator('#runCues').waitFor({ state: 'visible', timeout: 15_000 });

  // ── Click #runCues — cursor should become visible ──
  await page.locator('#runCues').click();

  await page.waitForFunction(
    () => document.querySelectorAll('.wa-agent-cursor.wa-agent-cursor--visible').length > 0,
    { timeout: 5_000, polling: 100 },
  );

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'cues-lifecycle-click.png'), fullPage: true });

  // ── Wait for pulse element (click cue) ──
  await page.waitForFunction(
    () => document.querySelectorAll('.wa-cursor-pulse').length >= 1,
    { timeout: 5_000, polling: 100 },
  );

  // ── Wait for flash element (fill/see cue) ──
  await page.waitForFunction(
    () => document.querySelectorAll('.wa-cursor-flash').length >= 1,
    { timeout: 8_000, polling: 200 },
  );

  // ── Wait for full settle — no transients remain, cursor hidden ──
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.wa-cursor-pulse, .wa-cursor-flash').length === 0 &&
      document.querySelectorAll('.wa-agent-cursor.wa-agent-cursor--visible').length === 0,
    { timeout: 8_000, polling: 250 },
  );

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'cues-lifecycle-cleared.png'), fullPage: true });

  // Final assertion: overlay fully cleared.
  const finalTransients = await page.evaluate(
    () => document.querySelectorAll('.wa-cursor-pulse, .wa-cursor-flash').length,
  );
  expect(finalTransients).toBe(0);
});
