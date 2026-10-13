import fs from 'fs';
import path from 'path';
import { test, expect } from './fixtures';
import { ARTIFACTS_DIR } from './helpers';

const ICO = path.resolve(__dirname, '../src/web/favicon.ico');

test('favicon: /favicon.ico is served from the output root as an image', async ({ page }) => {
  const res = await page.request.get('/favicon.ico');
  expect(res.status()).toBe(200);
  // The SPA fallback answers text/html for unknown paths, so the content type is
  // the assertion that actually proves a real icon is being served.
  expect(res.headers()['content-type']).toMatch(/^image\//);
  const body = await res.body();
  expect(body.length).toBe(fs.statSync(ICO).size);
});

test('favicon: index.html declares the icon and no favicon request 404s', async ({ page }) => {
  const seen: { url: string; status: number }[] = [];
  page.on('response', r => {
    if (r.url().includes('favicon.ico')) seen.push({ url: r.url(), status: r.status() });
  });

  // No need for waitForAgentInitSettled: these assertions check the <link> tag
  // and the favicon response, not the agent panel — and the panel does not
  // exist until the launcher is clicked, so that wait would never resolve.
  await page.goto('/');

  const link = page.locator('link[rel~="icon"]');
  await expect(link).toHaveCount(1);
  expect(await link.getAttribute('href')).toBe('favicon.ico');

  // Every favicon response observed during the load must be 200. The console
  // guard cannot catch this: e2e/fixtures.ts allowlists 'Failed to load resource'.
  expect(seen.filter(r => r.status !== 200)).toEqual([]);

  // Fetch the declared href directly, so the assertion holds even when the
  // browser serves the icon from cache and issues no network request.
  const res = await page.request.get('favicon.ico');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^image\//);
});

test('favicon: the browser decodes the ICO', async ({ page }) => {
  await page.goto('/');
  const dims = await page.evaluate(
    () =>
      new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('favicon.ico failed to decode'));
        img.src = 'favicon.ico?e2e=1';
      }),
  );
  expect(dims.w).toBeGreaterThan(0);
  expect(dims.h).toBeGreaterThan(0);
});

test('favicon: capture the icon at 16, 32 and 128 px for visual review', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(() => {
    const row = document.createElement('div');
    row.id = 'favicon-proof';
    row.style.cssText =
      'position:fixed;inset:0;z-index:99999;display:flex;gap:24px;' +
      'align-items:flex-end;justify-content:center;padding:32px;background:#ffffff';
    for (const size of [16, 32, 128]) {
      const img = document.createElement('img');
      img.src = 'favicon.ico';
      img.width = size;
      img.height = size;
      img.style.imageRendering = 'pixelated';
      row.appendChild(img);
    }
    document.body.appendChild(row);
  });

  const row = page.locator('#favicon-proof');
  await expect(row).toBeVisible();
  await expect(row.locator('img')).toHaveCount(3);
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await row.screenshot({ path: path.join(ARTIFACTS_DIR, 'favicon-sizes.png') });
});
