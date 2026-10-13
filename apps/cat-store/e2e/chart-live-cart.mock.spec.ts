import { test, expect } from './fixtures';
import { openPanel, sendChat, waitForTurnComplete } from './helpers';

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test('chart-live-cart: dual-axis cart chart renders safely with zero errors', async ({ page }) => {
  test.setTimeout(45_000);

  // Set up __WA_MOCK_SCRIPT__
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [{
          id: "call_show_chart",
          name: "show_chart",
          input: {
            title: "Products in your cart",
            config: {
              type: "bar",
              data: {
                labels: ["Premium Cat Food", "Cat Toy Mouse"],
                datasets: [
                  { label: "Quantity", data: [3, 1], yAxisID: "qty-axis" },
                  { label: "Price ($)", data: [12.99, 8.5], yAxisID: "price-axis", type: "line" }
                ]
              },
              options: {
                scales: {
                  yAxes: [
                    { id: "qty-axis", position: "left" },
                    { id: "price-axis", position: "right" }
                  ]
                }
              }
            }
          }
        }]
      },
      {
        text: "Here is the chart of products in your cart.",
        finishReason: "stop"
      }
    ];
  });

  // Zero real model network calls
  await page.route('**/api/anthropic/**', (route) => {
    void route.abort();
  });

  await openPanel(page);
  await sendChat(page, 'draw a chart of products in my cart');
  await waitForTurnComplete(page);

  // Wait for canvas element to appear in shadow DOM (AgentChartBlock)
  await page.waitForFunction(() => {
    function findCanvas(root: Document | ShadowRoot): boolean {
      if (root.querySelector('canvas')) return true;
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr && findCanvas(sr)) return true;
      }
      return false;
    }
    return findCanvas(document);
  }, { timeout: 20_000 });

  // Give Chart.js a frame to settle/animate
  await page.waitForTimeout(800);

  // Assert canvas has non-zero bounding box area
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

  expect(maxArea).toBeGreaterThan(1000);
});
