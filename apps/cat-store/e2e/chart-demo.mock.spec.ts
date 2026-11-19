import { test, expect } from './fixtures';

test('chart-datasource-demo: canvas has non-zero area (Chart.js)', async ({ page }) => {
  test.setTimeout(30_000);

  // Use full URL (baseURL + relative goto breaks dynamic chunk loading)
  // The datasource chart is now a gallery frame. `/public/cat-store/*`
  // 301-redirects to `/cat-store/*`, so the canonical path is used directly.
  await page.goto('http://localhost:28780/cat-store/gallery.html?frame=demo-chart-datasource');

  // Wait for a <canvas> to appear (Chart.js rendered)
  await page.waitForFunction(() => {
    function findCanvas(root: Document | ShadowRoot) {
      if (root.querySelector('canvas')) return true;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && findCanvas(el.shadowRoot)) return true;
      }
      return false;
    }
    return findCanvas(document);
  }, { timeout: 20_000 });

  // Give Chart.js a frame to settle
  await page.waitForTimeout(800);

  // Assert: canvas has non-zero bounding box (traverse shadow roots)
  const maxArea = await page.evaluate(() => {
    function traverse(root: Document | ShadowRoot): number {
      let maxA = 0;
      for (const el of root.querySelectorAll('canvas')) {
        const r = el.getBoundingClientRect();
        maxA = Math.max(maxA, r.width * r.height);
      }
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) maxA = Math.max(maxA, traverse(sr));
      }
      return maxA;
    }
    return traverse(document);
  });
  expect(maxArea, 'canvas should have positive area (not collapsed)').toBeGreaterThan(1000);

  // Screenshot for visual review
  await page.screenshot({ path: 'e2e-screenshots/chart-demo-visible.png', fullPage: true });
});
