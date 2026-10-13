import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { expect, test } from '@playwright/test';
import { listThemes } from '@cuatoi/web-agent-lit/themes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Transient review artifacts — `e2e/artifacts/` is gitignored; delete when the
// task closes (project screenshot-hygiene rule).
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts/006-theme');

for (const theme of listThemes().map(({ id }) => id)) {
  test(`gallery-docs-site — ${theme} desktop + mobile capture`, async ({ page }) => {
    test.skip(
      (process.env.E2E_ENV ?? 'public') !== 'local',
      'gallery-capture only runs with E2E_ENV=local (via pnpm capture:gallery)',
    );

    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    await page.goto(`gallery.html?theme=${theme}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector('agent-chat-panel', { timeout: 15_000 });
    // Proves the selector actually applied the theme before anything is captured.
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('#theme-switcher select')).toHaveValue(theme);
    // Proves the attribute resolves into real computed styles: `body`'s background
    // must equal the active `[data-theme]` block's --wa-background-color.
    const resolved = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const value = root.getPropertyValue('--wa-background-color').trim();
      const probe = document.createElement('div');
      probe.style.backgroundColor = value;
      document.body.appendChild(probe);
      const resolvedColor = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { value, resolvedColor, bodyBg: getComputedStyle(document.body).backgroundColor };
    });
    expect(resolved.value).toBeTruthy();
    expect(resolved.bodyBg).toBe(resolved.resolvedColor);
    await page.waitForTimeout(1500);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);
    const desktopPath = path.join(ARTIFACTS_DIR, `gallery-docs-site-${theme}-desktop.png`);
    await page.screenshot({ path: desktopPath, fullPage: true });
    console.log(`[gallery-capture] desktop → ${desktopPath}`);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(500);
    const ipadPath = path.join(ARTIFACTS_DIR, `gallery-docs-site-${theme}-ipad.png`);
    await page.screenshot({ path: ipadPath, fullPage: true });
    console.log(`[gallery-capture] ipad    → ${ipadPath}`);
  });
}
