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
const beerCssEntries = mdIndex.filter((e) => e.category === 'Beer CSS Reference');

test('sidebar renders guides and beercss reference counts correctly', async ({ page }) => {
  await page.goto('', { waitUntil: 'networkidle' });
  
  // Wait for the docs-app element and sidebar links
  await expect(page.locator('docs-app .side-nav')).toBeVisible();
  
  // Guides count check
  const guideLinks = page.locator('docs-app .side-nav > a[href^="#/guides/"]');
  await expect(guideLinks).toHaveCount(guideEntries.length);
  
  // Beer CSS collapsible section check — scoped to the section that holds
  // beercss links, since each package now also renders a details.nav-details.
  const beerCssDetails = page.locator('docs-app .side-nav details.nav-details:has(a[href^="#/beercss/"])');
  await expect(beerCssDetails).toBeVisible();

  // Beer CSS links count check
  const beerCssLinks = beerCssDetails.locator('a[href^="#/beercss/"]');
  await expect(beerCssLinks).toHaveCount(beerCssEntries.length);
});

test('default route renders overview guide', async ({ page }) => {
  await page.goto('', { waitUntil: 'networkidle' });
  const article = page.locator('docs-app article');
  await expect(article).toBeVisible();
  await expect(article).toHaveAttribute('data-cat', 'guides');
  await expect(article).toHaveAttribute('data-slug', 'index');
  // Check that it's rendered markdown (has H1, paragraphs, etc.), not raw md text
  await expect(page.locator('docs-app article h1')).toBeVisible();
  // Regression guard: YAML frontmatter (layout/title) must be stripped, never
  // shown as body text. Uses the REAL md file, not a route mock.
  const articleText = await article.innerText();
  expect(articleText).not.toContain('layout:');
  expect(articleText).not.toMatch(/^\s*---/);
});

test('click link navigates via hash routing with no page reload', async ({ page }) => {
  await page.goto('', { waitUntil: 'networkidle' });
  
  // Set window marker to check for reloads
  await page.evaluate(() => {
    window.__noReloadMarker = 'persisted';
  });
  
  // Click the architecture link
  const targetLink = page.locator('docs-app .side-nav a[href="#/guides/architecture"]').first();
  await targetLink.click();
  
  // Check location hash
  await expect(page).toHaveURL(/#\/guides\/architecture$/);
  
  // Check article content updated
  const article = page.locator('docs-app article');
  await expect(article).toHaveAttribute('data-cat', 'guides');
  await expect(article).toHaveAttribute('data-slug', 'architecture');
  
  // Assert no reload happened
  const marker = await page.evaluate(() => window.__noReloadMarker);
  expect(marker).toBe('persisted');
  
  // Check active class on the link
  await expect(targetLink).toHaveClass(/active/);
});

test('mobile drawer link navigates and closes the drawer', async ({ page }) => {
  // Narrow viewport so the side-nav is hidden and the drawer is the nav path.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    window.__noReloadMarker = 'persisted';
  });

  // Open the drawer via the hamburger, then tap a drawer link. Beer CSS's
  // data-ui closes the drawer; the @click handler forces the hash route
  // (regression: data-ui used to preventDefault the anchor → no navigation).
  await page.locator('header button.responsive-nav-trigger').click();
  const drawer = page.locator('#sidebar');
  await expect(drawer).toHaveClass(/active/);
  await page.locator('#sidebar a[href="#/guides/theming"]').click();

  await expect(page).toHaveURL(/#\/guides\/theming$/);
  const article = page.locator('docs-app article');
  await expect(article).toHaveAttribute('data-slug', 'theming');
  await expect(drawer).not.toHaveClass(/active/);
  const marker = await page.evaluate(() => window.__noReloadMarker);
  expect(marker).toBe('persisted');
});

test('header link navigates and closes the drawer (regression: stuck drawer after hash change)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    window.__noReloadMarker = 'persisted';
  });

  // Open the drawer via the hamburger
  await page.locator('header button.responsive-nav-trigger').click();
  const drawer = page.locator('#sidebar');
  await expect(drawer).toHaveClass(/active/);

  // Click a HEADER link (Overview) — this is the link that has no data-ui
  // and was previously leaving the drawer stuck open.
  // Model the agent's programmatic click (synthetic event) — a hit-tested click
  // can't reach the header link because Beer's .overlay (same z-index, later in DOM)
  // covers it while the drawer is open.
  await page.locator('header a[href="#/"]').dispatchEvent('click');

  // Drawer must be closed after the header-link nav
  await expect(drawer).not.toHaveClass(/active/);

  // Content must have routed (Overview → guides/index)
  const article = page.locator('docs-app article');
  await expect(article).toHaveAttribute('data-slug', 'index');

  // No page reload
  const marker = await page.evaluate(() => window.__noReloadMarker);
  expect(marker).toBe('persisted');
});

test('click beercss link renders beercss reference page', async ({ page }) => {
  await page.goto('', { waitUntil: 'networkidle' });
  
  // Open details if not open — scoped to the section that holds beercss
  // links, since each package now also renders a details.nav-details.
  const details = page.locator('docs-app .side-nav details.nav-details:has(a[href^="#/beercss/"])');
  const summary = details.locator('summary');
  const isOpen = await details.evaluate((el: HTMLDetailsElement) => el.open);
  if (!isOpen) {
    await summary.click();
  }
  
  const targetLink = page.locator('docs-app .side-nav a[href="#/beercss/button"]').first();
  await targetLink.click();
  
  await expect(page).toHaveURL(/#\/beercss\/button$/);
  
  const article = page.locator('docs-app article');
  await expect(article).toHaveAttribute('data-cat', 'beercss');
  await expect(article).toHaveAttribute('data-slug', 'button');
});

test('web-agent-bubble element instance persists across route changes', async ({ page }) => {
  await page.goto('', { waitUntil: 'networkidle' });
  
  // Locate the bubble and set a custom property on it
  await page.evaluate(() => {
    const bubble = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble');
    if (bubble) {
      bubble.__instanceMarker = 'unique-bubble-instance';
    }
  });
  
  // Navigate to another route by clicking
  const targetLink = page.locator('docs-app .side-nav a[href="#/guides/architecture"]').first();
  await targetLink.click();
  
  // Confirm the marker is still there on the bubble
  const marker = await page.evaluate(() => {
    const bubble = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble');
    return bubble ? bubble.__instanceMarker : null;
  });
  expect(marker).toBe('unique-bubble-instance');
});

test('deep linking and back/forward navigation work', async ({ page }) => {
  // Load deep link directly
  await page.goto('#/core/tools', { waitUntil: 'networkidle' });

  const article = page.locator('docs-app article');
  await expect(article).toHaveAttribute('data-cat', 'core');
  await expect(article).toHaveAttribute('data-slug', 'tools');
  
  // Navigate to another page by clicking
  await page.locator('docs-app .side-nav a[href="#/guides/architecture"]').first().click();
  await expect(article).toHaveAttribute('data-slug', 'architecture');
  
  // Go back
  await page.goBack();
  await expect(article).toHaveAttribute('data-slug', 'tools');
  
  // Go forward
  await page.goForward();
  await expect(article).toHaveAttribute('data-slug', 'architecture');
});

test('markdown sanitization strips script tags', async ({ page }) => {
  // Intercept the fetch to a specific markdown file
  await page.route('**/content/guides/architecture.md', route => {
    void route.fulfill({
      status: 200,
      contentType: 'text/markdown',
      body: '# Architecture\n<script>window.malicious = true;</script>\n**bold content**',
    });
  });
  
  // Go to the page and navigate to it
  await page.goto('', { waitUntil: 'networkidle' });
  await page.locator('docs-app .side-nav a[href="#/guides/architecture"]').first().click();

  // Wait for the routed content to actually render (data-slug flips) before
  // asserting on its contents — otherwise we may read the previous page's DOM.
  await expect(page.locator('docs-app article')).toHaveAttribute('data-slug', 'architecture');

  // Confirm the bold tag is parsed (strong tag)
  await expect(page.locator('docs-app article strong')).toContainText('bold content');
  
  // Confirm script tag is stripped and window.malicious is not set
  const scriptCount = await page.locator('docs-app article script').count();
  expect(scriptCount).toBe(0);
  
  const maliciousSet = await page.evaluate(() => window.malicious);
  expect(maliciousSet).toBeUndefined();
});

test('package sections render and route', async ({ page }) => {
  const sections = [...new Set(mdIndex
    .filter((e) => !['Guides', 'Beer CSS Reference'].includes(e.category))
    .map((e) => e.category))];
  await page.goto('', { waitUntil: 'networkidle' });

  // one collapsible section per package, in md-index order
  const summaries = page.locator('docs-app .side-nav details.nav-details summary');
  await expect(summaries).toHaveCount(sections.length + 1);   // + Beer CSS Reference

  // a package page opens and reports its own category folder
  await page.goto('#/dom/tools', { waitUntil: 'networkidle' });
  const article = page.locator('docs-app article');
  await expect(article).toHaveAttribute('data-cat', 'dom');
  await expect(article).toHaveAttribute('data-slug', 'tools');
  await expect(article.locator('h1')).toBeVisible();

  // the same slug in a different package is a different page
  await page.goto('#/core/tools', { waitUntil: 'networkidle' });
  await expect(article).toHaveAttribute('data-cat', 'core');
  const coreTitle = await article.locator('h1').innerText();
  expect(coreTitle).not.toBe('DOM and State Tools');
});
