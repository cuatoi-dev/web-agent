import { test, expect } from './fixtures';
import { chooseTheme, gotoAgentPage } from './helpers';
import path from 'path';
import fs from 'fs';

// Task 004: genui frame mount — Material render, replacement, plain profile,
// theme sync, and drag-resize (pointer-events:none on iframe).

const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../../temp/artifacts/2026-08-26-182335-004-genui-frame-delivery-and-mount',
);

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

// The frame's inline <style> block and mounted style= attributes trigger
// CSP violations when the parent page sets default-src 'none'. Allow it
// through for this spec — the frame has no CSP meta tag of its own.
test.use({ consoleErrorExtraAllowlist: ['Content Security Policy'] });

test('scenario 1: frame loads inside .col-side at #/agent', async ({ page }) => {
  await gotoAgentPage(page);

  const side = page.locator('agent-page .col-side');
  await expect(side).toBeVisible();

  const iframe = side.locator('iframe.genui-frame');
  await expect(iframe).toBeVisible();

  const box = await iframe.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);

  // The iframe fills the aside (same bounding box within rounding).
  const sideBox = await side.boundingBox();
  expect(Math.abs(box!.width - sideBox!.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(box!.height - sideBox!.height)).toBeLessThanOrEqual(2);
});

test('scenario 2: mount() renders a Material filled button inside the frame', async ({ page }) => {
  await gotoAgentPage(page);

  await page.evaluate(() => {
    void window.__WA_GENUI_MOUNT__!(
      '<md-filled-button id="test-btn">Confirm</md-filled-button>'
    );
  });
  // Wait for custom element upgrade + render frame
  await page.waitForTimeout(500);

  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  const btn = frame!.locator('#test-btn');
  await expect(btn).toBeAttached({ timeout: 10_000 });

  // md-filled-button is upgraded — wait for Lit to finish rendering.
  // Poll for the element to have non-zero dimensions (upgraded elements
  // get styled dimensions; un-upgraded unknown elements get 0x0).
  await frame!.waitForFunction(
    () => {
      const el = document.querySelector('#test-btn');
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 20 && rect.height > 10;
    },
    { timeout: 10_000 },
  );

  const box = await btn.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(20);
  expect(box!.height).toBeGreaterThan(10);
});

test('scenario 3: second mount() replaces the first render', async ({ page }) => {
  await gotoAgentPage(page);

  await page.evaluate(() => {
    void window.__WA_GENUI_MOUNT__!(
      '<div id="first">First Render</div>'
    );
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    void window.__WA_GENUI_MOUNT__!(
      '<div id="second">Second Render</div>'
    );
  });
  await page.waitForTimeout(300);

  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  const first = frame!.locator('#first');
  const second = frame!.locator('#second');

  await expect(second).toBeAttached({ timeout: 5_000 });
  await expect(first).toHaveCount(0);
});

test('scenario 4: plain HTML button renders under plain profile', async ({ page }) => {
  await gotoAgentPage(page);

  // Navigate the iframe to plain profile.
  const iframe = page.locator('agent-page .col-side iframe.genui-frame');
  await iframe.evaluate((el: HTMLIFrameElement) => { el.src = 'genui/frame?profile=plain'; });
  await page.waitForTimeout(1000);

  const frame = page.frame({ url: /genui\/frame.*profile=plain/ });
  expect(frame).not.toBeNull();

  // Wait for the frame to fully load
  await frame!.waitForLoadState('load');

  await page.evaluate(() => {
    void window.__WA_GENUI_MOUNT__!(
      '<button id="plain-btn" style="background: var(--wa-action-color-info, #6200ee); color: #fff; padding: 8px 16px; border: none; border-radius: 4px;">Plain Button</button>'
    );
  });
  await page.waitForTimeout(500);

  const btn = frame!.locator('#plain-btn');
  await expect(btn).toBeAttached({ timeout: 10_000 });

  const box = await btn.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(20);
  expect(box!.height).toBeGreaterThan(10);

  // No Material bundle loaded — custom element not defined.
  const materialDefined = await frame!.evaluate(() =>
    !!customElements.get('md-filled-button')
  );
  expect(materialDefined).toBe(false);
});

test('scenario 5: host theme change propagates to the frame', async ({ page }) => {
  await gotoAgentPage(page);

  // Wait for the frame's onload to fire and set initial theme.
  await page.waitForTimeout(500);

  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  // Initial theme should be dark (default).
  const initialTheme = await frame!.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(initialTheme).toBe('wa2-dark');

  // Toggle host to light.
  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
    { timeout: 5_000 },
  );

  // Frame should now be light too.
  const lightTheme = await frame!.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(lightTheme).toBe('wa2-light');

  // Toggle back to dark.
  await chooseTheme(page, 'wa2-dark');
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme') === 'wa2-dark',
    { timeout: 5_000 },
  );

  const darkTheme = await frame!.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  );
  expect(darkTheme).toBe('wa2-dark');

  // A third built-in theme: the frame follows it, with no base attribute.
  await chooseTheme(page, 'wa1-dark');
  await expect
    .poll(() => frame!.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe('wa1-dark');
  expect(
    await frame!.evaluate(() => document.documentElement.hasAttribute('data-theme-base')),
  ).toBe(false);
});

test('scenario 6: drag-resize works with the iframe present (pointer-events:none)', async ({ page }) => {
  await gotoAgentPage(page);

  // The iframe is present in .col-side
  const iframe = page.locator('agent-page .col-side iframe.genui-frame');
  await expect(iframe).toBeVisible();

  // Drag divider left (widen panel) — same direction as scenario 6 in
  // agent-right-panel.mock.spec.ts, which still passes.
  const divider = page.locator('agent-page .col-divider');
  const c = await divider.boundingBox();
  expect(c).not.toBeNull();
  const cx = c!.x + c!.width / 2;
  const cy = c!.y + c!.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 200, cy, { steps: 10 });
  await page.mouse.up();

  const sideBox = await page.locator('agent-page .col-side').boundingBox();
  expect(sideBox!.width).toBeCloseTo(520, 0);

  // Drag divider right (narrow panel) — this was the failing scenario 7.
  await page.mouse.move(cx - 200, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 200 + 300, cy, { steps: 10 });
  await page.mouse.up();

  const sideBox2 = await page.locator('agent-page .col-side').boundingBox();
  expect(sideBox2!.width).toBeCloseTo(220, 0);
});

test('scenario 7: screenshots for theme and plain profile', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  await gotoAgentPage(page);

  // --- Light theme, Material mount ---
  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
    { timeout: 5_000 },
  );
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    void window.__WA_GENUI_MOUNT__!(
      '<md-filled-button id="order-btn" style="--md-filled-button-container-color: var(--wa-action-color-info);">Submit Order</md-filled-button>'
    );
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, '01-mount-light.png'),
    fullPage: true,
  });

  // --- Dark theme, Material mount ---
  await chooseTheme(page, 'wa2-dark');
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme') === 'wa2-dark',
    { timeout: 5_000 },
  );
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, '03-mount-dark.png'),
    fullPage: true,
  });

  // --- Plain profile ---
  const iframe = page.locator('agent-page .col-side iframe.genui-frame');
  await iframe.evaluate((el: HTMLIFrameElement) => {
    el.src = 'genui/frame?profile=plain';
  });
  await page.waitForTimeout(1500);

  const frame = page.frame({ url: /genui\/frame.*profile=plain/ });
  expect(frame).not.toBeNull();
  await frame!.waitForLoadState('load');

  await page.evaluate(() => {
    void window.__WA_GENUI_MOUNT__!(
      '<button id="plain-btn" style="background: var(--wa-action-color-info, #6200ee); color: #fff; padding: 8px 16px; border: none; border-radius: 4px;">Plain Button</button>'
    );
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, '04-plain-profile.png'),
    fullPage: true,
  });
});
