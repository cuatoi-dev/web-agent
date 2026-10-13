import { test, expect } from './fixtures';
import { shot } from './helpers';

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

/** The one shape these specs read off the /api/orders response body — the
 *  real payload (see /api/orders/openapi.json) carries more fields per row. */
interface OrdersResponseBody {
  rows: { id: string }[];
  page: { total: number };
}

/** SPA-navigate to Orders via the in-app nav link. A deep link to /orders 404s
 *  on the webpack dev server (no history fallback), so never page.goto('orders'). */
async function gotoOrdersViaNav(page: import('@playwright/test').Page) {
  await page.goto('', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const link = page.locator('app-root nav a[href="#/orders"]');
  await link.waitFor({ state: 'visible', timeout: 15_000 });
  await link.click();
  await page.locator('orders-page').waitFor({ state: 'visible', timeout: 15_000 });
}

test('orders table is rendered from a live HTTP response (Express :20030)', async ({ page }) => {
  // Capture the real orders response — proof the rows crossed the network.
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/orders?') && r.request().method() === 'GET',
    { timeout: 30_000 },
  );

  await gotoOrdersViaNav(page);

  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as OrdersResponseBody;

  // Shape of the server payload (see /api/orders/openapi.json).
  expect(Array.isArray(body.rows)).toBe(true);
  expect(body.rows.length).toBeGreaterThan(0);
  expect(typeof body.page.total).toBe('number');

  const rows = page.locator('orders-page table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBe(body.rows.length);

  // Every rendered row id comes from the payload, in payload order.
  const renderedIds = await rows.locator('td:nth-child(1)').allInnerTexts();
  expect(renderedIds.map((t) => t.trim())).toEqual(body.rows.map((r) => r.id));

  // The pagination footer reflects the server-reported total.
  await expect(page.locator('orders-page .pagination-info'))
    .toContainText(String(body.page.total));

  // No error banner.
  await expect(page.locator('orders-page .error-container')).toHaveCount(0);

  await shot(page, 'orders-http.png');
});

test('the table follows the HTTP payload, not a client-side array (sentinel)', async ({ page }) => {
  const SENTINEL_ID = 'ORD-SENTINEL-7f3a';
  let intercepted = 0;

  await page.route('**/api/orders?*', async (route) => {
    intercepted++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'orders',
        aggregated: false,
        fields: [],
        rows: [{
          id: SENTINEL_ID,
          createdAt: '2026-01-02T03:04:05.000Z',
          customer: 'Sentinel Cat',
          category: 'Food',
          total: 42.5,
          status: 'delivered',
          itemCount: 1,
          items: 'Sentinel Pâté',
        }],
        page: { limit: 20, offset: 0, total: 1, hasMore: false },
      }),
    });
  });

  await gotoOrdersViaNav(page);

  const rows = page.locator('orders-page table tbody tr');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBe(1);
  await expect(rows.first()).toContainText(SENTINEL_ID);
  await expect(rows.first()).toContainText('Sentinel Cat');
  await expect(rows.first()).toContainText('$42.50');
  await expect(page.locator('orders-page .pagination-info')).toContainText('of 1');
  expect(intercepted).toBeGreaterThan(0);
});
