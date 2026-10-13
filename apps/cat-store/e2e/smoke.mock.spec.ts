import { test, expect } from './fixtures';
import { openPanel, shot } from './helpers';

test('smoke: panel opens', async ({ page }) => {
  await openPanel(page);
  await expect(page.locator('agent-chat-panel #input')).toBeVisible();
  await expect(page.locator('agent-chat-panel .input-area md-icon-button[data-aria-label="Send"]')).toBeVisible();
  await shot(page, 'smoke-panel.png');
});
