import { test, expect } from './fixtures';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type MdIndexEntry = {
  slug: string;
  title: string;
  category: string;
  folder: string;
  order: number;
  headings: { level: number; text: string }[];
  text: string;
};

const mdIndex = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../dist/md-index.json'), 'utf-8'),
) as MdIndexEntry[];
const guideEntries = mdIndex.filter((e) => e.category === 'Guides');

test('showcase guide is indexed and beercss slug absent from Guides', () => {
  const showcaseEntry = guideEntries.find((e) => e.slug === 'showcase');
  expect(showcaseEntry).toBeTruthy();
  expect(showcaseEntry!.category).toBe('Guides');

  const beerCssGuideEntry = guideEntries.find((e) => e.slug === 'beercss');
  expect(beerCssGuideEntry).toBeUndefined();
});

test('no astro files or src/pages dir remain', () => {
  const srcDir = path.resolve(__dirname, '../src');
  const pagesDir = path.join(srcDir, 'pages');
  const showcaseMd = path.join(srcDir, 'content', 'showcase.md');

  expect(fs.existsSync(pagesDir)).toBe(false);
  expect(fs.existsSync(showcaseMd)).toBe(true);

  // No .astro anywhere under src/
  function findAstro(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findAstro(full));
      else if (entry.name.endsWith('.astro')) results.push(full);
    }
    return results;
  }
  expect(findAstro(srcDir)).toHaveLength(0);
});

test('showcase renders with labeled controls', async ({ page }) => {
  await page.goto('#/guides/showcase', { waitUntil: 'networkidle' });

  const article = page.locator('docs-app article');
  await expect(article).toHaveAttribute('data-slug', 'showcase');

  // Buttons
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

  // Text input
  await expect(page.getByLabel('Full name')).toBeVisible();

  // Textarea
  await expect(page.getByRole('textbox', { name: /Message/ })).toBeVisible();

  // Table
  await expect(page.getByRole('table')).toBeVisible();

  // Switch
  await expect(page.getByText('Dark mode')).toBeVisible();

  // Checkbox
  await expect(page.getByText('Subscribe to newsletter')).toBeVisible();
});

test('Dark-mode switch toggles on click', async ({ page }) => {
  await page.goto('#/guides/showcase', { waitUntil: 'networkidle' });

  const darkSwitch = page.getByLabel('Dark mode');
  await expect(darkSwitch).not.toBeChecked();

  await page.getByText('Dark mode').click();
  await expect(darkSwitch).toBeChecked();

  await page.getByText('Dark mode').click();
  await expect(darkSwitch).not.toBeChecked();
});

test('migrated guide renders with h1 and hash links', async ({ page }) => {
  await page.goto('#/guides/index', { waitUntil: 'networkidle' });

  const article = page.locator('docs-app article');
  await expect(article).toHaveAttribute('data-slug', 'index');

  await expect(page.locator('docs-app article h1')).toBeVisible();

  // At least one internal hash link — confirms link rewrite worked
  const hashLink = page.locator('docs-app article a[href^="#/guides/"]').first();
  await expect(hashLink).toBeVisible();
});
