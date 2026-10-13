import { expect, test } from '@playwright/test';
import { listThemes } from '@cuatoi/web-agent-lit/themes';

// The gallery page itself is the system under test: it reads the real theme
// registry through `listThemes()` and applies each id with the registry's
// `applyTheme`. No mock seam — the page must prove the production path.

/** The cat-store gallery default when `?theme=` is absent or unknown. */
const DEFAULT_THEME = 'wa2-dark';

test('gallery lists every registered theme and selection sets the root and the URL', async ({ page }) => {
  await page.goto('gallery.html', { waitUntil: 'networkidle' });
  const select = page.locator('#theme-select');

  await expect(select.locator('option')).toHaveText(listThemes().map((t) => t.label));
  await expect(select).toHaveValue(DEFAULT_THEME);
  await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);

  for (const theme of listThemes()) {
    await select.selectOption(theme.id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    await expect(select).toHaveValue(theme.id);
    await expect(page).toHaveURL(new RegExp(`[?&]theme=${theme.id}(?:&|$)`));
  }
});

test('every registered theme id reaches the viewport frames through the URL', async ({ page }) => {
  await page.goto('gallery.html', { waitUntil: 'networkidle' });
  const select = page.locator('#theme-select');

  for (const theme of listThemes()) {
    await select.selectOption(theme.id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    for (const frame of await page.locator('iframe.vp-desktop, iframe.vp-mobile').all()) {
      await expect(frame).toHaveAttribute('src', new RegExp(`[?&]theme=${theme.id}(?:&|$)`));
    }
  }
});

test.describe('query fallbacks', () => {
  for (const search of ['', '?theme=', '?theme=no-such-theme', '?theme=wa1-light']) {
    test(`resolves ${search || '(absent)'} to ${DEFAULT_THEME}`, async ({ page }) => {
      const warnings: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'warning') warnings.push(m.text());
      });

      await page.goto(`gallery.html${search}`, { waitUntil: 'networkidle' });

      await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
      await expect(page.locator('#theme-select')).toHaveValue(DEFAULT_THEME);
      // Resolution picks the registered fallback before applying, so the
      // registry never sees the unknown id and never warns about it.
      expect(warnings.filter((w) => w.includes('unknown theme'))).toEqual([]);
    });
  }

  test('a valid id is found after other parameters and the others survive', async ({ page }) => {
    await page.goto('gallery.html?vp=desktop&frame=&theme=wa1-dark', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa1-dark');
    await expect(page.locator('#theme-select')).toHaveValue('wa1-dark');
    expect(new URL(page.url()).searchParams.get('vp')).toBe('desktop');

    await page.locator('#theme-select').selectOption('wa2-light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-light');
    const url = new URL(page.url());
    expect(url.searchParams.get('theme')).toBe('wa2-light');
    expect(url.searchParams.get('vp')).toBe('desktop');
    expect(url.searchParams.get('frame')).toBe('');
  });

  test('a built-in theme leaves no data-theme-base on the root', async ({ page }) => {
    await page.goto('gallery.html', { waitUntil: 'networkidle' });
    await page.locator('#theme-select').selectOption('wa1-dark');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-base', /.*/);
  });
});