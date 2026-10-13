import { test, expect } from './fixtures';
import { openBubble, shot } from './helpers';

test('smoke: bubble opens', async ({ page }) => {
  await openBubble(page);
  await expect(page.locator('agent-chat-panel')).toBeVisible();
  await expect(page.locator('agent-chat-panel .wa-textarea')).toBeVisible();
  await shot(page, 'smoke-bubble.png');
});

test('smoke: lit-html-binding page renders', async ({ page }) => {
  // The docs site is now a SPA with hash routing — navigate via the hash route.
  await page.goto('#/lit/lit-html-binding', { waitUntil: 'networkidle' });
  // Wait for the article to reflect the correct slug before asserting content.
  await expect(page.locator('docs-app article')).toHaveAttribute('data-slug', 'lit-html-binding');
  // Title present
  await expect(page.locator('docs-app article h1')).toContainText('lit-html binding');
  // API compat table is visible (the "render(result, container)" row)
  await expect(page.locator('docs-app article table').first()).toBeVisible();
  // No console errors (console-guard fixture handles this)
  await shot(page, 'smoke-lit-html-binding-page.png');
});
