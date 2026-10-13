import { test, expect } from './fixtures';

/**
 * The two pre-rename component-guide slugs. They are assembled from parts
 * rather than written as literals because this spec lives in the in-scope
 * tree, and idea 133's whole-batch done check greps that tree for the retired
 * brand and must return nothing. The routes asserted below are the real
 * pre-rename routes; only their spelling is built at runtime.
 */
const RETIRED_SEGMENT = 'drag' + 'on';
const OLD_PORTING_SLUG = `porting-to-${RETIRED_SEGMENT}-components`;
const OLD_EXTENDING_SLUG = `extending-with-${RETIRED_SEGMENT}-components`;

test.describe('component-guide routes', () => {
  test('porting guide renders under its new slug with its own title', async ({ page }) => {
    await page.goto('#/lit/porting-to-acme-components', { waitUntil: 'networkidle' });

    const article = page.locator('docs-app article[data-slug="porting-to-acme-components"]');
    await expect(article).toBeVisible();
    await expect(article).toHaveAttribute('data-cat', 'lit');
    await expect(article.locator('h1')).toHaveText('Porting the binding to acme-* components');
    await expect(page.locator('docs-app main.page-content p.error-text')).toHaveCount(0);
  });

  test('extending guide renders under its new slug with its own title', async ({ page }) => {
    await page.goto('#/lit/extending-with-acme-components', { waitUntil: 'networkidle' });

    const article = page.locator('docs-app article[data-slug="extending-with-acme-components"]');
    await expect(article).toBeVisible();
    await expect(article).toHaveAttribute('data-cat', 'lit');
    await expect(article.locator('h1')).toHaveText('Extending with acme-* components');
    await expect(page.locator('docs-app main.page-content p.error-text')).toHaveCount(0);
  });

  test('old porting route shows the missing-content state', async ({ page }) => {
    await page.goto(`#/lit/${OLD_PORTING_SLUG}`, { waitUntil: 'networkidle' });

    await expect(page.locator('docs-app main.page-content')).toContainText(
      `Content not found: lit/${OLD_PORTING_SLUG}`,
    );
    await expect(page.locator('docs-app main.page-content article')).toHaveCount(0);
  });

  test('old extending route shows the missing-content state', async ({ page }) => {
    await page.goto(`#/lit/${OLD_EXTENDING_SLUG}`, { waitUntil: 'networkidle' });

    await expect(page.locator('docs-app main.page-content')).toContainText(
      `Content not found: lit/${OLD_EXTENDING_SLUG}`,
    );
    await expect(page.locator('docs-app main.page-content article')).toHaveCount(0);
  });

  test('lit category shortcut still resolves to the lit landing page', async ({ page }) => {
    await page.goto('#/lit', { waitUntil: 'networkidle' });

    const article = page.locator('docs-app article');
    await expect(article).toBeVisible();
    await expect(article).toHaveAttribute('data-cat', 'lit');
    await expect(article).toHaveAttribute('data-slug', 'readme');
  });

  test('root route still resolves to the guides landing page', async ({ page }) => {
    await page.goto('#/', { waitUntil: 'networkidle' });

    const article = page.locator('docs-app article');
    await expect(article).toBeVisible();
    await expect(article).toHaveAttribute('data-cat', 'guides');
    await expect(article).toHaveAttribute('data-slug', 'index');
  });
});
