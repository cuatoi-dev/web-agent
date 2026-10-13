import { test, expect } from './fixtures';

test('finance charts render in the gallery (canvases + no error cards)', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('gallery.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('agent-chat-panel', { timeout: 15_000 });
  await page.waitForTimeout(1500); // let Chart.js settle across all panels

  // Count <canvas> across all shadow roots + measure max area.
  const canvasAreas = await page.evaluate(() => {
    const areas: number[] = [];
    function walk(root: Document | ShadowRoot) {
      for (const c of root.querySelectorAll('canvas')) {
        const r = (c as HTMLElement).getBoundingClientRect();
        areas.push(r.width * r.height);
      }
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) walk(sr);
      }
    }
    walk(document);
    return areas;
  });
  // ≥6 finance/chart canvases (bar + candlestick + payoff + equity + drawdown + volume + waterfall)
  const rendered = canvasAreas.filter((a) => a > 1000);
  expect(rendered.length, 'rendered chart canvases').toBeGreaterThanOrEqual(6);

  // No chart error cards anywhere in the gallery.
  const errorCards = await page.evaluate(() => {
    let n = 0;
    function walk(root: Document | ShadowRoot) {
      n += root.querySelectorAll('.error-card').length;
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) walk(sr);
      }
    }
    walk(document);
    return n;
  });
  expect(errorCards, 'chart error cards').toBe(0);

  await page.screenshot({ path: 'e2e-screenshots/finance-charts-gallery.png', fullPage: true });
});
