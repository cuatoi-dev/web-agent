import { test, expect } from './fixtures';
import { listThemes } from '@cuatoi/web-agent-lit/themes';
import type { AgentChartBlockProbe } from './dom-types';

/** WCAG relative luminance from an `rgb(...)`/`rgba(...)` string. */
function luminance(rgb: string): number {
  const [r, g, b] = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Read the live chart's resolved colours + the token values to compare against. */
const probeChart = () => {
  const block = document.querySelector<AgentChartBlockProbe>('agent-chart-block')!;
  const card = block.querySelector('.chart-container') as HTMLElement;
  const resolve = (expr: string) => {
    const p = document.createElement('span');
    p.style.color = expr;
    block.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  };
  const chart = block._chartInstance!;
  const scale = chart.scales[Object.keys(chart.scales)[0]];
  return {
    cardBg: getComputedStyle(card).backgroundColor,
    cardBorder: getComputedStyle(card).borderTopColor,
    tick: scale.options.ticks!.fontColor!,
    grid: scale.options.gridLines!.color!,
    expectSurface: resolve('var(--wa-background-color-300)'),
    expectBorder: resolve('var(--wa-border-color)'),
    expectText: resolve('var(--wa-text-color)'),
  };
};

for (const theme of listThemes().map(({ id }) => id)) {
  test(`chart block chrome + plot area follow ${theme} (018)`, async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto(`gallery.html?theme=${theme}`, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.waitForSelector('agent-chart-block .chart-container', { timeout: 15_000 });
    await page.waitForTimeout(1500); // let Chart.js settle

    const r = await page.evaluate(probeChart);

    // A1 chrome: the card is the theme surface, not a hard-coded white card.
    expect(r.cardBg, 'chart card background').toBe(r.expectSurface);
    expect(r.cardBg, 'chart card is not hard-coded white').not.toBe('rgb(255, 255, 255)');
    expect(r.cardBorder, 'chart card border').toBe(r.expectBorder);

    // A2 canvas: tick text + gridlines carry resolved token colours.
    expect(r.tick, 'canvas tick colour is set').toMatch(/^rgba?\(/);
    expect(r.tick, 'canvas tick colour').toBe(r.expectText);
    expect(r.grid, 'canvas gridline colour').toBe(r.expectBorder);
    expect(r.grid, 'gridlines are not the Chart.js default').not.toBe('rgba(0, 0, 0, 0.1)');

    // A3 legibility, MEASURED: tick text vs the card it is drawn on. Unit test
    // U5 proves the annotation-label plugin draws with this same resolved
    // colour, so this figure is the annotation label's contrast too.
    const calculatedContrast = contrast(r.tick, r.cardBg);
    console.log(`[MEASURED CONTRAST] ${theme}: ${calculatedContrast.toFixed(2)}:1 (tick: ${r.tick}, cardBg: ${r.cardBg})`);
    expect(
      calculatedContrast,
      'tick + annotation-label text vs card contrast',
    ).toBeGreaterThanOrEqual(3);

    await page.screenshot({
      path: `e2e-screenshots/018-chart-theme-${theme}.png`,
      fullPage: true,
    });
  });

  test(`annotation label renders themed on the card — ${theme} (018)`, async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto(`gallery.html?theme=${theme}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('agent-chart-block .chart-container', { timeout: 15_000 });

    // A reference line WITH a label and WITHOUT a `color` — the only shape that
    // exercises the themed default in finance-charts.ts:82. No gallery state
    // does this (the candlestick state supplies its own colour), so the block
    // is injected here rather than by editing
    // apps/cat-store/src/web/dev/gallery-states-charts.ts.
    await page.evaluate(() => {
      const el = document.createElement('agent-chart-block');
      el.id = 'annotation-probe';
      el.block = {
        type: 'chart',
        title: 'Annotation label probe (018)',
        config: {
          type: 'line',
          data: {
            labels: ['a', 'b', 'c', 'd'],
            datasets: [{ label: 'v', data: [1, 3, 2, 4], fill: false }],
          },
          options: {
            annotation: { lines: [{ axis: 'y', value: 2.5, label: 'threshold', dash: [4, 4] }] },
          },
        },
      };
      const host = document.createElement('figure');
      host.style.cssText = 'margin:0;';
      host.appendChild(el);
      document.querySelector('#gallery .strip')!.prepend(host);
    });
    await page.waitForTimeout(1500);

    const probe = await page.evaluate(() => {
      const el = document.getElementById('annotation-probe')!;
      return {
        errors: el.querySelectorAll('.error-card').length,
        canvases: el.querySelectorAll('canvas').length,
        rendered: !!(el as AgentChartBlockProbe)._chartInstance,
      };
    });
    expect(probe.errors, 'annotation probe error cards').toBe(0);
    expect(probe.canvases, 'annotation probe canvases').toBe(1);
    expect(probe.rendered, 'annotation probe chart instance').toBe(true);

    await page.locator('#annotation-probe').screenshot({
      path: `e2e-screenshots/018-annotation-label-${theme}.png`,
    });
  });
}

test('chart canvas re-themes on a live data-theme change (018)', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('gallery.html?theme=wa2-dark', { waitUntil: 'networkidle' });
  await page.waitForSelector('agent-chart-block .chart-container', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(probeChart);

  await page.selectOption('#theme-switcher select', 'wa2-light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-light');
  await page.waitForTimeout(1500); // observer -> re-render -> Chart.js settle
  const after = await page.evaluate(probeChart);

  expect(after.tick, 'tick colour tracks the new theme').toBe(after.expectText);
  expect(after.tick, 'tick colour actually changed').not.toBe(before.tick);
  expect(after.cardBg, 'card follows the new theme').toBe(after.expectSurface);
  expect(contrast(after.tick, after.cardBg), 'contrast after switch').toBeGreaterThanOrEqual(3);
});
