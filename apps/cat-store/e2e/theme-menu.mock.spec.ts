import path from 'path';
import fs from 'fs';
import { test, expect } from './fixtures';
import { ARTIFACTS_DIR, chooseTheme } from './helpers';

test('theme menu lists every registered theme, marks the active one, and persists the choice', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-dark');

  const button = page.locator('app-root .theme-menu-button');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  const items = page.locator('app-root .theme-menu-item');
  await expect(items).toHaveText([/WA v1 \(Dark\)/, /WA v2 \(Dark\)/, /WA v2 \(Light\)/]);
  await expect(page.locator('app-root .theme-menu-item[aria-checked="true"]')).toHaveAttribute('data-theme-id', 'wa2-dark');
  await expect(page.locator('app-root .theme-menu-item[data-theme-id="wa2-dark"] .theme-menu-check')).toHaveText('✓');
  await expect(page.locator('app-root .theme-menu-item[data-theme-id="wa1-dark"] .theme-menu-check')).toHaveText('');

  // Not clipped: every item lies inside the viewport, and its text fits its box.
  for (let i = 0; i < 3; i++) {
    const box = await items.nth(i).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
    expect(await items.nth(i).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'theme-menu-open-wa2-dark.png') });

  await page.locator('app-root .theme-menu-item[data-theme-id="wa1-dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa1-dark');
  await expect(page.locator('app-root .theme-menu')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa1-dark');
  await button.click();
  await expect(page.locator('app-root .theme-menu-item[aria-checked="true"]')).toHaveAttribute('data-theme-id', 'wa1-dark');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'theme-menu-open-wa1-dark.png') });

  await page.keyboard.press('Escape');
  await expect(page.locator('app-root .theme-menu')).toHaveCount(0);

  await button.click();
  await page.locator('app-root .logo').click();
  await expect(page.locator('app-root .theme-menu')).toHaveCount(0);

  await chooseTheme(page, 'wa2-light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-light');
  await chooseTheme(page, 'wa2-dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-dark');
});

const FIXTURE_CSS = `[data-theme="fixture-three"] {
  --wa-font-size-xl: 21px;
  --wa-text-shadow: none;
  --wa-header-text-shadow: none;
}`;
const FIXTURE_VALUES: Record<string, string> = {
  '--wa-font-size-xl': '21px',
  '--wa-text-shadow': 'none',
  '--wa-header-text-shadow': 'none',
};

for (const order of ['tokens first', 'fixture first'] as const) {
  test(`a partial theme with base wa2-dark: declared tokens win, the rest are wa2-dark (${order})`, async ({ page }) => {
    await page.goto('/');
    const tokensCss = await page.evaluate(() => {
      for (const s of Array.from(document.querySelectorAll('style'))) {
        if (s.textContent?.includes(':where([data-theme-base="wa2-dark"])')) return s.textContent;
      }
      return '';
    });
    expect(tokensCss).not.toBe('');
    const styles = order === 'tokens first'
      ? `<style>${tokensCss}</style><style>${FIXTURE_CSS}</style>`
      : `<style>${FIXTURE_CSS}</style><style>${tokensCss}</style>`;
    await page.setContent(
      `<!DOCTYPE html><html><head>${styles}</head><body>` +
      `<div id="themed" data-theme="fixture-three" data-theme-base="wa2-dark"></div>` +
      `<div id="reference" data-theme="wa2-dark"></div></body></html>`,
    );
    const result = await page.evaluate((fixtureNames) => {
      const names = new Set<string>();
      for (const sheet of Array.from(document.styleSheets)) {
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes('[data-theme="wa2-dark"]')) continue;
          for (let i = 0; i < rule.style.length; i++) {
            const n = rule.style.item(i);
            if (n.startsWith('--wa-')) names.add(n);
          }
        }
      }
      const themed = getComputedStyle(document.getElementById('themed')!);
      const reference = getComputedStyle(document.getElementById('reference')!);
      const declared: Record<string, string> = {};
      for (const n of fixtureNames) declared[n] = themed.getPropertyValue(n).trim();
      const mismatched = [...names]
        .filter((n) => !fixtureNames.includes(n))
        .filter((n) => themed.getPropertyValue(n) !== reference.getPropertyValue(n));
      return { tokenCount: names.size, declared, mismatched };
    }, Object.keys(FIXTURE_VALUES));
    expect(result.tokenCount).toBeGreaterThan(Object.keys(FIXTURE_VALUES).length);
    expect(result.declared).toEqual(FIXTURE_VALUES);
    expect(result.mismatched).toEqual([]);
  });
}
