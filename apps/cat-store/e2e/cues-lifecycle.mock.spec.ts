/**
 * Deterministic gate spec for the agent cursor.
 *
 * Asserts the cursor becomes visible, a pulse appears (click cue), a flash appears
 * (fill/see cue), then everything clears — with NO LLM involvement. Mirrors the
 * present-to-user.mock.spec.ts pattern: real cursor DOM, screenshots saved to e2e-screenshots/.
 */
import { test, expect } from './fixtures';
import path from 'path';
import fs from 'fs';

const DEMO_URL = 'gallery.html?frame=demo-cues'; // baseURL supplied by playwright.config.ts
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'e2e-screenshots');

test('cues-lifecycle: cursor travels, pulses on click, flashes on fill, then clears', async ({ page }) => {
  test.setTimeout(30_000);

  await page.goto(DEMO_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.locator('#runCues').waitFor({ state: 'visible', timeout: 15_000 });

  // ── Click #runCues — cursor should become visible ──
  await page.locator('#runCues').click();

  await page.waitForFunction(() => {
    function traverse(root: Document | ShadowRoot): boolean {
      if (root.querySelectorAll('.wa-agent-cursor.wa-agent-cursor--visible').length > 0) return true;
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr && traverse(sr)) return true;
      }
      return false;
    }
    return traverse(document);
  }, { timeout: 5_000, polling: 100 });

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'cues-lifecycle-click.png'), fullPage: true });

  // ── Wait for pulse element (click cue) ──
  await page.waitForFunction(() => {
    function traverse(root: Document | ShadowRoot): number {
      let n = root.querySelectorAll('.wa-cursor-pulse').length;
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) n += traverse(sr);
      }
      return n;
    }
    return traverse(document) >= 1;
  }, { timeout: 5_000, polling: 100 });

  // ── Wait for flash element (fill/see cue) ──
  await page.waitForFunction(() => {
    function traverse(root: Document | ShadowRoot): number {
      let n = root.querySelectorAll('.wa-cursor-flash').length;
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) n += traverse(sr);
      }
      return n;
    }
    return traverse(document) >= 1;
  }, { timeout: 8_000, polling: 200 });

  // ── Wait for full settle + cursor.clear() — no transients remain, cursor hidden ──
  await page.waitForFunction(() => {
    function traverse(root: Document | ShadowRoot): { transients: number; visible: boolean } {
      const transients = root.querySelectorAll('.wa-cursor-pulse, .wa-cursor-flash').length;
      const visible = root.querySelectorAll('.wa-agent-cursor.wa-agent-cursor--visible').length > 0;
      let totalTransients = transients;
      let anyVisible = visible;
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) {
          const c = traverse(sr);
          totalTransients += c.transients;
          anyVisible = anyVisible || c.visible;
        }
      }
      return { transients: totalTransients, visible: anyVisible };
    }
    const c = traverse(document);
    return c.transients === 0 && !c.visible;
  }, { timeout: 8_000, polling: 250 });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'cues-lifecycle-cleared.png'), fullPage: true });

  // Final assertion: no transient cursor children remain.
  const finalTransients = await page.evaluate(() => {
    function traverse(root: Document | ShadowRoot): number {
      let n = root.querySelectorAll('.wa-cursor-pulse, .wa-cursor-flash').length;
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) n += traverse(sr);
      }
      return n;
    }
    return traverse(document);
  });
  expect(finalTransients).toBe(0);

  // ── Word-by-word fill assertion: input should hold the full typed value ──
  const inputValue = await page.evaluate(() => (document.getElementById('input') as HTMLInputElement)?.value ?? '');
  expect(inputValue).toBe('hello agent world');

  // Log should contain an intermediate step (proves word-by-word, not instant set).
  const logText = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
  // "→ hello " is the first word chunk, logged by the input event listener.
  expect(logText).toContain('→ hello ');
  expect(logText).toContain('✓ fill typed: hello agent world');
});
